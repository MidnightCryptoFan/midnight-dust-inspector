import { describe, expect, test } from "vitest"
import {
  buildCardanoAccountSnapshot,
  formatCardanoAssetQuantity,
  formatCardanoNightBalance,
  hasPositiveCardanoNightBalance,
} from "@/domain/cardanoAccount"
import type { CardanoAsset, CardanoUtxo } from "@/domain/cardanoAccount"

const nightAsset: CardanoAsset = {
  policyId: "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa",
  assetName: "4e49474854",
  fingerprint: "asset1mocknight",
  decimals: 6,
  quantity: "94114390552",
  displayName: "NIGHT",
  raw: {},
}

const nightUtxo: CardanoUtxo = {
  txHash: "mock-night-utxo",
  txIndex: 0,
  address: "addr1mocknightaddress",
  stakeAddress: "stake1u9mockstakeaddress000000000000000000000000",
  blockTime: "2026-06-06T00:00:00.000Z",
  blockHeight: 100,
  assetList: [
    {
      ...nightAsset,
      quantity: "88359765449",
    },
  ],
  raw: {},
}

describe("Cardano account snapshot", () => {
  test("formats Cardano asset quantities with decimals", () => {
    expect(formatCardanoAssetQuantity(nightAsset)).toBe("94114.390552")
  })

  test("builds a NIGHT snapshot from account assets and UTxOs", () => {
    const snapshot = buildCardanoAccountSnapshot({
      stakeAddress: nightUtxo.stakeAddress ?? "",
      assets: [nightAsset],
      utxos: [nightUtxo],
      checkedAt: "2026-06-06T00:00:00.000Z",
      source: "koios",
    })

    expect(formatCardanoNightBalance(snapshot)).toBe("94.11k NIGHT")
    expect(hasPositiveCardanoNightBalance(snapshot)).toBe(true)
    expect(snapshot.nightUtxos).toHaveLength(1)
    expect(snapshot.nightUtxos[0]?.displayAmount).toBe("88359.765449")
  })
})
