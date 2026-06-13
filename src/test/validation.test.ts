import { describe, expect, test } from "vitest"
import { validateStakeAddress } from "@/lib/validation"
import { encodeBech32 } from "@/lib/bech32"

const mainnetStakeAddress =
  "stake1u8eseh2482k5e3a65sy9xsakzjl497zt5elwfh7q3u8k54g7yetxq"
const testnetStakeAddress = encodeBech32("stake_test", [
  0xe0,
  ...Array.from({ length: 28 }, (_, index) => index + 1),
])

describe("validateStakeAddress", () => {
  test("rejects an empty address", () => {
    const result = validateStakeAddress("")

    expect(result.valid).toBe(false)
  })

  test("accepts a likely mainnet stake address", () => {
    const result = validateStakeAddress(mainnetStakeAddress)

    expect(result.valid).toBe(true)
  })

  test("accepts a valid testnet stake address with a mainnet note", () => {
    const result = validateStakeAddress(testnetStakeAddress)

    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.note).toMatch(/testnet/)
    }
  })

  test("rejects a fake stake-looking address", () => {
    const result = validateStakeAddress(
      "stake1u9mockstakeaddress000000000000000000000000",
    )

    expect(result.valid).toBe(false)
  })

  test("rejects an invalid payment address prefix (not valid bech32)", () => {
    const result = validateStakeAddress("addr1mockpaymentaddress")

    expect(result.valid).toBe(false)
  })

  test("accepts a full Cardano base address and extracts the stake key", () => {
    const result = validateStakeAddress(
      "addr1q8u7fdex624p8vancn4rmjty8q4upt4p6etqp4x6crs98zhnpnw42w4dfnrm4fqg2dpmv99l2tuyhfn7un0uprc0df2snm9w77",
    )

    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.address.startsWith("stake1")).toBe(true)
      expect(result.note).toBeDefined()
    }
  })
})
