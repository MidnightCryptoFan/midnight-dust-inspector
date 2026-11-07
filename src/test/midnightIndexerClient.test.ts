import { afterEach, describe, expect, test, vi } from "vitest"
import { inspectDustGenerationStatus } from "@/services/midnightIndexerClient"

const stakeAddress =
  "stake1u8eseh2482k5e3a65sy9xsakzjl497zt5elwfh7q3u8k54g7yetxq"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("Midnight indexer configuration", () => {
  test("uses the server-only Blockfrost token with the free mainnet endpoint", async () => {
    vi.stubEnv("MIDNIGHT_INDEXER_URL", "")
    vi.stubEnv("MIDNIGHT_BLOCKFROST_PROJECT_ID", "secret-project-token")
    vi.stubEnv("NEXT_PUBLIC_MIDNIGHT_INDEXER_URL", "https://ignored.example")
    const fetcher = vi.fn(async () =>
      Response.json({ data: { dustGenerationStatus: [] } }),
    )

    const result = await inspectDustGenerationStatus(stakeAddress, { fetcher })

    expect(result.controlledError).toBeNull()
    expect(fetcher).toHaveBeenCalledWith(
      "https://midnight-mainnet.blockfrost.io/api/v0",
      expect.objectContaining({
        headers: expect.objectContaining({
          project_id: "secret-project-token",
        }),
      }),
    )
  })

  test("does not fall back to a public browser environment variable", async () => {
    vi.stubEnv("MIDNIGHT_INDEXER_URL", "")
    vi.stubEnv("MIDNIGHT_BLOCKFROST_PROJECT_ID", "")
    vi.stubEnv("NEXT_PUBLIC_MIDNIGHT_INDEXER_URL", "https://ignored.example")
    const fetcher = vi.fn()

    const result = await inspectDustGenerationStatus(stakeAddress, { fetcher })

    expect(fetcher).not.toHaveBeenCalled()
    expect(result.controlledError?.code).toBe("CONFIGURATION_ERROR")
  })

  test("replaces the retired endpoint when a Blockfrost token is available", async () => {
    vi.stubEnv(
      "MIDNIGHT_INDEXER_URL",
      "https://indexer.mainnet.midnight.network/api/v4/graphql",
    )
    vi.stubEnv("MIDNIGHT_BLOCKFROST_PROJECT_ID", "secret-project-token")
    const fetcher = vi.fn(async () =>
      Response.json({ data: { dustGenerationStatus: [] } }),
    )

    await inspectDustGenerationStatus(stakeAddress, { fetcher })

    expect(fetcher).toHaveBeenCalledWith(
      "https://midnight-mainnet.blockfrost.io/api/v0",
      expect.any(Object),
    )
  })

  test("reports the retired endpoint without leaking it to the browser", async () => {
    vi.stubEnv(
      "MIDNIGHT_INDEXER_URL",
      "https://indexer.mainnet.midnight.network/api/v4/graphql",
    )
    vi.stubEnv("MIDNIGHT_BLOCKFROST_PROJECT_ID", "")
    const fetcher = vi.fn()

    const result = await inspectDustGenerationStatus(stakeAddress, { fetcher })

    expect(fetcher).not.toHaveBeenCalled()
    expect(result.controlledError).toMatchObject({
      code: "CONFIGURATION_ERROR",
      message: "The configured Midnight indexer endpoint has been retired.",
    })
  })
})
