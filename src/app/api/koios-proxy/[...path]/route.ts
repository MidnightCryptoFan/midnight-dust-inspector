/**
 * Server-side Koios relay for browsers that cannot reach api.koios.rest
 * directly (ad-blockers, corporate firewalls, VPN/ISP blocks, flaky DNS).
 *
 * The client-side Koios transport (koiosTransport.client.ts) tries the user's
 * own connection first and only falls back to this route on transport-level
 * failures, so the server's per-IP Koios budget is not shared by every
 * visitor — only by those whose direct connection is broken.
 *
 * Strictly a pass-through to a fixed Koios base URL: only known endpoint
 * names are forwarded (single path segment, no traversal), only the headers
 * Koios needs are copied in either direction, and cookies never leave the
 * origin.
 */

// Koios can take tens of seconds per request when busy; don't let the
// platform default kill an in-flight transaction build.
export const maxDuration = 120

/**
 * Endpoints the browser legitimately calls: Lucid Evolution's Koios provider
 * (transaction building) plus our own timeline provider.
 */
const ALLOWED_ENDPOINTS = new Set([
  // Lucid Evolution's Koios provider
  "epoch_params",
  "address_info",
  "account_info",
  "datum_info",
  "tx_info",
  "submittx",
  "ogmios",
  "asset_addresses",
  "totals",
  // KoiosCardanoChainProvider (browser-side timeline scan)
  "account_txs",
  "tx_metadata",
  "account_assets",
  "account_addresses",
  "utxo_info",
  "address_utxos",
])

const FORWARDED_REQUEST_HEADERS = ["accept", "content-type", "prefer"]
const FORWARDED_RESPONSE_HEADERS = ["content-type", "content-range"]

/**
 * Endpoints whose data only changes once per epoch (~5 days), served from
 * Vercel's CDN cache so repeat calls never reach Koios. epoch_params is the
 * single most frequent call — Lucid fetches it on every transaction build.
 * One stale hour right at an epoch boundary is harmless: parameter values
 * rarely change between epochs at all.
 */
const EPOCH_STABLE_ENDPOINTS = new Set(["epoch_params", "totals"])
const EPOCH_STABLE_CACHE_CONTROL =
  "public, s-maxage=3600, stale-while-revalidate=86400"

type RouteContext = { params: Promise<{ path: string[] }> }

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return proxy(request, context, "GET")
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return proxy(request, context, "POST")
}

async function proxy(
  request: Request,
  context: RouteContext,
  method: "GET" | "POST",
): Promise<Response> {
  const { path } = await context.params

  // Every Koios REST endpoint is a single path segment; anything else
  // (sub-paths, traversal attempts) is rejected outright.
  const endpoint = path?.length === 1 ? path[0] : undefined
  if (!endpoint || !ALLOWED_ENDPOINTS.has(endpoint)) {
    return Response.json({ error: "Unknown Koios endpoint." }, { status: 404 })
  }

  const baseUrl =
    process.env.CARDANO_KOIOS_URL ?? "https://api.koios.rest/api/v1"
  const search = new URL(request.url).search
  const target = `${baseUrl}/${endpoint}${search}`

  const headers = new Headers()
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  const body = method === "POST" ? await request.arrayBuffer() : undefined

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body,
      cache: "no-store",
    })
  } catch {
    return Response.json(
      { error: "The server could not reach the Koios API." },
      { status: 502 },
    )
  }

  const responseHeaders = new Headers()
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) responseHeaders.set(name, value)
  }

  // Only successful GET responses for epoch-stable data are CDN-cacheable;
  // everything else (live chain state, errors) must stay fresh.
  if (method === "GET" && upstream.ok && EPOCH_STABLE_ENDPOINTS.has(endpoint)) {
    responseHeaders.set("cache-control", EPOCH_STABLE_CACHE_CONTROL)
  }

  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  })
}
