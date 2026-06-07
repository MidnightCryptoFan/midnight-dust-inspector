import type {
  CardanoTransaction,
  CardanoTransactionDetails,
} from "@/services/cardano/CardanoChainProvider"
import type {
  RegistrationEvent,
  RegistrationTimeline,
} from "./registrationTimeline"
import { DUST_CONTRACT } from "@/services/cardano/dustContract"

const REGISTRATION_PATTERN =
  /(dust|midnight).{0,80}(register|registration|registered|designate|delegate|link|pair)|(register|registration|registered|designate|delegate|link|pair).{0,80}(dust|midnight)/i

const REMOVAL_PATTERN =
  /(dust|midnight|registration).{0,80}(remove|removed|removal|deregister|deregistration|unregister|unlink)|(remove|removed|removal|deregister|deregistration|unregister|unlink).{0,80}(dust|midnight|registration)/i

const DUST_ADDRESS_PATTERN = /\bdust[a-z0-9_]{12,}\b/i

export function buildRegistrationTimeline(input: {
  stakeAddress: string
  transactions: CardanoTransaction[]
  detailsByTxHash: Map<string, CardanoTransactionDetails>
  checkedAt: string
  source: "koios"
}): RegistrationTimeline {
  const chronologicalTransactions = [...input.transactions].sort(
    (left, right) =>
      Date.parse(left.blockTime ?? "1970-01-01T00:00:00.000Z") -
      Date.parse(right.blockTime ?? "1970-01-01T00:00:00.000Z"),
  )

  const events = chronologicalTransactions.map((transaction) =>
    classifyRegistrationEvent({
      stakeAddress: input.stakeAddress,
      transaction,
      details: input.detailsByTxHash.get(transaction.txHash) ?? null,
    }),
  )

  return {
    stakeAddress: input.stakeAddress,
    events,
    activeRegistrationCount: calculateActiveRegistrationCount(events),
    checkedAt: input.checkedAt,
    source: input.source,
    scannedTransactionCount: input.transactions.length,
    note: "The timeline is built from public Cardano transaction data. Unknown entries are transactions that could not be confidently identified as a DUST registration or removal from their metadata.",
  }
}

export function classifyRegistrationEvent(input: {
  stakeAddress: string
  transaction: CardanoTransaction
  details: CardanoTransactionDetails | null
}): RegistrationEvent {
  const scriptAddress = DUST_CONTRACT.scriptAddress
  const details = input.details

  // High-confidence: detect by contract address in inputs/outputs.
  const paysToContract = details?.outputs.some(
    (out) => out.address === scriptAddress,
  )
  const spendsFromContract = details?.inputs.some(
    (inp) => inp.address === scriptAddress,
  )

  if (spendsFromContract && !paysToContract) {
    return createEvent({
      type: "registration_removed",
      confidence: "high",
      summary:
        "This transaction spends the DUST registration UTxO from the Cardano script address.",
      technicalDetails: [
        "An input from the DUST registration contract address was detected.",
      ],
      dustAddress: null,
      ...input,
    })
  }

  if (paysToContract) {
    const searchableText = collectSearchableText(details?.metadata)
    const dustAddress = extractDustAddress(searchableText)
    return createEvent({
      type: "registration_created",
      confidence: "high",
      summary:
        "This transaction creates a UTxO at the DUST registration contract address.",
      technicalDetails: [
        "An output to the DUST registration contract address was detected.",
      ],
      dustAddress,
      ...input,
    })
  }

  // Fallback: text metadata heuristics.
  const searchableText = collectSearchableText(details?.metadata)
  const dustAddress = extractDustAddress(searchableText)

  if (REMOVAL_PATTERN.test(searchableText)) {
    return createEvent({
      type: "registration_removed",
      confidence: "medium",
      summary:
        "This transaction contains metadata that looks like a DUST registration removal.",
      technicalDetails: ["Removal wording was found in transaction metadata."],
      dustAddress,
      ...input,
    })
  }

  if (REGISTRATION_PATTERN.test(searchableText) || dustAddress) {
    return createEvent({
      type: "registration_created",
      confidence: dustAddress ? "medium" : "low",
      summary:
        "This transaction contains metadata that looks related to a DUST registration.",
      technicalDetails: dustAddress
        ? ["A DUST-like address was found in transaction metadata."]
        : ["Registration wording was found in transaction metadata."],
      dustAddress,
      ...input,
    })
  }

  return createEvent({
    type: "unknown",
    confidence: "low",
    summary:
      "This Cardano transaction was found for the stake address but could not be identified as a DUST registration or removal.",
    technicalDetails:
      searchableText.trim().length > 0
        ? [
            "Transaction metadata was present but did not match known DUST registration wording.",
          ]
        : [
            "No readable transaction metadata was found by the Cardano provider.",
          ],
    dustAddress: null,
    ...input,
  })
}

export function collectSearchableText(value: unknown): string {
  const fragments: string[] = []
  const seen = new WeakSet<object>()

  function visit(current: unknown): void {
    if (current == null) {
      return
    }

    if (
      typeof current === "string" ||
      typeof current === "number" ||
      typeof current === "boolean"
    ) {
      fragments.push(String(current))
      return
    }

    if (typeof current !== "object" || seen.has(current)) {
      return
    }

    seen.add(current)

    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }

    for (const [key, nestedValue] of Object.entries(
      current as Record<string, unknown>,
    )) {
      fragments.push(key)
      visit(nestedValue)
    }
  }

  visit(value)

  return fragments.join(" ")
}

export function extractDustAddress(searchableText: string): string | null {
  return searchableText.match(DUST_ADDRESS_PATTERN)?.[0] ?? null
}

function createEvent(input: {
  type: RegistrationEvent["type"]
  confidence: RegistrationEvent["confidence"]
  summary: string
  technicalDetails: string[]
  dustAddress: string | null
  stakeAddress: string
  transaction: CardanoTransaction
  details: CardanoTransactionDetails | null
}): RegistrationEvent {
  return {
    type: input.type,
    txHash: input.transaction.txHash,
    blockTime: input.transaction.blockTime,
    blockHeight: input.transaction.blockHeight,
    stakeAddress: input.stakeAddress,
    dustAddress: input.dustAddress,
    confidence: input.confidence,
    summary: input.summary,
    technicalDetails: input.technicalDetails,
    raw: {
      transaction: input.transaction.raw,
      details: input.details?.raw ?? null,
      metadata: input.details?.metadata ?? null,
    },
  }
}

function calculateActiveRegistrationCount(
  events: RegistrationEvent[],
): number | null {
  const knownEvents = events.filter((event) => event.type !== "unknown")

  if (knownEvents.length === 0) {
    return null
  }

  return knownEvents.reduce((count, event) => {
    if (event.type === "registration_created") {
      return count + 1
    }

    return Math.max(0, count - 1)
  }, 0)
}
