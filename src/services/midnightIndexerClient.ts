import { z } from "zod"
import type {
  ControlledIndexerError,
  DustGenerationStatus,
  IndexerInspectionResult,
} from "@/domain/dustStatus"

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

const DEFAULT_BLOCKFROST_INDEXER_URL =
  "https://midnight-mainnet.blockfrost.io/api/v0"
const RETIRED_INDEXER_HOST = "indexer.mainnet.midnight.network"
const INDEXER_TIMEOUT_MS = 15_000

const DUST_GENERATION_STATUS_QUERY = `
query DustGenerationStatus($cardanoRewardAddresses: [CardanoRewardAddress!]!) {
  dustGenerationStatus(cardanoRewardAddresses: $cardanoRewardAddresses) {
    cardanoRewardAddress
    registered
    dustAddress
    nightBalance
    generationRate
    maxCapacity
    currentCapacity
    utxoTxHash
    utxoOutputIndex
  }
}
`

const nullableStringFieldSchema = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((value) => {
    if (value == null) {
      return null
    }

    return String(value)
  })

const dustGenerationStatusResponseSchema = z
  .object({
    cardanoRewardAddress: nullableStringFieldSchema,
    registered: z.boolean().nullable().optional().default(null),
    dustAddress: nullableStringFieldSchema,
    nightBalance: nullableStringFieldSchema,
    generationRate: nullableStringFieldSchema,
    maxCapacity: nullableStringFieldSchema,
    currentCapacity: nullableStringFieldSchema,
    utxoTxHash: nullableStringFieldSchema,
    utxoOutputIndex: nullableStringFieldSchema,
  })
  .passthrough()

const graphqlErrorSchema = z
  .object({
    message: z.string().optional(),
  })
  .passthrough()

const indexerResponseSchema = z
  .object({
    data: z
      .object({
        dustGenerationStatus: z
          .array(dustGenerationStatusResponseSchema)
          .nullable()
          .optional(),
      })
      .nullable()
      .optional(),
    errors: z.array(graphqlErrorSchema).optional(),
  })
  .passthrough()

export const mockIndexerScenarios = [
  { id: "healthy", label: "Healthy registration" },
  { id: "not-registered", label: "Not registered" },
  { id: "multiple-registrations", label: "Multiple registrations detected" },
  { id: "missing-dust-address", label: "Missing DUST address" },
  { id: "zero-generation-rate", label: "Zero generation rate" },
  { id: "zero-current-capacity", label: "Zero current capacity" },
  { id: "indexer-error", label: "Indexer error" },
] as const

export type MockIndexerScenario = (typeof mockIndexerScenarios)[number]["id"]

export function isMockIndexerEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USE_MOCK_INDEXER === "true"
}

export async function inspectDustGenerationStatus(
  stakeAddress: string,
  options?: {
    fetcher?: Fetcher
    mockScenario?: MockIndexerScenario
    checkedAt?: string
  },
): Promise<IndexerInspectionResult> {
  const checkedAt = options?.checkedAt ?? new Date().toISOString()

  if (isMockIndexerEnabled()) {
    return getMockIndexerResult(
      stakeAddress,
      options?.mockScenario ?? "healthy",
      checkedAt,
    )
  }

  const indexerConfiguration = resolveIndexerConfiguration()

  if (!indexerConfiguration.ok) {
    return createErrorResult({
      code: "CONFIGURATION_ERROR",
      message: indexerConfiguration.message,
      userMessage:
        "The free Midnight indexer connection is not configured yet.",
      technicalDetails: indexerConfiguration.technicalDetails,
      checkedAt,
      raw: null,
    })
  }

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), INDEXER_TIMEOUT_MS)

  try {
    const response = await (options?.fetcher ?? fetch)(
      indexerConfiguration.url,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...indexerConfiguration.headers,
        },
        body: JSON.stringify({
          query: DUST_GENERATION_STATUS_QUERY,
          variables: { cardanoRewardAddresses: [stakeAddress] },
        }),
        cache: "no-store",
        signal: abortController.signal,
      },
    )

    const rawResponse = await readResponseBody(response)

    if (!response.ok) {
      const endpointRetired = response.status === 410

      return createErrorResult({
        code: endpointRetired ? "CONFIGURATION_ERROR" : "HTTP_ERROR",
        message: `The indexer returned HTTP ${response.status}.`,
        userMessage: endpointRetired
          ? "The configured Midnight indexer endpoint has been retired."
          : "The Midnight indexer could not be reached successfully.",
        technicalDetails: endpointRetired
          ? [
              "The legacy Midnight mainnet indexer was retired.",
              "Configure MIDNIGHT_BLOCKFROST_PROJECT_ID for the free Blockfrost endpoint.",
            ]
          : [`HTTP status: ${response.status}`],
        checkedAt,
        raw: rawResponse,
      })
    }

    const parsedResponse = indexerResponseSchema.safeParse(rawResponse)

    if (!parsedResponse.success) {
      return createErrorResult({
        code: "SCHEMA_ERROR",
        message: "The indexer response was not in the expected format.",
        userMessage:
          "The indexer response could not be read safely by this version of the tool.",
        technicalDetails: parsedResponse.error.issues.map(
          (issue) => `${issue.path.join(".") || "response"}: ${issue.message}`,
        ),
        checkedAt,
        raw: rawResponse,
      })
    }

    const graphqlErrors = parsedResponse.data.errors ?? []

    if (graphqlErrors.length > 0) {
      return createErrorResult({
        code: "GRAPHQL_ERROR",
        message: graphqlErrors
          .map((error) => error.message ?? "The indexer returned an error.")
          .join(" "),
        userMessage: "The Midnight indexer returned an error for this address.",
        technicalDetails: graphqlErrors.map(
          (error, index) =>
            `GraphQL error ${index + 1}: ${
              error.message ?? "No message was provided."
            }`,
        ),
        checkedAt,
        raw: rawResponse,
      })
    }

    return {
      status: toDustGenerationStatus({
        stakeAddress,
        checkedAt,
        rawResponse,
        response: selectDustGenerationStatus(
          parsedResponse.data.data?.dustGenerationStatus,
          stakeAddress,
        ),
      }),
      rawResponse,
      controlledError: null,
    }
  } catch (error) {
    const requestTimedOut =
      error instanceof Error && error.name === "AbortError"

    return createErrorResult({
      code: "NETWORK_ERROR",
      message: requestTimedOut
        ? `The indexer request timed out after ${INDEXER_TIMEOUT_MS / 1000} seconds.`
        : error instanceof Error
          ? error.message
          : "The indexer request did not complete.",
      userMessage: requestTimedOut
        ? "The Midnight indexer did not respond in time."
        : "The Midnight indexer could not be reached.",
      technicalDetails: [
        requestTimedOut
          ? "The server stopped the indexer request after 15 seconds."
          : "The server could not complete the indexer request.",
      ],
      checkedAt,
      raw:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : error,
    })
  } finally {
    clearTimeout(timeout)
  }
}

type IndexerConfiguration =
  | {
      ok: true
      url: string
      headers: Record<string, string>
    }
  | {
      ok: false
      message: string
      technicalDetails: string[]
    }

function resolveIndexerConfiguration(): IndexerConfiguration {
  const configuredUrl = process.env.MIDNIGHT_INDEXER_URL?.trim()
  const projectId = process.env.MIDNIGHT_BLOCKFROST_PROJECT_ID?.trim()

  if (configuredUrl && !isRetiredIndexerUrl(configuredUrl)) {
    if (isBlockfrostUrl(configuredUrl) && !projectId) {
      return {
        ok: false,
        message: "MIDNIGHT_BLOCKFROST_PROJECT_ID is not configured.",
        technicalDetails: [
          "The configured Blockfrost endpoint requires a Midnight Mainnet project token.",
        ],
      }
    }

    return {
      ok: true,
      url: projectId
        ? appendBlockfrostProjectId(configuredUrl, projectId)
        : configuredUrl,
      headers: {},
    }
  }

  if (projectId) {
    return {
      ok: true,
      url: appendBlockfrostProjectId(DEFAULT_BLOCKFROST_INDEXER_URL, projectId),
      headers: {},
    }
  }

  return {
    ok: false,
    message: configuredUrl
      ? "The configured Midnight indexer endpoint has been retired."
      : "MIDNIGHT_BLOCKFROST_PROJECT_ID is not configured.",
    technicalDetails: [
      configuredUrl
        ? "Remove the retired MIDNIGHT_INDEXER_URL setting."
        : "No server-side Midnight indexer credential was found.",
      "Set MIDNIGHT_BLOCKFROST_PROJECT_ID to a free Blockfrost Midnight project token, or set MIDNIGHT_INDEXER_URL to your own GraphQL endpoint.",
    ],
  }
}

function isRetiredIndexerUrl(value: string): boolean {
  try {
    return new URL(value).hostname === RETIRED_INDEXER_HOST
  } catch {
    return false
  }
}

function isBlockfrostUrl(value: string): boolean {
  try {
    return new URL(value).hostname.endsWith(".blockfrost.io")
  } catch {
    return false
  }
}

function appendBlockfrostProjectId(value: string, projectId: string): string {
  const url = new URL(value)
  url.searchParams.set("project_id", projectId)
  return url.toString()
}

async function readResponseBody(response: Response): Promise<unknown> {
  const bodyText = await response.text()

  if (bodyText.trim().length === 0) {
    return null
  }

  try {
    return JSON.parse(bodyText) as unknown
  } catch {
    return bodyText
  }
}

function toDustGenerationStatus(input: {
  stakeAddress: string
  checkedAt: string
  rawResponse: unknown
  response: z.infer<typeof dustGenerationStatusResponseSchema> | null
}): DustGenerationStatus {
  return {
    stakeAddress: input.stakeAddress,
    registered: input.response?.registered ?? null,
    dustAddress: input.response?.dustAddress ?? null,
    nightBalance: input.response?.nightBalance ?? null,
    generationRate: input.response?.generationRate ?? null,
    maxCapacity: input.response?.maxCapacity ?? null,
    currentCapacity: input.response?.currentCapacity ?? null,
    utxoTxHash: input.response?.utxoTxHash ?? null,
    utxoOutputIndex: input.response?.utxoOutputIndex ?? null,
    raw: input.rawResponse,
    source: "midnight-indexer",
    checkedAt: input.checkedAt,
  }
}

function selectDustGenerationStatus(
  response:
    | z.infer<typeof dustGenerationStatusResponseSchema>[]
    | null
    | undefined,
  stakeAddress: string,
): z.infer<typeof dustGenerationStatusResponseSchema> | null {
  if (!response || response.length === 0) {
    return null
  }

  return (
    response.find(
      (status) =>
        status.cardanoRewardAddress?.toLowerCase() ===
        stakeAddress.toLowerCase(),
    ) ??
    response[0] ??
    null
  )
}

function createErrorResult(input: {
  code: ControlledIndexerError["code"]
  message: string
  userMessage: string
  technicalDetails: string[]
  checkedAt: string
  raw: unknown
}): IndexerInspectionResult {
  return {
    status: null,
    rawResponse: input.raw,
    controlledError: {
      code: input.code,
      message: input.message,
      userMessage: input.userMessage,
      technicalDetails: input.technicalDetails,
      raw: input.raw,
      checkedAt: input.checkedAt,
    },
  }
}

function getMockIndexerResult(
  stakeAddress: string,
  scenario: MockIndexerScenario,
  checkedAt: string,
): IndexerInspectionResult {
  if (scenario === "multiple-registrations") {
    const raw = {
      errors: [
        {
          message: "Multiple Registrations detected",
        },
      ],
    }

    return createErrorResult({
      code: "GRAPHQL_ERROR",
      message: "Multiple Registrations detected",
      userMessage: "The mock indexer found more than one registration.",
      technicalDetails: ["Mock response: multiple registrations detected."],
      checkedAt,
      raw,
    })
  }

  if (scenario === "indexer-error") {
    const raw = {
      error: "Mock indexer unavailable",
    }

    return createErrorResult({
      code: "NETWORK_ERROR",
      message: "Mock indexer unavailable.",
      userMessage: "The mock indexer could not be checked.",
      technicalDetails: ["Mock response: network or service error."],
      checkedAt,
      raw,
    })
  }

  const mockStatusByScenario: Record<
    Exclude<MockIndexerScenario, "multiple-registrations" | "indexer-error">,
    Omit<DustGenerationStatus, "stakeAddress" | "checkedAt" | "raw">
  > = {
    healthy: {
      registered: true,
      dustAddress: "dust1mockhealthyaddress000000000000000000000",
      nightBalance: "1250",
      generationRate: "5576091500000",
      maxCapacity: "100000000000000000",
      currentCapacity: "42000000000000000",
      utxoTxHash: "mock-registration-tx-hash",
      utxoOutputIndex: "0",
      source: "midnight-indexer",
    },
    "not-registered": {
      registered: false,
      dustAddress: null,
      nightBalance: "0",
      generationRate: null,
      maxCapacity: null,
      currentCapacity: null,
      utxoTxHash: null,
      utxoOutputIndex: null,
      source: "midnight-indexer",
    },
    "missing-dust-address": {
      registered: true,
      dustAddress: null,
      nightBalance: "1250",
      generationRate: "5576091500000",
      maxCapacity: "100000000000000000",
      currentCapacity: "42000000000000000",
      utxoTxHash: "mock-missing-dust-address-tx-hash",
      utxoOutputIndex: "0",
      source: "midnight-indexer",
    },
    "zero-generation-rate": {
      registered: true,
      dustAddress: "dust1mockzerorateaddress000000000000000000",
      nightBalance: "1250",
      generationRate: "0",
      maxCapacity: "0",
      currentCapacity: "42",
      utxoTxHash: null,
      utxoOutputIndex: null,
      source: "midnight-indexer",
    },
    "zero-current-capacity": {
      registered: true,
      dustAddress: "dust1mockzerocapacityaddress000000000000000",
      nightBalance: "1250",
      generationRate: "5576091500000",
      maxCapacity: "100000000000000000",
      currentCapacity: "0",
      utxoTxHash: "mock-zero-capacity-tx-hash",
      utxoOutputIndex: "0",
      source: "midnight-indexer",
    },
  }

  const raw = {
    data: {
      dustGenerationStatus: [
        {
          cardanoRewardAddress: stakeAddress,
          ...mockStatusByScenario[scenario],
        },
      ],
    },
  }

  return {
    status: {
      stakeAddress,
      checkedAt,
      raw,
      ...mockStatusByScenario[scenario],
    },
    rawResponse: raw,
    controlledError: null,
  }
}
