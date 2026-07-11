"use client"

import { useEffect, useState } from "react"
import type { ConnectedWallet } from "@/services/wallet/cip30"
import type { DustGenerationStatus } from "@/domain/dustStatus"
import type { ActiveRegistrationsResult } from "@/app/api/active-registrations/route"
import { decodeBech32, bytesToHex } from "@/lib/bech32"
import { KoiosTransportNote, useKoiosThrottle } from "./KoiosThrottleNote"

type Props = {
  wallet: ConnectedWallet
  indexerStatus: DustGenerationStatus | null
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
  /**
   * False when the registration's c_wallet key is not among the payment keys
   * the connected wallet reported — signing may still succeed (the key can be
   * an unlisted address of the same account), but the user should know.
   */
  ownedByWallet: boolean | null
}

type SelectionState = { registrations: Registration[]; selected: Set<string> }

type FlowState =
  | { step: "loading" }
  | ({ step: "select" } & SelectionState)
  | { step: "signing"; count: number }
  | { step: "done"; txHash: string; removed: Registration[] }
  | { step: "error"; message: string; retry?: SelectionState }

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
  // returns nothing but we still hold a pointer. A UTxO is only identified by
  // txHash AND outputIndex, so a missing index is not guessed.
  const fallbackTxHash = utxoRef?.txHash ?? indexerStatus?.utxoTxHash ?? null
  const fallbackOutputIndex =
    utxoRef?.outputIndex ??
    (indexerStatus?.utxoOutputIndex != null
      ? Number(indexerStatus.utxoOutputIndex)
      : null)

  useEffect(() => {
    let cancelled = false

    async function loadRegistrations() {
      try {
        // Identify the account by stake address AND every wallet payment key.
        // The history view finds registrations by stake account, so deletion
        // must search with the same identity — a registration's datum key is
        // often an older (rotated) payment key, never just the current one.
        const response = await fetch("/api/active-registrations", {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            stakeAddress: wallet.stakeAddress,
            paymentKeyHashes: wallet.paymentKeyHashes,
          }),
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
              ownedByWallet: r.ownedByWallet,
            }))
          : []

        // No live UTxOs found, but we still hold a complete pointer — offer it.
        // Without a definite output index we do not guess one.
        if (
          registrations.length === 0 &&
          fallbackTxHash &&
          fallbackOutputIndex != null &&
          Number.isFinite(fallbackOutputIndex)
        ) {
          registrations = [
            {
              txHash: fallbackTxHash,
              outputIndex: fallbackOutputIndex,
              dustAddress: indexerStatus?.dustAddress ?? null,
              dustAddressHex: null,
              matchesWallet: false,
              ownedByWallet: null,
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

  async function runRemoval(state: SelectionState) {
    const queue = state.registrations.filter((r) =>
      state.selected.has(refKey(r)),
    )
    if (queue.length === 0) return

    setFlow({ step: "signing", count: queue.length })

    try {
      const { deregisterDust } = await import(
        "@/services/cardano/dustTransactions.client"
      )
      const result = await deregisterDust(
        wallet.rawApi,
        queue.map((r) => ({ txHash: r.txHash, outputIndex: r.outputIndex })),
      )

      if (result.success) {
        setFlow({ step: "done", txHash: result.txHash, removed: queue })
      } else {
        setFlow({ step: "error", message: result.error, retry: state })
      }
    } catch (error) {
      setFlow({
        step: "error",
        message: error instanceof Error ? error.message : "Unknown error.",
        retry: state,
      })
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
            onConfirm={() =>
              runRemoval({
                registrations: flow.registrations,
                selected: flow.selected,
              })
            }
            onCancel={onCancel}
          />
        ) : null}

        {flow.step === "signing" ? <SigningStep count={flow.count} /> : null}

        {flow.step === "done" ? (
          <DoneStep
            txHash={flow.txHash}
            removed={flow.removed}
            onClose={() => onSuccess(flow.txHash)}
          />
        ) : null}

        {flow.step === "error" ? (
          <ErrorStep
            message={flow.message}
            onRetry={flow.retry ? () => setFlow({ step: "select", ...flow.retry! }) : undefined}
            onCancel={onCancel}
          />
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

function WarningBlock({ multiple }: { multiple: boolean }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
      <p className="font-semibold">Before you sign</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {multiple ? (
          <li>All selected registrations are removed in a single transaction.</li>
        ) : (
          <li>The registration NFT is burned and the script UTxO is spent.</li>
        )}
        <li>Normal Cardano transaction fees apply.</li>
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
                  {registration.ownedByWallet === false && (
                    <p className="mt-1 text-[11px] leading-4 text-slate-500">
                      Registered with an older payment key of this account. The
                      wallet is asked to sign with that key — if signing fails,
                      connect the wallet or account that created this
                      registration.
                    </p>
                  )}
                </div>
              </label>
            </li>
          )
        })}
      </ul>

      <WarningBlock multiple={isMultiple} />

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <span className="font-semibold text-slate-950">Wallet: </span>
        {wallet.info.name} ({wallet.stakeAddress.slice(0, 20)}…)
      </div>

      <p className="text-xs leading-5 text-slate-500">
        Your wallet extension shows the transaction before signing. This app
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

function SigningStep({ count }: { count: number }) {
  const { waiting, secondsLeft } = useKoiosThrottle()
  return (
    <div className="space-y-4 py-4 text-center">
      <div className="flex justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-red-600" />
      </div>
      <div>
        <p className="font-semibold text-slate-950">
          {waiting ? "Preparing transaction…" : "Waiting for wallet signature…"}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {waiting
            ? `Spacing out Koios requests to stay within rate limits · resuming in ${Math.max(secondsLeft, 1)}s`
            : "Confirm the transaction in your wallet extension." +
              (count > 1
                ? ` All ${count} registrations are removed in this one transaction.`
                : "")}
        </p>
        <KoiosTransportNote className="mt-1 block text-xs text-slate-400" />
      </div>
    </div>
  )
}

function DoneStep({
  txHash,
  removed,
  onClose,
}: {
  txHash: string
  removed: Registration[]
  onClose: () => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold uppercase tracking-normal text-teal-700">
          Transaction submitted
        </p>
        <h2 className="mt-1 text-lg font-semibold text-slate-950">
          {removed.length > 1
            ? `${removed.length} registrations removed`
            : "Registration removal was submitted"}
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
  onRetry?: () => void
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
        {onRetry && (
          <button
            className="flex-1 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            type="button"
            onClick={onRetry}
          >
            Back to selection
          </button>
        )}
        <button
          className={`rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 ${onRetry ? "" : "flex-1"}`}
          type="button"
          onClick={onCancel}
        >
          Close
        </button>
      </div>
    </div>
  )
}
