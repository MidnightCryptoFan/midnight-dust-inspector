"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { AddressInput } from "./AddressInput"
import { CardanoInspectionPanel } from "./CardanoInspectionPanel"
import { MidnightDustWalletPanel } from "./MidnightDustWalletPanel"
import { diagnoseDustStatus } from "@/domain/diagnosis"
import type { OnChainRegistrationState } from "@/domain/onChainRegistration"
import type { CardanoAccountSnapshot } from "@/domain/cardanoAccount"
import type {
  MidnightDustBalance,
  MidnightWalletError,
} from "@/domain/midnightDustBalance"
import type {
  ControlledIndexerError,
  DiagnosisResult,
  DustGenerationStatus,
} from "@/domain/dustStatus"
import type {
  RegistrationEvent,
  RegistrationTimeline,
  RegistrationTimelineError,
} from "@/domain/registrationTimeline"
import { DeregisterFlow } from "./DeregisterFlow"
import { RegisterFlow } from "./RegisterFlow"
import type { RegistrationOwnerResult } from "@/app/api/registration-owner/route"
import { validateStakeAddress } from "@/lib/validation"
import { inspectDustGenerationStatusFromApi } from "@/services/dustStatusApiClient"
import {
  inspectDustGenerationStatus,
  isMockIndexerEnabled,
  type MockIndexerScenario,
  mockIndexerScenarios,
} from "@/services/midnightIndexerClient"
import { inspectRegistrationTimelineCached } from "@/services/registrationTimelineCache"
import { KoiosThrottleNote } from "./KoiosThrottleNote"
import { type ConnectedWallet } from "@/services/wallet/cip30"
import { readMidnightWalletDustBalance } from "@/services/wallet/midnightDappConnector"
import { WalletConnectSection } from "./WalletConnectSection"
import { FaqPanel } from "./FaqPanel"
import { TipPanel } from "./TipPanel"

type DustGrowthStatus = "unchecked" | "checking" | "growing" | "stable"

export type ActiveRegistrationLookup =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "found"
      stakeAddress: string | null
      paymentKeyHash: string | null
      txHash: string
      outputIndex: number
    }
  | { status: "not_found"; reason: string }

type InspectionState = {
  stakeAddress: string
  diagnosis: DiagnosisResult
  status: DustGenerationStatus | null
  rawResponse: unknown
  controlledError: ControlledIndexerError | null
  cardanoAccountSnapshot: CardanoAccountSnapshot | null
  registrationTimeline: RegistrationTimeline | null
  registrationTimelineError: RegistrationTimelineError | null
  registrationAddress: string | null
  onChainState: OnChainRegistrationState | null
  /** UTxO found by script-address scan (used when indexer has no utxoTxHash). */
  resolvedUtxoRef: { txHash: string; outputIndex: number } | null
}

export function InspectorApp() {
  const mockModeEnabled = isMockIndexerEnabled()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [address, setAddress] = useState(() => searchParams.get("stake") ?? "")
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  )
  const [validationNote, setValidationNote] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [scanProgress, setScanProgress] = useState<{
    done: number
    total: number
  } | null>(null)
  const [mockScenario, setMockScenario] =
    useState<MockIndexerScenario>("healthy")
  const [inspection, setInspection] = useState<InspectionState | null>(null)
  const [connectedWallet, setConnectedWallet] =
    useState<ConnectedWallet | null>(null)
  const [midnightDustBalance, setMidnightDustBalance] =
    useState<MidnightDustBalance | null>(null)
  const [midnightWalletError, setMidnightWalletError] =
    useState<MidnightWalletError | null>(null)
  const [isOnChainLoading, setIsOnChainLoading] = useState(false)
  const [showDeregister, setShowDeregister] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const [dustGrowthStatus, setDustGrowthStatus] =
    useState<DustGrowthStatus>("unchecked")
  const [dustRate, setDustRate] = useState<bigint | null>(null)
  const [activeRegistrationLookup, setActiveRegistrationLookup] =
    useState<ActiveRegistrationLookup>({ status: "idle" })
  const [autoRefresh, setAutoRefresh] = useState(false)
  const dustGrowthCheckRef = useRef<{
    walletId: string
    phase: "checking" | "done"
    initialBalance: bigint
    startedAt: number
  } | null>(null)

  // Auto-submit when ?stake= is present in the URL on first load.
  useEffect(() => {
    const initialStake = searchParams.get("stake")
    if (initialStake) {
      void runInspection(initialStake)
    }
    // Run only once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!midnightDustBalance) {
      dustGrowthCheckRef.current = null
      return
    }

    const walletId = midnightDustBalance.walletId
    let current: bigint
    try {
      current = BigInt(midnightDustBalance.balance ?? "0")
    } catch {
      return
    }

    const state = dustGrowthCheckRef.current

    // Already finished checking this wallet — ignore further balance updates.
    if (state?.walletId === walletId && state.phase === "done") return

    // Second reading arrived for an in-progress check — compare and compute rate.
    if (state?.walletId === walletId && state.phase === "checking") {
      if (Date.now() - state.startedAt >= 8_000) {
        const delta =
          current > state.initialBalance ? current - state.initialBalance : 0n
        // 10s window → multiply by 360 to get per-hour rate
        const ratePerHour = delta * 360n
        setDustRate(ratePerHour > 0n ? ratePerHour : null)
        setDustGrowthStatus(
          current > state.initialBalance ? "growing" : "stable",
        )
        dustGrowthCheckRef.current = { ...state, phase: "done" }
      }
      return
    }

    // First reading for a new (or switched) wallet — start the 10-second check.
    dustGrowthCheckRef.current = {
      walletId,
      phase: "checking",
      initialBalance: current,
      startedAt: Date.now(),
    }
    setDustGrowthStatus("checking")
    setDustRate(null)

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        if (dustGrowthCheckRef.current?.walletId !== walletId) return
        try {
          const result = await readMidnightWalletDustBalance(walletId, {
            connectionMode: "configured-network",
          })
          if (result.balance) {
            setMidnightDustBalance(result.balance)
            setMidnightWalletError(result.error)
          } else {
            setDustGrowthStatus("unchecked")
            if (dustGrowthCheckRef.current?.walletId === walletId) {
              dustGrowthCheckRef.current = {
                walletId,
                phase: "done",
                initialBalance: 0n,
                startedAt: 0,
              }
            }
          }
        } catch {
          setDustGrowthStatus("unchecked")
        }
      })()
    }, 10_000)

    return () => window.clearTimeout(timeoutId)
  }, [midnightDustBalance])

  useEffect(() => {
    if (!autoRefresh || !inspection?.stakeAddress) return
    const stakeAddress = inspection.stakeAddress
    const paymentKeyHashes = connectedWallet?.paymentKeyHashes ?? null
    const id = window.setInterval(() => {
      void runInspection(stakeAddress, { paymentKeyHashes })
    }, 60_000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, inspection?.stakeAddress, connectedWallet?.paymentKeyHashes])

  async function handleWalletConnected(wallet: ConnectedWallet) {
    setConnectedWallet(wallet)
    setAddress(wallet.stakeAddress)
    setValidationMessage(null)
    await runInspection(wallet.stakeAddress, {
      paymentKeyHashes: wallet.paymentKeyHashes,
    })
  }

  function handleWalletDisconnected() {
    setConnectedWallet(null)
    setAddress("")
    setInspection(null)
    setValidationMessage(null)
    setActiveRegistrationLookup({ status: "idle" })
    setDustGrowthStatus("unchecked")
    setDustRate(null)
    setAutoRefresh(false)
  }

  async function handleSubmit() {
    await runInspection(address, {
      paymentKeyHashes: connectedWallet?.paymentKeyHashes ?? null,
    })
  }

  async function runInspection(
    stakeAddress: string,
    options?: { paymentKeyHashes?: string[] | null },
  ) {
    const validation = validateStakeAddress(stakeAddress)

    if (!validation.valid) {
      setValidationMessage(validation.message)
      setValidationNote(null)
      setInspection(null)
      return
    }

    setValidationMessage(null)
    setValidationNote(validation.note ?? null)
    setIsLoading(true)
    setScanProgress(null)
    router.replace(`?stake=${encodeURIComponent(validation.address)}`, {
      scroll: false,
    })

    try {
      const [result, timelineResult] = await Promise.all([
        mockModeEnabled
          ? inspectDustGenerationStatus(validation.address, { mockScenario })
          : inspectDustGenerationStatusFromApi(validation.address),
        mockModeEnabled
          ? Promise.resolve({
              timeline: null,
              cardanoAccountSnapshot: null,
              controlledError: null,
            })
          : inspectRegistrationTimelineCached(validation.address, {
              onProgress: (done, total) => setScanProgress({ done, total }),
            }),
      ])

      const registrationAddress = await resolveRegistrationAddress(
        result.status?.utxoTxHash ?? null,
        result.status?.utxoOutputIndex ?? null,
      )

      const diagnosis = diagnoseDustStatus(
        result.status,
        result.controlledError,
        {
          cardanoAccountSnapshot: timelineResult.cardanoAccountSnapshot,
          onChainRegistrationState: null,
        },
      )

      const newInspection: InspectionState = {
        stakeAddress: validation.address,
        diagnosis,
        status: result.status,
        rawResponse: result.rawResponse,
        controlledError: result.controlledError,
        cardanoAccountSnapshot: timelineResult.cardanoAccountSnapshot,
        registrationTimeline: timelineResult.timeline,
        registrationTimelineError: timelineResult.controlledError,
        registrationAddress,
        onChainState: null,
        resolvedUtxoRef: null,
      }
      setInspection(newInspection)

      // Cross-check on-chain state when indexer says registered
      if (result.status?.registered) {
        const paymentKeyHashes =
          options?.paymentKeyHashes ?? connectedWallet?.paymentKeyHashes ?? []

        if (result.status.utxoTxHash) {
          // Fast path: indexer has a UTxO pointer; check if still unspent.
          void fetchOnChainState(
            result.status.utxoTxHash,
            result.status.utxoOutputIndex,
            null,
          )
        } else {
          // Slow path: no UTxO pointer; scan the script address for every
          // registration of this stake account (works without a wallet too).
          void fetchOnChainState(null, null, {
            stakeAddress: validation.address,
            paymentKeyHashes,
          })
        }
      }
    } finally {
      setIsLoading(false)
      setScanProgress(null)
    }
  }

  async function fetchOnChainState(
    utxoTxHash: string | null,
    utxoOutputIndex: string | null,
    account: { stakeAddress: string; paymentKeyHashes: string[] } | null,
  ) {
    let requestBody: Record<string, unknown>

    if (utxoTxHash) {
      const outputIndex = utxoOutputIndex != null ? Number(utxoOutputIndex) : 0
      if (!Number.isFinite(outputIndex)) return
      requestBody = { utxoTxHash, utxoOutputIndex: outputIndex }
    } else if (account) {
      requestBody = {
        stakeAddress: account.stakeAddress,
        paymentKeyHashes: account.paymentKeyHashes,
      }
    } else {
      return
    }

    setIsOnChainLoading(true)
    try {
      const response = await fetch("/api/on-chain-registration", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
      })
      const data = (await response.json()) as {
        state: OnChainRegistrationState
        foundUtxo?: { txHash: string; outputIndex: number }
      }
      setInspection((prev) =>
        prev ? applyOnChainState(prev, data.state, data.foundUtxo) : prev,
      )
    } catch {
      setInspection((prev) =>
        prev
          ? applyOnChainState(prev, {
              kind: "unknown",
              error: "The Koios on-chain lookup failed.",
            })
          : prev,
      )
    } finally {
      setIsOnChainLoading(false)
    }
  }

  function handleDeregister() {
    setShowDeregister(true)
  }

  function handleRegister() {
    setShowRegister(true)
  }

  function handleTxSuccess(txHash: string) {
    void txHash
    // Re-run inspection after a short delay so on-chain state has a chance to update
    setTimeout(() => {
      if (inspection) {
        void runInspection(inspection.stakeAddress, {
          paymentKeyHashes: connectedWallet?.paymentKeyHashes ?? null,
        })
      }
    }, 5_000)
  }

  async function handleFindActiveSource() {
    const dustAddress = midnightDustBalance?.dustAddress?.trim()

    if (!dustAddress) {
      setActiveRegistrationLookup({
        status: "not_found",
        reason: "Connect a Midnight wallet first so the DUST address is known.",
      })
      return
    }

    setActiveRegistrationLookup({ status: "loading" })

    try {
      const response = await fetch("/api/registration-owner", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ dustAddress }),
      })
      const result = (await response.json()) as RegistrationOwnerResult

      if (result.found) {
        setActiveRegistrationLookup({
          status: "found",
          stakeAddress: result.stakeAddress,
          paymentKeyHash: result.paymentKeyHash,
          txHash: result.txHash,
          outputIndex: result.outputIndex,
        })
      } else {
        setActiveRegistrationLookup({
          status: "not_found",
          reason: result.reason,
        })
      }
    } catch {
      setActiveRegistrationLookup({
        status: "not_found",
        reason: "The active source lookup failed. Try again in a moment.",
      })
    }
  }

  async function handleInspectActiveSource(stakeAddress: string) {
    setAddress(stakeAddress)
    await runInspection(stakeAddress)
  }

  const recentRegistrationActivity = inspection?.registrationTimeline
    ? getRecentRegistrationActivity(inspection.registrationTimeline)
    : null

  const dustCapFull = (() => {
    try {
      const bal = midnightDustBalance?.balance
      const cap = midnightDustBalance?.cap
      if (!bal || !cap) return false
      const b = BigInt(bal)
      const c = BigInt(cap)
      return c > 0n && b >= c
    } catch {
      return false
    }
  })()

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
        {/* Header */}
        <header className="flex items-start justify-between py-2">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 dark:bg-slate-800">
              <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7">
                <rect x="3" y="3" width="4" height="4" fill="white" />
                <rect x="3" y="10" width="4" height="4" fill="white" />
                <rect x="3" y="17" width="4" height="4" fill="white" />
                <path
                  d="M12.8765 7H7V3.05761C13.5 3.05761 21 1.71441 21 11.9994C21 22.2845 14.2593 20.943 10.4074 20.9421V16.4708H12.8148C13.9383 16.4708 16.1852 16.9188 16.1852 11.9994C16.1852 7.52808 14 7 12.8765 7Z"
                  fill="white"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-slate-50 sm:text-3xl">
                Midnight DUST Inspector
              </h1>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Check your DUST generation, cap, wallet link, and registration status.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="https://midnightcryptofan.github.io/midnight-dust-inspector-help/"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-600 hover:bg-violet-100 transition-colors dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-400 dark:hover:bg-violet-950/50"
            >
              Get Help
            </a>
            <span className="hidden rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500 sm:inline-flex dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              Non-custodial
            </span>
          </div>
        </header>

        {/* Security notice */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
          This tool never asks for your seed phrase or private keys. Wallet connections are read-only unless you explicitly sign a registration transaction inside your wallet.
        </div>

        {/* Modals */}
        {showDeregister && connectedWallet && inspection != null && (
          inspection.status != null ||
          inspection.diagnosis.code === "MULTIPLE_REGISTRATIONS_DETECTED" ||
          (inspection.registrationTimeline?.activeRegistrationCount ?? 0) > 1
        ) && (
          <DeregisterFlow
            wallet={connectedWallet}
            indexerStatus={inspection.status}
            midnightAddress={midnightDustBalance?.dustAddress ?? null}
            utxoRef={inspection.resolvedUtxoRef ?? undefined}
            onSuccess={(txHash) => {
              setShowDeregister(false)
              handleTxSuccess(txHash)
            }}
            onCancel={() => setShowDeregister(false)}
          />
        )}
        {showRegister && connectedWallet && (
          <RegisterFlow
            wallet={connectedWallet}
            initialMidnightAddress={midnightDustBalance?.dustAddress ?? null}
            onSuccess={(txHash) => {
              setShowRegister(false)
              handleTxSuccess(txHash)
            }}
            onCancel={() => setShowRegister(false)}
          />
        )}

        {/* 1. Midnight Panel — primary */}
        <section className="rounded-xl border border-violet-200 bg-white p-5 dark:border-violet-800 dark:bg-slate-900">
          <WorldLabel world="midnight" />
          <div className="mt-4">
            <MidnightDustWalletPanel
              balance={midnightDustBalance}
              error={midnightWalletError}
              dustGrowthStatus={dustGrowthStatus}
              dustRate={dustRate}
              generationNotice={
                midnightDustBalance !== null &&
                dustGrowthStatus === "stable" &&
                dustRate === null &&
                inspection?.status?.registered === true
                  ? "DUST is generating per the Midnight indexer, but the amount is too small to detect in the 10-second measurement window. This is normal for very small NIGHT balances."
                  : null
              }
              onBalanceChange={(bal, err) => {
                if (bal?.dustAddress !== midnightDustBalance?.dustAddress) {
                  setActiveRegistrationLookup({ status: "idle" })
                }
                if (!bal) {
                  dustGrowthCheckRef.current = null
                  setDustGrowthStatus("unchecked")
                  setDustRate(null)
                }
                setMidnightDustBalance(bal)
                setMidnightWalletError(err)
              }}
              embedded
            />
          </div>
        </section>

        {/* 2. Cardano Panel — secondary */}
        <section className="rounded-xl border border-blue-100 bg-white p-5 dark:border-blue-900/60 dark:bg-slate-900">
          <WorldLabel world="cardano" />
          <div className="mt-4 space-y-4">
            <WalletConnectSection
              connected={connectedWallet}
              onConnected={handleWalletConnected}
              onDisconnected={handleWalletDisconnected}
              autoRefresh={autoRefresh}
              onAutoRefreshToggle={
                inspection ? () => setAutoRefresh((p) => !p) : undefined
              }
              embedded
            />
            {!connectedWallet && (
              <>
                <Divider label="or enter stake address" />
                <AddressInput
                  address={address}
                  validationMessage={validationMessage}
                  validationNote={validationNote}
                  isLoading={isLoading}
                  onAddressChange={(value) => {
                    setAddress(value)
                    setValidationMessage(null)
                    setValidationNote(null)
                  }}
                  onSubmit={handleSubmit}
                />
              </>
            )}
            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                <span>
                  {scanProgress && scanProgress.total > 0
                    ? `Analyzing transactions (${scanProgress.done}/${scanProgress.total})`
                    : "Inspecting…"}
                  <KoiosThrottleNote className="ml-1.5 text-slate-400 dark:text-slate-500" />
                </span>
              </div>
            )}
          </div>

          {inspection ? (
            <div className="mt-5 border-t border-slate-100 pt-5 dark:border-slate-800">
              <CardanoInspectionPanel
                snapshot={inspection.cardanoAccountSnapshot}
                indexerStatus={inspection.status}
                onChainState={inspection.onChainState}
                isOnChainLoading={isOnChainLoading}
                walletConnected={!!connectedWallet}
                midnightAddress={midnightDustBalance?.dustAddress ?? null}
                dustGrowthStatus={dustGrowthStatus}
                dustCapFull={dustCapFull}
                multipleRegistrations={
                  inspection.diagnosis.code === "MULTIPLE_REGISTRATIONS_DETECTED" ||
                  (inspection.registrationTimeline?.activeRegistrationCount ?? 0) > 1
                }
                activeRegistrationLookup={activeRegistrationLookup}
                timeline={inspection.registrationTimeline}
                timelineError={inspection.registrationTimelineError}
                recentActivity={recentRegistrationActivity}
                onDeregister={handleDeregister}
                onRegister={handleRegister}
                onFindActiveSource={handleFindActiveSource}
                onInspectActiveSource={handleInspectActiveSource}
                onRefresh={() =>
                  runInspection(inspection.stakeAddress, {
                    paymentKeyHashes: connectedWallet?.paymentKeyHashes ?? null,
                  })
                }
              />
            </div>
          ) : (
            !isLoading && (
              <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                Enter a Cardano stake address or connect your Cardano wallet to inspect your DUST generation.
              </p>
            )
          )}
        </section>

        {/* 3. FAQ */}
        <FaqPanel />

        {/* 4. Support */}
        <TipPanel />

        {/* 5. Footer */}
        <footer className="pb-2 text-center text-xs text-slate-400 dark:text-slate-600 space-y-0.5">
          <p>
            DUST Inspector{" "}
            {process.env.NEXT_PUBLIC_APP_VERSION
              ? `v${process.env.NEXT_PUBLIC_APP_VERSION}`
              : ""}
            {process.env.NEXT_PUBLIC_APP_CHANNEL ? (
              <span className="ml-1.5 rounded-full border border-current px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                {process.env.NEXT_PUBLIC_APP_CHANNEL}
              </span>
            ) : null}
          </p>
          <p>
            Created by{" "}
            <a
              href="https://github.com/MidnightCryptoFan/midnight-dust-inspector"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-slate-600 dark:hover:text-slate-400"
            >
              MidnightCryptoFan
            </a>
          </p>
          <p>This is an independent tool and not an official Midnight Network product.</p>
        </footer>

        {/* Dev: mock scenario */}
        {mockModeEnabled && (
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-800 dark:bg-sky-950/30">
            <label
              className="block text-sm font-semibold text-sky-950 dark:text-sky-200"
              htmlFor="mock-scenario"
            >
              Mock response (dev mode)
            </label>
            <select
              className="mt-2 min-h-10 rounded-lg border border-sky-300 bg-white px-3 py-2 text-sm text-slate-950 dark:border-sky-700 dark:bg-slate-800 dark:text-slate-50"
              id="mock-scenario"
              value={mockScenario}
              onChange={(e) =>
                setMockScenario(e.target.value as MockIndexerScenario)
              }
            >
              {mockIndexerScenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  )
}

function getRecentRegistrationActivity(
  timeline: RegistrationTimeline,
): RegistrationEvent | null {
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000
  return (
    timeline.events.find(
      (e) =>
        (e.type === "registration_created" ||
          e.type === "registration_removed") &&
        e.blockTime != null &&
        Date.parse(e.blockTime) >= cutoffMs,
    ) ?? null
  )
}

function applyOnChainState(
  inspection: InspectionState,
  onChainState: OnChainRegistrationState,
  foundUtxo?: { txHash: string; outputIndex: number },
): InspectionState {
  return {
    ...inspection,
    diagnosis: diagnoseDustStatus(
      inspection.status,
      inspection.controlledError,
      {
        cardanoAccountSnapshot: inspection.cardanoAccountSnapshot,
        onChainRegistrationState: onChainState,
      },
    ),
    onChainState,
    resolvedUtxoRef: foundUtxo ?? inspection.resolvedUtxoRef,
  }
}

async function resolveRegistrationAddress(
  utxoTxHash: string | null,
  utxoOutputIndex: string | null,
): Promise<string | null> {
  if (!utxoTxHash) {
    return null
  }

  const outputIndex = utxoOutputIndex != null ? Number(utxoOutputIndex) : 0

  if (!Number.isFinite(outputIndex)) {
    return null
  }

  try {
    const response = await fetch("/api/registration-address", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ txHash: utxoTxHash, outputIndex }),
    })
    const data = (await response.json()) as { address: string | null }
    return data.address
  } catch {
    return null
  }
}

const HELP_BASE =
  "https://midnightcryptofan.github.io/midnight-dust-inspector-help"

function WorldLabel({ world }: { world: "cardano" | "midnight" }) {
  if (world === "cardano") {
    return (
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400">
          <span className="h-2 w-2 rounded-full bg-blue-500" />
          Cardano
        </p>
        <a
          href={`${HELP_BASE}/#cardano`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
        >
          Help?
        </a>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-violet-600 dark:text-violet-400">
        <span className="h-2 w-2 rounded-full bg-violet-500" />
        Midnight
      </p>
      <a
        href={`${HELP_BASE}/#midnight`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-slate-400 hover:text-violet-500 dark:hover:text-violet-400 transition-colors"
      >
        Help?
      </a>
    </div>
  )
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </span>
      <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
    </div>
  )
}
