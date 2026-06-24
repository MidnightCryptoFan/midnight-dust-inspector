/**
 * Parser for the DUST registration inline datum.
 *
 * Datum layout: DustMappingDatum { c_wallet: VerificationKey(keyHash), dust_address }
 *   d8799f          Constr 0, indefinite array (outer)
 *     d8799f 581c <28-byte key hash> ff   VerificationKey(keyHash)
 *     58 <len> <dust_address bytes>        byte string (Midnight address, <=33 bytes)
 *   ff
 *
 * Shared by the Koios script scan and the client-side transaction builder so
 * both agree on how a registration's c_wallet and DUST address are decoded.
 */
export type ParsedRegistrationDatum = {
  /** Lowercased 28-byte payment key hash (c_wallet). */
  paymentKeyHash: string
  /** Lowercased DUST address bytes (hex), or null if not the expected shape. */
  dustAddressHex: string | null
}

export function parseRegistrationDatum(
  datumHex: string,
): ParsedRegistrationDatum | null {
  const lower = datumHex.toLowerCase()
  // d8799f d8799f 581c <56 hex = 28 bytes> ff
  const keyMatch = lower.match(/d8799fd8799f581c([0-9a-f]{56})ff/)
  if (!keyMatch || keyMatch.index == null) {
    return null
  }

  const paymentKeyHash = keyMatch[1]!

  // Immediately after the inner constr: a CBOR byte string 0x58 <len> <bytes>.
  const afterKey = keyMatch.index + keyMatch[0].length
  let dustAddressHex: string | null = null
  if (lower.slice(afterKey, afterKey + 2) === "58") {
    const len = parseInt(lower.slice(afterKey + 2, afterKey + 4), 16)
    if (Number.isFinite(len) && len > 0) {
      const start = afterKey + 4
      const candidate = lower.slice(start, start + len * 2)
      if (candidate.length === len * 2) {
        dustAddressHex = candidate
      }
    }
  }

  return { paymentKeyHash, dustAddressHex }
}
