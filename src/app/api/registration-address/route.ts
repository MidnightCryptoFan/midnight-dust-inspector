import { z } from "zod"
import { KoiosCardanoChainProvider } from "@/services/cardano/KoiosCardanoChainProvider"

const requestSchema = z.object({
  txHash: z.string().min(1),
  outputIndex: z.number().int().min(0),
})

export type RegistrationAddressResult = {
  address: string | null
  error: string | null
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    return Response.json({ address: null, error: "Invalid request body." })
  }

  const parsed = requestSchema.safeParse(body)

  if (!parsed.success) {
    return Response.json({
      address: null,
      error: "Invalid txHash or outputIndex.",
    })
  }

  try {
    const provider = new KoiosCardanoChainProvider()
    const address = await provider.getTransactionOutputAddress(
      parsed.data.txHash,
      parsed.data.outputIndex,
    )
    return Response.json({
      address,
      error: null,
    } satisfies RegistrationAddressResult)
  } catch (error) {
    return Response.json({
      address: null,
      error: error instanceof Error ? error.message : "Lookup failed.",
    } satisfies RegistrationAddressResult)
  }
}
