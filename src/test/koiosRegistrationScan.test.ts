import { describe, expect, test } from "vitest"
import { KoiosCardanoChainProvider } from "@/services/cardano/KoiosCardanoChainProvider"

const KEY_A = "f9e4b726d2aa13b3b3c4ea3dc964382bc0aea1d65600d4dac0e0538a"
const KEY_B = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const DUST_1 = "01".repeat(33)
const DUST_2 = "02".repeat(33)

// DustMappingDatum { c_wallet: VerificationKey(keyHash), dust_address }
function datum(keyHash: string, dustHex: string): string {
  return `d8799fd8799f581c${keyHash}ff5821${dustHex}ff`
}

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as unknown as Response
}

describe("findAllRegistrationUtxosForPaymentKey", () => {
  test("returns every UTxO whose datum encodes the payment key, with its DUST address", async () => {
    const provider = new KoiosCardanoChainProvider({
      fetcher: async () =>
        jsonResponse([
          { tx_hash: "tx1", tx_index: 0, inline_datum: { bytes: datum(KEY_A, DUST_1) } },
          { tx_hash: "tx2", tx_index: 3, inline_datum: { bytes: datum(KEY_A, DUST_2) } },
          { tx_hash: "tx3", tx_index: 0, inline_datum: { bytes: datum(KEY_B, DUST_1) } },
          { tx_hash: "tx4", tx_index: 1, inline_datum: null },
        ]),
    })

    const result = await provider.findAllRegistrationUtxosForPaymentKey(KEY_A)

    expect(result).toEqual([
      { txHash: "tx1", outputIndex: 0, dustAddressHex: DUST_1 },
      { txHash: "tx2", outputIndex: 3, dustAddressHex: DUST_2 },
    ])
  })

  test("returns an empty array when no datum matches the key", async () => {
    const provider = new KoiosCardanoChainProvider({
      fetcher: async () =>
        jsonResponse([
          { tx_hash: "tx3", tx_index: 0, inline_datum: { bytes: datum(KEY_B, DUST_1) } },
        ]),
    })

    expect(await provider.findAllRegistrationUtxosForPaymentKey(KEY_A)).toEqual(
      [],
    )
  })

  test("findRegistrationUtxoForPaymentKey returns the first match", async () => {
    const provider = new KoiosCardanoChainProvider({
      fetcher: async () =>
        jsonResponse([
          { tx_hash: "tx1", tx_index: 0, inline_datum: { bytes: datum(KEY_A, DUST_1) } },
          { tx_hash: "tx2", tx_index: 3, inline_datum: { bytes: datum(KEY_A, DUST_2) } },
        ]),
    })

    expect(await provider.findRegistrationUtxoForPaymentKey(KEY_A)).toEqual({
      txHash: "tx1",
      outputIndex: 0,
    })
  })
})
