import { act, cleanup, render, screen } from "@testing-library/react"
import { hydrateRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, test, vi } from "vitest"
import { WalletConnectSection } from "@/components/WalletConnectSection"

const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, "cardano")
  consoleError.mockClear()
})

function walletSection() {
  return (
    <WalletConnectSection
      connected={null}
      onConnected={() => undefined}
      onDisconnected={() => undefined}
    />
  )
}

describe("WalletConnectSection", () => {
  test("hydrates without an unstable server snapshot warning", async () => {
    const container = document.createElement("div")
    container.innerHTML = renderToString(walletSection())

    let root: Root | null = null
    await act(async () => {
      root = hydrateRoot(container, walletSection())
      await Promise.resolve()
    })

    const consoleMessages = consoleError.mock.calls
      .map((call) => call.map(String).join(" "))
      .join("\n")

    expect(consoleMessages).not.toContain("getServerSnapshot")

    await act(async () => {
      root?.unmount()
    })
  })

  test("updates when a Cardano wallet is injected after render", async () => {
    render(walletSection())

    expect(
      screen.getByText(/Looking for installed Cardano wallets/),
    ).toBeTruthy()

    await act(async () => {
      window.cardano = {
        eternl: {
          name: "Eternl",
          icon: "",
          apiVersion: "1.0.0",
          isEnabled: async () => false,
          enable: async () => ({}) as never,
        },
      }
      window.dispatchEvent(new Event("cardano-wallet-ready"))
    })

    expect(await screen.findByRole("button", { name: "Eternl" })).toBeTruthy()
  })
})
