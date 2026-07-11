"use client"

/**
 * Client-side Koios transport: rate-limited direct access with an automatic
 * server-proxy fallback.
 *
 * Every browser-side Koios request — our own timeline provider AND Lucid
 * Evolution's internal transaction-build calls (epoch_params, tx_info, …) —
 * goes through a global fetch wrapper scoped to the Koios host. Each request:
 *
 *   1. waits for a rate-limit slot (see koiosRateLimiter),
 *   2. is sent directly to Koios from the user's own IP,
 *   3. on a transport-level failure (fetch itself rejects: DNS failure,
 *      dropped connection, ad-blocker, firewall, VPN block) is retried once
 *      through this app's own /api/koios-proxy route, which reaches Koios
 *      from the server instead.
 *
 * After DIRECT_FAILURE_LIMIT transport failures the direct attempt is skipped
 * for the rest of the session — some networks can never reach Koios, and
 * paying a connection timeout on every single request would stall the
 * transaction build far beyond what a user waits out.
 *
 * Direct-first keeps each user's Koios traffic on their own IP so the
 * server's per-IP budget is not shared by every visitor; the proxy is a
 * fallback, not the default path.
 */

import { acquireKoiosSlot } from "./koiosRateLimiter"

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

const KOIOS_HOST_HINT = "koios.rest"
/** Path prefix every Koios REST endpoint lives under (also on custom hosts). */
const KOIOS_PATH_MARKER = "/api/v1/"
const PROXY_BASE_PATH = "/api/koios-proxy/"
/** Direct transport failures tolerated before going proxy-only for the session. */
const DIRECT_FAILURE_LIMIT = 3

let directTransportFailures = 0
let relayedRequests = 0

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.href
  return input.url
}

function isKoiosUrl(url: string): boolean {
  if (url.includes(KOIOS_HOST_HINT)) return true
  const configuredBase = process.env.NEXT_PUBLIC_CARDANO_KOIOS_URL
  return configuredBase != null && url.startsWith(configuredBase)
}

/**
 * Rewrites an absolute Koios URL to the app's proxy route, keeping the
 * endpoint path and the full query string. Returns null when the URL does not
 * contain the /api/v1/ marker (nothing sensible to relay).
 */
function proxyUrlFor(url: string): string | null {
  const idx = url.indexOf(KOIOS_PATH_MARKER)
  if (idx === -1) return null
  const suffix = url.slice(idx + KOIOS_PATH_MARKER.length)
  if (!suffix) return null
  return PROXY_BASE_PATH + suffix
}

async function relayThroughProxy(
  originalFetch: FetchLike,
  proxyUrl: string,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  relayedRequests += 1
  notifyTransport()
  if (input instanceof Request) {
    // Rebuild the request against the proxy URL field by field — the Request
    // constructor does not reliably copy method/body from another Request
    // passed as init. Reading the body from a clone keeps `input` replayable.
    const body =
      input.method === "GET" || input.method === "HEAD"
        ? undefined
        : await input.clone().arrayBuffer()
    return originalFetch(proxyUrl, {
      method: input.method,
      headers: input.headers,
      body,
    })
  }
  return originalFetch(proxyUrl, init)
}

/**
 * Wraps a fetch implementation with the Koios throttle and the direct→proxy
 * fallback. Exported separately from the installer so it can be unit-tested
 * without touching window.fetch.
 */
export function createKoiosTransportFetch(originalFetch: FetchLike): FetchLike {
  return async function koiosTransportFetch(input, init) {
    const url = requestUrl(input)
    if (!isKoiosUrl(url)) {
      return originalFetch(input, init)
    }

    // Throttle proxied calls too: they still land on Koios, just from the
    // server's IP, whose budget is shared across all fallback users.
    await acquireKoiosSlot()

    const proxyUrl = proxyUrlFor(url)
    if (!proxyUrl) {
      return originalFetch(input, init)
    }

    if (directTransportFailures >= DIRECT_FAILURE_LIMIT) {
      return relayThroughProxy(originalFetch, proxyUrl, input, init)
    }

    // A Request's body stream can only be read once, so the direct attempt
    // uses a clone and the original stays replayable for the proxy retry.
    const directInput = input instanceof Request ? input.clone() : input
    try {
      return await originalFetch(directInput, init)
    } catch (directError) {
      // Only fetch rejections land here (network-level failure). HTTP error
      // statuses resolve normally and are handled by the callers.
      directTransportFailures += 1
      notifyTransport()
      try {
        return await relayThroughProxy(originalFetch, proxyUrl, input, init)
      } catch {
        // The proxy failed too — surface the direct error, which names the
        // actual Koios endpoint instead of the proxy route.
        throw directError
      }
    }
  }
}

// --- Global installer ------------------------------------------------------

let installed = false

/**
 * Idempotently wraps the browser's global `fetch` with the Koios transport
 * (throttle + proxy fallback). Non-Koios requests pass through untouched.
 * No-op on the server.
 */
export function installKoiosBrowserTransport(): void {
  if (installed || typeof window === "undefined") return
  installed = true
  window.fetch = createKoiosTransportFetch(window.fetch.bind(window))
}

// --- Observable transport state (for the UI note) ---------------------------

export type KoiosTransportState = {
  /** True once at least one request was served through the server proxy. */
  usingServerRelay: boolean
  /** True once direct Koios access is skipped entirely for this session. */
  directDisabled: boolean
}

const listeners = new Set<() => void>()
let snapshot: KoiosTransportState = {
  usingServerRelay: false,
  directDisabled: false,
}

function notifyTransport() {
  const next: KoiosTransportState = {
    usingServerRelay: relayedRequests > 0,
    directDisabled: directTransportFailures >= DIRECT_FAILURE_LIMIT,
  }
  if (
    next.usingServerRelay !== snapshot.usingServerRelay ||
    next.directDisabled !== snapshot.directDisabled
  ) {
    snapshot = next
    for (const listener of listeners) listener()
  }
}

export function subscribeKoiosTransport(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getKoiosTransportSnapshot(): KoiosTransportState {
  return snapshot
}

const SERVER_SNAPSHOT: KoiosTransportState = {
  usingServerRelay: false,
  directDisabled: false,
}

export function getServerKoiosTransportSnapshot(): KoiosTransportState {
  return SERVER_SNAPSHOT
}

/** Test-only: clears failure counters and the observable snapshot. */
export function _resetKoiosTransportForTests(): void {
  directTransportFailures = 0
  relayedRequests = 0
  snapshot = { usingServerRelay: false, directDisabled: false }
}
