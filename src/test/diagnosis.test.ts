import { describe, expect, test } from "vitest"
import {
  containsMultipleRegistrationSignal,
  diagnoseDustStatus,
  isPositiveStatusValue,
  isZeroStatusValue,
  parseStatusNumber,
} from "@/domain/diagnosis"
import type {
  ControlledIndexerError,
  DustGenerationStatus,
} from "@/domain/dustStatus"
import type { CardanoAccountSnapshot } from "@/domain/cardanoAccount"

const baseStatus: DustGenerationStatus = {
  stakeAddress: "stake1u9mockstakeaddress000000000000000000000000",
  registered: true,
  dustAddress: "dust1mockdustaddress000000000000000000000000",
  nightBalance: "1000",
  generationRate: "1.5",
  maxCapacity: "100",
  currentCapacity: "10",
  utxoTxHash: "mock-registration-tx-hash",
  utxoOutputIndex: "0",
  raw: {},
  source: "midnight-indexer",
  checkedAt: "2026-06-06T00:00:00.000Z",
}

const cardanoAccountSnapshot: CardanoAccountSnapshot = {
  stakeAddress: baseStatus.stakeAddress,
  assets: [
    {
      policyId: "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa",
      assetName: "4e49474854",
      fingerprint: "asset1mocknight",
      decimals: 6,
      quantity: "88359765449",
      displayName: "NIGHT",
      raw: {},
    },
  ],
  nightAsset: {
    policyId: "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa",
    assetName: "4e49474854",
    fingerprint: "asset1mocknight",
    decimals: 6,
    quantity: "88359765449",
    displayName: "NIGHT",
    raw: {},
  },
  nightBalance: "88359765449",
  nightBalanceDisplay: "88359.765449",
  nightUtxos: [
    {
      address: "addr1mocknightaddress",
      txHash: "mock-night-utxo-tx",
      txIndex: 0,
      quantity: "88359765449",
      decimals: 6,
      displayAmount: "88359.765449",
      blockTime: "2026-06-06T00:00:00.000Z",
      blockHeight: 100,
      raw: {},
    },
  ],
  vestingSchedule: null,
  source: "koios",
  checkedAt: "2026-06-06T00:00:00.000Z",
  raw: {},
}

describe("diagnoseDustStatus", () => {
  test("classifies a healthy registration", () => {
    expect(diagnoseDustStatus(baseStatus).code).toBe("REGISTERED_OK")
  })

  test("classifies an address that is not registered", () => {
    const diagnosis = diagnoseDustStatus({
      ...baseStatus,
      registered: false,
      dustAddress: null,
      generationRate: null,
      maxCapacity: null,
      currentCapacity: null,
      utxoTxHash: null,
      utxoOutputIndex: null,
    })

    expect(diagnosis.code).toBe("NOT_REGISTERED")
    expect(diagnosis.severity).toBe("warning")
  })

  test("classifies multiple registrations from raw status data", () => {
    const diagnosis = diagnoseDustStatus({
      ...baseStatus,
      raw: { errors: [{ message: "Multiple Registrations detected" }] },
    })

    expect(diagnosis.code).toBe("MULTIPLE_REGISTRATIONS_DETECTED")
    expect(diagnosis.severity).toBe("error")
  })

  test("classifies a missing DUST address", () => {
    const diagnosis = diagnoseDustStatus({
      ...baseStatus,
      dustAddress: "",
    })

    expect(diagnosis.code).toBe("MISSING_DUST_ADDRESS")
  })

  test("classifies a zero generation rate", () => {
    const diagnosis = diagnoseDustStatus({
      ...baseStatus,
      generationRate: "0",
    })

    expect(diagnosis.code).toBe("ZERO_GENERATION_RATE")
  })

  test("classifies Cardano NIGHT and Midnight indexer zero balance as a mismatch", () => {
    const diagnosis = diagnoseDustStatus(
      {
        ...baseStatus,
        nightBalance: "0",
        generationRate: "0",
        maxCapacity: "0",
        currentCapacity: "0",
      },
      null,
      { cardanoAccountSnapshot },
    )

    expect(diagnosis.code).toBe("CARDANO_NIGHT_INDEXER_MISMATCH")
    expect(diagnosis.summary).toContain("Cardano stake key holds NIGHT")
  })

  test("prefers confirmed removal with indexer lag over the NIGHT mismatch", () => {
    const diagnosis = diagnoseDustStatus(
      {
        ...baseStatus,
        nightBalance: "0",
        generationRate: "0",
        maxCapacity: "0",
        currentCapacity: "0",
      },
      null,
      {
        cardanoAccountSnapshot,
        onChainRegistrationState: { kind: "deregistration_pending" },
      },
    )

    expect(diagnosis.code).toBe("DEREGISTRATION_CONFIRMED_INDEXER_LAG")
    expect(diagnosis.recommendedAction).toContain(
      "Do not submit another removal transaction",
    )
  })

  test("classifies a missing generation rate", () => {
    const diagnosis = diagnoseDustStatus({
      ...baseStatus,
      generationRate: null,
    })

    expect(diagnosis.code).toBe("ZERO_GENERATION_RATE")
  })

  test("classifies zero current capacity", () => {
    const diagnosis = diagnoseDustStatus({
      ...baseStatus,
      currentCapacity: "0",
    })

    expect(diagnosis.code).toBe("ZERO_CURRENT_CAPACITY")
    expect(diagnosis.severity).toBe("info")
  })

  test("classifies an indexer failure", () => {
    const error: ControlledIndexerError = {
      code: "NETWORK_ERROR",
      message: "The request timed out.",
      userMessage: "The Midnight indexer could not be reached.",
      technicalDetails: ["Timeout while calling the indexer."],
      raw: null,
      checkedAt: "2026-06-06T00:00:00.000Z",
    }

    expect(diagnoseDustStatus(null, error).code).toBe("INDEXER_ERROR")
  })

  test("classifies multiple registrations from an error message before a generic indexer error", () => {
    const error: ControlledIndexerError = {
      code: "GRAPHQL_ERROR",
      message: "Multiple Registrations detected",
      userMessage: "The Midnight indexer returned an error for this address.",
      technicalDetails: [],
      raw: null,
      checkedAt: "2026-06-06T00:00:00.000Z",
    }

    expect(diagnoseDustStatus(null, error).code).toBe(
      "MULTIPLE_REGISTRATIONS_DETECTED",
    )
  })

  test("falls back to unknown status", () => {
    const diagnosis = diagnoseDustStatus({
      ...baseStatus,
      registered: null,
      generationRate: "pending",
      currentCapacity: "pending",
    })

    expect(diagnosis.code).toBe("UNKNOWN_STATUS")
  })
})

describe("numeric status parsing", () => {
  test("parses status numbers used by generation rate and capacity checks", () => {
    expect(parseStatusNumber("0")).toBe(0)
    expect(parseStatusNumber("0 DUST")).toBe(0)
    expect(parseStatusNumber("1,234.50")).toBe(1234.5)
    expect(parseStatusNumber(null)).toBeNull()
    expect(parseStatusNumber("not reported")).toBeNull()
  })

  test("checks zero and positive values deterministically", () => {
    expect(isZeroStatusValue("0")).toBe(true)
    expect(isZeroStatusValue("0.00 DUST")).toBe(true)
    expect(isPositiveStatusValue("0")).toBe(false)
    expect(isPositiveStatusValue("0.01")).toBe(true)
  })
})

describe("multiple registration detection", () => {
  test("detects a direct error message", () => {
    expect(
      containsMultipleRegistrationSignal("Multiple Registrations detected"),
    ).toBe(true)
  })

  test("detects a raw JSON string", () => {
    const rawJson = JSON.stringify({
      errors: [{ message: "multiple registrations" }],
    })

    expect(containsMultipleRegistrationSignal(rawJson)).toBe(true)
  })

  test("detects mixed casing", () => {
    expect(containsMultipleRegistrationSignal("mUlTiPlE rEgIsTrAtIoNs")).toBe(
      true,
    )
  })

  test("detects a nested raw object", () => {
    const raw = {
      data: {
        dustGenerationStatus: null,
      },
      errors: [
        {
          extensions: {
            reason: "multiple active registrations were found",
          },
        },
      ],
    }

    expect(containsMultipleRegistrationSignal(raw)).toBe(true)
  })
})
