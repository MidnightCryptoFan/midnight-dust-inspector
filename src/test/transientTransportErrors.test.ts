import { describe, expect, it, vi } from "vitest"
import {
  isTransientTransportError,
  utxosByOutRefPerTx,
} from "@/services/cardano/dustTransactions.client"
import type { OutRef, UTxO } from "@lucid-evolution/lucid"

describe("utxosByOutRefPerTx", () => {
  // Lucid's Koios getUtxosByOutRef only returns UTxOs of the FIRST creating
  // transaction in a batched call, so the helper must issue one call per tx.
  it("queries once per creating transaction and merges the results", async () => {
    const fetcher = vi.fn(async (outRefs: OutRef[]) =>
      outRefs.map(
        (outRef) =>
          ({
            txHash: outRef.txHash,
            outputIndex: outRef.outputIndex,
            address: "addr1...",
            assets: {},
          }) as UTxO,
      ),
    )

    const utxos = await utxosByOutRefPerTx(fetcher, [
      { txHash: "tx-a", outputIndex: 0 },
      { txHash: "tx-b", outputIndex: 0 },
      { txHash: "tx-a", outputIndex: 2 },
    ])

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenCalledWith([
      { txHash: "tx-a", outputIndex: 0 },
      { txHash: "tx-a", outputIndex: 2 },
    ])
    expect(fetcher).toHaveBeenCalledWith([{ txHash: "tx-b", outputIndex: 0 }])
    expect(utxos.map((u) => `${u.txHash}#${u.outputIndex}`).sort()).toEqual([
      "tx-a#0",
      "tx-a#2",
      "tx-b#0",
    ])
  })

  it("propagates a failure of any per-tx call", async () => {
    const fetcher = vi.fn(async (outRefs: OutRef[]) => {
      if (outRefs[0]!.txHash === "tx-b") {
        throw new Error("Transport error")
      }
      return []
    })

    await expect(
      utxosByOutRefPerTx(fetcher, [
        { txHash: "tx-a", outputIndex: 0 },
        { txHash: "tx-b", outputIndex: 0 },
      ]),
    ).rejects.toThrow("Transport error")
  })
})

describe("isTransientTransportError", () => {
  it.each([
    "RequestError: Transport error (GET https://api.koios.rest/api/v1/epoch_params?limit=1)",
    "TypeError: Failed to fetch",
    "fetch failed",
    "network error",
    "ECONNRESET",
    "Request timeout",
    "Load failed",
  ])("treats %s as transient", (message) => {
    expect(isTransientTransportError(new Error(message))).toBe(true)
  })

  it.each([
    "Koios returned HTTP 429: too many requests",
    "Too Many Requests",
    "rate limit exceeded",
  ])("treats the rate-limit error %s as transient", (message) => {
    expect(isTransientTransportError(new Error(message))).toBe(true)
  })

  it.each([
    "Koios returned HTTP 500: internal error",
    "MissingVKeyWitnesses",
    // A bare number inside longer hex/ids must not look like a 429 status.
    "UTxO a1b429ffde#0 does not hold the DUST registration NFT.",
  ])("does not treat %s as transient", (message) => {
    expect(isTransientTransportError(new Error(message))).toBe(false)
  })
})
