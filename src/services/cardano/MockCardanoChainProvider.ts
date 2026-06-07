import type { CardanoAsset, CardanoUtxo } from "@/domain/cardanoAccount"
import type {
  CardanoChainProvider,
  CardanoTransaction,
  CardanoTransactionDetails,
} from "./CardanoChainProvider"

export class MockCardanoChainProvider implements CardanoChainProvider {
  async getTransactionsForStakeAddress(
    stakeAddress: string,
  ): Promise<CardanoTransaction[]> {
    void stakeAddress

    return []
  }

  async getTransactionDetails(
    txHash: string,
  ): Promise<CardanoTransactionDetails> {
    return {
      txHash,
      blockTime: null,
      blockHeight: null,
      inputs: [],
      outputs: [],
      metadata: null,
      raw: null,
    }
  }

  async getTransactionOutputAddress(
    txHash: string,
    outputIndex: number,
  ): Promise<string | null> {
    void txHash
    void outputIndex

    return null
  }

  async getAssetsForStakeAddress(
    stakeAddress: string,
  ): Promise<CardanoAsset[]> {
    void stakeAddress

    return []
  }

  async getAddressesForStakeAddress(stakeAddress: string): Promise<string[]> {
    void stakeAddress

    return []
  }

  async getUtxosForAddresses(addresses: string[]): Promise<CardanoUtxo[]> {
    void addresses

    return []
  }

  async checkUtxoSpent(txHash: string, outputIndex: number): Promise<boolean> {
    void txHash
    void outputIndex

    return false
  }
}
