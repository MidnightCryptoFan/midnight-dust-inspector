"use client"

import { useState } from "react"
import { decodeBech32, bytesToHex } from "@/lib/bech32"
import type { ConnectedWallet } from "@/services/wallet/cip30"
import { KoiosTransportNote, useKoiosThrottle } from "./KoiosThrottleNote"

type Props = {
  wallet: ConnectedWallet
  initialMidnightAddress?: string | null
  onSuccess: (txHash: string) => void
  onCancel: () => void
}

type FlowState =
  | { step: "address_input" }
  | { step: "confirm"; dustAddressHex: string; midnightAddress: string }
  | { step: "signing" }
  | { step: "submitted"; txHash: string }
  | { step: "error"; message: string }

export function RegisterFlow({
  wallet,
  initialMidnightAddress,
  onSuccess,
  onCancel,
}: Props) {
  const [flow, setFlow] = useState<FlowState>({ step: "address_input" })
  const [midnightInput, setMidnightInput] = useState(
    initialMidnightAddress?.trim() ?? "",
  )
  const [inputError, setInputError] = useState<string | null>(null)

  function handleAddressSubmit() {
    const address = midnightInput.trim()

    if (!address) {
      setInputError("Enter your Midnight DUST address.")
      return
    }

    const decoded = decodeMidnightAddress(address)

    if (!decoded) {
      setInputError(
        'Enter a valid Midnight DUST address. It should start with "mn_dust1" and decode to 33 bytes.',
      )
      return
    }

    setInputError(null)
    setFlow({
      step: "confirm",
      dustAddressHex: decoded,
      midnightAddress: address,
    })
  }

  async function handleRegister() {
    if (flow.step !== "confirm") {
      return
    }

    if (!wallet.paymentKeyHash) {
      setFlow({
        step: "error",
        message:
          "The payment key hash could not be read from the wallet. Make sure the wallet has at least one used or unused address.",
      })
      return
    }

    setFlow({ step: "signing" })

    try {
      const { registerDust } =
        await import("@/services/cardano/dustTransactions.client")

      const result = await registerDust(
        wallet.rawApi,
        wallet.paymentKeyHash,
        flow.dustAddressHex,
      )

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
        {flow.step === "address_input" ? (
          <AddressInputStep
            wallet={wallet}
            value={midnightInput}
            error={inputError}
            isPrefilled={!!initialMidnightAddress?.trim()}
            onChange={setMidnightInput}
            onSubmit={handleAddressSubmit}
            onCancel={onCancel}
          />
        ) : null}

        {flow.step === "confirm" ? (
          <ConfirmStep
            wallet={wallet}
            dustAddressHex={flow.dustAddressHex}
            midnightAddress={flow.midnightAddress}
            onConfirm={handleRegister}
            onBack={() => setFlow({ step: "address_input" })}
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
            onRetry={() => setFlow({ step: "address_input" })}
            onCancel={onCancel}
          />
        ) : null}
      </div>
    </div>
  )
}

function AddressInputStep({
  wallet,
  value,
  error,
  isPrefilled,
  onChange,
  onSubmit,
  onCancel,
}: {
  wallet: ConnectedWallet
  value: string
  error: string | null
  isPrefilled: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">
          Start DUST registration
        </h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          Enter the Midnight DUST address that should receive generated DUST.
          You can find it in your Midnight wallet.
        </p>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
        <p className="mb-1 text-xs font-semibold text-slate-950">
          Cardano wallet
        </p>
        <p className="font-mono text-slate-600">
          {wallet.info.name} - {wallet.stakeAddress.slice(0, 24)}...
        </p>
        {wallet.paymentKeyHash ? (
          <>
            <p className="mb-1 mt-2 text-xs font-semibold text-slate-950">
              Payment key hash
            </p>
            <p className="break-all font-mono text-xs text-slate-500">
              {wallet.paymentKeyHash}
            </p>
          </>
        ) : null}
      </div>

      <div>
        <label
          className="block text-sm font-semibold text-slate-950"
          htmlFor="midnight-address"
        >
          Midnight DUST address
        </label>
        <p className="mt-0.5 text-xs text-slate-500">
          {isPrefilled
            ? "Filled from the connected Midnight wallet"
            : "Starts with "}
          {!isPrefilled ? <code className="font-mono">mn_dust1</code> : null}
        </p>
        <input
          className={`mt-2 w-full rounded-md border px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 ${
            error ? "border-red-400 bg-red-50" : "border-slate-300 bg-white"
          }`}
          id="midnight-address"
          placeholder="mn_dust1..."
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onSubmit()
            }
          }}
        />
        {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
      </div>

      <div className="rounded-md border border-teal-200 bg-teal-50 p-3 text-xs leading-5 text-teal-900">
        This address is stored in the registration datum and is publicly visible
        on Cardano. It identifies the Midnight destination for generated DUST.
      </div>

      <div className="flex gap-3">
        <button
          className="flex-1 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
          type="button"
          onClick={onSubmit}
        >
          Continue
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

function ConfirmStep({
  wallet,
  dustAddressHex,
  midnightAddress,
  onConfirm,
  onBack,
  onCancel,
}: {
  wallet: ConnectedWallet
  dustAddressHex: string
  midnightAddress: string
  onConfirm: () => void
  onBack: () => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">
          Confirm registration transaction
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Review these details before asking your wallet to sign.
        </p>
      </div>

      <div className="space-y-3 rounded-md border border-slate-200 p-4 text-sm">
        <DetailRow
          label="Cardano wallet"
          value={wallet.info.name}
          mono={false}
        />
        <DetailRow
          label="Payment key"
          value={wallet.paymentKeyHash ?? "Not available"}
        />
        <DetailRow label="Midnight address" value={midnightAddress} />
        <DetailRow label="Address bytes" value={dustAddressHex} />
        <DetailRow
          label="Registration script"
          value="addr1w9e7ft4rrdd4rkdseguxr9hudfxyytm5ckh2qy0yhz7lfeg9lvhq7"
        />
        <DetailRow
          label="Estimated cost"
          value="Cardano fee plus 2 ADA script output"
          mono={false}
        />
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        <p className="font-semibold">After registration</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>The transaction is submitted to Cardano.</li>
          <li>The registration becomes active after Cardano confirmation.</li>
          <li>
            The Midnight indexer may need hours, or sometimes longer, before
            DUST generation appears in status checks.
          </li>
        </ul>
      </div>

      <div className="flex gap-3">
        <button
          className="flex-1 rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
          type="button"
          onClick={onConfirm}
        >
          Register
        </button>
        <button
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          type="button"
          onClick={onBack}
        >
          Back
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

function SigningStep() {
  const { waiting, secondsLeft } = useKoiosThrottle()
  return (
    <div className="space-y-4 py-4 text-center">
      <div className="flex justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-teal-600" />
      </div>
      <div>
        <p className="font-semibold text-slate-950">
          {waiting ? "Preparing transaction…" : "Waiting for wallet signature..."}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {waiting
            ? `Spacing out Koios requests to stay within rate limits · resuming in ${Math.max(secondsLeft, 1)}s`
            : "Confirm the transaction in your wallet extension."}
        </p>
        <KoiosTransportNote className="mt-1 block text-xs text-slate-400" />
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
          DUST registration was submitted
        </h2>
      </div>

      <p className="text-sm leading-6 text-slate-600">
        The registration transaction was submitted to Cardano. Wait for
        confirmation before taking another action.
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
            DUST generation appears after the Midnight indexer processes the new
            registration.
          </li>
        </ul>
      </div>

      <button
        className="w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
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
        Registration could not continue
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

function DetailRow({
  label,
  value,
  mono = true,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-950">{label}</p>
      <p
        className={`mt-0.5 break-all text-xs text-slate-600 ${mono ? "font-mono" : ""}`}
      >
        {value}
      </p>
    </div>
  )
}

function decodeMidnightAddress(address: string): string | null {
  if (!address.startsWith("mn_dust1")) {
    return null
  }

  const decoded = decodeBech32(address)

  if (!decoded || decoded.bytes.length !== 33) {
    return null
  }

  return bytesToHex(decoded.bytes)
}
