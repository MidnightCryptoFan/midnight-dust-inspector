"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import {
  getKoiosThrottleSnapshot,
  getServerKoiosThrottleSnapshot,
  subscribeKoiosThrottle,
} from "@/services/cardano/koiosRateLimiter"
import {
  getKoiosTransportSnapshot,
  getServerKoiosTransportSnapshot,
  subscribeKoiosTransport,
  type KoiosTransportState,
} from "@/services/cardano/koiosTransport.client"

/**
 * Live view of the Koios rate-limit wait state: `waiting` plus the number of
 * whole seconds until the next request slot frees up (ticks down locally so the
 * countdown stays smooth between store updates).
 */
export function useKoiosThrottle(): { waiting: boolean; secondsLeft: number } {
  const state = useSyncExternalStore(
    subscribeKoiosThrottle,
    getKoiosThrottleSnapshot,
    getServerKoiosThrottleSnapshot,
  )

  // Ticks a local clock while waiting so the derived countdown stays smooth
  // between store updates. setState only runs inside the interval callback.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!state.waiting) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [state.waiting])

  const secondsLeft = state.waiting
    ? Math.max(0, Math.ceil((state.nextSlotAt - now) / 1000))
    : 0

  return { waiting: state.waiting, secondsLeft }
}

/**
 * Inline "brief pause · resuming in Ns" note. Renders nothing unless the
 * rate limiter is currently holding requests back.
 */
export function KoiosThrottleNote({ className = "" }: { className?: string }) {
  const { waiting, secondsLeft } = useKoiosThrottle()
  if (!waiting) return null

  return (
    <span className={className}>
      brief pause · resuming in {Math.max(secondsLeft, 1)}s
    </span>
  )
}

/** Live view of the Koios transport state (direct vs. server relay). */
export function useKoiosTransport(): KoiosTransportState {
  return useSyncExternalStore(
    subscribeKoiosTransport,
    getKoiosTransportSnapshot,
    getServerKoiosTransportSnapshot,
  )
}

/**
 * Inline note shown once Koios requests are being relayed through the app's
 * server because the browser could not reach Koios directly. Renders nothing
 * while the direct connection works.
 */
export function KoiosTransportNote({ className = "" }: { className?: string }) {
  const { usingServerRelay } = useKoiosTransport()
  if (!usingServerRelay) return null

  return (
    <span className={className}>
      direct Cardano data connection unavailable · relaying via server
    </span>
  )
}
