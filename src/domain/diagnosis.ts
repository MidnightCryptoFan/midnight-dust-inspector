import type {
  ControlledIndexerError,
  DiagnosisResult,
  DustGenerationStatus,
} from "./dustStatus"
import type { CardanoAccountSnapshot } from "./cardanoAccount"
import type { OnChainRegistrationState } from "./onChainRegistration"
import {
  formatCardanoNightBalance,
  hasPositiveCardanoNightBalance,
} from "./cardanoAccount"

const MULTIPLE_REGISTRATION_PATTERN =
  /multiple\s+(?:active\s+)?(?:dust\s+)?registrations?/i

export function parseStatusNumber(
  value: string | null | undefined,
): number | null {
  if (value == null) {
    return null
  }

  const normalized = value.trim().replace(/[_ ,]/g, "")

  if (normalized.length === 0) {
    return null
  }

  const match = normalized.match(/^-?\d+(?:\.\d+)?/)

  if (!match) {
    return null
  }

  const parsed = Number(match[0])

  return Number.isFinite(parsed) ? parsed : null
}

export function isZeroStatusValue(value: string | null | undefined): boolean {
  const parsed = parseStatusNumber(value)

  return parsed === 0
}

export function isPositiveStatusValue(
  value: string | null | undefined,
): boolean {
  const parsed = parseStatusNumber(value)

  return parsed !== null && parsed > 0
}

export function containsMultipleRegistrationSignal(input: unknown): boolean {
  const seen = new WeakSet<object>()

  function inspect(value: unknown, depth: number): boolean {
    if (depth > 12 || value == null) {
      return false
    }

    if (typeof value === "string") {
      return MULTIPLE_REGISTRATION_PATTERN.test(normalizeSearchText(value))
    }

    if (value instanceof Error) {
      return inspect(`${value.name} ${value.message}`, depth + 1)
    }

    if (typeof value !== "object") {
      return false
    }

    if (seen.has(value)) {
      return false
    }

    seen.add(value)

    if (Array.isArray(value)) {
      return value.some((item) => inspect(item, depth + 1))
    }

    return Object.entries(value as Record<string, unknown>).some(
      ([key, nestedValue]) =>
        inspect(key, depth + 1) || inspect(nestedValue, depth + 1),
    )
  }

  return inspect(input, 0)
}

export function diagnoseDustStatus(
  status: DustGenerationStatus | null,
  controlledError?: ControlledIndexerError | null,
  context?: {
    cardanoAccountSnapshot?: CardanoAccountSnapshot | null
    onChainRegistrationState?: OnChainRegistrationState | null
  },
): DiagnosisResult {
  if (
    containsMultipleRegistrationSignal(controlledError?.message) ||
    containsMultipleRegistrationSignal(controlledError?.raw) ||
    containsMultipleRegistrationSignal(status?.raw)
  ) {
    return {
      code: "MULTIPLE_REGISTRATIONS_DETECTED",
      severity: "error",
      title: "Multiple DUST registrations were detected",
      summary:
        "Midnight found more than one active registration for this Cardano stake address.",
      explanation:
        "DUST generation needs exactly one destination. If multiple registrations exist, the system cannot safely decide which DUST address should receive generated DUST.",
      recommendedAction:
        "Do not blindly submit another removal transaction. First verify which registration remains active and whether the indexer has processed the latest Cardano transaction.",
      technicalDetails: [
        "A multiple-registration signal was found in the indexer data or error details.",
        ...buildStatusTechnicalDetails(status),
        ...buildErrorTechnicalDetails(controlledError),
      ],
    }
  }

  if (controlledError) {
    return {
      code: "INDEXER_ERROR",
      severity: "error",
      title: "The Midnight indexer could not be checked",
      summary: "The tool could not read the current DUST status.",
      explanation:
        "This can happen if the indexer is temporarily unavailable, behind the chain, or if the response format changed.",
      recommendedAction:
        "Try again later and keep your transaction hash if you already paid a fee.",
      technicalDetails: buildErrorTechnicalDetails(controlledError),
    }
  }

  if (!status) {
    return unknownStatusDiagnosis(["No status object was available."])
  }

  if (status.registered === false) {
    return {
      code: "NOT_REGISTERED",
      severity: "warning",
      title: "No active DUST registration was found",
      summary:
        "This Cardano stake address does not appear to be registered for DUST generation.",
      explanation:
        "DUST generation can only start after a valid registration exists.",
      recommendedAction:
        "Check that you entered the correct Cardano stake address and that your NIGHT registration transaction was confirmed.",
      technicalDetails: buildStatusTechnicalDetails(status),
    }
  }

  if (status.registered === true && isBlank(status.dustAddress)) {
    return {
      code: "MISSING_DUST_ADDRESS",
      severity: "error",
      title: "The registration is missing a DUST address",
      summary:
        "The indexer reports a registration, but no DUST destination address was found.",
      explanation:
        "This usually means the registration data is incomplete or the indexer has not fully processed it.",
      recommendedAction:
        "Wait for the indexer to catch up. If the issue persists, export the debug report and open a support issue.",
      technicalDetails: buildStatusTechnicalDetails(status),
    }
  }

  if (
    status.registered === true &&
    context?.onChainRegistrationState?.kind === "deregistration_pending"
  ) {
    return {
      code: "DEREGISTRATION_CONFIRMED_INDEXER_LAG",
      severity: "info",
      title: "Registration removal is confirmed on Cardano",
      summary:
        "The registration UTxO is no longer present on-chain, but the Midnight indexer still reports this address as registered.",
      explanation:
        "This usually means the removal transaction has been processed by Cardano and the Midnight indexer has not caught up yet.",
      recommendedAction:
        "Do not submit another removal transaction. Wait for the Midnight indexer to update, then check again before registering.",
      technicalDetails: [
        "On-chain registration state: deregistration_pending.",
        ...buildStatusTechnicalDetails(status),
      ],
    }
  }

  if (
    status.registered === true &&
    !isBlank(status.dustAddress) &&
    hasPositiveCardanoNightBalance(context?.cardanoAccountSnapshot) &&
    isZeroStatusValue(status.nightBalance) &&
    isZeroOrMissingStatusValue(status.generationRate) &&
    isZeroOrMissingStatusValue(status.maxCapacity)
  ) {
    const cardanoNightBalance = formatCardanoNightBalance(
      context?.cardanoAccountSnapshot,
    )

    return {
      code: "CARDANO_NIGHT_INDEXER_MISMATCH",
      severity: "warning",
      title: "Cardano NIGHT was found, but DUST generation is zero",
      summary:
        "The Cardano stake key holds NIGHT, but the Midnight indexer reports zero NIGHT counted for this DUST registration.",
      explanation:
        "This points to a mismatch between the Cardano NIGHT UTxOs and the active Midnight generation path. DUST generation is tracked for registered NIGHT UTxOs, not just the wallet's total token balance.",
      recommendedAction:
        "Do not pay for another removal or registration transaction yet. Compare the Cardano generating address shown by the DUST Generator with the NIGHT UTxO addresses below, then export the debug report and include both dashboard outputs in a support issue.",
      technicalDetails: [
        "Cardano NIGHT exists for this stake key, but the Midnight indexer reports zero eligible NIGHT for generation.",
        `cardanoNightBalance: ${cardanoNightBalance ?? "not reported"}`,
        `cardanoNightUtxoCount: ${
          context?.cardanoAccountSnapshot?.nightUtxos.length ?? 0
        }`,
        ...buildStatusTechnicalDetails(status),
      ],
    }
  }

  if (
    status.registered === true &&
    (isBlank(status.generationRate) || isZeroStatusValue(status.generationRate))
  ) {
    return {
      code: "ZERO_GENERATION_RATE",
      severity: "warning",
      title: "DUST generation rate is zero",
      summary:
        "The registration exists, but DUST does not appear to be generating yet.",
      explanation:
        "A zero generation rate may indicate missing NIGHT balance, incomplete registration, or an indexer/state issue.",
      recommendedAction:
        "Check your NIGHT balance and confirm that the registration is connected to the correct Cardano stake address.",
      technicalDetails: buildStatusTechnicalDetails(status),
    }
  }

  if (status.registered === true && isZeroStatusValue(status.currentCapacity)) {
    return {
      code: "ZERO_CURRENT_CAPACITY",
      severity: "info",
      title: "Current DUST capacity is zero",
      summary:
        "The registration exists, but there is currently no available DUST capacity.",
      explanation:
        "This may be normal if DUST was recently spent or if capacity has not accumulated yet.",
      recommendedAction:
        "Wait and check again later. If the value never changes, export a debug report.",
      technicalDetails: buildStatusTechnicalDetails(status),
    }
  }

  if (
    status.registered === true &&
    !isBlank(status.dustAddress) &&
    isPositiveStatusValue(status.generationRate)
  ) {
    return {
      code: "REGISTERED_OK",
      severity: "success",
      title: "DUST registration looks healthy",
      summary: "This stake address appears to have a valid DUST registration.",
      explanation:
        "The indexer reports an active registration, a DUST destination address, and a positive generation rate.",
      recommendedAction:
        "No repair action is needed based on the current indexer status.",
      technicalDetails: buildStatusTechnicalDetails(status),
    }
  }

  return unknownStatusDiagnosis(buildStatusTechnicalDetails(status))
}

function normalizeSearchText(value: string): string {
  return value.replace(/[_-]+/g, " ")
}

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim().length === 0
}

function isZeroOrMissingStatusValue(value: string | null | undefined): boolean {
  return isBlank(value) || isZeroStatusValue(value)
}

function buildStatusTechnicalDetails(
  status: DustGenerationStatus | null | undefined,
): string[] {
  if (!status) {
    return []
  }

  return [
    `stakeAddress: ${status.stakeAddress}`,
    `registered: ${String(status.registered)}`,
    `dustAddress: ${status.dustAddress ?? "not reported"}`,
    `nightBalance: ${status.nightBalance ?? "not reported"}`,
    `generationRate: ${status.generationRate ?? "not reported"}`,
    `maxCapacity: ${status.maxCapacity ?? "not reported"}`,
    `currentCapacity: ${status.currentCapacity ?? "not reported"}`,
    `utxoTxHash: ${status.utxoTxHash ?? "not reported"}`,
    `utxoOutputIndex: ${status.utxoOutputIndex ?? "not reported"}`,
    `source: ${status.source}`,
    `checkedAt: ${status.checkedAt}`,
  ]
}

function buildErrorTechnicalDetails(
  controlledError: ControlledIndexerError | null | undefined,
): string[] {
  if (!controlledError) {
    return []
  }

  return [
    `errorCode: ${controlledError.code}`,
    `message: ${controlledError.message}`,
    ...controlledError.technicalDetails,
    `checkedAt: ${controlledError.checkedAt}`,
  ]
}

function unknownStatusDiagnosis(technicalDetails: string[]): DiagnosisResult {
  return {
    code: "UNKNOWN_STATUS",
    severity: "info",
    title: "The DUST status is unclear",
    summary: "The tool could not confidently classify the current state.",
    explanation:
      "The returned data does not match one of the known diagnosis patterns.",
    recommendedAction:
      "Open the advanced section, export the debug report, and compare it with the latest Midnight documentation.",
    technicalDetails,
  }
}
