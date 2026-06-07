import { z } from "zod"
import type { OnChainRegistrationState } from "@/domain/onChainRegistration"
import { KoiosCardanoChainProvider } from "@/services/cardano/KoiosCardanoChainProvider"

const utxoRequestSchema = z.object({
  utxoTxHash: z.string().min(1),
  utxoOutputIndex: z.number().int().min(0),
})

const paymentKeyRequestSchema = z.object({
  paymentKeyHash: z
    .string()
    .length(56)
    .regex(/^[0-9a-f]+$/i),
})

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

  // Variant B: scan the registration script address by payment key hash
  const keyParsed = paymentKeyRequestSchema.safeParse(body)
  if (keyParsed.success) {
    try {
      const foundUtxo = await provider.findRegistrationUtxoForPaymentKey(
        keyParsed.data.paymentKeyHash,
      )
      if (foundUtxo) {
        return Response.json({
          state: { kind: "registered_active" },
          foundUtxo,
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
        "Invalid request: provide utxoTxHash+utxoOutputIndex or paymentKeyHash.",
    },
  } satisfies OnChainRegistrationResult)
}
