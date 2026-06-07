import { afterEach, describe, expect, test } from "vitest"
import {
  connectWallet,
  stakeAddressFromBaseAddress,
} from "@/services/wallet/cip30"
import { bytesToHex, decodeBech32 } from "@/lib/bech32"

const stakeAddress =
  "stake1u8eseh2482k5e3a65sy9xsakzjl497zt5elwfh7q3u8k54g7yetxq"

afterEach(() => {
  Reflect.deleteProperty(window, "cardano")
})

describe("CIP-30 wallet service", () => {
  test("derives a stake address from a Cardano base address", () => {
    const baseAddress = makeBaseAddressHex()

    expect(stakeAddressFromBaseAddress(baseAddress)).toBe(stakeAddress)
  })

  test("falls back to the change address when Lace returns no reward addresses", async () => {
    window.cardano = {
      lace: {
        name: "Lace",
        icon: "",
        apiVersion: "1.0.0",
        isEnabled: async () => false,
        enable: async () =>
          ({
            getRewardAddresses: async () => [],
            getChangeAddress: async () => makeBaseAddressHex(),
            getUsedAddresses: async () => [],
            getUnusedAddresses: async () => [],
          }) as never,
      },
    }

    const wallet = await connectWallet("lace")

    expect(wallet.info.name).toBe("Lace")
    expect(wallet.stakeAddress).toBe(stakeAddress)
    expect(wallet.paymentKeyHash).toBe(
      "11111111111111111111111111111111111111111111111111111111",
    )
  })
})

function makeBaseAddressHex(): string {
  const decodedStakeAddress = decodeBech32(stakeAddress)

  if (!decodedStakeAddress) {
    throw new Error("Test stake address should decode.")
  }

  return bytesToHex([
    0x01,
    ...Array.from({ length: 28 }, () => 0x11),
    ...decodedStakeAddress.bytes.slice(1),
  ])
}
