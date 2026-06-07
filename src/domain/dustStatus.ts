export type DustGenerationStatus = {
  stakeAddress: string
  registered: boolean | null
  dustAddress: string | null
  nightBalance: string | null
  generationRate: string | null
  maxCapacity: string | null
  currentCapacity: string | null
  utxoTxHash: string | null
  utxoOutputIndex: string | null
  raw: unknown
  source: "midnight-indexer"
  checkedAt: string
}

export const diagnosisSeverities = [
  "success",
  "warning",
  "error",
  "info",
] as const

export type DiagnosisSeverity = (typeof diagnosisSeverities)[number]

export const diagnosisCodes = [
  "REGISTERED_OK",
  "NOT_REGISTERED",
  "NOT_REGISTERED_WITH_DUST_WALLET",
  "MULTIPLE_REGISTRATIONS_DETECTED",
  "DEREGISTRATION_CONFIRMED_INDEXER_LAG",
  "CARDANO_NIGHT_INDEXER_MISMATCH",
  "MISSING_DUST_ADDRESS",
  "ZERO_GENERATION_RATE",
  "ZERO_CURRENT_CAPACITY",
  "INDEXER_ERROR",
  "INVALID_ADDRESS",
  "UNKNOWN_STATUS",
] as const

export type DiagnosisCode = (typeof diagnosisCodes)[number]

export type DiagnosisResult = {
  code: DiagnosisCode
  severity: DiagnosisSeverity
  title: string
  summary: string
  explanation: string
  recommendedAction: string
  technicalDetails: string[]
}

export type ControlledIndexerErrorCode =
  | "CONFIGURATION_ERROR"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "GRAPHQL_ERROR"
  | "SCHEMA_ERROR"
  | "UNKNOWN_ERROR"

export type ControlledIndexerError = {
  code: ControlledIndexerErrorCode
  message: string
  userMessage: string
  technicalDetails: string[]
  raw?: unknown
  checkedAt: string
}

export type IndexerInspectionResult = {
  status: DustGenerationStatus | null
  rawResponse: unknown
  controlledError: ControlledIndexerError | null
}
