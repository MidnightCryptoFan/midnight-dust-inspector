import { describe, expect, test } from "vitest"
import { KoiosCardanoChainProvider } from "@/services/cardano/KoiosCardanoChainProvider"

/**
 * Koios response-shape tolerance.
 *
 * Koios has demonstrably changed field shapes without notice (July 2026:
 * collateral_output.asset_list became a string — see the repair in
 * koiosTransport.client.ts). These tests pin down that the provider's own
 * schemas tolerate the adjacent low-risk drift `asset_list: null`, which
 * semantically means "no native assets" and must behave exactly like an
 * absent or empty list — not crash the whole call.
 */

const ADDRESS =
  "addr1qxakqsnh069g2l5uk04fpazl0tugsxqs347mah7azdup2us9a7n7k65flntnw90eaua39vw6llh9as2783cgv86sen4sww2n7j"

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as unknown as Response
}

describe("asset_list: null tolerance", () => {
  test("getUtxosForAddresses treats a null asset_list as no assets", async () => {
    const provider = new KoiosCardanoChainProvider({
      fetcher: async () =>
        jsonResponse([
          {
            tx_hash: "tx1",
            tx_index: 0,
            address: ADDRESS,
            asset_list: null,
          },
          {
            tx_hash: "tx2",
            tx_index: 1,
            address: ADDRESS,
            asset_list: [
              {
                policy_id: "aa",
                asset_name: "4e49474854",
                quantity: "5",
              },
            ],
          },
        ]),
    })

    const utxos = await provider.getUtxosForAddresses([ADDRESS])

    expect(utxos).toHaveLength(2)
    expect(utxos[0].assetList).toEqual([])
    expect(utxos[1].assetList).toHaveLength(1)
    expect(utxos[1].assetList[0].quantity).toBe("5")
  })

  test("getTransactionOutputAddress resolves the address despite a null asset_list", async () => {
    const provider = new KoiosCardanoChainProvider({
      fetcher: async () =>
        jsonResponse([
          {
            tx_hash: "tx1",
            outputs: [
              {
                tx_index: 0,
                payment_addr: { bech32: ADDRESS },
                asset_list: null,
              },
            ],
          },
        ]),
    })

    expect(await provider.getTransactionOutputAddress("tx1", 0)).toBe(ADDRESS)
  })

  test("getTransactionDetails keeps inputs/outputs when their asset_list is null", async () => {
    // The tx_info parse failure path silently falls back to empty
    // inputs/outputs, so a schema regression here would not crash — it would
    // quietly blank the transaction history details instead. This pins the
    // non-degraded behavior.
    const provider = new KoiosCardanoChainProvider({
      fetcher: async (input) => {
        const url = String(input)
        if (url.includes("/tx_metadata")) {
          return jsonResponse([{ tx_hash: "tx1", metadata: null }])
        }
        if (url.includes("/tx_info")) {
          return jsonResponse([
            {
              tx_hash: "tx1",
              inputs: [
                {
                  payment_addr: { bech32: ADDRESS, cred: "aa" },
                  asset_list: null,
                },
              ],
              outputs: [
                {
                  tx_index: 0,
                  payment_addr: { bech32: ADDRESS },
                  asset_list: null,
                },
              ],
            },
          ])
        }
        throw new Error(`Unexpected Koios call: ${url}`)
      },
    })

    const details = await provider.getTransactionDetails("tx1")

    expect(details.inputs).toHaveLength(1)
    expect(details.outputs).toHaveLength(1)
    expect(details.inputs[0].nightQuantity).toBeNull()
    expect(details.outputs[0].nightQuantity).toBeNull()
  })
})
