"use client"

/**
 * Client-side DUST registration transaction builder using Lucid Evolution.
 * This module is browser-only and must never be imported in server components.
 */

import type { OutRef, WalletApi } from "@lucid-evolution/lucid"
import { DUST_CONTRACT, DUST_NFT_UNIT } from "./dustContract"
import { parseRegistrationDatum } from "@/lib/registrationDatum"

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
 * Builds, signs, and submits a single deregistration transaction that removes
 * one or more registrations at once.
 *
 * Each registration UTxO is spent from the DUST script address and its NFT is
 * burned in the same transaction (the contract restricts minting to +1 per tx
 * but does not restrict the burn quantity, so `-N` in one tx is valid). Doing
 * it in one transaction avoids chaining unconfirmed wallet inputs across
 * several back-to-back submissions.
 *
 * Before building, every referenced UTxO is verified to (a) still exist
 * unspent at the script address, (b) hold exactly the registration NFT, and
 * (c) carry an inline datum whose c_wallet equals `paymentKeyHash` — so a
 * stale or foreign UTxO is rejected up front instead of failing on-chain.
 *
 * @param walletApi   The CIP-30 enabled wallet API (from ConnectedWallet.rawApi)
 * @param paymentKeyHash  28-byte hex payment key hash registered as c_wallet.
 *   The script's check_auth requires this key in the transaction's
 *   extra_signatories (required_signers), so it must be declared explicitly.
 * @param registrationOutRefs  The registration UTxOs to remove (at least one).
 */
export async function deregisterDust(
  walletApi: WalletApi,
  paymentKeyHash: string,
  registrationOutRefs: OutRef[],
): Promise<TxResult> {
  if (paymentKeyHash.length !== 56) {
    return {
      success: false,
      error: `Invalid payment key hash length: ${paymentKeyHash.length} chars (expected 56).`,
    }
  }

  if (registrationOutRefs.length === 0) {
    return { success: false, error: "No registration UTxO was selected." }
  }

  try {
    const { Data, Constr } = await import("@lucid-evolution/lucid")
    const lucid = await buildLucid(walletApi)

    const utxos = await lucid.utxosByOutRef(registrationOutRefs)

    if (utxos.length !== registrationOutRefs.length) {
      return {
        success: false,
        error:
          "One or more registration UTxOs were not found on-chain. They may already be spent — run the check again.",
      }
    }

    const lowerKey = paymentKeyHash.toLowerCase()
    for (const utxo of utxos) {
      const ref = `${utxo.txHash}#${utxo.outputIndex}`

      if ((utxo.assets[DUST_NFT_UNIT] ?? 0n) < 1n) {
        return {
          success: false,
          error: `UTxO ${ref} does not hold the DUST registration NFT.`,
        }
      }

      const parsed = utxo.datum ? parseRegistrationDatum(utxo.datum) : null
      if (!parsed) {
        return {
          success: false,
          error: `UTxO ${ref} does not carry a readable registration datum.`,
        }
      }
      if (parsed.paymentKeyHash !== lowerKey) {
        return {
          success: false,
          error: `UTxO ${ref} is registered to a different wallet key and cannot be removed with this wallet.`,
        }
      }
    }

    // Spend redeemer: Constr 0 [] = d87980
    const spendRedeemer = Data.to(new Constr(0, []))
    // Burn redeemer: Constr 1 [] = d87a80
    const burnRedeemer = Data.to(new Constr(1, []))

    const tx = await lucid
      .newTx()
      .collectFrom(utxos, spendRedeemer)
      .mintAssets({ [DUST_NFT_UNIT]: BigInt(-utxos.length) }, burnRedeemer)
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
      // The minting policy also runs check_auth on the c_wallet recorded in the
      // datum, so the registering key must be an explicit required signer.
      .addSignerKey(paymentKeyHash)
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
