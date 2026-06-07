import { formatCompactAtomicQuantity } from "@/lib/formatting"

export type MidnightDustBalance = {
  walletId: string
  walletName: string
  dustAddress: string | null
  balance: string | null
  cap: string | null
  source: "midnight-wallet"
  checkedAt: string
  raw: unknown
}

const DUST_ATOMIC_UNITS_PER_DUST = 1_000_000_000_000_000n

export type MidnightWalletErrorCode =
  | "NO_WALLET"
  | "CONNECTION_TIMEOUT"
  | "CONNECTION_REJECTED"
  | "UNSUPPORTED_WALLET"
  | "READ_ERROR"
  | "UNKNOWN_ERROR"

export type MidnightWalletError = {
  code: MidnightWalletErrorCode
  message: string
  userMessage: string
  technicalDetails: string[]
  raw?: unknown
  checkedAt: string
}

export function createMidnightWalletError(input: {
  code: MidnightWalletErrorCode
  message: string
  userMessage: string
  technicalDetails?: string[]
  raw?: unknown
  checkedAt?: string
}): MidnightWalletError {
  return {
    code: input.code,
    message: input.message,
    userMessage: input.userMessage,
    technicalDetails: input.technicalDetails ?? [],
    raw: input.raw,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
  }
}

export function formatDustQuantity(value: string | null | undefined): string {
  if (value == null || value.trim().length === 0) {
    return "Not reported"
  }

  try {
    const atomicAmount = BigInt(value)
    return `${formatCompactAtomicQuantity(
      atomicAmount,
      DUST_ATOMIC_UNITS_PER_DUST,
    )} DUST`
  } catch {
    return `${value} DUST`
  }
}
