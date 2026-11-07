import { z } from "zod"
import { KoiosCardanoChainProvider } from "@/services/cardano/KoiosCardanoChainProvider"
import { tryDecodeAnyBech32 } from "@/lib/bech32"
import { findStakeAddressesForDustAddress } from "@/services/midnightIndexerClient"

// The paginated script scan can take well over a minute when Koios is slow;
// without this the serverless function is killed at the platform default.
export const maxDuration = 300

const requestSchema = z.object({
  dustAddress: z.string().min(10),
})

export type RegistrationOwnerResult =
  | {
      found: true
      stakeAddress: string | null
      candidateStakeAddresses: string[]
      confidence:
        | "indexer_verified"
        | "credential_match"
        | "ambiguous"
        | "unresolved"
      paymentKeyHash: string | null
      txHash: string
      outputIndex: number
      registrationUtxos: Array<{
        txHash: string
        outputIndex: number
        paymentKeyHash: string
      }>
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

    const indexerMatch = await findStakeAddressesForDustAddress(
      result.candidateStakeAddresses,
      parsed.data.dustAddress,
    )
    const candidateStakeAddresses = Array.from(
      new Map(
        [...result.candidateStakeAddresses, ...indexerMatch.matches].map(
          (address) => [address.toLowerCase(), address],
        ),
      ).values(),
    )

    const hasAmbiguousIndexerMatches = indexerMatch.matches.length > 1
    const indexerVerifiedStakeAddress =
      indexerMatch.matches.length === 1 ? indexerMatch.matches[0] : null
    const stakeAddress = hasAmbiguousIndexerMatches
      ? null
      : (indexerVerifiedStakeAddress ?? result.stakeAddress)
    const confidence = hasAmbiguousIndexerMatches
      ? "ambiguous"
      : indexerVerifiedStakeAddress
        ? "indexer_verified"
        : result.stakeAddress
          ? "credential_match"
          : candidateStakeAddresses.length > 0
            ? "ambiguous"
            : "unresolved"

    return Response.json({
      found: true,
      stakeAddress,
      candidateStakeAddresses,
      confidence,
      paymentKeyHash: result.paymentKeyHash,
      txHash: result.txHash,
      outputIndex: result.outputIndex,
      registrationUtxos: result.registrationUtxos,
    } satisfies RegistrationOwnerResult)
  } catch (error) {
    return Response.json({
      found: false,
      reason:
        error instanceof Error ? error.message : "The Cardano lookup failed.",
    } satisfies RegistrationOwnerResult)
  }
}
