import { z } from "zod"
import { KoiosCardanoChainProvider } from "@/services/cardano/KoiosCardanoChainProvider"
import { encodeBech32, hexToBytes } from "@/lib/bech32"

const requestSchema = z.object({
  paymentKeyHash: z
    .string()
    .length(56)
    .regex(/^[0-9a-f]+$/i),
})

export type ActiveRegistration = {
  txHash: string
  outputIndex: number
  /** Registered Midnight DUST address (mn_dust1…), or null if it could not be decoded. */
  dustAddress: string | null
  dustAddressHex: string | null
}

export type ActiveRegistrationsResult =
  | { ok: true; registrations: ActiveRegistration[] }
  | { ok: false; reason: string }

/** Midnight DUST address human-readable prefix (bech32 hrp). */
const DUST_ADDRESS_HRP = "mn_dust"

export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({
      ok: false,
      reason: "Invalid request body.",
    } satisfies ActiveRegistrationsResult)
  }

  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({
      ok: false,
      reason: "Missing or invalid paymentKeyHash.",
    } satisfies ActiveRegistrationsResult)
  }

  try {
    const provider = new KoiosCardanoChainProvider()
    const utxos = await provider.findAllRegistrationUtxosForPaymentKey(
      parsed.data.paymentKeyHash.toLowerCase(),
    )

    const registrations: ActiveRegistration[] = utxos.map((utxo) => ({
      txHash: utxo.txHash,
      outputIndex: utxo.outputIndex,
      dustAddressHex: utxo.dustAddressHex,
      dustAddress: encodeDustAddress(utxo.dustAddressHex),
    }))

    return Response.json({
      ok: true,
      registrations,
    } satisfies ActiveRegistrationsResult)
  } catch (error) {
    return Response.json({
      ok: false,
      reason:
        error instanceof Error ? error.message : "The Cardano lookup failed.",
    } satisfies ActiveRegistrationsResult)
  }
}

function encodeDustAddress(dustAddressHex: string | null): string | null {
  if (!dustAddressHex) return null
  try {
    return encodeBech32(DUST_ADDRESS_HRP, hexToBytes(dustAddressHex))
  } catch {
    return null
  }
}
