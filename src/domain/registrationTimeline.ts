import type { CardanoAccountSnapshot } from "./cardanoAccount"

export type RegistrationEvent = {
  type:
    | "registration_created"
    | "registration_removed"
    | "night_transfer"
    | "unknown"
  txHash: string
  blockTime: string | null
  stakeAddress: string
  dustAddress: string | null
  nightAmount: string | null
  nightDirection: "received" | "sent" | null
  blockHeight: number | null
  confidence: "high" | "medium" | "low"
  summary: string
  technicalDetails: string[]
  raw: unknown
}

export type RegistrationTimeline = {
  stakeAddress: string
  events: RegistrationEvent[]
  activeRegistrationCount: number | null
  checkedAt: string
  source: "koios"
  scannedTransactionCount: number
  note: string
}

export type RegistrationTimelineErrorCode =
  | "CARDANO_PROVIDER_ERROR"
  | "INVALID_ADDRESS"
  | "UNKNOWN_ERROR"

export type RegistrationTimelineError = {
  code: RegistrationTimelineErrorCode
  message: string
  userMessage: string
  technicalDetails: string[]
  raw?: unknown
  checkedAt: string
}

export type RegistrationTimelineInspectionResult = {
  timeline: RegistrationTimeline | null
  cardanoAccountSnapshot: CardanoAccountSnapshot | null
  controlledError: RegistrationTimelineError | null
}
