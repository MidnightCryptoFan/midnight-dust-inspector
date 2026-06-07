import { z } from "zod"
import { extractStakeAddressFromCardanoAddress } from "./bech32"

export type AddressValidationResult =
  | { valid: true; address: string; note?: string }
  | { valid: false; message: string }

export const stakeAddressSchema = z
  .string()
  .trim()
  .min(1, "Paste your Cardano stake address before checking.")
  .refine((value) => value.toLowerCase().startsWith("stake"), {
    message:
      "This does not look like a Cardano stake address. Stake addresses usually start with stake or stake_test.",
  })

export function validateStakeAddress(input: string): AddressValidationResult {
  const trimmed = input.trim()

  if (!trimmed) {
    return { valid: false, message: "Paste your Cardano stake address before checking." }
  }

  const lower = trimmed.toLowerCase()

  if (lower.startsWith("stake")) {
    return { valid: true, address: trimmed }
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
