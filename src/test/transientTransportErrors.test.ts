import { describe, expect, it } from "vitest"
import { isTransientTransportError } from "@/services/cardano/dustTransactions.client"

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
