import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import { InspectorApp } from "@/components/InspectorApp"
import type { CardanoAccountSnapshot } from "@/domain/cardanoAccount"
import type { DustGenerationStatus } from "@/domain/dustStatus"
import { inspectDustGenerationStatusFromApi } from "@/services/dustStatusApiClient"
import { inspectRegistrationTimelineFromApi } from "@/services/registrationTimelineApiClient"
import { connectWallet } from "@/services/wallet/cip30"

vi.mock("@/services/midnightIndexerClient", () => ({
  inspectDustGenerationStatus: vi.fn(),
  isMockIndexerEnabled: () => false,
  mockIndexerScenarios: [],
}))

vi.mock("@/services/dustStatusApiClient", () => ({
  inspectDustGenerationStatusFromApi: vi.fn(),
}))

vi.mock("@/services/registrationTimelineApiClient", () => ({
  inspectRegistrationTimelineFromApi: vi.fn(),
}))

vi.mock("@/services/wallet/cip30", () => ({
  connectWallet: vi.fn(),
  detectInstalledWallets: vi.fn(() => [
    {
      id: "eternl",
      name: "Eternl",
      icon: "",
    },
  ]),
}))

const stakeAddress =
  "stake1u8eseh2482k5e3a65sy9xsakzjl497zt5elwfh7q3u8k54g7yetxq"
const paymentKeyHash =
  "f9e4b726d2aa13b3b3c4ea3dc964382bc0aea1d65600d4dac0e0538a"

const registeredWithoutUtxo: DustGenerationStatus = {
  stakeAddress,
  registered: true,
  dustAddress:
    "mn_dust1wdqhsj25ygtlxnrrzg354rqh80lua9sy68cgmsmqel4rr0ls2q8qg5m6mqm",
  nightBalance: "0",
  generationRate: "0",
  maxCapacity: "0",
  currentCapacity: "0",
  utxoTxHash: null,
  utxoOutputIndex: null,
  raw: {},
  source: "midnight-indexer",
  checkedAt: "2026-06-06T00:00:00.000Z",
}

const cardanoNightSnapshot: CardanoAccountSnapshot = {
  stakeAddress,
  assets: [
    {
      policyId: "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa",
      assetName: "4e49474854",
      fingerprint: "asset1night",
      decimals: 6,
      quantity: "94114390552",
      displayName: "NIGHT",
      raw: {},
    },
  ],
  nightAsset: {
    policyId: "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa",
    assetName: "4e49474854",
    fingerprint: "asset1night",
    decimals: 6,
    quantity: "94114390552",
    displayName: "NIGHT",
    raw: {},
  },
  nightBalance: "94114390552",
  nightBalanceDisplay: "94114.390552",
  nightUtxos: [
    {
      address: "addr1mocknightaddress",
      txHash: "night-utxo",
      txIndex: 0,
      quantity: "94114390552",
      decimals: 6,
      displayAmount: "94114.390552",
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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("InspectorApp wallet connection", () => {
  test("uses the connected wallet payment key hash for the first on-chain scan", async () => {
    vi.mocked(connectWallet).mockResolvedValue({
      info: {
        id: "eternl",
        name: "Eternl",
        icon: "",
      },
      stakeAddress,
      paymentKeyHash,
      rawApi: {} as never,
    })
    vi.mocked(inspectDustGenerationStatusFromApi).mockResolvedValue({
      status: registeredWithoutUtxo,
      rawResponse: {},
      controlledError: null,
    })
    vi.mocked(inspectRegistrationTimelineFromApi).mockResolvedValue({
      timeline: null,
      cardanoAccountSnapshot: null,
      controlledError: null,
    })
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          state: { kind: "deregistration_pending" },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    )

    render(<InspectorApp />)

    fireEvent.click(await screen.findByRole("button", { name: "Eternl" }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/on-chain-registration",
        expect.objectContaining({
          body: JSON.stringify({ paymentKeyHash }),
        }),
      )
    })
  })

  test("waits for the on-chain check before showing the NIGHT mismatch guide", async () => {
    vi.mocked(connectWallet).mockResolvedValue({
      info: {
        id: "eternl",
        name: "Eternl",
        icon: "",
      },
      stakeAddress,
      paymentKeyHash,
      rawApi: {} as never,
    })
    vi.mocked(inspectDustGenerationStatusFromApi).mockResolvedValue({
      status: registeredWithoutUtxo,
      rawResponse: {},
      controlledError: null,
    })
    vi.mocked(inspectRegistrationTimelineFromApi).mockResolvedValue({
      timeline: null,
      cardanoAccountSnapshot: cardanoNightSnapshot,
      controlledError: null,
    })

    let resolveOnChainCheck!: (response: Response) => void
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveOnChainCheck = resolve
      }),
    )

    render(<InspectorApp />)

    fireEvent.click(await screen.findByRole("button", { name: "Eternl" }))

    expect(await screen.findByText("Checking…")).toBeTruthy()
    expect(screen.queryByText("What to do about the NIGHT mismatch")).toBeNull()

    resolveOnChainCheck(
      new Response(
        JSON.stringify({
          state: { kind: "deregistration_pending" },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    )

    expect(
      await screen.findByText("Deregistration confirmed on-chain."),
    ).toBeTruthy()
    expect(
      screen.queryByText("Removal is confirmed; wait for the indexer"),
    ).toBeNull()
  })
})
