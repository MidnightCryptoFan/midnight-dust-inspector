// Standard bech32 encoder (BIP-0173) used by Cardano stake addresses.
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

function polymod(values: number[]): number {
  let chk = 1
  for (const v of values) {
    const top = chk >> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GENERATOR[i]!
    }
  }
  return chk
}

function hrpExpand(hrp: string): number[] {
  const result: number[] = []
  for (let i = 0; i < hrp.length; i++) result.push(hrp.charCodeAt(i) >> 5)
  result.push(0)
  for (let i = 0; i < hrp.length; i++) result.push(hrp.charCodeAt(i) & 31)
  return result
}

function createChecksum(hrp: string, data: number[]): number[] {
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]
  const mod = polymod(values) ^ 1
  return Array.from({ length: 6 }, (_, i) => (mod >> (5 * (5 - i))) & 31)
}

function convertBits(data: number[], from: number, to: number): number[] {
  let acc = 0
  let bits = 0
  const result: number[] = []
  const maxv = (1 << to) - 1
  for (const v of data) {
    acc = (acc << from) | v
    bits += from
    while (bits >= to) {
      bits -= to
      result.push((acc >> bits) & maxv)
    }
  }
  if (bits > 0) result.push((acc << (to - bits)) & maxv)
  return result
}

export function encodeBech32(hrp: string, bytes: number[]): string {
  const data = convertBits(bytes, 8, 5)
  const combined = [...data, ...createChecksum(hrp, data)]
  return hrp + "1" + combined.map((d) => CHARSET[d]).join("")
}

export function hexToBytes(hex: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16))
  }
  return bytes
}

export function bytesToHex(bytes: number[] | Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function unconvertBits(
  data: number[],
  from: number,
  to: number,
): number[] | null {
  let acc = 0
  let bits = 0
  const result: number[] = []
  const maxv = (1 << to) - 1
  for (const v of data) {
    if (v < 0 || v >> from !== 0) return null
    acc = (acc << from) | v
    bits += from
    while (bits >= to) {
      bits -= to
      result.push((acc >> bits) & maxv)
    }
  }
  if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) return null
  return result
}

export type Bech32Decoded = { hrp: string; bytes: number[] }

/**
 * Extracts the stake address from a Cardano base address (types 0–3).
 * Returns null for enterprise, script, pointer, or unrecognized addresses.
 *
 * Cardano base-address layout (per CIP-0019):
 *   byte 0  : header  — high nibble = address type, low nibble = network (1 = mainnet)
 *   bytes 1–28  : payment part (key hash or script hash)
 *   bytes 29–56 : staking part (key hash or script hash)
 *
 * Stake/reward address layout:
 *   byte 0  : 0xe1 (mainnet key) or 0xe0 (testnet key)
 *   bytes 1–28 : stake key hash
 */
export function extractStakeAddressFromCardanoAddress(
  address: string,
): string | null {
  const decoded = decodeBech32(address)
  if (!decoded) return null
  if (decoded.hrp !== "addr" && decoded.hrp !== "addr_test") return null

  const bytes = decoded.bytes
  if (bytes.length < 57) return null

  const headerByte = bytes[0]!
  const addrType = (headerByte >> 4) & 0xf
  const network = headerByte & 0xf

  // Only base addresses (types 0–3) carry a staking component
  if (addrType > 3) return null

  const stakeKeyHashBytes = bytes.slice(29, 57)
  const stakeHeaderByte = network === 1 ? 0xe1 : 0xe0
  const hrp = network === 1 ? "stake" : "stake_test"

  return encodeBech32(hrp, [stakeHeaderByte, ...stakeKeyHashBytes])
}

/** Decodes a bech32-encoded string. Returns null for invalid input. */
export function decodeBech32(str: string): Bech32Decoded | null {
  const lower = str.toLowerCase()
  const sepIdx = lower.lastIndexOf("1")
  if (sepIdx < 1 || sepIdx + 7 > lower.length) return null

  const hrp = lower.slice(0, sepIdx)
  const data: number[] = []
  for (let i = sepIdx + 1; i < lower.length; i++) {
    const idx = CHARSET.indexOf(lower[i]!)
    if (idx === -1) return null
    data.push(idx)
  }

  if (!verifyChecksum(hrp, data)) return null

  const converted = unconvertBits(data.slice(0, -6), 5, 8)
  if (!converted) return null

  return { hrp, bytes: converted }
}

function verifyChecksum(hrp: string, data: number[]): boolean {
  return polymod([...hrpExpand(hrp), ...data]) === 1
}

function verifyChecksumM(hrp: string, data: number[]): boolean {
  return polymod([...hrpExpand(hrp), ...data]) === 0x2bc830a3
}

/** Decodes a bech32m-encoded string (BIP-0350). Returns null for invalid input. */
export function decodeBech32m(str: string): Bech32Decoded | null {
  const lower = str.toLowerCase()
  const sepIdx = lower.lastIndexOf("1")
  if (sepIdx < 1 || sepIdx + 7 > lower.length) return null

  const hrp = lower.slice(0, sepIdx)
  const data: number[] = []
  for (let i = sepIdx + 1; i < lower.length; i++) {
    const idx = CHARSET.indexOf(lower[i]!)
    if (idx === -1) return null
    data.push(idx)
  }

  if (!verifyChecksumM(hrp, data)) return null

  const converted = unconvertBits(data.slice(0, -6), 5, 8)
  if (!converted) return null

  return { hrp, bytes: converted }
}

/**
 * Tries both bech32 and bech32m decoding.
 * Returns the raw payload bytes as a hex string, or null if both fail.
 */
export function tryDecodeAnyBech32(str: string): string | null {
  const standard = decodeBech32(str)
  if (standard) return bytesToHex(standard.bytes)

  const m = decodeBech32m(str)
  if (m) return bytesToHex(m.bytes)

  return null
}
