import { z } from "zod"
import { decodeBech32, extractStakeAddressFromCardanoAddress } from "./bech32"

export type AddressValidationResult =
  | { valid: true; address: string; note?: string }
  | { valid: false; message: string }

export const stakeAddressSchema = z
  .string()
  .trim()
  .min(1, "Paste your Cardano stake address before checking.")
  .refine((value) => parseStakeAddress(value) !== null, {
    message:
      "This does not look like a valid Cardano stake address. Stake addresses usually start with stake1 or stake_test1.",
  })
  .transform((value) => value.toLowerCase())

export function validateStakeAddress(input: string): AddressValidationResult {
  const trimmed = input.trim()

  if (!trimmed) {
    return {
      valid: false,
      message: "Paste your Cardano stake address before checking.",
    }
  }

  const lower = trimmed.toLowerCase()

  if (lower.startsWith("stake")) {
    const parsed = parseStakeAddress(trimmed)
    if (!parsed) {
      return {
        valid: false,
        message:
          "This does not look like a valid Cardano stake address. Check the address and paste the full stake1 or stake_test1 address.",
      }
    }

    return parsed.network === "testnet"
      ? {
          valid: true,
          address: parsed.address,
          note: "This is a testnet stake address. The default Midnight DUST Inspector endpoints are configured for mainnet.",
        }
      : { valid: true, address: parsed.address }
  }

  // If the user pasted a full Cardano base address, try to extract the stake key.
  if (lower.startsWith("addr")) {
    const extracted = extractStakeAddressFromCardanoAddress(trimmed)
    if (extracted) {
      return {
        valid: true,
        address: extracted,
        note: `Stake key extracted from the payment address you entered: ${extracted}`,
      }
    }
    return {
      valid: false,
      message:
        "This looks like a Cardano payment address, but the stake key could not be extracted. Enterprise and script addresses have no staking component. Please paste your stake address (starts with stake1) instead.",
    }
  }

  return {
    valid: false,
    message:
      "This does not look like a Cardano stake address. Stake addresses usually start with stake or stake_test.",
  }
}

function parseStakeAddress(
  input: string,
): { address: string; network: "mainnet" | "testnet" } | null {
  const trimmed = input.trim()
  const lower = trimmed.toLowerCase()
  const upper = trimmed.toUpperCase()

  if (trimmed !== lower && trimmed !== upper) {
    return null
  }

  const decoded = decodeBech32(lower)
  if (!decoded) return null
  if (decoded.hrp !== "stake" && decoded.hrp !== "stake_test") return null
  if (decoded.bytes.length !== 29) return null

  const header = decoded.bytes[0]!
  const addressType = (header & 0xf0) >> 4
  const networkId = header & 0x0f

  if (addressType !== 14 && addressType !== 15) return null
  if (decoded.hrp === "stake" && networkId !== 1) return null
  if (decoded.hrp === "stake_test" && networkId === 1) return null

  return {
    address: lower,
    network: decoded.hrp === "stake" ? "mainnet" : "testnet",
  }
}
