"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import type {
  MidnightDustBalance,
  MidnightWalletError,
} from "@/domain/midnightDustBalance"
import { formatDustQuantity } from "@/domain/midnightDustBalance"
import { formatCheckedAt, formatCompactAtomicQuantity } from "@/lib/formatting"
import {
  detectInstalledMidnightWallets,
  readMidnightWalletDustBalance,
  type MidnightWalletConnectionMode,
  type MidnightWalletInfo,
} from "@/services/wallet/midnightDappConnector"
import { CopyButton } from "./CopyButton"
import {
  requestBrowserWalletDiscovery,
  subscribeToBrowserWalletDiscovery,
} from "@/services/wallet/walletDiscoveryStore"

type DustGrowthStatus = "unchecked" | "checking" | "growing" | "stable"

type MidnightDustWalletPanelProps = {
  balance: MidnightDustBalance | null
  error: MidnightWalletError | null
  generationNotice?: string | null
  dustGrowthStatus?: DustGrowthStatus
  /** Atomic DUST units per hour, computed from 10-second measurement. */
  dustRate?: bigint | null
  onBalanceChange: (
    balance: MidnightDustBalance | null,
    error: MidnightWalletError | null,
  ) => void
  /** Render without an outer section for embedding inside a wallet card. */
  embedded?: boolean
}

export function MidnightDustWalletPanel({
  balance,
  error,
  generationNotice,
  dustGrowthStatus = "unchecked",
  dustRate = null,
  onBalanceChange,
  embedded = false,
}: MidnightDustWalletPanelProps) {
  const wallets = useSyncExternalStore(
    subscribeToMidnightWalletAvailability,
    getMidnightWalletSnapshot,
    getServerMidnightWalletSnapshot,
  )
  const [connecting, setConnecting] = useState<string | null>(null)
  const [isDiscovering, setIsDiscovering] = useState(true)
  const [, forceDiscoveryRefresh] = useState(0)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const connectAttemptIdRef = useRef(0)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setIsDiscovering(false)
    }, 3_000)

    return () => window.clearTimeout(timeoutId)
  }, [])

  useEffect(() => {
    if (!autoRefresh || !balance?.walletId) return
    const walletId = balance.walletId
    const id = window.setInterval(() => {
      void handleConnect(walletId)
    }, 60_000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, balance?.walletId])

  async function handleConnect(
    walletId: string,
    connectionMode: MidnightWalletConnectionMode = "configured-network",
  ) {
    const attemptId = connectAttemptIdRef.current + 1
    connectAttemptIdRef.current = attemptId
    const resultPromise = readMidnightWalletDustBalance(walletId, {
      connectionMode,
    })

    setConnecting(walletId)

    if (!balance) {
      onBalanceChange(null, null)
    }

    try {
      const result = await resultPromise
      if (connectAttemptIdRef.current === attemptId) {
        if (!result.balance) {
          setAutoRefresh(false)
        }
        onBalanceChange(result.balance, result.error)
      }
    } finally {
      if (connectAttemptIdRef.current === attemptId) {
        setConnecting(null)
      }
    }
  }

  function handleCancelConnect() {
    connectAttemptIdRef.current += 1
    setConnecting(null)
  }

  function handleScanAgain() {
    setIsDiscovering(true)
    requestBrowserWalletDiscovery("midnight")
    forceDiscoveryRefresh((value) => value + 1)
    window.setTimeout(() => setIsDiscovering(false), 1_500)
  }

  async function handleRefresh() {
    if (!balance) return
    await handleConnect(balance.walletId)
  }

  const connectedWalletInfo =
    wallets.find((w) => w.id === balance?.walletId) ?? null

  const inner = (
    <div className="space-y-4">
      {balance ? (
        <>
          {/* Connected header — mirrors Cardano WalletConnectSection layout */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {connectedWalletInfo?.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="h-7 w-7 rounded-md object-contain"
                  src={connectedWalletInfo.icon}
                />
              ) : null}
              <div>
                <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                  {balance.walletName}
                </p>
                <p className="mt-0.5 text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-slate-300">
                  Midnight DUST address
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs font-semibold text-violet-900 dark:text-violet-100">
                    {balance.dustAddress
                      ? `${balance.dustAddress.slice(0, 20)}…${balance.dustAddress.slice(-6)}`
                      : "—"}
                  </span>
                  {balance.dustAddress && (
                    <CopyButton text={balance.dustAddress} />
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-800 dark:bg-violet-900/40 dark:text-violet-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                  Connected
                </span>
                <button
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  type="button"
                  onClick={() => {
                    setAutoRefresh(false)
                    onBalanceChange(null, null)
                  }}
                >
                  Disconnect
                </button>
              </div>
              <button
                type="button"
                onClick={() => setAutoRefresh((prev) => !prev)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  autoRefresh
                    ? "border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950/30 dark:text-green-400"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    autoRefresh
                      ? "animate-pulse bg-green-500"
                      : "bg-slate-300 dark:bg-slate-600"
                  }`}
                />
                {autoRefresh ? "Auto-refresh on · 60s" : "Auto-refresh"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <DustMetric
              label="DUST balance"
              value={formatDustQuantity(balance.balance)}
              accent
            />
            <DustMetric
              label="DUST cap"
              value={formatDustQuantity(balance.cap)}
            />
            <DustMetric
              label="Generation rate"
              value={formatDustRate(dustGrowthStatus, dustRate)}
              measuring={dustGrowthStatus === "checking"}
            />
          </div>

          <GenerationEta
            dustGrowthStatus={dustGrowthStatus}
            dustRate={dustRate}
            balance={balance.balance}
            cap={balance.cap}
          />

          {generationNotice ? (
            <p className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs leading-5 text-violet-900 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300">
              {generationNotice}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {formatCheckedAt(balance.checkedAt)}
            </span>
            {!autoRefresh && (
              <button
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                disabled={!!connecting}
                type="button"
                onClick={handleRefresh}
              >
                {connecting ? "Refreshing..." : "Refresh"}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">
            Connect to read your Midnight DUST wallet address, DUST balance, and
            DUST cap. NIGHT stays in your Cardano wallet.
          </p>
          {wallets.length > 0 ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {wallets.map((wallet) => (
                  <WalletConnectButtons
                    connecting={connecting}
                    key={wallet.id}
                    onConnect={handleConnect}
                    wallet={wallet}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              <p>
                {isDiscovering
                  ? "Looking for installed Midnight wallets. Unlock Lace if it is already open."
                  : "No Midnight DApp Connector wallet detected. Unlock Lace or another compatible Midnight wallet, then scan again."}
              </p>
              <button
                className="mt-3 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-700"
                type="button"
                onClick={handleScanAgain}
              >
                Scan again
              </button>
              <button
                className="ml-2 mt-3 rounded-md border border-violet-200 bg-white px-2.5 py-1 text-xs font-semibold text-violet-700 transition hover:bg-violet-50 disabled:opacity-50 dark:border-violet-700 dark:bg-slate-900 dark:text-violet-200 dark:hover:bg-violet-950/60"
                disabled={!!connecting}
                type="button"
                onClick={() => handleConnect("lace")}
              >
                Connect Lace
              </button>
            </div>
          )}

          {connecting && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm dark:border-violet-800 dark:bg-violet-950/30">
              <p className="font-semibold text-violet-900 dark:text-violet-300">
                Waiting for Lace response
              </p>
              <ol className="mt-1.5 space-y-1 text-xs text-violet-700 dark:text-violet-400">
                <li>
                  1. Open or unlock the <strong>Lace extension</strong>.
                </li>
                <li>
                  2. Look for a <strong>connection request</strong>. It may
                  appear inside Lace, for example in a{" "}
                  <strong>DApps / Connections</strong> tab inside Lace.
                </li>
                <li>
                  3. If nothing appears, stop waiting and try again after
                  refreshing the page.
                </li>
              </ol>
              <button
                className="mt-3 rounded-md border border-violet-300 bg-white px-2.5 py-1 text-xs font-semibold text-violet-800 transition hover:bg-violet-100 dark:border-violet-700 dark:bg-slate-900 dark:text-violet-200 dark:hover:bg-violet-950/60"
                type="button"
                onClick={handleCancelConnect}
              >
                Stop waiting
              </button>
            </div>
          )}

          {error ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              <p className="font-semibold">{error.userMessage}</p>
              {error.code === "CONNECTION_TIMEOUT" && (
                <p className="mt-1 text-xs">
                  Open the Lace extension and look for a connection request
                  inside it, or close the Lace popup entirely and click the
                  connect button again - the wallet should open with the
                  request.
                </p>
              )}
              {error.technicalDetails.length > 0 && (
                <ul className="mt-2 space-y-0.5 font-mono text-xs opacity-70">
                  {error.technicalDetails.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  )

  if (embedded) return inner

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-4 flex items-center gap-2">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-violet-600 dark:text-violet-400">
          <span className="h-2 w-2 rounded-full bg-violet-500" />
          Midnight
        </p>
      </div>
      <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">
        Midnight DUST Wallet
      </h2>
      {inner}
    </section>
  )
}

// Helpers.

function WalletConnectButtons({
  wallet,
  connecting,
  onConnect,
}: {
  wallet: MidnightWalletInfo
  connecting: string | null
  onConnect: (
    walletId: string,
    connectionMode?: MidnightWalletConnectionMode,
  ) => void
}) {
  const isConnecting = connecting === wallet.id
  const isLace = isLaceWallet(wallet)

  return (
    <div className="flex flex-wrap gap-2">
      <button
        className="flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 transition hover:border-violet-300 hover:bg-violet-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-violet-700 dark:hover:bg-violet-950/40"
        disabled={!!connecting}
        type="button"
        onClick={() => onConnect(wallet.id)}
      >
        {wallet.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            className="h-5 w-5 rounded-sm object-contain"
            src={wallet.icon}
          />
        ) : null}
        {isConnecting ? `Connecting ${wallet.name}...` : wallet.name}
      </button>
      {isLace && !wallet.supportsConnect && wallet.supportsLegacyEnable ? (
        <button
          className="min-h-9 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-violet-300 hover:bg-violet-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-violet-700 dark:hover:bg-violet-950/40"
          disabled={!!connecting}
          type="button"
          onClick={() => onConnect(wallet.id, "legacy-enable")}
        >
          Lace legacy
        </button>
      ) : null}
    </div>
  )
}

function isLaceWallet(wallet: MidnightWalletInfo): boolean {
  return (
    wallet.name.toLowerCase().includes("lace") ||
    wallet.rdns?.toLowerCase().includes("lace") === true
  )
}

function DustMetric({
  label,
  value,
  accent,
  className = "",
  mono,
  measuring,
}: {
  label: string
  value: string
  accent?: boolean
  className?: string
  mono?: boolean
  measuring?: boolean
}) {
  return (
    <div
      className={`rounded-lg border border-slate-100 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800 ${className}`}
    >
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </dt>
      <dd
        className={`mt-1 break-all text-sm ${mono ? "font-mono text-xs" : ""} ${
          measuring
            ? "flex items-center gap-1 text-slate-400 dark:text-slate-500"
            : accent
              ? "font-semibold text-violet-700 dark:text-violet-300"
              : "text-slate-800 dark:text-slate-200"
        }`}
      >
        {measuring && (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-violet-500" />
        )}
        {value}
      </dd>
    </div>
  )
}

const DUST_ATOMIC_UNITS = 1_000_000_000_000_000n

function formatDustRate(status: DustGrowthStatus, rate: bigint | null): string {
  if (status === "checking") return "Measuring…"
  if (status === "unchecked") return "—"
  if (!rate || rate === 0n) return "0 DUST/h"
  return `${formatCompactAtomicQuantity(rate, DUST_ATOMIC_UNITS)} DUST/h`
}

function GenerationEta({
  dustGrowthStatus,
  dustRate,
  balance,
  cap,
}: {
  dustGrowthStatus: DustGrowthStatus
  dustRate: bigint | null
  balance: string | null
  cap: string | null
}) {
  if (dustGrowthStatus === "checking") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-violet-500" />
        Measuring generation rate over 10 seconds…
      </p>
    )
  }

  if (dustGrowthStatus === "unchecked" || !dustRate || dustRate === 0n)
    return null

  let etaText: string | null = null
  try {
    const balAtomic = BigInt(balance ?? "0")
    const capAtomic = BigInt(cap ?? "0")
    const remaining = capAtomic - balAtomic
    if (remaining > 0n && dustRate > 0n) {
      const hoursLeft = remaining / dustRate
      if (hoursLeft < 24n) {
        etaText = `Cap full in ~${hoursLeft}h`
      } else {
        const daysLeft = hoursLeft / 24n
        etaText =
          daysLeft < 365n
            ? `Cap full in ~${daysLeft} days`
            : `Cap full in ${daysLeft / 365n}+ years`
      }
    } else if (remaining <= 0n) {
      etaText = "Cap reached"
    }
  } catch {
    etaText = null
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className="flex items-center gap-1.5 font-medium text-green-700 dark:text-green-400">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        Active — DUST growing
      </span>
      {etaText && (
        <span className="text-slate-500 dark:text-slate-400">{etaText}</span>
      )}
    </div>
  )
}

// Store subscription.

function subscribeToMidnightWalletAvailability(
  onStoreChange: () => void,
): () => void {
  return subscribeToBrowserWalletDiscovery("midnight", onStoreChange)
}

const serverMidnightWalletSnapshot: MidnightWalletInfo[] = []
function getServerMidnightWalletSnapshot(): MidnightWalletInfo[] {
  return serverMidnightWalletSnapshot
}

let cachedMidnightWalletSnapshot: MidnightWalletInfo[] = []
let cachedMidnightWalletSnapshotKey = ""

function getMidnightWalletSnapshot(): MidnightWalletInfo[] {
  const nextSnapshot = detectInstalledMidnightWallets()
  const nextKey = nextSnapshot
    .map(
      (wallet) =>
        `${wallet.id}:${wallet.name}:${wallet.icon}:${wallet.rdns}:${wallet.apiVersion}:${wallet.supportsConnect}:${wallet.supportsLegacyEnable}`,
    )
    .join("|")
  if (nextKey !== cachedMidnightWalletSnapshotKey) {
    cachedMidnightWalletSnapshot = nextSnapshot
    cachedMidnightWalletSnapshotKey = nextKey
  }
  return cachedMidnightWalletSnapshot
}
