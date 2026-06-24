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

  async getTransactionsForStakeAddress(
    stakeAddress: string,
  ): Promise<CardanoTransaction[]> {
    const url = new URL(`${this.baseUrl}/account_txs`)
    url.searchParams.set("_stake_address", stakeAddress)

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

    const parsed = koiosAccountTransactionsSchema.parse(raw)

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
    const response = await this.fetcher(`${this.baseUrl}/account_assets`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ _stake_addresses: [stakeAddress] }),
      cache: "no-store",
    })

    const raw = await readJsonResponse(response)

    if (!response.ok) {
      throw new Error(`Koios returned HTTP ${response.status}.`)
    }

    const parsed = koiosAccountAssetsSchema.parse(raw)

    return parsed.map(toCardanoAsset)
  }

  async getAddressesForStakeAddress(stakeAddress: string): Promise<string[]> {
    const response = await this.fetcher(`${this.baseUrl}/account_addresses`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        _stake_addresses: [stakeAddress],
        _first_only: false,
        _empty: false,
      }),
      cache: "no-store",
    })

    const raw = await readJsonResponse(response)

    if (!response.ok) {
      throw new Error(`Koios returned HTTP ${response.status}.`)
    }

    const parsed = koiosAccountAddressesSchema.parse(raw)

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
    const response = await this.fetcher(`${this.baseUrl}/address_utxos`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        _addresses: [DUST_CONTRACT.scriptAddress],
        _extended: true,
      }),
      cache: "no-store",
    })

    const raw = await readJsonResponse(response)

    if (!response.ok) {
      throw new Error(`Koios returned HTTP ${response.status}.`)
    }

    const parsed = koiosScriptUtxosSchema.parse(raw)
    const lowerKey = paymentKeyHash.toLowerCase()

    const matches: Array<{
      txHash: string
      outputIndex: number
      dustAddressHex: string | null
    }> = []

    for (const utxo of parsed) {
      const datumBytes = utxo.inline_datum?.bytes
      if (!datumBytes) continue
      const datum = parseRegistrationDatum(datumBytes)
      if (datum?.paymentKeyHash === lowerKey) {
        matches.push({
          txHash: utxo.tx_hash,
          outputIndex: normalizeNumber(utxo.tx_index) ?? 0,
          dustAddressHex: datum.dustAddressHex,
        })
      }
    }

    return matches
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
    const response = await this.fetcher(`${this.baseUrl}/address_utxos`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        _addresses: [DUST_CONTRACT.scriptAddress],
        _extended: true,
      }),
      cache: "no-store",
    })

    const raw = await readJsonResponse(response)
    if (!response.ok) {
      throw new Error(`Koios returned HTTP ${response.status}.`)
    }

    const parsed = koiosScriptUtxosSchema.parse(raw)
    const lowerDustHex = dustAddressHex.toLowerCase()

    let matchedTxHash: string | null = null
    let matchedOutputIndex: number | null = null
    let matchedPaymentKeyHash: string | null = null

    for (const utxo of parsed) {
      const datumBytes = utxo.inline_datum?.bytes
      if (!datumBytes) continue

      const lowerDatum = datumBytes.toLowerCase()
      if (!lowerDatum.includes(lowerDustHex)) continue

      // Extract the payment key hash from c_wallet part of datum:
      // Pattern: d8799f d8799f 581c <28-byte-key-hash> ff
      const keyMatch = lowerDatum.match(/d8799fd8799f581c([0-9a-f]{56})ff/)
      matchedTxHash = utxo.tx_hash
      matchedOutputIndex = normalizeNumber(utxo.tx_index) ?? 0
      matchedPaymentKeyHash = keyMatch?.[1] ?? null
      break
    }

    if (!matchedTxHash) {
      return null
    }

    const stakeAddress = matchedPaymentKeyHash
      ? await this.resolveStakeAddressFromTx(
          matchedTxHash,
          matchedPaymentKeyHash,
        )
      : null

    return {
      txHash: matchedTxHash,
      outputIndex: matchedOutputIndex ?? 0,
      paymentKeyHash: matchedPaymentKeyHash,
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

    const response = await this.fetcher(`${this.baseUrl}/address_utxos`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        _addresses: addresses.slice(0, 100),
        _extended: true,
      }),
      cache: "no-store",
    })

    const raw = await readJsonResponse(response)

    if (!response.ok) {
      throw new Error(`Koios returned HTTP ${response.status}.`)
    }

    const parsed = koiosAddressUtxosSchema.parse(raw)

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

/**
 * Parses a DUST registration inline datum (hex) into its components.
 *
 * Datum layout: DustMappingDatum { c_wallet: VerificationKey(keyHash), dust_address }
 *   d8799f          Constr 0, indefinite array (outer)
 *     d8799f 581c <28-byte key hash> ff   VerificationKey(keyHash)
 *     58 <len> <dust_address bytes>        byte string (Midnight address, <=33 bytes)
 *   ff
 *
 * Returns the lowercased payment key hash and DUST address hex, or null if the
 * datum does not match the expected shape.
 */
function parseRegistrationDatum(
  datumHex: string,
): { paymentKeyHash: string; dustAddressHex: string | null } | null {
  const lower = datumHex.toLowerCase()
  // d8799f d8799f 581c <56 hex = 28 bytes> ff
  const keyMatch = lower.match(/d8799fd8799f581c([0-9a-f]{56})ff/)
  if (!keyMatch || keyMatch.index == null) {
    return null
  }

  const paymentKeyHash = keyMatch[1]!

  // Immediately after the inner constr: a CBOR byte string 0x58 <len> <bytes>.
  const afterKey = keyMatch.index + keyMatch[0].length
  let dustAddressHex: string | null = null
  if (lower.slice(afterKey, afterKey + 2) === "58") {
    const len = parseInt(lower.slice(afterKey + 2, afterKey + 4), 16)
    if (Number.isFinite(len) && len > 0) {
      const start = afterKey + 4
      const candidate = lower.slice(start, start + len * 2)
      if (candidate.length === len * 2) {
        dustAddressHex = candidate
      }
    }
  }

  return { paymentKeyHash, dustAddressHex }
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
