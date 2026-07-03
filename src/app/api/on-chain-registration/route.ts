import { z } from "zod"
import type { OnChainRegistrationState } from "@/domain/onChainRegistration"
import { KoiosCardanoChainProvider } from "@/services/cardano/KoiosCardanoChainProvider"

// The paginated script scan can take well over a minute when Koios is slow;
// without this the serverless function is killed at the platform default.
export const maxDuration = 300

const utxoRequestSchema = z.object({
  utxoTxHash: z.string().min(1),
  utxoOutputIndex: z.number().int().min(0),
})

const paymentKeyHashSchema = z
  .string()
  .length(56)
  .regex(/^[0-9a-f]+$/i)

const accountRequestSchema = z
  .object({
    paymentKeyHash: paymentKeyHashSchema.optional(),
    paymentKeyHashes: z.array(paymentKeyHashSchema).max(200).optional(),
    stakeAddress: z
      .string()
      .regex(/^stake1[0-9a-z]+$/)
      .optional(),
  })
  .refine(
    (value) =>
      value.paymentKeyHash != null ||
      (value.paymentKeyHashes?.length ?? 0) > 0 ||
      value.stakeAddress != null,
  )

export type OnChainRegistrationResult = {
  state: OnChainRegistrationState
  /** Populated when the UTxO was discovered by scanning the script address. */
  foundUtxo?: { txHash: string; outputIndex: number }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    return Response.json({
      state: { kind: "unknown", error: "Invalid request body." },
    } satisfies OnChainRegistrationResult)
  }

  const provider = new KoiosCardanoChainProvider()

  // Variant A: check a specific UTxO by tx hash + output index
  const utxoParsed = utxoRequestSchema.safeParse(body)
  if (utxoParsed.success) {
    try {
      const spent = await provider.checkUtxoSpent(
        utxoParsed.data.utxoTxHash,
        utxoParsed.data.utxoOutputIndex,
      )
      return Response.json({
        state: spent
          ? { kind: "deregistration_pending" }
          : { kind: "registered_active" },
      } satisfies OnChainRegistrationResult)
    } catch (error) {
      return Response.json({
        state: {
          kind: "unknown",
          error: error instanceof Error ? error.message : "Lookup failed.",
        },
      } satisfies OnChainRegistrationResult)
    }
  }

  // Variant B: scan the registration script address for the whole account
  // (stake address and/or wallet payment key hashes). Matching only a single
  // payment key misses registrations made with a rotated change key.
  const accountParsed = accountRequestSchema.safeParse(body)
  if (accountParsed.success) {
    try {
      const found = await provider.findActiveRegistrationsForAccount({
        stakeAddress: accountParsed.data.stakeAddress ?? null,
        paymentKeyHashes: [
          ...(accountParsed.data.paymentKeyHash
            ? [accountParsed.data.paymentKeyHash]
            : []),
          ...(accountParsed.data.paymentKeyHashes ?? []),
        ],
      })
      const first = found[0]
      if (first) {
        return Response.json({
          state: { kind: "registered_active" },
          foundUtxo: { txHash: first.txHash, outputIndex: first.outputIndex },
        } satisfies OnChainRegistrationResult)
      } else {
        return Response.json({
          state: { kind: "deregistration_pending" },
        } satisfies OnChainRegistrationResult)
      }
    } catch (error) {
      return Response.json({
        state: {
          kind: "unknown",
          error:
            error instanceof Error ? error.message : "The script scan failed.",
        },
      } satisfies OnChainRegistrationResult)
    }
  }

  return Response.json({
    state: {
      kind: "unknown",
      error:
        "Invalid request: provide utxoTxHash+utxoOutputIndex, a stakeAddress, or paymentKeyHash(es).",
    },
  } satisfies OnChainRegistrationResult)
}
