import type { MidnightDustBalance } from "@/domain/midnightDustBalance"
import { createMidnightWalletError } from "@/domain/midnightDustBalance"

const DEFAULT_MIDNIGHT_WALLET_TIMEOUT_MS = 30_000
const OPTIONAL_MIDNIGHT_WALLET_READ_TIMEOUT_MS = 2_000

export type MidnightWalletConnectionMode =
  | "auto"
  | "wallet-default"
  | "configured-network"
  | "mainnet"
  | "preprod"
  | "preview"
  | "undeployed"
  | "legacy-enable"

export type MidnightWalletInfo = {
  id: string
  name: string
  icon: string
  apiVersion: string | null
  /** Reverse-DNS wallet identifier, present in Midnight DApp Connector v4+. */
  rdns: string | null
  supportsConnect: boolean
  supportsLegacyEnable: boolean
}

export type MidnightWalletReadResult = {
  balance: MidnightDustBalance | null
  error: ReturnType<typeof createMidnightWalletError> | null
}

type MidnightConnectedWalletApi = {
  getDustAddress?: () => Promise<string | { dustAddress?: unknown }>
  getDustBalance?: () => Promise<{
    balance?: unknown
    cap?: unknown
  }>
  state?: () => Promise<{
    address?: unknown
    dustAddress?: unknown
    balance?: unknown
    cap?: unknown
  }>
  getConnectionStatus?: () => Promise<unknown>
  getConfiguration?: () => Promise<unknown>
}

type MidnightInitialWalletApi = {
  name?: string
  icon?: string
  apiVersion?: string
  /** EIP-6963-style reverse-DNS identifier, present in MDC v4+. */
  rdns?: string
  isEnabled?: () => Promise<boolean>
  /** CIP-30-style connection method used by some wallet builds. */
  enable?: () => Promise<MidnightConnectedWalletApi>
  /** Midnight DApp Connector connection method. */
  connect?: (...args: unknown[]) => Promise<MidnightConnectedWalletApi>
}

declare global {
  interface Window {
    midnight?: Record<string, MidnightInitialWalletApi | undefined>
  }
}

export function detectInstalledMidnightWallets(): MidnightWalletInfo[] {
  if (typeof window === "undefined" || !window.midnight) {
    return []
  }

  return Object.entries(window.midnight)
    .flatMap(([id, wallet]) => {
      if (
        !wallet ||
        (typeof wallet.enable !== "function" &&
          typeof wallet.connect !== "function" &&
          typeof wallet.isEnabled !== "function")
      ) {
        return []
      }

      return [
        {
          id,
          name: formatMidnightWalletName(id, wallet.name),
          icon: wallet.icon || "",
          apiVersion: wallet.apiVersion ?? null,
          rdns: wallet.rdns ?? null,
          supportsConnect: typeof wallet.connect === "function",
          supportsLegacyEnable: typeof wallet.enable === "function",
        },
      ]
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

export async function readMidnightWalletDustBalance(
  walletId: string,
  options?: {
    networkId?: string
    connectionMode?: MidnightWalletConnectionMode
    checkedAt?: string
    timeoutMs?: number
  },
): Promise<MidnightWalletReadResult> {
  const checkedAt = options?.checkedAt ?? new Date().toISOString()
  const resolvedWallet = resolveMidnightWallet(walletId)
  const wallet = resolvedWallet?.wallet
  const resolvedWalletId = resolvedWallet?.id ?? walletId
  const timeoutMs = options?.timeoutMs ?? DEFAULT_MIDNIGHT_WALLET_TIMEOUT_MS
  const connectionMode = options?.connectionMode ?? "configured-network"
  const networkId = getNetworkIdForConnectionMode(
    connectionMode,
    options?.networkId,
  )
  const walletDiagnostics = wallet
    ? getInitialWalletDiagnostics(resolvedWalletId, wallet, networkId)
    : getMissingWalletDiagnostics(walletId)

  if (!wallet) {
    return {
      balance: null,
      error: createMidnightWalletError({
        code: "NO_WALLET",
        message: `Midnight wallet "${walletId}" is not installed.`,
        userMessage: "The selected Midnight wallet was not found.",
        technicalDetails: walletDiagnostics,
        checkedAt,
      }),
    }
  }

  try {
    const connected = await withTimeout(
      connectViaMidnightWallet(wallet, connectionMode, options?.networkId),
      timeoutMs,
      "The Midnight wallet did not answer the connection request in time.",
    )

    const canReadV4Dust =
      typeof connected.getDustAddress === "function" &&
      typeof connected.getDustBalance === "function"
    const canReadLegacyState = typeof connected.state === "function"

    if (!canReadV4Dust && !canReadLegacyState) {
      return {
        balance: null,
        error: createMidnightWalletError({
          code: "UNSUPPORTED_WALLET",
          message:
            "The connected Midnight wallet does not expose DUST balance methods.",
          userMessage:
            "This Midnight wallet connected, but it did not expose the read-only DUST address and balance methods needed by the inspector.",
          technicalDetails: [
            `Expected getDustAddress()/getDustBalance() or state(). Connected API keys: ${connected ? Object.keys(connected).join(", ") : "none"}`,
          ],
          checkedAt,
        }),
      }
    }

    const optionalTimeoutMs = Math.min(
      timeoutMs,
      OPTIONAL_MIDNIGHT_WALLET_READ_TIMEOUT_MS,
    )

    const [dustSnapshot, connectionStatus, configuration] = await Promise.all([
      readDustSnapshot(connected, timeoutMs),
      readOptional(() => connected.getConnectionStatus?.(), optionalTimeoutMs),
      readOptional(() => connected.getConfiguration?.(), optionalTimeoutMs),
    ])

    return {
      balance: {
        walletId: resolvedWalletId,
        walletName: formatMidnightWalletName(resolvedWalletId, wallet.name),
        dustAddress: dustSnapshot.dustAddress,
        balance: dustSnapshot.balance,
        cap: dustSnapshot.cap,
        source: "midnight-wallet",
        checkedAt,
        raw: {
          dustAddress: dustSnapshot.dustAddress,
          balance: dustSnapshot.balance,
          cap: dustSnapshot.cap,
          walletState: dustSnapshot.walletState,
          connectionStatus,
          configuration,
          apiVersion: wallet.apiVersion ?? null,
        },
      },
      error: null,
    }
  } catch (error) {
    const timedOut = error instanceof MidnightWalletTimeoutError

    return {
      balance: null,
      error: createMidnightWalletError({
        code: timedOut ? "CONNECTION_TIMEOUT" : "CONNECTION_REJECTED",
        message:
          error instanceof Error
            ? error.message
            : "The Midnight wallet connection failed.",
        userMessage: timedOut
          ? "The Midnight wallet did not answer in time. Unlock or open the wallet extension, then try again."
          : "The Midnight wallet could not be connected or the balance could not be read.",
        technicalDetails: walletDiagnostics,
        raw:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : error,
        checkedAt,
      }),
    }
  }
}

async function connectViaMidnightWallet(
  wallet: MidnightInitialWalletApi,
  connectionMode: MidnightWalletConnectionMode,
  requestedNetworkId: string | undefined,
): Promise<MidnightConnectedWalletApi> {
  if (connectionMode === "legacy-enable") {
    return connectViaLegacyEnable(wallet)
  }

  if (typeof wallet.connect === "function") {
    if (connectionMode === "auto") {
      return connectViaNetworkCandidates(wallet, requestedNetworkId)
    }

    const networkId = getNetworkIdForConnectionMode(
      connectionMode,
      requestedNetworkId,
    )

    return networkId ? wallet.connect(networkId) : wallet.connect()
  }

  return connectViaLegacyEnable(wallet)
}

async function connectViaNetworkCandidates(
  wallet: MidnightInitialWalletApi,
  requestedNetworkId: string | undefined,
): Promise<MidnightConnectedWalletApi> {
  if (typeof wallet.connect !== "function") {
    return connectViaLegacyEnable(wallet)
  }

  const candidates = uniqueNetworkIds([
    requestedNetworkId,
    process.env.NEXT_PUBLIC_MIDNIGHT_NETWORK_ID,
    "mainnet",
    "preprod",
    "preview",
    "undeployed",
  ])
  let lastError: unknown

  for (const networkId of candidates) {
    try {
      return await wallet.connect(networkId)
    } catch (error) {
      lastError = error

      if (!isRetryableNetworkError(error)) {
        throw error
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("The Midnight wallet could not connect to any known network.")
}

async function connectViaLegacyEnable(
  wallet: MidnightInitialWalletApi,
): Promise<MidnightConnectedWalletApi> {
  if (typeof wallet.enable !== "function") {
    throw new Error("No Midnight wallet connection method was found.")
  }

  if (typeof wallet.isEnabled === "function") {
    await wallet.isEnabled()
  }

  return wallet.enable()
}

function getNetworkIdForConnectionMode(
  connectionMode: MidnightWalletConnectionMode,
  requestedNetworkId: string | undefined,
): string | undefined {
  if (connectionMode === "wallet-default") {
    return undefined
  }

  if (connectionMode === "mainnet") {
    return "mainnet"
  }

  if (connectionMode === "preprod") {
    return "preprod"
  }

  if (connectionMode === "preview") {
    return "preview"
  }

  if (connectionMode === "undeployed") {
    return "undeployed"
  }

  return requestedNetworkId ?? getMidnightNetworkId()
}

function uniqueNetworkIds(networkIds: Array<string | undefined>): string[] {
  return Array.from(
    new Set(networkIds.filter((networkId): networkId is string => !!networkId)),
  )
}

function isRetryableNetworkError(error: unknown): boolean {
  const reason =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "reason" in error
        ? String(error.reason)
        : String(error)

  return /mismatch|unsupported|network/i.test(reason)
}

function resolveMidnightWallet(
  walletId: string,
): { id: string; wallet: MidnightInitialWalletApi } | null {
  const wallets = window.midnight
  if (!wallets) return null

  const directWallet = wallets[walletId]
  if (directWallet) {
    return { id: walletId, wallet: directWallet }
  }

  if (walletId.toLowerCase() !== "lace") {
    return null
  }

  for (const [id, wallet] of Object.entries(wallets)) {
    if (!wallet) continue

    const name = wallet.name?.toLowerCase() ?? ""
    const rdns = wallet.rdns?.toLowerCase() ?? ""

    if (
      id.toLowerCase() === "mnlace" ||
      name.includes("lace") ||
      rdns.includes("lace")
    ) {
      return { id, wallet }
    }
  }

  return null
}

function getInitialWalletDiagnostics(
  walletId: string,
  wallet: MidnightInitialWalletApi,
  networkId: string | undefined,
): string[] {
  const ownKeys = Object.keys(wallet)
  const prototypeKeys = Object.getOwnPropertyNames(
    Object.getPrototypeOf(wallet) ?? {},
  ).filter((key) => key !== "constructor")

  return [
    `resolvedWalletId: ${walletId}`,
    `requestedNetworkId: ${networkId ?? "wallet default"}`,
    `name: ${wallet.name ?? "not reported"}`,
    `apiVersion: ${wallet.apiVersion ?? "not reported"}`,
    `rdns: ${wallet.rdns ?? "not reported"}`,
    `hasConnect: ${typeof wallet.connect === "function" ? "yes" : "no"}`,
    `hasLegacyEnable: ${typeof wallet.enable === "function" ? "yes" : "no"}`,
    `ownKeys: ${ownKeys.length > 0 ? ownKeys.join(", ") : "none"}`,
    `prototypeKeys: ${prototypeKeys.length > 0 ? prototypeKeys.join(", ") : "none"}`,
  ]
}

function getMissingWalletDiagnostics(walletId: string): string[] {
  const walletKeys =
    typeof window !== "undefined" && window.midnight
      ? Object.keys(window.midnight)
      : []

  return [
    `requestedWalletId: ${walletId}`,
    `window.midnight keys: ${walletKeys.length > 0 ? walletKeys.join(", ") : "none"}`,
  ]
}

async function readDustSnapshot(
  connected: MidnightConnectedWalletApi,
  timeoutMs: number,
): Promise<{
  dustAddress: string | null
  balance: string | null
  cap: string | null
  walletState: unknown
}> {
  if (
    typeof connected.getDustAddress === "function" &&
    typeof connected.getDustBalance === "function"
  ) {
    const [addressResponse, balanceResponse] = await Promise.all([
      withTimeout(
        connected.getDustAddress(),
        timeoutMs,
        "The Midnight wallet did not return a DUST address in time.",
      ),
      withTimeout(
        connected.getDustBalance(),
        timeoutMs,
        "The Midnight wallet did not return a DUST balance in time.",
      ),
    ])

    return {
      dustAddress: normalizeDustAddress(addressResponse),
      balance: normalizeOptionalInteger(balanceResponse.balance),
      cap: normalizeOptionalInteger(balanceResponse.cap),
      walletState: null,
    }
  }

  if (typeof connected.state === "function") {
    const walletState = await withTimeout(
      connected.state(),
      timeoutMs,
      "The Midnight wallet did not return its state in time.",
    )

    return {
      dustAddress: normalizeDustAddress(walletState),
      balance: normalizeOptionalInteger(walletState.balance),
      cap: normalizeOptionalInteger(walletState.cap),
      walletState,
    }
  }

  throw new Error(
    "The connected Midnight wallet did not expose readable state.",
  )
}

function formatMidnightWalletName(
  id: string,
  name: string | undefined,
): string {
  const candidate = (name || id).trim()
  const knownName = KNOWN_MIDNIGHT_WALLET_NAMES[candidate.toLowerCase()]

  if (knownName) {
    return knownName
  }

  if (candidate.length === 0) {
    return id
  }

  return candidate
}

const KNOWN_MIDNIGHT_WALLET_NAMES: Record<string, string> = {
  lace: "Lace",
  mnlace: "Lace",
}

function getMidnightNetworkId(): string | undefined {
  return process.env.NEXT_PUBLIC_MIDNIGHT_NETWORK_ID || "mainnet"
}

function normalizeDustAddress(
  value: string | Record<string, unknown>,
): string | null {
  if (typeof value === "string") {
    return value
  }

  if (typeof value.dustAddress === "string") {
    return value.dustAddress
  }

  if (typeof value.address === "string") {
    return value.address
  }

  return null
}

function normalizeOptionalInteger(value: unknown): string | null {
  if (value == null) {
    return null
  }

  if (typeof value === "bigint") {
    return value.toString()
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value).toString()
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim()
  }

  return null
}

async function readOptional(
  read: () => Promise<unknown> | undefined,
  timeoutMs: number,
) {
  try {
    const result = read()
    return result
      ? await withTimeout(result, timeoutMs, "Optional read timed out.")
      : null
  } catch {
    return null
  }
}

class MidnightWalletTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MidnightWalletTimeoutError"
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new MidnightWalletTimeoutError(message))
    }, timeoutMs)

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
