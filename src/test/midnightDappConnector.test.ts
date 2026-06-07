import { afterEach, describe, expect, test, vi } from "vitest"
import {
  detectInstalledMidnightWallets,
  readMidnightWalletDustBalance,
} from "@/services/wallet/midnightDappConnector"

afterEach(() => {
  delete window.midnight
  vi.useRealTimers()
})

describe("Midnight DApp Connector service", () => {
  test("normalizes known wallet display names", () => {
    window.midnight = {
      mnLace: {
        name: "lace",
        icon: "",
        apiVersion: "4.0.1",
        connect: async () => ({
          getDustAddress: async () =>
            "mn_dust1mockdustaddress000000000000000000000000",
          getDustBalance: async () => ({
            balance: "0",
            cap: "0",
          }),
        }),
      },
    }

    expect(detectInstalledMidnightWallets()).toMatchObject([
      { id: "mnLace", name: "Lace" },
    ])
  })

  test("uses mainnet for the primary connect flow", async () => {
    const connect = vi.fn(async () => ({
      getDustAddress: async () =>
        "mn_dust1mockdustaddress000000000000000000000000",
      getDustBalance: async () => ({
        balance: "12345",
        cap: "441800",
      }),
    }))
    const enable = vi.fn(async () => ({
      getDustAddress: async () => "mn_dust1wrongmethod000000000000000000000000",
      getDustBalance: async () => ({
        balance: "0",
        cap: "0",
      }),
    }))

    window.midnight = {
      lace: {
        name: "Lace",
        icon: "",
        apiVersion: "4.0.1",
        connect,
        enable,
      },
    }

    const result = await readMidnightWalletDustBalance("lace")

    expect(connect).toHaveBeenCalledWith("mainnet")
    expect(enable).not.toHaveBeenCalled()
    expect(result.balance?.dustAddress).toBe(
      "mn_dust1mockdustaddress000000000000000000000000",
    )
  })

  test("resolves Lace even when it is injected under a UUID key", async () => {
    const connect = vi.fn(async () => ({
      getDustAddress: async () =>
        "mn_dust1mockdustaddress000000000000000000000000",
      getDustBalance: async () => ({
        balance: "12345",
        cap: "441800",
      }),
    }))

    window.midnight = {
      "f764d0d0-b5cd-4175-a7de-75803bf952c1": {
        name: "lace",
        icon: "",
        apiVersion: "4.0.1",
        rdns: "io.lace.wallet",
        connect,
      },
    }

    const result = await readMidnightWalletDustBalance("lace")

    expect(connect).toHaveBeenCalledWith("mainnet")
    expect(result.error).toBeNull()
    expect(result.balance?.walletName).toBe("Lace")
  })

  test("passes an explicit mainnet hint when requested", async () => {
    const connect = vi.fn(async () => ({
      getDustAddress: async () =>
        "mn_dust1mockdustaddress000000000000000000000000",
      getDustBalance: async () => ({
        balance: "12345",
        cap: "441800",
      }),
    }))

    window.midnight = {
      lace: {
        name: "Lace",
        icon: "",
        apiVersion: "4.0.1",
        connect,
      },
    }

    await readMidnightWalletDustBalance("lace", {
      connectionMode: "mainnet",
    })

    expect(connect).toHaveBeenCalledWith("mainnet")
  })

  test("passes an explicit preprod hint when requested", async () => {
    const connect = vi.fn(async () => ({
      getDustAddress: async () =>
        "mn_dust1mockdustaddress000000000000000000000000",
      getDustBalance: async () => ({
        balance: "12345",
        cap: "441800",
      }),
    }))

    window.midnight = {
      lace: {
        name: "Lace",
        icon: "",
        apiVersion: "4.0.1",
        connect,
      },
    }

    await readMidnightWalletDustBalance("lace", {
      connectionMode: "preprod",
    })

    expect(connect).toHaveBeenCalledWith("preprod")
  })

  test("supports the legacy mnLace enable and state flow", async () => {
    const isEnabled = vi.fn(async () => false)
    const enable = vi.fn(async () => ({
      state: async () => ({
        address: "mn_dust1legacydustaddress000000000000000000000",
        balance: 98765n,
        cap: 123456n,
      }),
    }))

    window.midnight = {
      mnLace: {
        name: "lace",
        icon: "",
        apiVersion: "1.0.0",
        isEnabled,
        enable,
      },
    }

    const result = await readMidnightWalletDustBalance("mnLace")

    expect(isEnabled).toHaveBeenCalledOnce()
    expect(enable).toHaveBeenCalledOnce()
    expect(result.error).toBeNull()
    expect(result.balance?.walletName).toBe("Lace")
    expect(result.balance?.dustAddress).toBe(
      "mn_dust1legacydustaddress000000000000000000000",
    )
    expect(result.balance?.balance).toBe("98765")
    expect(result.balance?.cap).toBe("123456")
  })

  test("returns a controlled timeout error when the wallet does not answer", async () => {
    vi.useFakeTimers()
    window.midnight = {
      lace: {
        name: "Lace",
        icon: "",
        apiVersion: "4.0.1",
        connect: () => new Promise(() => undefined),
      },
    }

    const resultPromise = readMidnightWalletDustBalance("lace", {
      timeoutMs: 10,
    })

    await vi.advanceTimersByTimeAsync(10)

    const result = await resultPromise

    expect(result.balance).toBeNull()
    expect(result.error?.code).toBe("CONNECTION_TIMEOUT")
    expect(result.error?.userMessage).toContain("did not answer")
  })

  test("reads DUST address, balance, and cap from a connected wallet", async () => {
    window.midnight = {
      lace: {
        name: "Lace",
        icon: "",
        apiVersion: "4.0.1",
        connect: async () => ({
          getDustAddress: async () => ({
            dustAddress: "mn_dust1mockdustaddress000000000000000000000000",
          }),
          getDustBalance: async () => ({
            balance: 12345n,
            cap: 441800n,
          }),
        }),
      },
    }

    const result = await readMidnightWalletDustBalance("lace")

    expect(result.error).toBeNull()
    expect(result.balance?.dustAddress).toBe(
      "mn_dust1mockdustaddress000000000000000000000000",
    )
    expect(result.balance?.balance).toBe("12345")
    expect(result.balance?.cap).toBe("441800")
  })

  test("does not block the main balance read on optional wallet metadata", async () => {
    vi.useFakeTimers()
    window.midnight = {
      lace: {
        name: "Lace",
        icon: "",
        apiVersion: "4.0.1",
        connect: async () => ({
          getDustAddress: async () =>
            "mn_dust1mockdustaddress000000000000000000000000",
          getDustBalance: async () => ({
            balance: "12345",
            cap: "441800",
          }),
          getConnectionStatus: () => new Promise(() => undefined),
          getConfiguration: () => new Promise(() => undefined),
        }),
      },
    }

    const resultPromise = readMidnightWalletDustBalance("lace")

    await vi.advanceTimersByTimeAsync(2_000)

    const result = await resultPromise

    expect(result.error).toBeNull()
    expect(result.balance?.dustAddress).toBe(
      "mn_dust1mockdustaddress000000000000000000000000",
    )
    expect(result.balance?.raw).toMatchObject({
      connectionStatus: null,
      configuration: null,
    })
  })
})
