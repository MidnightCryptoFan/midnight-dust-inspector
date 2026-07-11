import { afterEach, describe, expect, it, vi } from "vitest"
import { GET, POST } from "@/app/api/koios-proxy/[...path]/route"

function context(path: string[]) {
  return { params: Promise.resolve({ path }) }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("koios proxy route", () => {
  it("forwards an allowed GET with its query string to the Koios base URL", async () => {
    const upstream = vi.fn<
      (input: string, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response('[{"epoch_no":1}]', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    )
    vi.stubGlobal("fetch", upstream)

    const response = await GET(
      new Request("http://localhost/api/koios-proxy/epoch_params?limit=1"),
      context(["epoch_params"]),
    )

    expect(upstream).toHaveBeenCalledTimes(1)
    const [target, init = {}] = upstream.mock.calls[0]!
    expect(target).toBe("https://api.koios.rest/api/v1/epoch_params?limit=1")
    expect(init.method).toBe("GET")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/json")
    expect(await response.text()).toBe('[{"epoch_no":1}]')
  })

  it("forwards an allowed POST body and passes content-range back", async () => {
    const upstream = vi.fn<
      (input: string, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response("[]", {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-range": "0-999/2431",
          },
        }),
    )
    vi.stubGlobal("fetch", upstream)

    const body = JSON.stringify({ _tx_hashes: ["abc"] })
    const response = await POST(
      new Request("http://localhost/api/koios-proxy/tx_info", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          prefer: "count=estimated",
        },
        body,
      }),
      context(["tx_info"]),
    )

    const [target, init = {}] = upstream.mock.calls[0]!
    expect(target).toBe("https://api.koios.rest/api/v1/tx_info")
    expect(init.method).toBe("POST")
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/json",
    )
    expect(new Headers(init.headers).get("prefer")).toBe("count=estimated")
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(body)
    expect(response.headers.get("content-range")).toBe("0-999/2431")
  })

  it("rejects endpoints that are not on the allowlist without calling Koios", async () => {
    const upstream = vi.fn()
    vi.stubGlobal("fetch", upstream)

    const response = await GET(
      new Request("http://localhost/api/koios-proxy/pool_list"),
      context(["pool_list"]),
    )

    expect(response.status).toBe(404)
    expect(upstream).not.toHaveBeenCalled()
  })

  it("rejects multi-segment paths without calling Koios", async () => {
    const upstream = vi.fn()
    vi.stubGlobal("fetch", upstream)

    const response = await GET(
      new Request("http://localhost/api/koios-proxy/tx_info/../secrets"),
      context(["tx_info", "..", "secrets"]),
    )

    expect(response.status).toBe(404)
    expect(upstream).not.toHaveBeenCalled()
  })

  it("returns 502 when the upstream request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed")
      }),
    )

    const response = await GET(
      new Request("http://localhost/api/koios-proxy/epoch_params?limit=1"),
      context(["epoch_params"]),
    )

    expect(response.status).toBe(502)
  })

  it("passes upstream error statuses through unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("rate limited", {
            status: 429,
            headers: { "content-type": "text/plain" },
          }),
      ),
    )

    const response = await GET(
      new Request("http://localhost/api/koios-proxy/epoch_params?limit=1"),
      context(["epoch_params"]),
    )

    expect(response.status).toBe(429)
    expect(await response.text()).toBe("rate limited")
  })
})
