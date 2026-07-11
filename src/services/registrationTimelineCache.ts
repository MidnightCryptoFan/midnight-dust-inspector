import type { RegistrationTimelineInspectionResult } from "@/domain/registrationTimeline"
import { inspectRegistrationTimeline } from "./registrationTimelineClient"
import { inspectRegistrationTimelineFromApi } from "./registrationTimelineApiClient"
import { KoiosCardanoChainProvider } from "./cardano/KoiosCardanoChainProvider"
import { installKoiosBrowserTransport } from "./cardano/koiosTransport.client"

const CACHE_TTL_MS = 60_000
const INCREMENTAL_CHECK_COUNT = 5

type CacheEntry = {
  result: RegistrationTimelineInspectionResult
  knownTxHashes: Set<string>
  fetchedAt: number
}

// Module-level cache — persists across React re-renders within the same browser tab.
const cache = new Map<string, CacheEntry>()

/**
 * Fetches registration timeline data from Koios directly in the browser so
 * each user's own IP is used, avoiding shared server-side rate limits.
 *
 * Caching strategy:
 * - Within 60 s: return cached result immediately (no Koios call).
 * - After 60 s: fetch only the latest 5 transactions and compare with cache.
 *   - Nothing new → extend cache lifetime, return cached data.
 *   - New transactions found → full re-fetch (up to 100 txs + tx details).
 */
export async function inspectRegistrationTimelineCached(
  stakeAddress: string,
  options?: { onProgress?: (done: number, total: number) => void },
): Promise<RegistrationTimelineInspectionResult> {
  // Route all browser-side Koios calls (this scan + Lucid's later tx build)
  // through the shared transport: rate-limited so the burst can't trip
  // Koios's 100/10s cap, with a server-proxy fallback when the browser
  // cannot reach Koios directly.
  installKoiosBrowserTransport()

  const now = Date.now()
  const entry = cache.get(stakeAddress)

  if (entry && now - entry.fetchedAt < CACHE_TTL_MS) {
    return withCurrentTimestamp(entry.result)
  }

  if (entry) {
    try {
      const provider = new KoiosCardanoChainProvider()
      const recent = await provider.getTransactionsForStakeAddress(stakeAddress)
      const hasNew = recent
        .slice(0, INCREMENTAL_CHECK_COUNT)
        .some((tx) => !entry.knownTxHashes.has(tx.txHash))
      if (!hasNew) {
        cache.set(stakeAddress, { ...entry, fetchedAt: now })
        return withCurrentTimestamp(entry.result)
      }
    } catch {
      // Incremental check failed — fall through to full fetch.
    }
  }

  // Try direct browser fetch first (uses the user's own IP).
  // Fall back to the server API route if the client-side Koios call fails —
  // e.g. due to a browser firewall, corporate proxy, or transient CORS issue.
  let result = await inspectRegistrationTimeline(stakeAddress, {
    onProgress: options?.onProgress,
  })
  if (result.controlledError) {
    try {
      result = await inspectRegistrationTimelineFromApi(stakeAddress)
    } catch {
      // Fallback also failed — keep the original client-side error result.
    }
  }
  cache.set(stakeAddress, {
    result,
    knownTxHashes: new Set(
      result.timeline?.events.map((e) => e.txHash) ?? [],
    ),
    fetchedAt: now,
  })
  return result
}

function withCurrentTimestamp(
  result: RegistrationTimelineInspectionResult,
): RegistrationTimelineInspectionResult {
  const checkedAt = new Date().toISOString()
  return {
    ...result,
    timeline: result.timeline ? { ...result.timeline, checkedAt } : null,
    cardanoAccountSnapshot: result.cardanoAccountSnapshot
      ? { ...result.cardanoAccountSnapshot, checkedAt }
      : null,
  }
}
