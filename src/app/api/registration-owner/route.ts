import { z } from "zod"
import { KoiosCardanoChainProvider } from "@/services/cardano/KoiosCardanoChainProvider"
import { tryDecodeAnyBech32 } from "@/lib/bech32"

const requestSchema = z.object({
  dustAddress: z.string().min(10),
})

export type RegistrationOwnerResult =
  | {
      found: true
      stakeAddress: string | null
      paymentKeyHash: string | null
      txHash: string
      outputIndex: number
    }
  | { found: false; reason: string }

export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({
      found: false,
      reason: "Invalid request body.",
    } satisfies RegistrationOwnerResult)
  }

  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({
      found: false,
      reason: "Missing or invalid dustAddress.",
    } satisfies RegistrationOwnerResult)
  }

  const dustAddressHex = tryDecodeAnyBech32(parsed.data.dustAddress)
  if (!dustAddressHex) {
    return Response.json({
      found: false,
      reason:
        "Could not decode the Midnight DUST address. It may use an unsupported encoding.",
    } satisfies RegistrationOwnerResult)
  }

  try {
    const provider = new KoiosCardanoChainProvider()
    const result =
      await provider.findRegistrationOwnerForDustAddress(dustAddressHex)

    if (!result) {
      return Response.json({
        found: false,
        reason:
          "No registration UTxO was found at the script address for this Midnight DUST address. The registration may have been removed, or this address was never registered.",
      } satisfies RegistrationOwnerResult)
    }

    return Response.json({
      found: true,
      stakeAddress: result.stakeAddress,
      paymentKeyHash: result.paymentKeyHash,
      txHash: result.txHash,
      outputIndex: result.outputIndex,
    } satisfies RegistrationOwnerResult)
  } catch (error) {
    return Response.json({
      found: false,
      reason:
        error instanceof Error ? error.message : "The Cardano lookup failed.",
    } satisfies RegistrationOwnerResult)
  }
}
