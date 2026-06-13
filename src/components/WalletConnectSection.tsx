"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import {
  connectWallet,
  detectInstalledWallets,
  type ConnectedWallet,
  type WalletInfo,
} from "@/services/wallet/cip30"
import {
  requestBrowserWalletDiscovery,
  subscribeToBrowserWalletDiscovery,
} from "@/services/wallet/walletDiscoveryStore"
import { CopyButton } from "./CopyButton"

type WalletConnectSectionProps = {
  connected: ConnectedWallet | null
  onConnected: (wallet: ConnectedWallet) => void
  onDisconnected: () => void
  autoRefresh?: boolean
  onAutoRefreshToggle?: () => void
  /** Render without an outer border for embedding inside a wallet card. */
  embedded?: boolean
}

export function WalletConnectSection({
  connected,
  onConnected,
  onDisconnected,
  autoRefresh = false,
  onAutoRefreshToggle,
  embedded = false,
}: WalletConnectSectionProps) {
  const wallets = useSyncExternalStore(
    subscribeToWalletAvailability,
    getWalletSnapshot,
    getServerWalletSnapshot,
  )
  const [connecting, setConnecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDiscovering, setIsDiscovering] = useState(true)
  const [, forceDiscoveryRefresh] = useState(0)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setIsDiscovering(false)
    }, 3_000)

    return () => window.clearTimeout(timeoutId)
  }, [])

  async function handleConnect(walletId: string) {
    const walletPromise = connectWallet(walletId)

    setConnecting(walletId)
    setError(null)
    try {
      const wallet = await walletPromise
      onConnected(wallet)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed.")
    } finally {
      setConnecting(null)
    }
  }

  function handleScanAgain() {
    setIsDiscovering(true)
    requestBrowserWalletDiscovery("cardano")
    forceDiscoveryRefresh((value) => value + 1)
    window.setTimeout(() => setIsDiscovering(false), 1_500)
  }

  if (connected) {
    const inner = (
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {connected.info.icon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              className="h-7 w-7 rounded-md object-contain"
              src={connected.info.icon}
            />
          ) : null}
          <div>
            <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">
              {connected.info.name}
            </p>
            <p className="mt-0.5 text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-slate-300">
              Cardano stake address
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs font-semibold text-blue-900 dark:text-blue-100">
                {connected.stakeAddress.slice(0, 20)}…
                {connected.stakeAddress.slice(-6)}
              </span>
              <CopyButton text={connected.stakeAddress} />
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Connected
            </span>
            <button
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              type="button"
              onClick={onDisconnected}
            >
              Disconnect
            </button>
          </div>
          {onAutoRefreshToggle && (
            <button
              type="button"
              onClick={onAutoRefreshToggle}
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
          )}
        </div>
      </div>
    )

    if (embedded) return inner
    return (
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/30">
        {inner}
      </div>
    )
  }

  const inner = (
    <div className="space-y-3">
      <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">
        Connect to check your NIGHT balance, registration status, and manage
        registrations without any third-party app.
      </p>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        You can inspect your status read-only. Registration actions require explicit wallet confirmation.
      </p>

      {wallets.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {wallets.map((wallet) => (
            <button
              className="flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-700 dark:hover:bg-blue-950/40"
              disabled={!!connecting}
              key={wallet.id}
              type="button"
              onClick={() => handleConnect(wallet.id)}
            >
              {wallet.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="h-5 w-5 rounded-sm object-contain"
                  src={wallet.icon}
                />
              ) : null}
              {connecting === wallet.id ? "Connecting..." : wallet.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          <p>
            {isDiscovering
              ? "Looking for installed Cardano wallets. Unlock the wallet extension if it is already open."
              : "No Cardano wallets detected. Unlock Eternl, Lace, or another CIP-30 wallet, then scan again."}
          </p>
          <button
            className="mt-3 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-700"
            type="button"
            onClick={handleScanAgain}
          >
            Scan again
          </button>
        </div>
      )}

      {error ? (
        <p className="text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  )

  if (embedded) return inner
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
      {inner}
    </div>
  )
}

// Store subscription.

function subscribeToWalletAvailability(onStoreChange: () => void): () => void {
  return subscribeToBrowserWalletDiscovery("cardano", onStoreChange)
}

const serverWalletSnapshot: WalletInfo[] = []
function getServerWalletSnapshot(): WalletInfo[] {
  return serverWalletSnapshot
}

let cachedWalletSnapshot: WalletInfo[] = []
let cachedWalletSnapshotKey = ""

function getWalletSnapshot(): WalletInfo[] {
  const nextSnapshot = detectInstalledWallets()
  const nextKey = nextSnapshot
    .map((wallet) => `${wallet.id}:${wallet.name}:${wallet.icon}`)
    .join("|")
  if (nextKey !== cachedWalletSnapshotKey) {
    cachedWalletSnapshot = nextSnapshot
    cachedWalletSnapshotKey = nextKey
  }
  return cachedWalletSnapshot
}
