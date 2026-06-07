import type { CardanoAsset, CardanoUtxo } from "@/domain/cardanoAccount"

export type CardanoTransaction = {
  txHash: string
  blockTime: string | null
  blockHeight: number | null
  raw: unknown
}

export type CardanoTransactionDetails = CardanoTransaction & {
  inputs: Array<{ address?: string }>
  outputs: Array<{ address: string }>
  metadata: unknown
}

export interface CardanoChainProvider {
  getTransactionsForStakeAddress(
    stakeAddress: string,
  ): Promise<CardanoTransaction[]>
  getTransactionDetails(txHash: string): Promise<CardanoTransactionDetails>
  getTransactionOutputAddress(
    txHash: string,
    outputIndex: number,
  ): Promise<string | null>
  getAssetsForStakeAddress(stakeAddress: string): Promise<CardanoAsset[]>
  getAddressesForStakeAddress(stakeAddress: string): Promise<string[]>
  getUtxosForAddresses(addresses: string[]): Promise<CardanoUtxo[]>
  /** Returns true when the UTxO has already been spent (i.e. it is no longer in the UTXO set). */
  checkUtxoSpent(txHash: string, outputIndex: number): Promise<boolean>
}
