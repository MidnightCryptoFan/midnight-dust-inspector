import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import { CardanoInspectionPanel } from "@/components/CardanoInspectionPanel"
import type { DustGenerationStatus } from "@/domain/dustStatus"
import type {
  RegistrationEvent,
  RegistrationTimeline,
} from "@/domain/registrationTimeline"

const inactiveStatus: DustGenerationStatus = {
  stakeAddress: "stake1u8eseh2482k5e3a65sy9xsakzjl497zt5elwfh7q3u8k54g7yetxq",
  registered: false,
  dustAddress: null,
  nightBalance: "0",
  generationRate: "0",
  maxCapacity: "0",
  currentCapacity: "0",
  utxoTxHash: null,
  utxoOutputIndex: null,
  registrations: [],
  raw: {},
  source: "midnight-indexer",
  checkedAt: "2026-06-07T00:00:00.000Z",
}

// Indexer still says registered=true, but UTxO was already spent (deregistration
// confirmed on-chain, indexer catching up) — the real conflict scenario.
const activeStatus: DustGenerationStatus = {
  ...inactiveStatus,
  registered: true,
  utxoTxHash:
    "5dce41e2b8d5f4fd750e71f74ac2a27398031b7ab46fd2060239d1bee8b398b0",
  utxoOutputIndex: "0",
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("CardanoInspectionPanel active source lookup", () => {
  test("converts the indexer rate from SPECK per second to DUST per hour", () => {
    render(
      <CardanoInspectionPanel
        activeRegistrationLookup={{ status: "idle" }}
        dustGrowthStatus="stable"
        dustCapFull={false}
        multipleRegistrations={false}
        indexerStatus={{
          ...activeStatus,
          dustAddress: "mn_dust1mockdustaddress000000000000000000000000",
          generationRate: "5576091500000",
        }}
        isOnChainLoading={false}
        midnightAddress={null}
        onChainState={{ kind: "registered_active" }}
        onDeregister={vi.fn()}
        onFindActiveSource={vi.fn()}
        onInspectActiveSource={vi.fn()}
        onRefresh={vi.fn()}
        onRegister={vi.fn()}
        recentActivity={null}
        snapshot={null}
        timeline={null}
        timelineError={null}
        walletConnected={false}
      />,
    )

    expect(screen.getByText("20.0739 DUST/h")).toBeTruthy()
  })

  test("offers reverse lookup when the DUST cap is full but the inspected stake is inactive", () => {
    const onFindActiveSource = vi.fn()

    render(
      <CardanoInspectionPanel
        activeRegistrationLookup={{ status: "idle" }}
        dustGrowthStatus="stable"
        dustCapFull
        multipleRegistrations={false}
        indexerStatus={inactiveStatus}
        isOnChainLoading={false}
        midnightAddress="mn_dust1mockdustaddress000000000000000000000000"
        onChainState={null}
        onDeregister={vi.fn()}
        onFindActiveSource={onFindActiveSource}
        onInspectActiveSource={vi.fn()}
        onRefresh={vi.fn()}
        onRegister={vi.fn()}
        recentActivity={null}
        snapshot={null}
        timeline={null}
        timelineError={null}
        walletConnected
      />,
    )

    expect(
      screen.getByText(/does not confirm that the Cardano stake address/i),
    ).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", {
        name: "Find the Cardano source for this DUST wallet",
      }),
    )
    expect(onFindActiveSource).toHaveBeenCalledOnce()
  })

  test("lets the user find and inspect the active source when DUST is growing elsewhere", () => {
    const onFindActiveSource = vi.fn()
    const onInspectActiveSource = vi.fn()
    const sourceStakeAddress =
      "stake1u9mockactivesource000000000000000000000000"

    render(
      <CardanoInspectionPanel
        activeRegistrationLookup={{
          status: "found",
          stakeAddress: sourceStakeAddress,
          candidateStakeAddresses: [sourceStakeAddress],
          confidence: "indexer_verified",
          paymentKeyHash:
            "f9e4b726d2aa13b3b3c4ea3dc964382bc0aea1d65600d4dac0e0538a",
          txHash:
            "5dce41e2b8d5f4fd750e71f74ac2a27398031b7ab46fd2060239d1bee8b398b0",
          outputIndex: 0,
          registrationUtxos: [
            {
              txHash:
                "5dce41e2b8d5f4fd750e71f74ac2a27398031b7ab46fd2060239d1bee8b398b0",
              outputIndex: 0,
              paymentKeyHash:
                "f9e4b726d2aa13b3b3c4ea3dc964382bc0aea1d65600d4dac0e0538a",
            },
          ],
        }}
        dustGrowthStatus="growing"
        dustCapFull={false}
        multipleRegistrations={false}
        indexerStatus={inactiveStatus}
        isOnChainLoading={false}
        midnightAddress="mn_dust1mockdustaddress000000000000000000000000"
        onChainState={null}
        onDeregister={vi.fn()}
        onFindActiveSource={onFindActiveSource}
        onInspectActiveSource={onInspectActiveSource}
        onRefresh={vi.fn()}
        onRegister={vi.fn()}
        recentActivity={null}
        snapshot={null}
        timeline={null}
        timelineError={null}
        walletConnected
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Find active source" }))
    expect(onFindActiveSource).toHaveBeenCalledOnce()
    expect(screen.getByText("Active registration source found.")).toBeTruthy()
    expect(screen.getByText(sourceStakeAddress)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Inspect source" }))
    expect(onInspectActiveSource).toHaveBeenCalledWith(sourceStakeAddress)
  })

  test("shows every structured Midnight mapping when registrations conflict", () => {
    render(
      <CardanoInspectionPanel
        activeRegistrationLookup={{ status: "idle" }}
        dustGrowthStatus="stable"
        dustCapFull={false}
        multipleRegistrations
        indexerStatus={{
          ...inactiveStatus,
          registrations: [
            {
              dustAddress: "mn_dust1first",
              valid: false,
              nightBalance: "10",
              generationRate: "0",
              maxCapacity: "50",
              currentCapacity: "50",
              utxoTxHash: "first-registration",
              utxoOutputIndex: "0",
            },
            {
              dustAddress: "mn_dust1second",
              valid: false,
              nightBalance: "20",
              generationRate: "0",
              maxCapacity: "100",
              currentCapacity: "100",
              utxoTxHash: "second-registration",
              utxoOutputIndex: "1",
            },
          ],
        }}
        isOnChainLoading={false}
        midnightAddress="mn_dust1second"
        onChainState={null}
        onDeregister={vi.fn()}
        onFindActiveSource={vi.fn()}
        onInspectActiveSource={vi.fn()}
        onRefresh={vi.fn()}
        onRegister={vi.fn()}
        recentActivity={null}
        snapshot={null}
        timeline={null}
        timelineError={null}
        walletConnected
      />,
    )

    expect(
      screen.getByText("2 active Cardano → Midnight mappings found"),
    ).toBeTruthy()
    expect(screen.getByText("mn_dust1first")).toBeTruthy()
    expect(screen.getByText("mn_dust1second")).toBeTruthy()
    expect(screen.getByText("✓ Connected Midnight wallet")).toBeTruthy()
  })

  test("shows ambiguous Cardano candidates without auto-selecting one", () => {
    const onInspectActiveSource = vi.fn()
    const firstCandidate = "stake1u9mockfirstcandidate000000000000000000000000"
    const secondCandidate = "stake1u9mocksecondcandidate00000000000000000000000"

    render(
      <CardanoInspectionPanel
        activeRegistrationLookup={{
          status: "found",
          stakeAddress: null,
          candidateStakeAddresses: [firstCandidate, secondCandidate],
          confidence: "ambiguous",
          paymentKeyHash:
            "f9e4b726d2aa13b3b3c4ea3dc964382bc0aea1d65600d4dac0e0538a",
          txHash:
            "5dce41e2b8d5f4fd750e71f74ac2a27398031b7ab46fd2060239d1bee8b398b0",
          outputIndex: 0,
          registrationUtxos: [
            {
              txHash:
                "5dce41e2b8d5f4fd750e71f74ac2a27398031b7ab46fd2060239d1bee8b398b0",
              outputIndex: 0,
              paymentKeyHash:
                "f9e4b726d2aa13b3b3c4ea3dc964382bc0aea1d65600d4dac0e0538a",
            },
          ],
        }}
        dustGrowthStatus="growing"
        dustCapFull={false}
        multipleRegistrations={false}
        indexerStatus={inactiveStatus}
        isOnChainLoading={false}
        midnightAddress="mn_dust1mockdustaddress000000000000000000000000"
        onChainState={null}
        onDeregister={vi.fn()}
        onFindActiveSource={vi.fn()}
        onInspectActiveSource={onInspectActiveSource}
        onRefresh={vi.fn()}
        onRegister={vi.fn()}
        recentActivity={null}
        snapshot={null}
        timeline={null}
        timelineError={null}
        walletConnected
      />,
    )

    expect(
      screen.getByText(
        "Active registration found; Cardano source needs confirmation.",
      ),
    ).toBeTruthy()
    const candidateButtons = screen.getAllByRole("button", {
      name: "Inspect candidate",
    })
    fireEvent.click(candidateButtons[1])
    expect(onInspectActiveSource).toHaveBeenCalledWith(secondCandidate)
  })

  test("explains that a full DUST balance does not reveal its Cardano source", () => {
    const recentRemoval: RegistrationEvent = {
      type: "registration_removed",
      txHash:
        "5dce41e2b8d5f4fd750e71f74ac2a27398031b7ab46fd2060239d1bee8b398b0",
      blockTime: "2026-06-06T08:14:27.000Z",
      blockHeight: 100,
      stakeAddress: inactiveStatus.stakeAddress,
      dustAddress: null,
      nightAmount: null,
      nightDirection: null,
      confidence: "high",
      summary: "DUST registration was removed.",
      technicalDetails: [],
      raw: {},
    }

    render(
      <CardanoInspectionPanel
        activeRegistrationLookup={{
          status: "not_found",
          reason:
            "No registration UTxO was found at the script address for this Midnight DUST address.",
        }}
        dustGrowthStatus="growing"
        dustCapFull={false}
        multipleRegistrations={false}
        indexerStatus={inactiveStatus}
        isOnChainLoading={false}
        midnightAddress="mn_dust1mockdustaddress000000000000000000000000"
        onChainState={null}
        onDeregister={vi.fn()}
        onFindActiveSource={vi.fn()}
        onInspectActiveSource={vi.fn()}
        onRefresh={vi.fn()}
        onRegister={vi.fn()}
        recentActivity={recentRemoval}
        snapshot={null}
        timeline={null}
        timelineError={null}
        walletConnected
      />,
    )

    expect(screen.getByText("No active Cardano source found.")).toBeTruthy()
    expect(
      screen.getByText(/DUST balance and cap alone cannot identify/i),
    ).toBeTruthy()
    expect(
      screen.getByText(/Latest registration change seen here/),
    ).toBeTruthy()
  })
})

describe("CardanoInspectionPanel registration history", () => {
  const removalEvent: RegistrationEvent = {
    type: "registration_removed",
    txHash: "5dce41e2b8d5f4fd750e71f74ac2a27398031b7ab46fd2060239d1bee8b398b0",
    blockTime: "2026-06-06T08:14:27.000Z",
    blockHeight: 100,
    stakeAddress: inactiveStatus.stakeAddress,
    dustAddress: null,
    nightAmount: null,
    nightDirection: null,
    confidence: "high",
    summary: "DUST registration was removed.",
    technicalDetails: [],
    raw: {},
  }

  function timelineWith(
    event: RegistrationEvent,
    checkedAt = inactiveStatus.checkedAt,
  ): RegistrationTimeline {
    return {
      stakeAddress: inactiveStatus.stakeAddress,
      events: [event],
      activeRegistrationCount: 0,
      checkedAt,
      source: "koios",
      scannedTransactionCount: 1,
      partial: false,
      failedDetailCount: 0,
      note: "Test timeline",
    }
  }

  function renderWithEvent(event: RegistrationEvent) {
    render(
      <CardanoInspectionPanel
        activeRegistrationLookup={{ status: "idle" }}
        dustGrowthStatus="stable"
        dustCapFull={false}
        multipleRegistrations={false}
        // Indexer says registered=true, but on-chain the UTxO is already spent.
        // This is the genuine conflict that triggers sync/support warnings.
        indexerStatus={activeStatus}
        isOnChainLoading={false}
        midnightAddress="mn_dust1mockdustaddress000000000000000000000000"
        onChainState={{ kind: "deregistration_pending" }}
        onDeregister={vi.fn()}
        onFindActiveSource={vi.fn()}
        onInspectActiveSource={vi.fn()}
        onRefresh={vi.fn()}
        onRegister={vi.fn()}
        recentActivity={event}
        snapshot={null}
        timeline={timelineWith(event)}
        timelineError={null}
        walletConnected
      />,
    )
  }

  test("copies the full transaction id from a registration event", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })

    renderWithEvent(removalEvent)

    fireEvent.click(screen.getByRole("button", { name: "Copy" }))

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(removalEvent.txHash),
    )
    expect(screen.getByRole("button", { name: "Copied!" })).toBeTruthy()
  })

  test("warns that a contradictory recent event may still be syncing", () => {
    renderWithEvent(removalEvent)

    expect(
      screen.getByText("Recent change - status may still sync"),
    ).toBeTruthy()
    expect(screen.getByText(/less than 48 hours old/)).toBeTruthy()
  })

  test("escalates contradictory events older than 48 hours to support", () => {
    renderWithEvent({
      ...removalEvent,
      blockTime: "2026-06-04T00:00:00.000Z",
    })

    expect(screen.getByText("Needs support review")).toBeTruthy()
    expect(screen.getByText(/older than 48 hours/)).toBeTruthy()
    expect(screen.getByText(/contact Midnight support/)).toBeTruthy()
  })
})
