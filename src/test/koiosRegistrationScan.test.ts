import { describe, expect, test } from "vitest"
import { KoiosCardanoChainProvider } from "@/services/cardano/KoiosCardanoChainProvider"
import { decodeBech32, encodeBech32, hexToBytes } from "@/lib/bech32"

/** Builds a mainnet base address (type 0) for the given stake account and payment key. */
function makeAccountAddress(stake: string, paymentKeyHex: string): string {
  const stakeBytes = decodeBech32(stake)
  if (!stakeBytes) throw new Error("Test stake address should decode.")
  return encodeBech32("addr", [
    0x01,
    ...hexToBytes(paymentKeyHex),
    ...stakeBytes.bytes.slice(1),
  ])
}

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

  test("follows Koios pagination past the 1000-row page limit", async () => {
    // Page 1: 1000 filler UTxOs for other keys. Page 2: the user's UTxO.
    // Without pagination the match on page 2 is silently lost.
    const pageOne = Array.from({ length: 1000 }, (_, i) => ({
      tx_hash: `filler${i}`,
      tx_index: 0,
      inline_datum: { bytes: datum(KEY_B, DUST_1) },
    }))
    const pageTwo = [
      { tx_hash: "txDeep", tx_index: 1, inline_datum: { bytes: datum(KEY_A, DUST_2) } },
    ]

    const provider = new KoiosCardanoChainProvider({
      fetcher: async (input) => {
        const url = String(input)
        return jsonResponse(url.includes("offset=1000") ? pageTwo : pageOne)
      },
    })

    expect(await provider.findAllRegistrationUtxosForPaymentKey(KEY_A)).toEqual(
      [{ txHash: "txDeep", outputIndex: 1, dustAddressHex: DUST_2 }],
    )
  })
})

describe("findActiveRegistrationsForAccount", () => {
  const STAKE = "stake1uyz7lfltd2yle4ehzhu77wcjk8d0lmj7c90rcuyxragve6cyyhr4g"
  // Base address (type 0) of the stake account whose payment cred is KEY_B.
  const ACCOUNT_ADDRESS = makeAccountAddress(STAKE, KEY_B)

  function accountFetcher(overrides?: {
    accountTxs?: Array<{ tx_hash: string }>
    scriptUtxos?: unknown[]
    addresses?: string[]
  }) {
    return async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/account_addresses")) {
        return jsonResponse([
          { stake_address: STAKE, addresses: overrides?.addresses ?? [] },
        ])
      }
      if (url.includes("/account_txs")) {
        return jsonResponse(overrides?.accountTxs ?? [])
      }
      if (url.includes("/address_utxos")) {
        return jsonResponse(overrides?.scriptUtxos ?? [])
      }
      throw new Error(`Unexpected Koios call: ${url}`)
    }
  }

  test("matches registrations by any provided wallet payment key", async () => {
    const provider = new KoiosCardanoChainProvider({
      fetcher: accountFetcher({
        scriptUtxos: [
          { tx_hash: "tx1", tx_index: 0, inline_datum: { bytes: datum(KEY_A, DUST_1) } },
          { tx_hash: "tx2", tx_index: 0, inline_datum: { bytes: datum(KEY_B, DUST_2) } },
        ],
      }),
    })

    const result = await provider.findActiveRegistrationsForAccount({
      paymentKeyHashes: [KEY_A],
    })

    expect(result).toEqual([
      {
        txHash: "tx1",
        outputIndex: 0,
        cWalletKeyHash: KEY_A,
        dustAddressHex: DUST_1,
        ownedByWallet: true,
      },
    ])
  })

  test("finds a registration the account funded even when its datum key is unknown to the wallet", async () => {
    // The customer's exact bug: the registration datum holds an old change key
    // (KEY_B) that neither the wallet nor the chain reports for the account —
    // but the registration tx is in the account's history.
    const provider = new KoiosCardanoChainProvider({
      fetcher: accountFetcher({
        accountTxs: [{ tx_hash: "txFunded" }],
        scriptUtxos: [
          { tx_hash: "txFunded", tx_index: 0, inline_datum: { bytes: datum(KEY_B, DUST_1) } },
          { tx_hash: "txForeign", tx_index: 0, inline_datum: { bytes: datum(KEY_B, DUST_2) } },
        ],
      }),
    })

    const result = await provider.findActiveRegistrationsForAccount({
      stakeAddress: STAKE,
      paymentKeyHashes: [KEY_A],
    })

    expect(result).toEqual([
      {
        txHash: "txFunded",
        outputIndex: 0,
        cWalletKeyHash: KEY_B,
        dustAddressHex: DUST_1,
        ownedByWallet: false,
      },
    ])
  })

  test("matches registrations keyed to the payment credential of an on-chain account address", async () => {
    const provider = new KoiosCardanoChainProvider({
      fetcher: accountFetcher({
        addresses: [ACCOUNT_ADDRESS],
        scriptUtxos: [
          { tx_hash: "tx1", tx_index: 2, inline_datum: { bytes: datum(KEY_B, DUST_1) } },
        ],
      }),
    })

    const result = await provider.findActiveRegistrationsForAccount({
      stakeAddress: STAKE,
      paymentKeyHashes: [],
    })

    expect(result).toEqual([
      {
        txHash: "tx1",
        outputIndex: 2,
        cWalletKeyHash: KEY_B,
        dustAddressHex: DUST_1,
        ownedByWallet: false,
      },
    ])
  })
})
