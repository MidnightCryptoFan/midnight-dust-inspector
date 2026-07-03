import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import { RegisterFlow } from "@/components/RegisterFlow"
import type { ConnectedWallet } from "@/services/wallet/cip30"

const connectedWallet: ConnectedWallet = {
  info: {
    id: "eternl",
    name: "Eternl",
    icon: "",
  },
  stakeAddress: "stake1u8eseh2482k5e3a65sy9xsakzjl497zt5elwfh7q3u8k54g7yetxq",
  paymentKeyHash: "f9e4b726d2aa13b3b3c4ea3dc964382bc0aea1d65600d4dac0e0538a",
  paymentKeyHashes: ["f9e4b726d2aa13b3b3c4ea3dc964382bc0aea1d65600d4dac0e0538a"],
  rawApi: {} as never,
}

afterEach(() => {
  cleanup()
})

describe("RegisterFlow", () => {
  test("prefills the Midnight address from the connected Midnight wallet", () => {
    const dustAddress =
      "mn_dust1wdqhsj25ygtlxnrrzg354rqh80lua9sy68cgmsmqel4rr0ls2q8qg5m6mqm"

    render(
      <RegisterFlow
        wallet={connectedWallet}
        initialMidnightAddress={dustAddress}
        onCancel={vi.fn()}
        onSuccess={vi.fn()}
      />,
    )

    const input = screen.getByLabelText(
      "Midnight DUST address",
    ) as HTMLInputElement

    expect(input.value).toBe(dustAddress)
    expect(
      screen.getByText("Filled from the connected Midnight wallet"),
    ).toBeTruthy()
  })
})
