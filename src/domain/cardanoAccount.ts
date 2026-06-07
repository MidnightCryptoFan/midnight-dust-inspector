import { formatCompactAtomicQuantity } from "@/lib/formatting"

export type VestingSchedule = {
  nextThawTimestampMs: number
  thawsCompleted: number
  intervalMs: number
}

export const DEFAULT_CARDANO_NIGHT_POLICY_ID =
  "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa"
export const DEFAULT_CARDANO_NIGHT_ASSET_NAME = "4e49474854"

export type CardanoAsset = {
  policyId: string
  assetName: string
  fingerprint: string | null
  decimals: number | null
  quantity: string
  displayName: string | null
  raw: unknown
}

export type CardanoUtxoAsset = CardanoAsset

export type CardanoUtxo = {
  txHash: string
  txIndex: number
  address: string
  stakeAddress: string | null
  blockTime: string | null
  blockHeight: number | null
  assetList: CardanoUtxoAsset[]
  raw: unknown
}

export type CardanoNightUtxo = {
  address: string
  txHash: string
  txIndex: number
  quantity: string
  decimals: number | null
  displayAmount: string | null
  blockTime: string | null
  blockHeight: number | null
  raw: unknown
}

export type CardanoAccountSnapshot = {
  stakeAddress: string
  assets: CardanoAsset[]
  nightAsset: CardanoAsset | null
  nightBalance: string | null
  nightBalanceDisplay: string | null
  nightUtxos: CardanoNightUtxo[]
  vestingSchedule: VestingSchedule | null
  source: "koios"
  checkedAt: string
  raw: unknown
}

export function buildCardanoAccountSnapshot(input: {
  stakeAddress: string
  assets: CardanoAsset[]
  utxos: CardanoUtxo[]
  checkedAt: string
  source: "koios"
}): CardanoAccountSnapshot {
  const nightAsset = findCardanoNightAsset(input.assets)

  return {
    stakeAddress: input.stakeAddress,
    assets: input.assets,
    nightAsset,
    nightBalance: nightAsset?.quantity ?? null,
    nightBalanceDisplay: nightAsset
      ? formatCardanoAssetQuantity(nightAsset)
      : null,
    nightUtxos: collectNightUtxos(input.utxos),
    vestingSchedule: extractVestingSchedule(input.utxos),
    source: input.source,
    checkedAt: input.checkedAt,
    raw: {
      assets: input.assets.map((asset) => asset.raw),
      utxos: input.utxos.map((utxo) => utxo.raw),
    },
  }
}

export function findCardanoNightAsset(
  assets: CardanoAsset[],
): CardanoAsset | null {
  return (
    assets.find(
      (asset) =>
        asset.policyId === getCardanoNightPolicyId() &&
        asset.assetName.toLowerCase() === getCardanoNightAssetName(),
    ) ?? null
  )
}

export function hasPositiveCardanoNightBalance(
  snapshot: CardanoAccountSnapshot | null | undefined,
): boolean {
  return isPositiveIntegerString(snapshot?.nightBalance)
}

export function formatCardanoNightBalance(
  snapshot: CardanoAccountSnapshot | null | undefined,
): string | null {
  if (!snapshot?.nightBalanceDisplay || !snapshot.nightBalance) {
    return null
  }

  try {
    const decimals = snapshot.nightAsset?.decimals ?? 0
    const atomicUnitsPerNight = decimals > 0 ? 10n ** BigInt(decimals) : 1n

    return `${formatCompactAtomicQuantity(
      BigInt(snapshot.nightBalance),
      atomicUnitsPerNight,
    )} NIGHT`
  } catch {
    return `${snapshot.nightBalanceDisplay} NIGHT`
  }
}

export function formatCardanoAssetQuantity(asset: {
  quantity: string
  decimals: number | null
}): string | null {
  try {
    const quantity = BigInt(asset.quantity)
    const decimals = asset.decimals ?? 0

    if (decimals <= 0) {
      return quantity.toString()
    }

    const divisor = 10n ** BigInt(decimals)
    const whole = quantity / divisor
    const fraction = quantity % divisor
    const fractionText = fraction.toString().padStart(decimals, "0")
    const trimmedFraction = fractionText.replace(/0+$/, "")

    return trimmedFraction.length > 0
      ? `${whole}.${trimmedFraction}`
      : whole.toString()
  } catch {
    return null
  }
}

function collectNightUtxos(utxos: CardanoUtxo[]): CardanoNightUtxo[] {
  return utxos.flatMap((utxo) =>
    utxo.assetList
      .filter(
        (asset) =>
          asset.policyId === getCardanoNightPolicyId() &&
          asset.assetName.toLowerCase() === getCardanoNightAssetName(),
      )
      .map((asset) => ({
        address: utxo.address,
        txHash: utxo.txHash,
        txIndex: utxo.txIndex,
        quantity: asset.quantity,
        decimals: asset.decimals,
        displayAmount: formatCardanoAssetQuantity(asset),
        blockTime: utxo.blockTime,
        blockHeight: utxo.blockHeight,
        raw: {
          utxo: utxo.raw,
          asset: asset.raw,
        },
      })),
  )
}

function getCardanoNightPolicyId(): string {
  return (
    process.env.CARDANO_NIGHT_POLICY_ID ?? DEFAULT_CARDANO_NIGHT_POLICY_ID
  ).toLowerCase()
}

function getCardanoNightAssetName(): string {
  return (
    process.env.CARDANO_NIGHT_ASSET_NAME ?? DEFAULT_CARDANO_NIGHT_ASSET_NAME
  ).toLowerCase()
}

function extractVestingSchedule(utxos: CardanoUtxo[]): VestingSchedule | null {
  const nightPolicyId = getCardanoNightPolicyId()
  const nightAssetName = getCardanoNightAssetName()

  for (const utxo of utxos) {
    const hasNight = utxo.assetList.some(
      (asset) =>
        asset.policyId === nightPolicyId &&
        asset.assetName.toLowerCase() === nightAssetName,
    )
    if (!hasNight) continue

    const raw = utxo.raw as { inline_datum?: { value?: unknown } } | null
    const schedule = parseVestingDatum(raw?.inline_datum?.value)
    if (schedule) return schedule
  }
  return null
}

function parseVestingDatum(value: unknown): VestingSchedule | null {
  try {
    if (!value || typeof value !== "object") return null
    const datum = value as { constructor?: number; fields?: unknown[] }
    if (datum.constructor !== 0 || !Array.isArray(datum.fields)) return null
    if (datum.fields.length < 5) return null

    const getInt = (field: unknown): number | null => {
      if (!field || typeof field !== "object") return null
      const f = field as { int?: unknown }
      return typeof f.int === "number" ? f.int : null
    }

    const amountPerThawAtomic = getInt(datum.fields[1])
    const nextThawTimestampMs = getInt(datum.fields[2])
    const thawsCompleted = getInt(datum.fields[3])
    const intervalMs = getInt(datum.fields[4])

    if (
      amountPerThawAtomic === null ||
      nextThawTimestampMs === null ||
      thawsCompleted === null ||
      intervalMs === null
    )
      return null

    return {
      nextThawTimestampMs,
      thawsCompleted,
      intervalMs,
    }
  } catch {
    return null
  }
}

function isPositiveIntegerString(value: string | null | undefined): boolean {
  if (!value) {
    return false
  }

  try {
    return BigInt(value) > 0n
  } catch {
    return false
  }
}
