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

describe("tx_info collateral asset_list repair", () => {
  const TX_INFO_URL = "https://api.koios.rest/api/v1/tx_info"

  // Verbatim shape of the broken Koios mainnet response (July 2026): the
  // collateral fields carry asset_list as a STRING — either "[]" or a Haskell
  // Show dump — while regular outputs stay proper arrays.
  const HASKELL_ASSET_LIST =
    '[(PolicyID {policyID = ScriptHash "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa"},[("4e49474854",130672882)])]'

  const OUTPUT_ASSETS = [
    {
      policy_id: "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa",
      asset_name: "4e49474854",
      fingerprint: "asset1...",
      decimals: 6,
      quantity: "130672882",
    },
  ]

  function brokenTxInfoBody(collateralAssetList: unknown) {
    return JSON.stringify([
      {
        tx_hash: "6886ca46",
        outputs: [{ tx_index: 0, asset_list: OUTPUT_ASSETS }],
        collateral_output: {
          tx_hash: "6886ca46",
          tx_index: 2,
          asset_list: collateralAssetList,
        },
        collateral_inputs: [{ tx_hash: "aaaa", tx_index: 0, asset_list: "[]" }],
        reference_inputs: null,
      },
    ])
  }

  async function fetchParsed(body: string, url = TX_INFO_URL) {
    const inner = vi.fn(async () => okResponse(body))
    const transportFetch = createKoiosTransportFetch(inner)
    const response = await transportFetch(url)
    return (await response.json()) as Array<Record<string, unknown>>
  }

  beforeEach(() => {
    _resetKoiosTransportForTests()
  })

  it('replaces a string "[]" collateral asset_list with an empty array', async () => {
    const [tx] = await fetchParsed(brokenTxInfoBody("[]"))

    const collateralOutput = tx.collateral_output as Record<string, unknown>
    expect(collateralOutput.asset_list).toEqual([])
    const [collateralInput] = tx.collateral_inputs as Array<
      Record<string, unknown>
    >
    expect(collateralInput.asset_list).toEqual([])
    // Null sections stay null — Lucid's schema allows that.
    expect(tx.reference_inputs).toBeNull()
  })

  it("replaces a Haskell-Show collateral asset_list (not JSON.parse-able)", async () => {
    const [tx] = await fetchParsed(brokenTxInfoBody(HASKELL_ASSET_LIST))

    const collateralOutput = tx.collateral_output as Record<string, unknown>
    expect(collateralOutput.asset_list).toEqual([])
  })

  it("never touches the asset_list of regular outputs", async () => {
    const [tx] = await fetchParsed(brokenTxInfoBody("[]"))

    const [output] = tx.outputs as Array<Record<string, unknown>>
    expect(output.asset_list).toEqual(OUTPUT_ASSETS)
  })

  it("leaves a well-formed tx_info response byte-identical", async () => {
    const body = JSON.stringify([
      {
        tx_hash: "abc",
        outputs: [{ tx_index: 0, asset_list: [] }],
        collateral_output: { tx_index: 2, asset_list: [] },
      },
    ])
    const inner = vi.fn(async () => okResponse(body))
    const transportFetch = createKoiosTransportFetch(inner)

    const response = await transportFetch(TX_INFO_URL)

    expect(await response.text()).toBe(body)
  })

  it("repairs the response when it was served through the proxy fallback", async () => {
    const inner = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input)
      if (url.includes("koios.rest")) {
        throw new TypeError("Failed to fetch")
      }
      return okResponse(brokenTxInfoBody("[]"))
    })
    const transportFetch = createKoiosTransportFetch(inner)

    const response = await transportFetch(TX_INFO_URL)
    const [tx] = (await response.json()) as Array<Record<string, unknown>>

    const collateralOutput = tx.collateral_output as Record<string, unknown>
    expect(collateralOutput.asset_list).toEqual([])
  })

  it("does not rewrite other Koios endpoints", async () => {
    // A string asset_list on a non-tx_info endpoint must pass through: only
    // /tx_info is known to be safe to repair.
    const body = JSON.stringify([{ tx_hash: "abc", asset_list: "[]" }])
    const inner = vi.fn(async () => okResponse(body))
    const transportFetch = createKoiosTransportFetch(inner)

    const response = await transportFetch(
      "https://api.koios.rest/api/v1/address_utxos",
    )

    expect(await response.text()).toBe(body)
  })

  it("passes non-JSON and error responses through untouched", async () => {
    const html = "<html>rate limited</html>"
    const inner = vi.fn(async () => okResponse(html))
    const transportFetch = createKoiosTransportFetch(inner)
    expect(await (await transportFetch(TX_INFO_URL)).text()).toBe(html)

    const errorInner = vi.fn(async () => new Response("boom", { status: 500 }))
    const errorFetch = createKoiosTransportFetch(errorInner)
    const errorResponse = await errorFetch(TX_INFO_URL)
    expect(errorResponse.status).toBe(500)
    expect(await errorResponse.text()).toBe("boom")
  })

  it("keeps the content-type header on a repaired response", async () => {
    const inner = vi.fn(async () => okResponse(brokenTxInfoBody("[]")))
    const transportFetch = createKoiosTransportFetch(inner)

    const response = await transportFetch(TX_INFO_URL)

    expect(response.headers.get("content-type")).toBe("application/json")
  })

  // Verbatim shape of the second Koios breakage: plutus_contracts entries
  // with address/bytecode null (bytecode is only filled with _bytecode: true,
  // which Lucid never sends) and input.datum null — the schema demands
  // strings / an object there.
  const MALFORMED_PLUTUS_CONTRACT = {
    size: 3207,
    input: {
      datum: null,
      redeemer: {
        fee: "6340",
        unit: { mem: "78544", steps: "25069181" },
        datum: { hash: "923918e4", value: { fields: [], constructor: 0 } },
        purpose: "spend",
      },
    },
    address: null,
    bytecode: null,
    script_hash: "73e4aea31b5b51d9b0ca386196fc6a4c422f74c5aea011e4b8bdf4e5",
    spends_input: null,
    valid_contract: true,
  }

  it("nulls a plutus_contracts section that would fail Lucid's schema", async () => {
    const body = JSON.stringify([
      {
        tx_hash: "abc",
        outputs: [{ tx_index: 0, asset_list: [] }],
        plutus_contracts: [MALFORMED_PLUTUS_CONTRACT],
      },
    ])
    const [tx] = await fetchParsed(body)

    expect(tx.plutus_contracts).toBeNull()
  })

  it("keeps a well-formed plutus_contracts section untouched", async () => {
    const wellFormed = {
      ...MALFORMED_PLUTUS_CONTRACT,
      address: "addr1w9e7ft4rrdd4rkdseguxr9hudfxyytm5ckh2qy0yhz7lfeg9lvhq7",
      bytecode: "590c87590c84",
      input: {
        ...MALFORMED_PLUTUS_CONTRACT.input,
        datum: { hash: null, value: null },
      },
    }
    const body = JSON.stringify([
      {
        tx_hash: "abc",
        outputs: [{ tx_index: 0, asset_list: [] }],
        plutus_contracts: [wellFormed],
      },
    ])
    const [tx] = await fetchParsed(body)

    expect(tx.plutus_contracts).toEqual([wellFormed])
  })
})
