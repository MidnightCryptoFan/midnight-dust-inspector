import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import { MidnightDustWalletPanel } from "@/components/MidnightDustWalletPanel"
import type { MidnightDustBalance } from "@/domain/midnightDustBalance"

const dustAddress = "mn_dust1mockdustaddress000000000000000000000000"

const balance: MidnightDustBalance = {
  walletId: "mnLace",
  walletName: "Lace",
  dustAddress,
  balance: "55544952560721783320",
  cap: "441798827245000000000",
  source: "midnight-wallet",
  checkedAt: "2026-06-06T00:00:00.000Z",
  raw: {},
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, "midnight")
  vi.useRealTimers()
})

describe("MidnightDustWalletPanel", () => {
  test("shows wallet DUST balance and recipient match", () => {
    render(
      <MidnightDustWalletPanel
        balance={balance}
        error={null}
        generationNotice="DUST wallet values are shown for the connected Midnight wallet. They do not mean DUST generation is active while the Cardano registration is removed."
        onBalanceChange={() => undefined}
      />,
    )

    expect(screen.getByText("Midnight DUST Wallet")).toBeTruthy()
    expect(screen.getByText("55.54k DUST")).toBeTruthy()
    expect(screen.getByText("441.8k DUST")).toBeTruthy()
    expect(screen.queryByText("Registered recipient")).toBeNull()
    expect(
      screen.getByText(/They do not mean DUST generation is active/),
    ).toBeTruthy()
  })

  test("shows only Midnight wallet data", () => {
    render(
      <MidnightDustWalletPanel
        balance={balance}
        error={null}
        onBalanceChange={() => undefined}
      />,
    )

    expect(screen.getByText("Midnight DUST address")).toBeTruthy()
    expect(screen.queryByText(/Address mismatch/)).toBeNull()
  })

  test("updates when a Midnight wallet is injected after render", async () => {
    vi.useFakeTimers()

    render(
      <MidnightDustWalletPanel
        balance={null}
        error={null}
        onBalanceChange={() => undefined}
      />,
    )

    expect(
      screen.getByText(/Looking for installed Midnight wallets/),
    ).toBeTruthy()

    await act(async () => {
      window.midnight = {
        lace: {
          name: "Lace",
          icon: "",
          apiVersion: "4.0.1",
          rdns: "io.lace.wallet",
          connect: async () => ({
            getDustAddress: async () => ({ dustAddress }),
            getDustBalance: async () => ({
              balance: 0n,
              cap: 0n,
            }),
          }),
        },
      }
      window.dispatchEvent(new Event("midnight:announceProvider"))
    })

    expect(screen.getByRole("button", { name: "Lace" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Lace mainnet" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Lace preprod" })).toBeNull()
  })
})
