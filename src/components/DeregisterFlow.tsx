"use client"

import { useState } from "react"
import type { ConnectedWallet } from "@/services/wallet/cip30"
import type { DustGenerationStatus } from "@/domain/dustStatus"

type Props = {
  wallet: ConnectedWallet
  indexerStatus: DustGenerationStatus
  utxoRef?: { txHash: string; outputIndex: number }
  onSuccess: (txHash: string) => void
  onCancel: () => void
}

type FlowState =
  | { step: "confirm" }
  | { step: "signing" }
  | { step: "submitted"; txHash: string }
  | { step: "error"; message: string }

export function DeregisterFlow({
  wallet,
  indexerStatus,
  utxoRef,
  onSuccess,
  onCancel,
}: Props) {
  const [flow, setFlow] = useState<FlowState>({ step: "confirm" })
  const effectiveTxHash = utxoRef?.txHash ?? indexerStatus.utxoTxHash
  const effectiveOutputIndex =
    utxoRef?.outputIndex ??
    (indexerStatus.utxoOutputIndex != null
      ? Number(indexerStatus.utxoOutputIndex)
      : 0)

  async function handleDeregister() {
    if (!effectiveTxHash) {
      setFlow({
        step: "error",
        message:
          "No registration UTxO reference is available. Run the check again.",
      })
      return
    }

    setFlow({ step: "signing" })

    try {
      const { deregisterDust } =
        await import("@/services/cardano/dustTransactions.client")

      const result = await deregisterDust(wallet.rawApi, {
        txHash: effectiveTxHash,
        outputIndex: effectiveOutputIndex,
      })

      if (result.success) {
        setFlow({ step: "submitted", txHash: result.txHash })
        onSuccess(result.txHash)
      } else {
        setFlow({ step: "error", message: result.error })
      }
    } catch (error) {
      setFlow({
        step: "error",
        message: error instanceof Error ? error.message : "Unknown error.",
      })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-md border border-slate-200 bg-white p-6 shadow-xl">
        {flow.step === "confirm" ? (
          <ConfirmStep
            wallet={wallet}
            utxoTxHash={effectiveTxHash}
            utxoOutputIndex={String(effectiveOutputIndex)}
            onConfirm={handleDeregister}
            onCancel={onCancel}
          />
        ) : null}

        {flow.step === "signing" ? <SigningStep /> : null}

        {flow.step === "submitted" ? (
          <SuccessStep txHash={flow.txHash} onClose={onCancel} />
        ) : null}

        {flow.step === "error" ? (
          <ErrorStep
            message={flow.message}
            onRetry={() => setFlow({ step: "confirm" })}
            onCancel={onCancel}
          />
        ) : null}
      </div>
    </div>
  )
}

function ConfirmStep({
  wallet,
  utxoTxHash,
  utxoOutputIndex,
  onConfirm,
  onCancel,
}: {
  wallet: ConnectedWallet
  utxoTxHash: string | null
  utxoOutputIndex: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">
          Remove DUST registration
        </h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          This transaction removes the current DUST registration. DUST
          generation stops until a new registration is confirmed and processed.
        </p>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        <p className="font-semibold">Before you sign</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>The registration NFT will be burned.</li>
          <li>The registration script UTxO will be spent.</li>
          <li>Normal Cardano transaction fees apply.</li>
          <li>
            The Midnight indexer may need hours, or sometimes longer, to show
            the updated status.
          </li>
        </ul>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm font-mono text-slate-700">
        <p className="mb-1 font-sans text-xs font-semibold text-slate-950">
          Registration UTxO to spend
        </p>
        <p className="break-all">
          {utxoTxHash ?? "Not available"}#{utxoOutputIndex}
        </p>
        <p className="mb-1 mt-3 font-sans text-xs font-semibold text-slate-950">
          Wallet
        </p>
        <p>
          {wallet.info.name} ({wallet.stakeAddress.slice(0, 20)}...)
        </p>
      </div>

      <p className="text-xs leading-5 text-slate-500">
        Your wallet extension will show the transaction before signing. Review
        the details there as well. This app never asks for your seed phrase or
        private keys.
      </p>

      <div className="flex gap-3">
        <button
          className="flex-1 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
          type="button"
          onClick={onConfirm}
        >
          Remove registration
        </button>
        <button
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          type="button"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function SigningStep() {
  return (
    <div className="space-y-4 py-4 text-center">
      <div className="flex justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-red-600" />
      </div>
      <div>
        <p className="font-semibold text-slate-950">
          Waiting for wallet signature...
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Confirm the transaction in your wallet extension.
        </p>
      </div>
    </div>
  )
}

function SuccessStep({
  txHash,
  onClose,
}: {
  txHash: string
  onClose: () => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold uppercase tracking-normal text-teal-700">
          Transaction submitted
        </p>
        <h2 className="mt-1 text-lg font-semibold text-slate-950">
          Registration removal was submitted
        </h2>
      </div>

      <p className="text-sm leading-6 text-slate-600">
        The transaction was submitted to Cardano. Wait for confirmation before
        taking another action.
      </p>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <p className="mb-1 text-xs font-semibold text-slate-950">
          Transaction hash
        </p>
        <p className="break-all font-mono text-xs text-slate-600">{txHash}</p>
      </div>

      <div className="rounded-md border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950">
        <p className="font-semibold">What happens next</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>Wait for Cardano confirmation.</li>
          <li>Run the inspector again after the transaction confirms.</li>
          <li>
            If the Midnight indexer still says registered, wait and check again;
            indexer lag is common after registration changes.
          </li>
        </ul>
      </div>

      <button
        className="w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        type="button"
        onClick={onClose}
      >
        Close
      </button>
    </div>
  )
}

function ErrorStep({
  message,
  onRetry,
  onCancel,
}: {
  message: string
  onRetry: () => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-950">
        The transaction could not be prepared
      </h2>
      <div className="break-all rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {message}
      </div>
      <div className="flex gap-3">
        <button
          className="flex-1 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          type="button"
          onClick={onRetry}
        >
          Try again
        </button>
        <button
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          type="button"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
