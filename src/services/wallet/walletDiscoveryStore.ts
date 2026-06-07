export type BrowserWalletNamespace = "cardano" | "midnight"

const POLL_DELAYS_MS = [
  0, 50, 150, 300, 600, 1_000, 1_500, 2_500, 4_000, 6_000, 9_000, 12_000,
]

const DISCOVERY_EVENTS: Record<BrowserWalletNamespace, string[]> = {
  cardano: [
    "cardano-wallet-ready",
    "cardano#initialized",
    "cardano_wallets_initialized",
    "eternl#initialized",
    "lace#initialized",
    "nami#initialized",
    "vespr#initialized",
    "wallet-ready",
  ],
  midnight: [
    "midnight-wallet-ready",
    "midnight:announceProvider",
    "eip6963:announceProvider",
  ],
}

const REQUEST_EVENTS: Record<BrowserWalletNamespace, string[]> = {
  cardano: [],
  midnight: ["midnight:requestProvider", "eip6963:requestProvider"],
}

export function subscribeToBrowserWalletDiscovery(
  namespace: BrowserWalletNamespace,
  onStoreChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => undefined

  let disposed = false
  const timeoutIds: number[] = []

  const notify = () => {
    if (!disposed) onStoreChange()
  }

  const events = new Set([
    ...DISCOVERY_EVENTS[namespace],
    "focus",
    "pageshow",
    "visibilitychange",
  ])

  for (const eventName of events) {
    window.addEventListener(eventName, notify)
  }

  for (const delay of POLL_DELAYS_MS) {
    timeoutIds.push(
      window.setTimeout(() => {
        requestBrowserWalletDiscovery(namespace)
        notify()
      }, delay),
    )
  }

  const intervalId = window.setInterval(() => {
    requestBrowserWalletDiscovery(namespace)
    notify()
  }, 1_000)

  const stopPollingId = window.setTimeout(() => {
    window.clearInterval(intervalId)
  }, 15_000)

  requestBrowserWalletDiscovery(namespace)

  return () => {
    disposed = true
    for (const eventName of events) {
      window.removeEventListener(eventName, notify)
    }
    for (const timeoutId of timeoutIds) {
      window.clearTimeout(timeoutId)
    }
    window.clearInterval(intervalId)
    window.clearTimeout(stopPollingId)
  }
}

export function requestBrowserWalletDiscovery(
  namespace: BrowserWalletNamespace,
): void {
  if (typeof window === "undefined") return

  for (const eventName of REQUEST_EVENTS[namespace]) {
    try {
      window.dispatchEvent(new Event(eventName))
    } catch {
      // Wallet discovery should never break the inspector UI.
    }
  }
}
