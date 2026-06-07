import { describe, expect, test } from "vitest"
import {
  buildRegistrationTimeline,
  classifyRegistrationEvent,
  collectSearchableText,
  extractDustAddress,
} from "@/domain/registrationTimelineAnalysis"
import type {
  CardanoTransaction,
  CardanoTransactionDetails,
} from "@/services/cardano/CardanoChainProvider"

const stakeAddress = "stake1u9mockstakeaddress000000000000000000000000"

function transaction(txHash: string, blockTime: string): CardanoTransaction {
  return {
    txHash,
    blockTime,
    blockHeight: 100,
    raw: { tx_hash: txHash },
  }
}

function details(txHash: string, metadata: unknown): CardanoTransactionDetails {
  return {
    txHash,
    blockTime: null,
    blockHeight: null,
    inputs: [],
    outputs: [],
    metadata,
    raw: { tx_hash: txHash, metadata },
  }
}

describe("registration timeline analysis", () => {
  test("collects searchable text from nested metadata", () => {
    expect(
      collectSearchableText({
        midnight: {
          action: "register DUST",
        },
      }),
    ).toContain("register DUST")
  })

  test("extracts a DUST-like address from metadata text", () => {
    expect(
      extractDustAddress("send generated resource to dust1mockaddress00000000"),
    ).toBe("dust1mockaddress00000000")
  })

  test("classifies likely registration metadata", () => {
    const event = classifyRegistrationEvent({
      stakeAddress,
      transaction: transaction("tx1", "2026-01-01T00:00:00.000Z"),
      details: details("tx1", {
        action: "register Midnight DUST destination",
        dustAddress: "dust1mockaddress00000000",
      }),
    })

    expect(event.type).toBe("registration_created")
    expect(event.dustAddress).toBe("dust1mockaddress00000000")
  })

  test("classifies likely removal metadata", () => {
    const event = classifyRegistrationEvent({
      stakeAddress,
      transaction: transaction("tx2", "2026-01-02T00:00:00.000Z"),
      details: details("tx2", {
        action: "remove DUST registration",
      }),
    })

    expect(event.type).toBe("registration_removed")
  })

  test("keeps unclear metadata as unknown", () => {
    const event = classifyRegistrationEvent({
      stakeAddress,
      transaction: transaction("tx3", "2026-01-03T00:00:00.000Z"),
      details: details("tx3", {
        message: "ordinary wallet transaction",
      }),
    })

    expect(event.type).toBe("unknown")
  })

  test("builds a chronological timeline and active count from known events", () => {
    const first = transaction("tx1", "2026-01-01T00:00:00.000Z")
    const second = transaction("tx2", "2026-01-02T00:00:00.000Z")
    const timeline = buildRegistrationTimeline({
      stakeAddress,
      transactions: [second, first],
      detailsByTxHash: new Map([
        [first.txHash, details(first.txHash, { action: "register DUST" })],
        [
          second.txHash,
          details(second.txHash, { action: "remove DUST registration" }),
        ],
      ]),
      checkedAt: "2026-06-06T00:00:00.000Z",
      source: "koios",
    })

    expect(timeline.events.map((event) => event.txHash)).toEqual(["tx1", "tx2"])
    expect(timeline.activeRegistrationCount).toBe(0)
  })

  test("reports unclear active count when no known events are found", () => {
    const timeline = buildRegistrationTimeline({
      stakeAddress,
      transactions: [transaction("tx1", "2026-01-01T00:00:00.000Z")],
      detailsByTxHash: new Map(),
      checkedAt: "2026-06-06T00:00:00.000Z",
      source: "koios",
    })

    expect(timeline.activeRegistrationCount).toBeNull()
  })
})
