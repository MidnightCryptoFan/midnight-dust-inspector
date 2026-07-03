import { z } from "zod"
import type {
  CardanoAsset,
  CardanoUtxo,
  CardanoUtxoAsset,
} from "@/domain/cardanoAccount"
import { DEFAULT_CARDANO_NIGHT_POLICY_ID } from "@/domain/cardanoAccount"
import type {
  CardanoChainProvider,
  CardanoTransaction,
  CardanoTransactionDetails,
} from "./CardanoChainProvider"
import { DUST_CONTRACT } from "./dustContract"
import { parseRegistrationDatum } from "@/lib/registrationDatum"
import { bytesToHex, decodeBech32 } from "@/lib/bech32"

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

const koiosTransactionSchema = z
  .object({
    tx_hash: z.string(),
    block_time: z.union([z.number(), z.string(), z.null()]).optional(),
    block_height: z.union([z.number(), z.string(), z.null()]).optional(),
  })
  .passthrough()

const koiosAccountTransactionsSchema = z.array(koiosTransactionSchema)

const koiosMetadataSchema = z
  .object({
    tx_hash: z.string(),
    metadata: z.unknown().nullable().optional(),
  })
  .passthrough()

const koiosMetadataResponseSchema = z.array(koiosMetadataSchema)

const koiosTxAssetItemSchema = z
  .object({
    policy_id: z.string(),
    quantity: z.union([z.string(), z.number()]),
  })
  .passthrough()

const koiosTxOutputSchema = z
  .object({
    tx_index: z.union([z.number(), z.string()]),
    payment_addr: z
      .object({
        bech32: z.string(),
      })
      .passthrough(),
    stake_addr: z.string().nullable().optional(),
    asset_list: z.array(koiosTxAssetItemSchema).optional().default([]),
  })
  .passthrough()

const koiosTxInfoSchema = z
  .object({
    tx_hash: z.string(),
    outputs: z.array(koiosTxOutputSchema).optional().default([]),
  })
  .passthrough()

const koiosTxInfoResponseSchema = z.array(koiosTxInfoSchema)

const koiosAssetSchema = z
  .object({
    policy_id: z.string(),
    asset_name: z.string(),
    fingerprint: z.string().nullable().optional(),
    decimals: z.union([z.number(), z.string(), z.null()]).optional(),
    quantity: z.union([z.string(), z.number()]),
  })
  .passthrough()

const koiosAccountAssetsSchema = z.array(koiosAssetSchema)

const koiosAccountAddressSchema = z
  .object({
    stake_address: z.string(),
    addresses: z.array(z.string()).optional().default([]),
  })
  .passthrough()

const koiosAccountAddressesSchema = z.array(koiosAccountAddressSchema)

const koiosUtxoSchema = z
  .object({
    tx_hash: z.string(),
    tx_index: z.union([z.number(), z.string()]),
    address: z.string(),
    stake_address: z.string().nullable().optional(),
    block_time: z.union([z.number(), z.string(), z.null()]).optional(),
    block_height: z.union([z.number(), z.string(), z.null()]).optional(),
    asset_list: z.array(koiosAssetSchema).optional().default([]),
  })
  .passthrough()

const koiosAddressUtxosSchema = z.array(koiosUtxoSchema)

const koiosUtxoInfoItemSchema = z
  .object({
    tx_hash: z.string(),
    tx_index: z.union([z.number(), z.string()]),
  })
  .passthrough()

const koiosUtxoInfoSchema = z.array(koiosUtxoInfoItemSchema)

const koiosScriptUtxoItemSchema = z
  .object({
    tx_hash: z.string(),
    tx_index: z.union([z.number(), z.string()]),
    inline_datum: z.object({ bytes: z.string() }).nullable().optional(),
  })
  .passthrough()

const koiosScriptUtxosSchema = z.array(koiosScriptUtxoItemSchema)

const koiosTxInputSchema = z
  .object({
    payment_addr: z
      .object({
        bech32: z.string().optional(),
        cred: z.string().optional(),
      })
      .passthrough()
      .optional(),
    stake_addr: z.string().nullable().optional(),
    asset_list: z.array(koiosTxAssetItemSchema).optional().default([]),
  })
  .passthrough()

const koiosTxInfoWithInputsSchema = z
  .object({
    tx_hash: z.string(),
    inputs: z.array(koiosTxInputSchema).optional().default([]),
    outputs: z.array(koiosTxOutputSchema).optional().default([]),
  })
  .passthrough()

const koiosTxInfoWithInputsResponseSchema = z.array(koiosTxInfoWithInputsSchema)

/** Koios caps every response at this many rows; larger result sets are paged. */
const KOIOS_PAGE_SIZE = 1000

/** An unspent UTxO at the DUST registration script with its parsed datum. */
export type ScriptRegistrationUtxo = {
  txHash: string
  outputIndex: number
  /** The c_wallet payment key hash recorded in the registration datum. */
  cWalletKeyHash: string
  dustAddressHex: string | null
}

export type ActiveAccountRegistration = ScriptRegistrationUtxo & {
  /** True when c_wallet matches one of the payment key hashes the caller supplied. */
  ownedByWallet: boolean
}

export class KoiosCardanoChainProvider implements CardanoChainProvider {
  private readonly baseUrl: string
  private readonly fetcher: Fetcher

  constructor(options?: { baseUrl?: string; fetcher?: Fetcher }) {
    this.baseUrl =
      options?.baseUrl ??
      process.env.CARDANO_KOIOS_URL ??
      "https://api.koios.rest/api/v1"
    this.fetcher = options?.fetcher ?? fetch
  }

  /**
   * POSTs one page of a Koios endpoint. `withCount` asks PostgREST for a
   * Content-Range header so the total row count is known after the first page.
   */
  private async postPage(
    path: string,
    body: Record<string, unknown>,
    options: { offset: number; select?: string; withCount?: boolean },
  ): Promise<{ rows: unknown[]; total: number | null }> {
    const url = new URL(`${this.baseUrl}${path}`)
    if (options.select) {
      url.searchParams.set("select", options.select)
    }
    if (options.offset > 0) {
      url.searchParams.set("offset", String(options.offset))
    }

    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    }
    if (options.withCount) {
      headers.prefer = "count=estimated"
    }

    const response = await this.fetcher(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    })

    const raw = await readJsonResponse(response)

    if (!response.ok) {
      throw new Error(`Koios returned HTTP ${response.status}.`)
    }

    const rows = z.array(z.unknown()).parse(raw)

    let total: number | null = null
    const contentRange = response.headers?.get?.("content-range")
    const totalMatch = contentRange?.match(/\/(\d+)\s*$/)
    if (totalMatch) {
      total = Number(totalMatch[1])
    }

    return { rows, total }
  }

  /**
   * POSTs to a Koios endpoint and follows offset pagination until the full
   * result set is read. Koios silently truncates at 1000 rows per response,
   * so any potentially large result set MUST go through this helper — a
   * single request looks complete but is not.
   *
   * When the first page reports a total row count, the remaining pages are
   * fetched in parallel (each Koios page can take tens of seconds, so
   * sequential paging would multiply that). A sequential tail guard covers a
   * missing or underestimated count.
   */
  private async postAllPages(
    path: string,
    body: Record<string, unknown>,
    select?: string,
  ): Promise<unknown[]> {
    const first = await this.postPage(path, body, {
      offset: 0,
      select,
      withCount: true,
    })
    const rows = [...first.rows]

    if (first.rows.length < KOIOS_PAGE_SIZE) {
      return rows
    }

    let nextOffset = KOIOS_PAGE_SIZE
    let lastPageFull = true

    if (first.total != null && first.total > KOIOS_PAGE_SIZE) {
      const offsets: number[] = []
      for (let o = KOIOS_PAGE_SIZE; o < first.total; o += KOIOS_PAGE_SIZE) {
        offsets.push(o)
      }
      const pages = await Promise.all(
        offsets.map((offset) => this.postPage(path, body, { offset, select })),
      )
      for (const page of pages) {
        rows.push(...page.rows)
      }
      nextOffset = offsets[offsets.length - 1]! + KOIOS_PAGE_SIZE
      lastPageFull = pages[pages.length - 1]!.rows.length >= KOIOS_PAGE_SIZE
    }

    while (lastPageFull) {
      const page = await this.postPage(path, body, {
        offset: nextOffset,
        select,
      })
      rows.push(...page.rows)
      lastPageFull = page.rows.length >= KOIOS_PAGE_SIZE
      nextOffset += KOIOS_PAGE_SIZE
    }

    return rows
  }

  async getTransactionsForStakeAddress(
    stakeAddress: string,
  ): Promise<CardanoTransaction[]> {
    const rows: unknown[] = []

    for (let offset = 0; ; offset += KOIOS_PAGE_SIZE) {
      const url = new URL(`${this.baseUrl}/account_txs`)
      url.searchParams.set("_stake_address", stakeAddress)
      if (offset > 0) {
        url.searchParams.set("offset", String(offset))
      }

      const response = await this.fetcher(url, {
        method: "GET",
        headers: {
          accept: "application/json",
        },
        cache: "no-store",
      })

      const raw = await readJsonResponse(response)

      if (!response.ok) {
        throw new Error(`Koios returned HTTP ${response.status}.`)
      }

      const page = z.array(z.unknown()).parse(raw)
      rows.push(...page)

      if (page.length < KOIOS_PAGE_SIZE) {
        break
      }
    }

    const parsed = koiosAccountTransactionsSchema.parse(rows)

    return parsed.map((transaction) => ({
      txHash: transaction.tx_hash,
      blockTime: normalizeBlockTime(transaction.block_time),
      blockHeight: normalizeNumber(transaction.block_height),
      raw: transaction,
    }))
  }

  async getTransactionDetails(
    txHash: string,
  ): Promise<CardanoTransactionDetails> {
    const headers = {
      accept: "application/json",
      "content-type": "application/json",
    }

    const [metadataResponse, txInfoResponse] = await Promise.all([
      this.fetcher(`${this.baseUrl}/tx_metadata`, {
        method: "POST",
        headers,
        body: JSON.stringify({ _tx_hashes: [txHash] }),
        cache: "no-store",
      }),
      this.fetcher(`${this.baseUrl}/tx_info`, {
        method: "POST",
        headers,
        // _inputs: true is required — without it Koios omits the inputs array,
        // which prevents detection of de-registration (contract-spend) transactions.
        body: JSON.stringify({
          _tx_hashes: [txHash],
          _inputs: true,
          _assets: true,
        }),
        cache: "no-store",
      }),
    ])

    const metadataRaw = await readJsonResponse(metadataResponse)
    if (!metadataResponse.ok) {
      throw new Error(`Koios returned HTTP ${metadataResponse.status}.`)
    }
    const metadataParsed = koiosMetadataResponseSchema.parse(metadataRaw)
    const metadata =
      metadataParsed.find((item) => item.tx_hash === txHash)?.metadata ?? null

    const nightPolicyId = (
      process.env.CARDANO_NIGHT_POLICY_ID ?? DEFAULT_CARDANO_NIGHT_POLICY_ID
    ).toLowerCase()

    const getNightQty = (
      assets: Array<{ policy_id: string; quantity: string | number }>,
    ): string | null => {
      const found = assets.find(
        (a) => a.policy_id.toLowerCase() === nightPolicyId,
      )
      return found != null ? String(found.quantity) : null
    }

    let inputs: Array<{ address?: string; nightQuantity: string | null }> = []
    let outputs: Array<{ address: string; nightQuantity: string | null }> = []
    if (txInfoResponse.ok) {
      try {
        const txInfoRaw = await readJsonResponse(txInfoResponse)
        const txInfoParsed =
          koiosTxInfoWithInputsResponseSchema.parse(txInfoRaw)
        const txInfo = txInfoParsed.find((item) => item.tx_hash === txHash)
        if (txInfo) {
          inputs = txInfo.inputs.map((inp) => ({
            address: inp.payment_addr?.bech32,
            stakeAddress: inp.stake_addr ?? null,
            nightQuantity: getNightQty(inp.asset_list),
          }))
          outputs = txInfo.outputs.map((out) => ({
            address: out.payment_addr.bech32,
            stakeAddress: out.stake_addr ?? null,
            nightQuantity: getNightQty(out.asset_list),
          }))
        }
      } catch {
        // tx_info parse failed — fall through with empty inputs/outputs
      }
    }

    return {
      txHash,
      blockTime: null,
      blockHeight: null,
      inputs,
      outputs,
      metadata,
      raw: metadataRaw,
    }
  }

  async getTransactionOutputAddress(
    txHash: string,
    outputIndex: number,
  ): Promise<string | null> {
    const response = await this.fetcher(`${this.baseUrl}/tx_info`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ _tx_hashes: [txHash] }),
      cache: "no-store",
    })

    const raw = await readJsonResponse(response)

    if (!response.ok) {
      throw new Error(`Koios returned HTTP ${response.status}.`)
    }

    const parsed = koiosTxInfoResponseSchema.parse(raw)
    const tx = parsed.find((item) => item.tx_hash === txHash)

    if (!tx) {
      return null
    }

    const output = tx.outputs.find(
      (out) => normalizeNumber(out.tx_index) === outputIndex,
    )

    return output?.payment_addr.bech32 ?? null
  }

  async getAssetsForStakeAddress(
    stakeAddress: string,
  ): Promise<CardanoAsset[]> {
    const rows = await this.postAllPages("/account_assets", {
      _stake_addresses: [stakeAddress],
    })

    const parsed = koiosAccountAssetsSchema.parse(rows)

    return parsed.map(toCardanoAsset)
  }

  async getAddressesForStakeAddress(stakeAddress: string): Promise<string[]> {
    // _empty: true — an address whose funds have moved on still identifies
    // the account (e.g. the address that once funded a registration).
    const rows = await this.postAllPages("/account_addresses", {
      _stake_addresses: [stakeAddress],
      _first_only: false,
      _empty: true,
    })

    const parsed = koiosAccountAddressesSchema.parse(rows)

    return parsed.flatMap((account) => account.addresses)
  }

  async checkUtxoSpent(txHash: string, outputIndex: number): Promise<boolean> {
    const response = await this.fetcher(`${this.baseUrl}/utxo_info`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ _utxo_refs: [`${txHash}#${outputIndex}`] }),
      cache: "no-store",
    })

    const raw = await readJsonResponse(response)

    if (!response.ok) {
      throw new Error(`Koios returned HTTP ${response.status}.`)
    }

    const parsed = koiosUtxoInfoSchema.parse(raw)
    // If the UTxO is still unspent, Koios returns it. Empty array = spent.
    const found = parsed.some(
      (u) =>
        u.tx_hash === txHash && normalizeNumber(u.tx_index) === outputIndex,
    )
    return !found
  }

  /**
   * Scans the DUST registration script address for a UTxO whose datum encodes
   * the given payment key hash in the c_wallet field.
   * Returns the first matching UTxO reference, or null if not found.
   * Use this when the Midnight indexer reports registered=true but utxoTxHash is absent.
   */
  async findRegistrationUtxoForPaymentKey(
    paymentKeyHash: string,
  ): Promise<{ txHash: string; outputIndex: number } | null> {
    const all = await this.findAllRegistrationUtxosForPaymentKey(paymentKeyHash)
    const first = all[0]
    return first ? { txHash: first.txHash, outputIndex: first.outputIndex } : null
  }

  /**
   * Fetches every unspent UTxO at the DUST registration script address (all
   * pages) and parses each inline datum. UTxOs without a parseable
   * registration datum are skipped.
   */
  async getScriptRegistrationUtxos(): Promise<ScriptRegistrationUtxo[]> {
    const rows = await this.postAllPages(
      "/address_utxos",
      {
        _addresses: [DUST_CONTRACT.scriptAddress],
        _extended: true,
      },
      // Only these columns are needed; the full rows roughly double the
      // payload of an already large (multi-MB, multi-page) result set.
      "tx_hash,tx_index,inline_datum",
    )

    const parsed = koiosScriptUtxosSchema.parse(rows)
    const registrations: ScriptRegistrationUtxo[] = []

    for (const utxo of parsed) {
      const datumBytes = utxo.inline_datum?.bytes
      if (!datumBytes) continue
      const datum = parseRegistrationDatum(datumBytes)
      if (!datum) continue
      registrations.push({
        txHash: utxo.tx_hash,
        outputIndex: normalizeNumber(utxo.tx_index) ?? 0,
        cWalletKeyHash: datum.paymentKeyHash,
        dustAddressHex: datum.dustAddressHex,
      })
    }

    return registrations
  }

  /**
   * Scans the DUST registration script address for ALL unspent UTxOs whose
   * datum encodes the given payment key hash in the c_wallet field, returning
   * each registration's UTxO reference and its registered DUST address.
   *
   * The same Cardano key can hold more than one active registration (DUST
   * generation expects exactly one), so this is the source of truth for
   * cleaning up multiple registrations — independent of the lagging indexer.
   */
  async findAllRegistrationUtxosForPaymentKey(
    paymentKeyHash: string,
  ): Promise<
    Array<{ txHash: string; outputIndex: number; dustAddressHex: string | null }>
  > {
    const lowerKey = paymentKeyHash.toLowerCase()
    const all = await this.getScriptRegistrationUtxos()
    return all
      .filter((utxo) => utxo.cWalletKeyHash === lowerKey)
      .map((utxo) => ({
        txHash: utxo.txHash,
        outputIndex: utxo.outputIndex,
        dustAddressHex: utxo.dustAddressHex,
      }))
  }

  /**
   * Finds every active registration that belongs to a stake account, using
   * BOTH criteria the account can be recognised by:
   *
   * 1. The datum's c_wallet matches one of the given payment key hashes, or
   *    the payment credential of any on-chain address of the stake account.
   * 2. The UTxO was created by a transaction the stake account took part in
   *    (i.e. the account funded the registration). This catches registrations
   *    whose c_wallet is a wallet key that never appeared on-chain — e.g. a
   *    fresh change address at registration time — which criterion 1 can
   *    never see.
   *
   * The history view identifies the user by stake account, so deletion must
   * use the same identity or the two views contradict each other.
   */
  async findActiveRegistrationsForAccount(input: {
    stakeAddress?: string | null
    paymentKeyHashes?: string[]
  }): Promise<ActiveAccountRegistration[]> {
    const walletKeys = new Set(
      (input.paymentKeyHashes ?? []).map((key) => key.toLowerCase()),
    )
    const accountKeys = new Set(walletKeys)
    let accountTxHashes = new Set<string>()

    if (input.stakeAddress) {
      const [addresses, transactions] = await Promise.all([
        this.getAddressesForStakeAddress(input.stakeAddress),
        this.getTransactionsForStakeAddress(input.stakeAddress),
      ])
      for (const address of addresses) {
        const keyHash = paymentKeyHashFromBech32Address(address)
        if (keyHash) accountKeys.add(keyHash)
      }
      accountTxHashes = new Set(transactions.map((tx) => tx.txHash))
    }

    const scriptUtxos = await this.getScriptRegistrationUtxos()

    return scriptUtxos
      .filter(
        (utxo) =>
          accountKeys.has(utxo.cWalletKeyHash) ||
          accountTxHashes.has(utxo.txHash),
      )
      .map((utxo) => ({
        ...utxo,
        ownedByWallet: walletKeys.has(utxo.cWalletKeyHash),
      }))
  }

  /**
   * Scans the DUST registration script address for a UTxO whose datum contains
   * the given Midnight DUST address bytes (hex-encoded). When found, extracts
   * the registered c_wallet payment key hash and resolves the Cardano stake
   * address by inspecting the transaction's inputs.
   *
   * This is the reverse of the Cardano → Midnight direction: given a Midnight
   * DUST address, find which Cardano stake address registered it.
   */
  async findRegistrationOwnerForDustAddress(dustAddressHex: string): Promise<{
    txHash: string
    outputIndex: number
    paymentKeyHash: string | null
    stakeAddress: string | null
  } | null> {
    const scriptUtxos = await this.getScriptRegistrationUtxos()
    const lowerDustHex = dustAddressHex.toLowerCase()

    const match = scriptUtxos.find(
      (utxo) => utxo.dustAddressHex === lowerDustHex,
    )

    if (!match) {
      return null
    }

    const stakeAddress = await this.resolveStakeAddressFromTx(
      match.txHash,
      match.cWalletKeyHash,
    )

    return {
      txHash: match.txHash,
      outputIndex: match.outputIndex,
      paymentKeyHash: match.cWalletKeyHash,
      stakeAddress,
    }
  }

  private async resolveStakeAddressFromTx(
    txHash: string,
    paymentKeyHash: string,
  ): Promise<string | null> {
    const response = await this.fetcher(`${this.baseUrl}/tx_info`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ _tx_hashes: [txHash], _inputs: true }),
      cache: "no-store",
    })

    const raw = await readJsonResponse(response)
    if (!response.ok) {
      return null
    }

    let parsed: z.infer<typeof koiosTxInfoWithInputsResponseSchema>
    try {
      parsed = koiosTxInfoWithInputsResponseSchema.parse(raw)
    } catch {
      return null
    }

    const tx = parsed.find((t) => t.tx_hash === txHash)
    if (!tx) return null

    const lowerKey = paymentKeyHash.toLowerCase()

    for (const input of tx.inputs) {
      const cred = input.payment_addr?.cred?.toLowerCase()
      if (cred === lowerKey && input.stake_addr) {
        return input.stake_addr
      }
    }

    // Fallback: return any stake_addr from any input (best guess)
    for (const input of tx.inputs) {
      if (input.stake_addr) {
        return input.stake_addr
      }
    }

    return null
  }

  async getUtxosForAddresses(addresses: string[]): Promise<CardanoUtxo[]> {
    if (addresses.length === 0) {
      return []
    }

    // Koios accepts a limited number of addresses per request, so query in
    // chunks instead of silently dropping addresses beyond the first 100.
    const rows: unknown[] = []
    for (let i = 0; i < addresses.length; i += 100) {
      const chunk = addresses.slice(i, i + 100)
      rows.push(
        ...(await this.postAllPages("/address_utxos", {
          _addresses: chunk,
          _extended: true,
        })),
      )
    }

    const parsed = koiosAddressUtxosSchema.parse(rows)

    return parsed.map((utxo) => ({
      txHash: utxo.tx_hash,
      txIndex: normalizeNumber(utxo.tx_index) ?? 0,
      address: utxo.address,
      stakeAddress: utxo.stake_address ?? null,
      blockTime: normalizeBlockTime(utxo.block_time),
      blockHeight: normalizeNumber(utxo.block_height),
      assetList: utxo.asset_list.map(toCardanoAsset),
      raw: utxo,
    }))
  }
}

/**
 * Extracts the payment key hash from a bech32 Cardano address. Returns null
 * for script payment credentials (odd Shelley address types) — those hashes
 * are not verification keys and can never sign a deregistration.
 */
function paymentKeyHashFromBech32Address(address: string): string | null {
  const decoded = decodeBech32(address)
  if (!decoded || decoded.bytes.length < 29) return null

  const headerByte = decoded.bytes[0]!
  const addressType = (headerByte & 0xf0) >> 4
  if (addressType > 7) return null
  if ((addressType & 1) === 1) return null

  return bytesToHex(decoded.bytes.slice(1, 29)).toLowerCase()
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const body = await response.text()

  if (body.trim().length === 0) {
    return null
  }

  return JSON.parse(body) as unknown
}

function normalizeBlockTime(
  value: number | string | null | undefined,
): string | null {
  const seconds = normalizeNumber(value)

  if (seconds == null) {
    return null
  }

  return new Date(seconds * 1000).toISOString()
}

function normalizeNumber(
  value: number | string | null | undefined,
): number | null {
  if (value == null) {
    return null
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : null
}

function toCardanoAsset(
  asset: z.infer<typeof koiosAssetSchema>,
): CardanoAsset & CardanoUtxoAsset {
  return {
    policyId: asset.policy_id.toLowerCase(),
    assetName: asset.asset_name.toLowerCase(),
    fingerprint: asset.fingerprint ?? null,
    decimals: normalizeNumber(asset.decimals),
    quantity: String(asset.quantity),
    displayName: decodeAssetName(asset.asset_name),
    raw: asset,
  }
}

function decodeAssetName(assetName: string): string | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(assetName)) {
    return null
  }

  const bytes = assetName.match(/[0-9a-f]{2}/gi)

  if (!bytes) {
    return null
  }

  return bytes
    .map((byte) => String.fromCharCode(Number.parseInt(byte, 16)))
    .join("")
}
