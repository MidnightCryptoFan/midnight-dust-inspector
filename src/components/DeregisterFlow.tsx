"use client"

import { useEffect, useState } from "react"
import type { ConnectedWallet } from "@/services/wallet/cip30"
import type { DustGenerationStatus } from "@/domain/dustStatus"
import type { ActiveRegistrationsResult } from "@/app/api/active-registrations/route"
import { decodeBech32, bytesToHex } from "@/lib/bech32"

type Props = {
  wallet: ConnectedWallet
  indexerStatus: DustGenerationStatus
  /** Connected Midnight DUST address (mn_dust1…), used to mark which registration to keep. */
  midnightAddress?: string | null
  utxoRef?: { txHash: string; outputIndex: number }
  onSuccess: (txHash: string) => void
  onCancel: () => void
}

type Registration = {
  txHash: string
  outputIndex: number
  dustAddress: string | null
  dustAddressHex: string | null
  /** True when this registration's DUST address matches the connected Midnight wallet. */
  matchesWallet: boolean
}

type RemovalResult = {
  registration: Registration
  success: boolean
  txHash?: string
  error?: string
}

type FlowState =
  | { step: "loading" }
  | { step: "select"; registrations: Registration[]; selected: Set<string> }
  | { step: "signing"; total: number; current: number; results: RemovalResult[] }
  | { step: "done"; results: RemovalResult[] }
  | { step: "error"; message: string }

function refKey(r: { txHash: string; outputIndex: number }): string {
  return `${r.txHash}#${r.outputIndex}`
}

export function DeregisterFlow({
  wallet,
  indexerStatus,
  midnightAddress,
  utxoRef,
  onSuccess,
  onCancel,
}: Props) {
  const [flow, setFlow] = useState<FlowState>({ step: "loading" })

  const connectedDustHex = midnightAddress
    ? decodeMidnightAddressHex(midnightAddress)
    : null

  // Fallback UTxO ref from the indexer / earlier scan, used when the live scan
  // returns nothing (e.g. unparseable datum) but we still have a pointer.
  const fallbackTxHash = utxoRef?.txHash ?? indexerStatus.utxoTxHash
  const fallbackOutputIndex =
    utxoRef?.outputIndex ??
    (indexerStatus.utxoOutputIndex != null
      ? Number(indexerStatus.utxoOutputIndex)
      : 0)

  useEffect(() => {
    let cancelled = false

    async function loadRegistrations() {
      if (!wallet.paymentKeyHash) {
        setFlow({
          step: "error",
          message:
            "The wallet payment key hash could not be read. Reconnect the wallet and try again.",
        })
        return
      }

      try {
        const response = await fetch("/api/active-registrations", {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({ paymentKeyHash: wallet.paymentKeyHash }),
        })
        const data = (await response.json()) as ActiveRegistrationsResult

        if (cancelled) return

        let registrations: Registration[] = data.ok
          ? data.registrations.map((r) => ({
              txHash: r.txHash,
              outputIndex: r.outputIndex,
              dustAddress: r.dustAddress,
              dustAddressHex: r.dustAddressHex,
              matchesWallet:
                connectedDustHex != null &&
                r.dustAddressHex != null &&
                r.dustAddressHex.toLowerCase() === connectedDustHex,
            }))
          : []

        // No live UTxOs found, but we still hold a pointer — offer that one.
        if (registrations.length === 0 && fallbackTxHash) {
          registrations = [
            {
              txHash: fallbackTxHash,
              outputIndex: fallbackOutputIndex,
              dustAddress: indexerStatus.dustAddress,
              dustAddressHex: null,
              matchesWallet: false,
            },
          ]
        }

        if (registrations.length === 0) {
          setFlow({
            step: "error",
            message:
              "No active registration UTxO was found on-chain for this wallet. It may already be removed — run the check again.",
          })
          return
        }

        // Pre-select the registrations that do NOT match the connected wallet
        // (the conflicting ones). When the match cannot be determined, select
        // nothing so the user makes a deliberate choice.
        const selected = new Set<string>()
        if (connectedDustHex != null) {
          for (const r of registrations) {
            if (!r.matchesWallet) selected.add(refKey(r))
          }
        }

        setFlow({ step: "select", registrations, selected })
      } catch (error) {
        if (cancelled) return
        setFlow({
          step: "error",
          message:
            error instanceof Error
              ? error.message
              : "The on-chain registration lookup failed.",
        })
      }
    }

    void loadRegistrations()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runRemoval(queue: Registration[]) {
    if (!wallet.paymentKeyHash) {
      setFlow({
        step: "error",
        message: "The wallet payment key hash could not be read.",
      })
      return
    }

    const { deregisterDust } = await import(
      "@/services/cardano/dustTransactions.client"
    )

    const results: RemovalResult[] = []
    for (let i = 0; i < queue.length; i++) {
      const registration = queue[i]!
      setFlow({
        step: "signing",
        total: queue.length,
        current: i + 1,
        results: [...results],
      })

      try {
        const result = await deregisterDust(
          wallet.rawApi,
          wallet.paymentKeyHash,
          {
            txHash: registration.txHash,
            outputIndex: registration.outputIndex,
          },
        )
        results.push(
          result.success
            ? { registration, success: true, txHash: result.txHash }
            : { registration, success: false, error: result.error },
        )
      } catch (error) {
        results.push({
          registration,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error.",
        })
      }
    }

    setFlow({ step: "done", results })
  }

  function handleConfirmSelection() {
    if (flow.step !== "select") return
    const queue = flow.registrations.filter((r) =>
      flow.selected.has(refKey(r)),
    )
    if (queue.length === 0) return
    void runRemoval(queue)
  }

  function handleDone() {
    if (flow.step !== "done") return
    const lastSuccess = [...flow.results]
      .reverse()
      .find((r) => r.success && r.txHash)
    if (lastSuccess?.txHash) {
      onSuccess(lastSuccess.txHash)
    } else {
      onCancel()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-md border border-slate-200 bg-white p-6 shadow-xl">
        {flow.step === "loading" ? <LoadingStep /> : null}

        {flow.step === "select" ? (
          <SelectStep
            wallet={wallet}
            registrations={flow.registrations}
            selected={flow.selected}
            midnightAddressConnected={connectedDustHex != null}
            onToggle={(key) =>
              setFlow((prev) => {
                if (prev.step !== "select") return prev
                const next = new Set(prev.selected)
                if (next.has(key)) next.delete(key)
                else next.add(key)
                return { ...prev, selected: next }
              })
            }
            onConfirm={handleConfirmSelection}
            onCancel={onCancel}
          />
        ) : null}

        {flow.step === "signing" ? (
          <SigningStep total={flow.total} current={flow.current} />
        ) : null}

        {flow.step === "done" ? (
          <DoneStep
            results={flow.results}
            onRetryFailed={() =>
              runRemoval(
                flow.results.filter((r) => !r.success).map((r) => r.registration),
              )
            }
            onDone={handleDone}
          />
        ) : null}

        {flow.step === "error" ? (
          <ErrorStep message={flow.message} onCancel={onCancel} />
        ) : null}
      </div>
    </div>
  )
}

function decodeMidnightAddressHex(address: string): string | null {
  const trimmed = address.trim()
  if (!trimmed.startsWith("mn_dust1")) return null
  const decoded = decodeBech32(trimmed)
  if (!decoded || decoded.bytes.length !== 33) return null
  return bytesToHex(decoded.bytes).toLowerCase()
}

function LoadingStep() {
  return (
    <div className="space-y-4 py-4 text-center">
      <div className="flex justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-red-600" />
      </div>
      <div>
        <p className="font-semibold text-slate-950">
          Checking active registrations…
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Scanning the Cardano registration script for this wallet.
        </p>
      </div>
    </div>
  )
}

function WarningBlock() {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
      <p className="font-semibold">Before you sign</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        <li>Each selected registration is removed in its own transaction.</li>
        <li>Its registration NFT is burned and the script UTxO is spent.</li>
        <li>Normal Cardano transaction fees apply per removal.</li>
        <li>
          The Midnight indexer may need hours, or sometimes longer, to show the
          updated status.
        </li>
      </ul>
    </div>
  )
}

function SelectStep({
  wallet,
  registrations,
  selected,
  midnightAddressConnected,
  onToggle,
  onConfirm,
  onCancel,
}: {
  wallet: ConnectedWallet
  registrations: Registration[]
  selected: Set<string>
  midnightAddressConnected: boolean
  onToggle: (key: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const isMultiple = registrations.length > 1
  const selectedCount = selected.size

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">
          {isMultiple
            ? `Remove DUST registrations (${registrations.length} active)`
            : "Remove DUST registration"}
        </h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          {isMultiple
            ? "This wallet has more than one active registration. DUST generation needs exactly one destination. Select the registrations to remove — the one matching your connected Midnight wallet is kept by default."
            : "This transaction removes the current DUST registration. DUST generation stops until a new registration is confirmed and processed."}
        </p>
      </div>

      {isMultiple && !midnightAddressConnected && (
        <div className="rounded-md border border-violet-200 bg-violet-50 p-3 text-xs leading-5 text-violet-900">
          Connect your Midnight wallet to see which registration points to your
          address. Nothing is pre-selected until then — choose carefully.
        </div>
      )}

      <ul className="space-y-2">
        {registrations.map((registration) => {
          const key = refKey(registration)
          const isSelected = selected.has(key)
          return (
            <li key={key}>
              <label
                className={`flex cursor-pointer gap-3 rounded-md border p-3 transition ${
                  isSelected
                    ? "border-red-300 bg-red-50"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-red-600"
                  checked={isSelected}
                  onChange={() => onToggle(key)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {registration.matchesWallet ? (
                      <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-800">
                        ✓ Matches your wallet — keep
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        ⚠ Different DUST address
                      </span>
                    )}
                  </div>
                  <p className="mt-1 break-all font-mono text-xs text-slate-700">
                    {registration.dustAddress ??
                      (registration.dustAddressHex
                        ? `0x${registration.dustAddressHex}`
                        : "DUST address could not be decoded")}
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] text-slate-400">
                    {registration.txHash.slice(0, 12)}…
                    {registration.txHash.slice(-8)}#{registration.outputIndex}
                  </p>
                </div>
              </label>
            </li>
          )
        })}
      </ul>

      <WarningBlock />

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <span className="font-semibold text-slate-950">Wallet: </span>
        {wallet.info.name} ({wallet.stakeAddress.slice(0, 20)}…)
      </div>

      <p className="text-xs leading-5 text-slate-500">
        Your wallet extension shows each transaction before signing. This app
        never asks for your seed phrase or private keys.
      </p>

      <div className="flex gap-3">
        <button
          className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold text-white transition ${
            selectedCount === 0
              ? "cursor-not-allowed bg-slate-400"
              : "bg-red-600 hover:bg-red-700"
          }`}
          type="button"
          disabled={selectedCount === 0}
          onClick={onConfirm}
        >
          {selectedCount > 1
            ? `Remove ${selectedCount} registrations`
            : "Remove registration"}
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

function SigningStep({ total, current }: { total: number; current: number }) {
  return (
    <div className="space-y-4 py-4 text-center">
      <div className="flex justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-red-600" />
      </div>
      <div>
        <p className="font-semibold text-slate-950">
          Waiting for wallet signature
          {total > 1 ? ` (${current} of ${total})` : ""}…
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Confirm the transaction in your wallet extension.
          {total > 1
            ? " Each registration is removed in a separate transaction."
            : ""}
        </p>
      </div>
    </div>
  )
}

function DoneStep({
  results,
  onRetryFailed,
  onDone,
}: {
  results: RemovalResult[]
  onRetryFailed: () => void
  onDone: () => void
}) {
  const succeeded = results.filter((r) => r.success)
  const failed = results.filter((r) => !r.success)

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold uppercase tracking-normal text-teal-700">
          {failed.length === 0 ? "Submitted" : "Partly submitted"}
        </p>
        <h2 className="mt-1 text-lg font-semibold text-slate-950">
          {succeeded.length} of {results.length} removal
          {results.length === 1 ? "" : "s"} submitted
        </h2>
      </div>

      <ul className="space-y-2">
        {results.map((result) => (
          <li
            key={refKey(result.registration)}
            className={`rounded-md border p-3 text-xs ${
              result.success
                ? "border-teal-200 bg-teal-50"
                : "border-red-200 bg-red-50"
            }`}
          >
            <p className="font-semibold">
              {result.success ? "✓ Submitted" : "✗ Failed"} ·{" "}
              {result.registration.dustAddress ??
                `${result.registration.txHash.slice(0, 10)}…`}
            </p>
            <p className="mt-1 break-all font-mono text-[11px] text-slate-600">
              {result.success ? result.txHash : result.error}
            </p>
          </li>
        ))}
      </ul>

      {succeeded.length > 0 && (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950">
          <p className="font-semibold">What happens next</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>Wait for Cardano confirmation.</li>
            <li>Run the inspector again after the transactions confirm.</li>
            <li>
              If the Midnight indexer still says registered, wait and check
              again; indexer lag is common after registration changes.
            </li>
          </ul>
        </div>
      )}

      <div className="flex gap-3">
        {failed.length > 0 && (
          <button
            className="flex-1 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            type="button"
            onClick={onRetryFailed}
          >
            Retry {failed.length} failed
          </button>
        )}
        <button
          className="flex-1 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          type="button"
          onClick={onDone}
        >
          Done
        </button>
      </div>
    </div>
  )
}

function ErrorStep({
  message,
  onCancel,
}: {
  message: string
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
      <div className="flex justify-end">
        <button
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          type="button"
          onClick={onCancel}
        >
          Close
        </button>
      </div>
    </div>
  )
}
