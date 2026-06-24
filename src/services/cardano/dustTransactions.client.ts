"use client"

/**
 * Client-side DUST registration transaction builder using Lucid Evolution.
 * This module is browser-only and must never be imported in server components.
 */

import type { OutRef, WalletApi } from "@lucid-evolution/lucid"
import { DUST_CONTRACT, DUST_NFT_UNIT } from "./dustContract"

// Types

export type TxResult =
  | { success: true; txHash: string }
  | { success: false; error: string }

// Lucid factory (lazy-loaded, browser only)

async function buildLucid(walletApi: WalletApi) {
  const { Lucid, Koios } = await import("@lucid-evolution/lucid")
  const koiosUrl =
    process.env.NEXT_PUBLIC_CARDANO_KOIOS_URL ?? "https://api.koios.rest/api/v1"
  const lucid = await Lucid(new Koios(koiosUrl), "Mainnet")
  lucid.selectWallet.fromAPI(walletApi)
  return lucid
}

// Contract script

const REGISTRATION_SCRIPT = {
  type: "PlutusV3" as const,
  script: DUST_CONTRACT.scriptCbor,
}

// Deregistration

/**
 * Builds, signs, and submits a deregistration transaction.
 *
 * Spends the registration UTxO at the DUST script address and burns the
 * registration NFT. After this transaction is confirmed, DUST generation
 * stops. The Midnight indexer may take hours to reflect the change.
 *
 * @param walletApi   The CIP-30 enabled wallet API (from ConnectedWallet.rawApi)
 * @param paymentKeyHash  28-byte hex payment key hash registered as c_wallet.
 *   The script's check_auth requires this key in the transaction's
 *   extra_signatories (required_signers), so it must be declared explicitly.
 * @param registrationOutRef  The UTxO holding the registration NFT at the script
 */
export async function deregisterDust(
  walletApi: WalletApi,
  paymentKeyHash: string,
  registrationOutRef: OutRef,
): Promise<TxResult> {
  if (paymentKeyHash.length !== 56) {
    return {
      success: false,
      error: `Invalid payment key hash length: ${paymentKeyHash.length} chars (expected 56).`,
    }
  }

  try {
    const { Data, Constr } = await import("@lucid-evolution/lucid")
    const lucid = await buildLucid(walletApi)

    const [registrationUtxo] = await lucid.utxosByOutRef([registrationOutRef])

    if (!registrationUtxo) {
      return {
        success: false,
        error: "Registration UTxO not found on-chain. It may already be spent.",
      }
    }

    // Spend redeemer: Constr 0 [] = d87980
    const spendRedeemer = Data.to(new Constr(0, []))
    // Burn redeemer: Constr 1 [] = d87a80
    const burnRedeemer = Data.to(new Constr(1, []))

    const tx = await lucid
      .newTx()
      .collectFrom([registrationUtxo], spendRedeemer)
      .mintAssets({ [DUST_NFT_UNIT]: -1n }, burnRedeemer)
      .attach.SpendingValidator(REGISTRATION_SCRIPT)
      .attach.MintingPolicy(REGISTRATION_SCRIPT)
      // The validator runs check_auth(c_wallet, extra_signatories, withdrawals).
      // c_wallet is VerificationKey(paymentKeyHash), so this key must be a
      // required signer for it to appear in extra_signatories; without it the
      // script rejects the spend/burn.
      .addSignerKey(paymentKeyHash)
      .complete()

    const signedTx = await tx.sign.withWallet().complete()
    const txHash = await signedTx.submit()

    return { success: true, txHash }
  } catch (err) {
    return { success: false, error: formatError(err) }
  }
}

// Registration

/**
 * Builds, signs, and submits a registration transaction.
 *
 * Mints 1 registration NFT and creates the UTxO at the DUST script address
 * with the datum { c_wallet: VerificationKey(paymentKeyHash), dust_address }.
 *
 * @param walletApi        The CIP-30 enabled wallet API
 * @param paymentKeyHash   28-byte hex payment key hash (from ConnectedWallet)
 * @param dustAddressHex   33-byte hex Midnight DUST address (decoded from mn_dust1...)
 */
export async function registerDust(
  walletApi: WalletApi,
  paymentKeyHash: string,
  dustAddressHex: string,
): Promise<TxResult> {
  if (paymentKeyHash.length !== 56) {
    return {
      success: false,
      error: `Invalid payment key hash length: ${paymentKeyHash.length} chars (expected 56).`,
    }
  }

  if (dustAddressHex.length !== 66) {
    return {
      success: false,
      error: `Invalid Midnight address bytes: ${dustAddressHex.length} chars (expected 66 = 33 bytes).`,
    }
  }

  try {
    const { Data, Constr } = await import("@lucid-evolution/lucid")
    const lucid = await buildLucid(walletApi)

    // DustMappingDatum { c_wallet: VerificationKey(paymentKeyHash), dust_address }
    const datum = Data.to(
      new Constr(0, [new Constr(0, [paymentKeyHash]), dustAddressHex]),
    )

    // Mint redeemer: Constr 0 [] = d87980
    const mintRedeemer = Data.to(new Constr(0, []))

    const tx = await lucid
      .newTx()
      .mintAssets({ [DUST_NFT_UNIT]: 1n }, mintRedeemer)
      .pay.ToContract(
        DUST_CONTRACT.scriptAddress,
        { kind: "inline", value: datum },
        { lovelace: 2_000_000n, [DUST_NFT_UNIT]: 1n },
      )
      .attach.MintingPolicy(REGISTRATION_SCRIPT)
      .complete()

    const signedTx = await tx.sign.withWallet().complete()
    const txHash = await signedTx.submit()

    return { success: true, txHash }
  } catch (err) {
    return { success: false, error: formatError(err) }
  }
}

// Helpers

function formatError(err: unknown): string {
  if (err instanceof Error) {
    // Strip long CBOR hex from error messages
    return err.message.replace(/[0-9a-f]{40,}/gi, "[hex...]")
  }
  return String(err)
}
