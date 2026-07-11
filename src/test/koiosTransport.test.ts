import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  _resetKoiosTransportForTests,
  createKoiosTransportFetch,
  getKoiosTransportSnapshot,
} from "@/services/cardano/koiosTransport.client"

const KOIOS_URL = "https://api.koios.rest/api/v1/epoch_params?limit=1"
const PROXY_URL = "/api/koios-proxy/epoch_params?limit=1"

function okResponse(body = "[]") {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

describe("createKoiosTransportFetch", () => {
  beforeEach(() => {
    _resetKoiosTransportForTests()
  })

  it("passes non-Koios requests through untouched", async () => {
    const inner = vi.fn(async () => okResponse())
    const transportFetch = createKoiosTransportFetch(inner)

    await transportFetch("https://example.com/data", { method: "GET" })

    expect(inner).toHaveBeenCalledTimes(1)
    expect(inner).toHaveBeenCalledWith("https://example.com/data", {
      method: "GET",
    })
    expect(getKoiosTransportSnapshot().usingServerRelay).toBe(false)
  })

  it("uses the direct connection when it works", async () => {
    const inner = vi.fn(async () => okResponse('[{"epoch_no":1}]'))
    const transportFetch = createKoiosTransportFetch(inner)

    const response = await transportFetch(KOIOS_URL)

    expect(inner).toHaveBeenCalledTimes(1)
    expect(inner).toHaveBeenCalledWith(KOIOS_URL, undefined)
    expect(await response.text()).toBe('[{"epoch_no":1}]')
    expect(getKoiosTransportSnapshot().usingServerRelay).toBe(false)
  })

  it("falls back to the server proxy when the direct fetch rejects", async () => {
    const inner = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input)
      if (url.includes("koios.rest")) {
        throw new TypeError("Failed to fetch")
      }
      return okResponse('[{"epoch_no":2}]')
    })
    const transportFetch = createKoiosTransportFetch(inner)

    const response = await transportFetch(KOIOS_URL)

    expect(inner).toHaveBeenCalledTimes(2)
    expect(inner).toHaveBeenNthCalledWith(1, KOIOS_URL, undefined)
    expect(inner).toHaveBeenNthCalledWith(2, PROXY_URL, undefined)
    expect(await response.text()).toBe('[{"epoch_no":2}]')
    expect(getKoiosTransportSnapshot().usingServerRelay).toBe(true)
  })

  it("keeps POST init (method and body) on the proxy retry", async () => {
    const inner = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input)
      if (url.includes("koios.rest")) {
        throw new TypeError("Failed to fetch")
      }
      return okResponse()
    })
    const transportFetch = createKoiosTransportFetch(inner)
    const init: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ _tx_hashes: ["abc"] }),
    }

    await transportFetch("https://api.koios.rest/api/v1/tx_info", init)

    expect(inner).toHaveBeenNthCalledWith(2, "/api/koios-proxy/tx_info", init)
  })

  it("preserves a Request object's method and body on the proxy retry", async () => {
    let relayedInit: RequestInit | undefined
    const inner = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof input === "string" && input.includes("/api/koios-proxy/")) {
          relayedInit = init
          return okResponse()
        }
        throw new TypeError("Failed to fetch")
      },
    )
    const transportFetch = createKoiosTransportFetch(inner)

    const request = new Request("https://api.koios.rest/api/v1/tx_info", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ _tx_hashes: ["abc"] }),
    })
    await transportFetch(request)

    expect(relayedInit).toBeDefined()
    expect(relayedInit!.method).toBe("POST")
    expect(new TextDecoder().decode(relayedInit!.body as ArrayBuffer)).toBe(
      JSON.stringify({ _tx_hashes: ["abc"] }),
    )
    expect(new Headers(relayedInit!.headers).get("content-type")).toBe(
      "application/json",
    )
  })

  it("skips the direct attempt for the session after repeated failures", async () => {
    const inner = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input)
      if (url.includes("koios.rest")) {
        throw new TypeError("Failed to fetch")
      }
      return okResponse()
    })
    const transportFetch = createKoiosTransportFetch(inner)

    // Three direct failures, each rescued by the proxy…
    for (let i = 0; i < 3; i++) {
      await transportFetch(KOIOS_URL)
    }
    expect(getKoiosTransportSnapshot().directDisabled).toBe(true)
    inner.mockClear()

    // …after which requests go straight to the proxy.
    await transportFetch(KOIOS_URL)
    expect(inner).toHaveBeenCalledTimes(1)
    expect(inner).toHaveBeenCalledWith(PROXY_URL, undefined)
  })

  it("surfaces the direct error when the proxy also fails", async () => {
    const inner = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input)
      if (url.includes("koios.rest")) {
        throw new TypeError("Transport error (direct)")
      }
      throw new TypeError("proxy down")
    })
    const transportFetch = createKoiosTransportFetch(inner)

    await expect(transportFetch(KOIOS_URL)).rejects.toThrow(
      "Transport error (direct)",
    )
  })
})
