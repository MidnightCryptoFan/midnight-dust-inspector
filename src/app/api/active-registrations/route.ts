import { z } from "zod"
import { KoiosCardanoChainProvider } from "@/services/cardano/KoiosCardanoChainProvider"
import { encodeBech32, hexToBytes } from "@/lib/bech32"

// The paginated script scan can take well over a minute when Koios is slow;
// without this the serverless function is killed at the platform default.
export const maxDuration = 300

const paymentKeyHashSchema = z
  .string()
  .length(56)
  .regex(/^[0-9a-f]+$/i)

const requestSchema = z
  .object({
    /** Legacy single-key form; still accepted. */
    paymentKeyHash: paymentKeyHashSchema.optional(),
    /** Every payment key hash the connected wallet reports. */
    paymentKeyHashes: z.array(paymentKeyHashSchema).max(200).optional(),
    /**
     * Bech32 stake address of the account. Enables account-wide discovery:
     * registrations whose datum key belongs to any address of the account,
     * plus registrations the account funded (even when the datum key never
     * appeared on-chain).
     */
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
    { message: "Provide a stake address or at least one payment key hash." },
  )

export type ActiveRegistration = {
  txHash: string
  outputIndex: number
  /** Registered Midnight DUST address (mn_dust1…), or null if it could not be decoded. */
  dustAddress: string | null
  dustAddressHex: string | null
  /** The c_wallet payment key hash recorded in the registration datum. */
  cWalletKeyHash: string
  /** True when c_wallet matches a payment key the connected wallet reported. */
  ownedByWallet: boolean
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
      reason:
        "Missing or invalid wallet identity: provide a stake address or payment key hashes.",
    } satisfies ActiveRegistrationsResult)
  }

  const paymentKeyHashes = [
    ...(parsed.data.paymentKeyHash ? [parsed.data.paymentKeyHash] : []),
    ...(parsed.data.paymentKeyHashes ?? []),
  ].map((key) => key.toLowerCase())

  try {
    const provider = new KoiosCardanoChainProvider()
    const found = await provider.findActiveRegistrationsForAccount({
      stakeAddress: parsed.data.stakeAddress ?? null,
      paymentKeyHashes,
    })

    const registrations: ActiveRegistration[] = found.map((utxo) => ({
      txHash: utxo.txHash,
      outputIndex: utxo.outputIndex,
      dustAddressHex: utxo.dustAddressHex,
      dustAddress: encodeDustAddress(utxo.dustAddressHex),
      cWalletKeyHash: utxo.cWalletKeyHash,
      ownedByWallet: utxo.ownedByWallet,
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
