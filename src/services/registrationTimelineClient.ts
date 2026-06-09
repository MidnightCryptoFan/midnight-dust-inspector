import type {
  RegistrationTimelineError,
  RegistrationTimelineInspectionResult,
} from "@/domain/registrationTimeline"
import { buildCardanoAccountSnapshot } from "@/domain/cardanoAccount"
import { buildRegistrationTimeline } from "@/domain/registrationTimelineAnalysis"
import type {
  CardanoChainProvider,
  CardanoTransactionDetails,
} from "./cardano/CardanoChainProvider"
import { KoiosCardanoChainProvider } from "./cardano/KoiosCardanoChainProvider"

export async function inspectRegistrationTimeline(
  stakeAddress: string,
  options?: {
    provider?: CardanoChainProvider
    checkedAt?: string
    limit?: number
  },
): Promise<RegistrationTimelineInspectionResult> {
  const checkedAt = options?.checkedAt ?? new Date().toISOString()
  const provider = options?.provider ?? new KoiosCardanoChainProvider()
  const limit = options?.limit ?? getTimelineLimit()

  try {
    const [transactions, assets, addresses] = await Promise.all([
      provider.getTransactionsForStakeAddress(stakeAddress),
      provider.getAssetsForStakeAddress(stakeAddress),
      provider.getAddressesForStakeAddress(stakeAddress),
    ])
    const utxos = await provider.getUtxosForAddresses(addresses)
    const recentTransactions = transactions.slice(0, limit)
    const details = await Promise.all(
      recentTransactions.map(async (transaction) => {
        try {
          return await provider.getTransactionDetails(transaction.txHash)
        } catch {
          return {
            txHash: transaction.txHash,
            blockTime: transaction.blockTime,
            blockHeight: transaction.blockHeight,
            inputs: [],
            outputs: [],
            metadata: null,
            raw: null,
          } satisfies CardanoTransactionDetails
        }
      }),
    )

    return {
      timeline: buildRegistrationTimeline({
        stakeAddress,
        transactions: recentTransactions,
        detailsByTxHash: new Map(
          details.map((detail) => [detail.txHash, detail] as const),
        ),
        checkedAt,
        source: "koios",
      }),
      cardanoAccountSnapshot: buildCardanoAccountSnapshot({
        stakeAddress,
        assets,
        utxos,
        checkedAt,
        source: "koios",
      }),
      controlledError: null,
    }
  } catch (error) {
    return {
      timeline: null,
      cardanoAccountSnapshot: null,
      controlledError: createTimelineError({
        message:
          error instanceof Error
            ? error.message
            : "The Cardano timeline request did not complete.",
        checkedAt,
        raw:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : error,
      }),
    }
  }
}

function getTimelineLimit(): number {
  const parsed = Number(process.env.CARDANO_TIMELINE_TRANSACTION_LIMIT ?? "100")

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 25
  }

  return Math.min(Math.floor(parsed), 100)
}

function createTimelineError(input: {
  message: string
  checkedAt: string
  raw: unknown
}): RegistrationTimelineError {
  return {
    code: "CARDANO_PROVIDER_ERROR",
    message: input.message,
    userMessage: "The Cardano on-chain timeline could not be checked.",
    technicalDetails: [
      "The read-only Cardano provider request failed or returned data in an unexpected format.",
    ],
    raw: input.raw,
    checkedAt: input.checkedAt,
  }
}
