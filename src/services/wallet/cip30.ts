import type { WalletApi } from "@lucid-evolution/core-types"
import {
  bytesToHex,
  decodeBech32,
  encodeBech32,
  hexToBytes,
} from "@/lib/bech32"

const DEFAULT_CARDANO_WALLET_TIMEOUT_MS = 60_000

export type WalletInfo = {
  id: string
  name: string
  icon: string
}

/** WalletApi from CIP-30 / Lucid Evolution. Re-exported for convenience. */
export type { WalletApi }

export type ConnectedWallet = {
  info: WalletInfo
  stakeAddress: string
  /** Hex payment key hash (28 bytes). Used to build the c_wallet credential in the registration datum. */
  paymentKeyHash: string | null
  /**
   * Every payment key hash the wallet reports (change + used + unused
   * addresses, deduplicated, change address first). Multi-address wallets
   * rotate payment keys under the same stake key, so an on-chain registration
   * may reference any of these — never just the current change key.
   */
  paymentKeyHashes: string[]
  /** Raw CIP-30 wallet API used for signing and submitting transactions. Browser-only. */
  rawApi: WalletApi
}

const KNOWN_WALLET_IDS = [
  "eternl",
  "lace",
  "vespr",
  "nami",
  "flint",
  "typhon",
  "nufi",
  "yoroi",
  "gerowallet",
  "begin",
]

export function detectInstalledWallets(): WalletInfo[] {
  if (typeof window === "undefined" || !window.cardano) return []
  return KNOWN_WALLET_IDS.flatMap((id) => {
    const handle = window.cardano?.[id]
    if (!handle) return []
    return [{ id, name: handle.name || id, icon: handle.icon || "" }]
  })
}

function rewardAddressToStakeBech32(raw: string): string {
  if (raw.startsWith("stake")) return raw
  const bytes = hexToBytes(raw.toLowerCase())
  const networkId = bytes[0] != null ? bytes[0] & 0x0f : 1
  const hrp = networkId === 1 ? "stake" : "stake_test"
  return encodeBech32(hrp, bytes)
}

export async function connectWallet(
  walletId: string,
): Promise<ConnectedWallet> {
  const handle = window.cardano?.[walletId]
  if (!handle) throw new Error(`Wallet "${walletId}" is not installed.`)

  const api = await withWalletTimeout(
    handle.enable(),
    "The Cardano wallet did not answer the connection request in time.",
  )
  const stakeAddress = await extractStakeAddress(api)
  const paymentKeyHashes = await extractPaymentKeyHashes(api)

  return {
    info: {
      id: walletId,
      name: handle.name || walletId,
      icon: handle.icon || "",
    },
    stakeAddress,
    paymentKeyHash: paymentKeyHashes[0] ?? null,
    paymentKeyHashes,
    rawApi: api,
  }
}

async function extractStakeAddress(api: WalletApi): Promise<string> {
  const rewardAddresses = await readWalletAddresses(() =>
    api.getRewardAddresses(),
  )
  const rewardAddress = rewardAddresses.find(Boolean)

  if (rewardAddress) {
    return rewardAddressToStakeBech32(rewardAddress)
  }

  const candidateAddresses = await readBaseAddressCandidates(api)

  for (const address of candidateAddresses) {
    const stakeAddress = stakeAddressFromBaseAddress(address)

    if (stakeAddress) {
      return stakeAddress
    }
  }

  throw new Error(
    "The Cardano wallet connected, but no stake address could be read. Unlock Lace, select a Cardano account with a stake key, then try again.",
  )
}

async function readBaseAddressCandidates(api: WalletApi): Promise<string[]> {
  const [changeAddress, usedAddresses, unusedAddresses] = await Promise.all([
    readWalletAddress(() => api.getChangeAddress()),
    readWalletAddresses(() => api.getUsedAddresses()),
    readWalletAddresses(() => api.getUnusedAddresses()),
  ])

  return [changeAddress, ...usedAddresses, ...unusedAddresses].filter(
    (address): address is string => !!address,
  )
}

async function extractPaymentKeyHashes(api: WalletApi): Promise<string[]> {
  try {
    const [changeAddress, used, unused] = await Promise.all([
      readWalletAddress(() => api.getChangeAddress()),
      readWalletAddresses(() => api.getUsedAddresses()),
      readWalletAddresses(() => api.getUnusedAddresses()),
    ])
    const hashes: string[] = []
    for (const address of [changeAddress, ...used, ...unused]) {
      if (!address) continue
      const hash = paymentKeyHashFromAddressHex(address)
      if (hash && !hashes.includes(hash)) {
        hashes.push(hash)
      }
    }
    return hashes
  } catch {
    return []
  }
}

export function stakeAddressFromBaseAddress(address: string): string | null {
  try {
    const bytes = decodeCardanoAddressBytes(address)

    if (!bytes || bytes.length < 57) {
      return null
    }

    const headerByte = bytes[0]!
    const addressType = (headerByte & 0xf0) >> 4
    const networkId = headerByte & 0x0f

    if (addressType < 0 || addressType > 3) {
      return null
    }

    const stakeCredentialType =
      addressType === 0 || addressType === 1 ? 0xe0 : 0xf0
    const rewardBytes = [
      stakeCredentialType | networkId,
      ...bytes.slice(29, 57),
    ]
    const hrp = networkId === 1 ? "stake" : "stake_test"

    return encodeBech32(hrp, rewardBytes)
  } catch {
    return null
  }
}

/**
 * Extracts the 28-byte payment key hash from a Cardano base address.
 * Accepts both hex (from CIP-30) and bech32 (addr1...) formats.
 * Returns null for script payment credentials (odd Shelley address types) —
 * those hashes are not verification keys and can never sign a transaction.
 */
export function paymentKeyHashFromAddressHex(
  addressHex: string,
): string | null {
  try {
    const bytes = decodeCardanoAddressBytes(addressHex)

    if (!bytes) return null

    if (bytes.length < 29) return null

    const headerByte = bytes[0]!
    const addressType = (headerByte & 0xf0) >> 4
    if (addressType > 7) return null
    // Odd address types carry a script hash as payment credential.
    if ((addressType & 1) === 1) return null

    return bytesToHex(bytes.slice(1, 29))
  } catch {
    return null
  }
}

function decodeCardanoAddressBytes(address: string): number[] | null {
  if (address.startsWith("addr") || address.startsWith("stake")) {
    return decodeBech32(address)?.bytes ?? null
  }

  return hexToBytes(address.toLowerCase())
}

async function readWalletAddress(
  read: () => Promise<string>,
): Promise<string | null> {
  try {
    return await withWalletTimeout(
      read(),
      "The Cardano wallet did not return an address in time.",
    )
  } catch {
    return null
  }
}

async function readWalletAddresses(
  read: () => Promise<string[]>,
): Promise<string[]> {
  try {
    return await withWalletTimeout(
      read(),
      "The Cardano wallet did not return addresses in time.",
    )
  } catch {
    return []
  }
}

function withWalletTimeout<T>(
  promise: Promise<T>,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(message))
    }, DEFAULT_CARDANO_WALLET_TIMEOUT_MS)

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timeoutId)
        reject(error)
      },
    )
  })
}
