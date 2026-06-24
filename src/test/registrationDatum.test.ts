import { describe, expect, test } from "vitest"
import { parseRegistrationDatum } from "@/lib/registrationDatum"

const KEY = "f9e4b726d2aa13b3b3c4ea3dc964382bc0aea1d65600d4dac0e0538a"
const DUST = "01".repeat(33)

function datum(keyHash: string, dustHex: string): string {
  return `d8799fd8799f581c${keyHash}ff5821${dustHex}ff`
}

describe("parseRegistrationDatum", () => {
  test("extracts the payment key hash and DUST address", () => {
    expect(parseRegistrationDatum(datum(KEY, DUST))).toEqual({
      paymentKeyHash: KEY,
      dustAddressHex: DUST,
    })
  })

  test("is case-insensitive and lowercases the key", () => {
    const parsed = parseRegistrationDatum(datum(KEY.toUpperCase(), DUST))
    expect(parsed?.paymentKeyHash).toBe(KEY)
  })

  test("returns null when the datum is not a registration mapping", () => {
    expect(parseRegistrationDatum("d8799f4100ff")).toBeNull()
    expect(parseRegistrationDatum("")).toBeNull()
  })

  test("returns the key with null address when the dust byte string is absent", () => {
    expect(parseRegistrationDatum(`d8799fd8799f581c${KEY}ffff`)).toEqual({
      paymentKeyHash: KEY,
      dustAddressHex: null,
    })
  })
})
