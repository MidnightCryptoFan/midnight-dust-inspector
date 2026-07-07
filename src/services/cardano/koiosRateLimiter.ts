"use client"

/**
 * Client-side Koios rate limiter.
 *
 * Koios enforces 100 requests / 10 s per IP. The registration-timeline scan
 * fires up to ~200 tx_info/tx_metadata calls at once, and Lucid Evolution adds
 * a few more during transaction building — all from the user's own browser IP.
 * When the burst exceeds the limit Koios drops the connection, which Lucid
 * surfaces as an opaque "Transport error".
 *
 * This module funnels every browser-side Koios request through a sliding-window
 * throttle (a safety margin under the hard limit) so calls are spaced instead of
 * bursting. It also installs a global `fetch` wrapper scoped to the Koios host,
 * so both our own provider AND Lucid's internal calls (which take no custom
 * fetch) are covered by the same throttle.
 *
 * A small observable store exposes the wait state so the UI can show a
 * "resuming in Ns" countdown while requests are queued.
 */

const WINDOW_MS = 10_000
// Hard limit is 100/10s; stay under it to leave room for timing jitter and any
// un-throttled calls (e.g. wallet submit endpoints).
const MAX_IN_WINDOW = 90
const KOIOS_HOST_HINT = "koios.rest"

// Timestamps (ms) of granted slots within the current window.
let grants: number[] = []
// FIFO of waiters blocked until a slot frees up.
const waiters: Array<() => void> = []
let pumpTimer: ReturnType<typeof setTimeout> | null = null

function prune(now: number) {
  const cutoff = now - WINDOW_MS
  if (grants.length && grants[0] <= cutoff) {
    grants = grants.filter((t) => t > cutoff)
  }
}

/** ms until the oldest grant leaves the window (0 if a slot is free now). */
function msUntilNextSlot(now: number): number {
  if (grants.length < MAX_IN_WINDOW) return 0
  return Math.max(0, grants[0] + WINDOW_MS - now)
}

function pump() {
  pumpTimer = null
  const now = Date.now()
  prune(now)

  while (waiters.length > 0 && grants.length < MAX_IN_WINDOW) {
    grants.push(Date.now())
    const resolve = waiters.shift()!
    resolve()
  }

  if (waiters.length > 0) {
    const wait = msUntilNextSlot(Date.now())
    if (pumpTimer === null) {
      pumpTimer = setTimeout(pump, Math.max(wait, 25))
    }
  }
  notify()
}

/** Resolves once a rate-limit slot is available for a Koios request. */
export function acquireKoiosSlot(): Promise<void> {
  return new Promise<void>((resolve) => {
    waiters.push(resolve)
    pump()
  })
}

// --- Observable wait state (for the UI countdown) -------------------------

export type KoiosThrottleState = {
  /** True while at least one request is queued behind the rate limit. */
  waiting: boolean
  /** Number of requests currently queued. */
  queued: number
  /** Wall-clock time (ms) when the next slot frees up, or 0 if free now. */
  nextSlotAt: number
}

const listeners = new Set<() => void>()
let snapshot: KoiosThrottleState = {
  waiting: false,
  queued: 0,
  nextSlotAt: 0,
}

function notify() {
  const now = Date.now()
  const waiting = waiters.length > 0
  const next: KoiosThrottleState = {
    waiting,
    queued: waiters.length,
    nextSlotAt: waiting ? now + msUntilNextSlot(now) : 0,
  }
  if (
    next.waiting !== snapshot.waiting ||
    next.queued !== snapshot.queued ||
    next.nextSlotAt !== snapshot.nextSlotAt
  ) {
    snapshot = next
    for (const l of listeners) l()
  }
}

export function subscribeKoiosThrottle(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getKoiosThrottleSnapshot(): KoiosThrottleState {
  return snapshot
}

export function getServerKoiosThrottleSnapshot(): KoiosThrottleState {
  return snapshot
}

// --- Global fetch wrapper (scoped to the Koios host) ----------------------

let installed = false

/**
 * Idempotently wraps the browser's global `fetch` so that any request to the
 * Koios host passes through the throttle first. Non-Koios requests are passed
 * straight through untouched. No-op on the server.
 */
export function installKoiosFetchThrottle(): void {
  if (installed || typeof window === "undefined") return
  installed = true

  const originalFetch = window.fetch.bind(window)

  window.fetch = async function throttledFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    let url: string
    if (typeof input === "string") url = input
    else if (input instanceof URL) url = input.href
    else url = input.url

    if (!url.includes(KOIOS_HOST_HINT)) {
      return originalFetch(input, init)
    }

    await acquireKoiosSlot()
    return originalFetch(input, init)
  }
}
