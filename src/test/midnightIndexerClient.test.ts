import { afterEach, describe, expect, test, vi } from "vitest"
import {
  findStakeAddressesForDustAddress,
  inspectDustGenerationStatus,
} from "@/services/midnightIndexerClient"

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

  test("never sends the Blockfrost token to a custom indexer", async () => {
    vi.stubEnv("MIDNIGHT_INDEXER_URL", "https://indexer.example/graphql")
    vi.stubEnv("MIDNIGHT_BLOCKFROST_PROJECT_ID", "secret-project-token")
    const fetcher = vi.fn(async () =>
      Response.json({ data: { dustGenerationStatus: [] } }),
    )

    await inspectDustGenerationStatus(stakeAddress, { fetcher })

    expect(fetcher).toHaveBeenCalledWith(
      "https://indexer.example/graphql",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          project_id: expect.anything(),
        }),
      }),
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

describe("Midnight registration mappings", () => {
  test("returns every active mapping reported for a Cardano stake address", async () => {
    vi.stubEnv("MIDNIGHT_BLOCKFROST_PROJECT_ID", "secret-project-token")
    const fetcher = vi.fn(async () =>
      Response.json({
        data: {
          dustGenerationStatus: [
            {
              cardanoRewardAddress: stakeAddress,
              registered: false,
              dustAddress: null,
              nightBalance: "0",
              generationRate: "0",
              maxCapacity: "0",
              currentCapacity: "0",
              utxoTxHash: null,
              utxoOutputIndex: null,
            },
          ],
          dustGenerations: [
            {
              cardanoRewardAddress: stakeAddress,
              registrations: [
                {
                  dustAddress: "mn_dust1first",
                  valid: false,
                  nightBalance: "10",
                  generationRate: "0",
                  maxCapacity: "50",
                  currentCapacity: "50",
                  utxoTxHash: "first-tx",
                  utxoOutputIndex: 0,
                },
                {
                  dustAddress: "mn_dust1second",
                  valid: false,
                  nightBalance: "20",
                  generationRate: "0",
                  maxCapacity: "100",
                  currentCapacity: "100",
                  utxoTxHash: "second-tx",
                  utxoOutputIndex: 1,
                },
              ],
            },
          ],
        },
      }),
    )

    const result = await inspectDustGenerationStatus(stakeAddress, { fetcher })

    expect(result.status?.registrations).toHaveLength(2)
    expect(result.status?.registrations[1]).toMatchObject({
      dustAddress: "mn_dust1second",
      utxoOutputIndex: "1",
    })
  })

  test("verifies reverse-lookup candidates against their active DUST mappings", async () => {
    vi.stubEnv("MIDNIGHT_BLOCKFROST_PROJECT_ID", "secret-project-token")
    const otherStakeAddress =
      "stake1u9mockotherstakeaddress0000000000000000000000"
    const fetcher = vi.fn(async () =>
      Response.json({
        data: {
          dustGenerations: [
            {
              cardanoRewardAddress: stakeAddress,
              registrations: [
                {
                  dustAddress: "mn_dust1target",
                  valid: true,
                  nightBalance: "10",
                  generationRate: "1",
                  maxCapacity: "50",
                  currentCapacity: "20",
                  utxoTxHash: "target-tx",
                  utxoOutputIndex: 0,
                },
              ],
            },
            {
              cardanoRewardAddress: otherStakeAddress,
              registrations: [],
            },
          ],
        },
      }),
    )

    const result = await findStakeAddressesForDustAddress(
      [stakeAddress, otherStakeAddress],
      "mn_dust1target",
      { fetcher },
    )

    expect(result).toEqual({ matches: [stakeAddress], complete: true })
  })
})
