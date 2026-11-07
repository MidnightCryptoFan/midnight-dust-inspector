import { afterEach, describe, expect, test, vi } from "vitest"
import { createKoiosServerTransport } from "@/services/cardano/koiosServerTransport"

afterEach(() => {
  vi.useRealTimers()
})

describe("Koios server transport", () => {
  test("queues requests beyond the configured free API window", async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(async () => Response.json([]))
    const transport = createKoiosServerTransport(fetcher, {
      maxInWindow: 2,
      windowMs: 1_000,
    })

    const requests = [
      transport("https://api.koios.rest/api/v1/account_txs"),
      transport("https://api.koios.rest/api/v1/account_assets"),
      transport("https://api.koios.rest/api/v1/account_addresses"),
    ]

    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1_000)
    await Promise.all(requests)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})
