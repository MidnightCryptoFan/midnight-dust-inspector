import { describe, expect, test } from "vitest"
import { validateStakeAddress } from "@/lib/validation"

describe("validateStakeAddress", () => {
  test("rejects an empty address", () => {
    const result = validateStakeAddress("")

    expect(result.valid).toBe(false)
  })

  test("accepts a likely mainnet stake address", () => {
    const result = validateStakeAddress(
      "stake1u9mockstakeaddress000000000000000000000000",
    )

    expect(result.valid).toBe(true)
  })

  test("accepts a likely testnet stake address", () => {
    const result = validateStakeAddress(
      "stake_test1u9mockstakeaddress000000000000000000000000",
    )

    expect(result.valid).toBe(true)
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
