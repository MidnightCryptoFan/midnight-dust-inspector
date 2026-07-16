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

async function sendDirectWithProxyFallback(
  originalFetch: FetchLike,
  proxyUrl: string,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
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

/**
 * Wraps a fetch implementation with the Koios throttle, the direct→proxy
 * fallback, and the /tx_info response repair. Exported separately from the
 * installer so it can be unit-tested without touching window.fetch.
 */
export function createKoiosTransportFetch(originalFetch: FetchLike): FetchLike {
  const koiosTransportFetch: FetchLike = async (input, init) => {
    const url = requestUrl(input)
    if (!isKoiosUrl(url)) {
      return originalFetch(input, init)
    }

    // Throttle proxied calls too: they still land on Koios, just from the
    // server's IP, whose budget is shared across all fallback users.
    await acquireKoiosSlot()

    const proxyUrl = proxyUrlFor(url)
    const response = proxyUrl
      ? await sendDirectWithProxyFallback(originalFetch, proxyUrl, input, init)
      : await originalFetch(input, init)

    // The datum repair may need a follow-up /datum_info call; routing it
    // through this same transport keeps the throttle and proxy fallback.
    return isTxInfoUrl(url)
      ? normalizeTxInfoResponse(response, url, koiosTransportFetch)
      : response
  }
  return koiosTransportFetch
}

// --- /tx_info response repair ------------------------------------------------

/**
 * Koios mainnet currently (since ~July 2026) returns three malformed
 * sections in /tx_info that Lucid Evolution's strict Effect schema rejects:
 *
 * 1. `collateral_output.asset_list` is a raw STRING instead of an array:
 *    `"[]"` when empty, otherwise a Haskell Show dump of db-sync's
 *    multi_assets_descr column, e.g.
 *    `[(PolicyID {policyID = ScriptHash "…"},[("4e49474854",130672882)])]` —
 *    note: NOT JSON, so it cannot simply be JSON.parse()d.
 * 2. `plutus_contracts[]` entries carry `address: null`, `bytecode: null`
 *    (Koios only fills bytecode when `_bytecode: true` is requested, which
 *    Lucid never sends) and `input.datum: null`, where the schema demands
 *    strings / an object.
 * 3. `inline_datum` objects carry `bytes: null` (the decoded `value` is
 *    still present), where the schema demands a string — observed on the
 *    registration outputs themselves. /datum_info and /utxo_info still
 *    return the correct CBOR bytes for the same datums, so only the
 *    /tx_info query path is broken.
 *
 * Effect reports only the FIRST schema error, so these surface one at a
 * time. Every transaction that spends or mints through a Plutus script —
 * i.e. every DUST registration — trips them, and the whole transaction
 * build aborts with a ParseError. This hook repairs the response before
 * Lucid sees it.
 *
 * Lucid only ever consumes `outputs` from /tx_info (getUtxosByOutRef,
 * awaitTx), so everything else is dead data here and is repaired locally:
 * malformed string asset_lists become empty arrays, a malformed
 * plutus_contracts section and malformed dead-section inline_datum objects
 * become null (their schemas allow null) — all lossless.
 *
 * The `outputs` section is live data and is treated differently: a broken
 * output inline_datum is REFETCHED from /datum_info via the output's
 * datum_hash (the deregistration flow spends these UTxOs and needs the real
 * datum bytes). An output asset_list is never touched and an unrepairable
 * output datum is left broken: blanking either would corrupt transaction
 * building (hide the registration NFT or its datum), so those must keep
 * failing loudly.
 */
function isTxInfoUrl(url: string): boolean {
  return url.split(/[?#]/, 1)[0]!.endsWith("/tx_info")
}

/** Replaces a string-typed asset_list on one input/output entry. */
function repairStringAssetList(entry: unknown): boolean {
  if (entry === null || typeof entry !== "object") return false
  const io = entry as { asset_list?: unknown }
  if (typeof io.asset_list !== "string") return false
  io.asset_list = []
  return true
}

/**
 * True when a plutus_contracts entry would fail Lucid's schema (string
 * address/bytecode, object input.datum).
 */
function isMalformedPlutusContract(entry: unknown): boolean {
  if (entry === null || typeof entry !== "object") return true
  const contract = entry as {
    address?: unknown
    bytecode?: unknown
    input?: unknown
  }
  if (typeof contract.address !== "string") return true
  if (typeof contract.bytecode !== "string") return true
  const input = contract.input as { datum?: unknown } | null | undefined
  if (input === null || typeof input !== "object") return true
  return input.datum === null || typeof input.datum !== "object"
}

/** True when an inline_datum object would fail Lucid's schema. */
function isMalformedInlineDatum(inlineDatum: unknown): boolean {
  if (inlineDatum === null || typeof inlineDatum !== "object") return false
  const datum = inlineDatum as { bytes?: unknown; value?: unknown }
  return (
    typeof datum.bytes !== "string" ||
    datum.value === null ||
    typeof datum.value !== "object"
  )
}

/** Nulls a malformed inline_datum on a dead-section entry, in place. */
function repairDeadInlineDatum(entry: unknown): boolean {
  if (entry === null || typeof entry !== "object") return false
  const io = entry as { inline_datum?: unknown }
  if (!isMalformedInlineDatum(io.inline_datum)) return false
  io.inline_datum = null
  return true
}

/** Repairs the dead (never consumed) sections of a /tx_info payload, in place. */
function repairTxInfoPayload(payload: unknown): boolean {
  if (!Array.isArray(payload)) return false
  let changed = false
  for (const tx of payload) {
    if (tx === null || typeof tx !== "object") continue
    const record = tx as Record<string, unknown>
    changed = repairStringAssetList(record.collateral_output) || changed
    changed = repairDeadInlineDatum(record.collateral_output) || changed
    for (const key of ["collateral_inputs", "reference_inputs", "inputs"]) {
      const list = record[key]
      if (!Array.isArray(list)) continue
      for (const entry of list) {
        // inputs' asset_list is deliberately excluded: the timeline consumers
        // read it, so a malformed one there must keep failing loudly.
        if (key !== "inputs") {
          changed = repairStringAssetList(entry) || changed
        }
        changed = repairDeadInlineDatum(entry) || changed
      }
    }
    const contracts = record.plutus_contracts
    if (Array.isArray(contracts) && contracts.some(isMalformedPlutusContract)) {
      record.plutus_contracts = null
      changed = true
    }
  }
  return changed
}

type BrokenOutputDatum = {
  inlineDatum: { bytes?: unknown; value?: unknown }
  datumHash: string
}

/**
 * Finds outputs whose inline_datum would fail Lucid's schema but whose
 * datum_hash allows the real bytes to be refetched from /datum_info.
 */
function collectBrokenOutputDatums(payload: unknown): BrokenOutputDatum[] {
  const broken: BrokenOutputDatum[] = []
  if (!Array.isArray(payload)) return broken
  for (const tx of payload) {
    if (tx === null || typeof tx !== "object") continue
    const outputs = (tx as Record<string, unknown>).outputs
    if (!Array.isArray(outputs)) continue
    for (const output of outputs) {
      if (output === null || typeof output !== "object") continue
      const record = output as { inline_datum?: unknown; datum_hash?: unknown }
      if (!isMalformedInlineDatum(record.inline_datum)) continue
      if (typeof record.datum_hash !== "string") continue
      broken.push({
        inlineDatum: record.inline_datum as {
          bytes?: unknown
          value?: unknown
        },
        datumHash: record.datum_hash,
      })
    }
  }
  return broken
}

/**
 * Refetches the real datum bytes from /datum_info and patches the broken
 * output datums in place. Anything that cannot be repaired stays broken on
 * purpose — the schema error downstream is better than silently spending a
 * script UTxO with fabricated datum data.
 */
async function repairOutputDatums(
  broken: BrokenOutputDatum[],
  txInfoUrl: string,
  transportFetch: FetchLike,
): Promise<boolean> {
  const base = txInfoUrl.split(/[?#]/, 1)[0]!
  const datumInfoUrl = base.slice(0, -"/tx_info".length) + "/datum_info"
  const hashes = [...new Set(broken.map((entry) => entry.datumHash))]

  try {
    const response = await transportFetch(datumInfoUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ _datum_hashes: hashes }),
    })
    if (!response.ok) return false
    const rows: unknown = await response.json()
    if (!Array.isArray(rows)) return false

    const byHash = new Map<string, { bytes: string; value: unknown }>()
    for (const row of rows) {
      if (row === null || typeof row !== "object") continue
      const datum = row as {
        datum_hash?: unknown
        bytes?: unknown
        value?: unknown
      }
      if (
        typeof datum.datum_hash === "string" &&
        typeof datum.bytes === "string"
      ) {
        byHash.set(datum.datum_hash, {
          bytes: datum.bytes,
          value: datum.value,
        })
      }
    }

    let changed = false
    for (const entry of broken) {
      const lookup = byHash.get(entry.datumHash)
      if (!lookup) continue
      if (typeof entry.inlineDatum.bytes !== "string") {
        entry.inlineDatum.bytes = lookup.bytes
      }
      if (
        entry.inlineDatum.value === null ||
        typeof entry.inlineDatum.value !== "object"
      ) {
        entry.inlineDatum.value = lookup.value
      }
      changed = true
    }
    return changed
  } catch {
    // The lookup itself failed — leave the payload as delivered.
    return false
  }
}

async function normalizeTxInfoResponse(
  response: Response,
  url: string,
  transportFetch: FetchLike,
): Promise<Response> {
  if (!response.ok) return response

  let payload: unknown
  try {
    payload = await response.clone().json()
  } catch {
    // Non-JSON body (e.g. an HTML error page) — leave it to the callers.
    return response
  }

  let changed = repairTxInfoPayload(payload)
  const brokenDatums = collectBrokenOutputDatums(payload)
  if (brokenDatums.length > 0) {
    changed =
      (await repairOutputDatums(brokenDatums, url, transportFetch)) || changed
  }

  if (!changed) return response

  // Content-length no longer matches the repaired body; everything else
  // (content-type in particular) must survive for the consumers.
  const headers = new Headers(response.headers)
  headers.delete("content-length")
  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
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
