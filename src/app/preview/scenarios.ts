import type { CardanoAccountSnapshot } from "@/domain/cardanoAccount"
import type { DustGenerationStatus } from "@/domain/dustStatus"
import type { OnChainRegistrationState } from "@/domain/onChainRegistration"
import type {
  RegistrationEvent,
  RegistrationTimeline,
} from "@/domain/registrationTimeline"

const MOCK_STAKE = "stake1u9previewmockaddress000000000000000000000000"
const MOCK_DUST = "dust1previewmockdustaddress000000000000000000"
const MOCK_NIGHT_POLICY = "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa"
const MOCK_NIGHT_ASSET = "4e49474854"
// Real vesting script address — has the correct address type byte for isScriptPaymentAddress
const VESTING_SCRIPT_ADDR =
  "addr1z9vcd07vpjluvr0v3hu8w9wvjhgrs9a2cwrtp6wn8ksrkw0npnw42w4dfnrm4fqg2dpmv99l2tuyhfn7un0uprc0df2s97hhdv"
const CHECKED_AT = "2026-06-08T12:00:00.000Z"

// ─── Shared helpers ───────────────────────────────────────────────────────────

function nightAsset(quantity: string) {
  return {
    policyId: MOCK_NIGHT_POLICY,
    assetName: MOCK_NIGHT_ASSET,
    fingerprint: "asset1mocknight",
    decimals: 6,
    quantity,
    displayName: "NIGHT",
    raw: {},
  }
}

function nightSnapshot(
  unlockedQty: string,
  lockedQty?: string,
  vestingThawMs?: number,
): CardanoAccountSnapshot {
  const totalQty = (
    BigInt(unlockedQty) + BigInt(lockedQty ?? "0")
  ).toString()

  const lockedUtxo = lockedQty
    ? [
        {
          address: VESTING_SCRIPT_ADDR,
          txHash: "mock-vesting-utxo-tx",
          txIndex: 0,
          quantity: lockedQty,
          decimals: 6,
          displayAmount: formatNight(lockedQty),
          blockTime: "2026-03-01T00:00:00.000Z",
          blockHeight: 10000000,
          raw: {},
        },
      ]
    : []

  const unlockedUtxo = [
    {
      address: "addr1qymockpreviewaddress000000000000000000000000000000000000000",
      txHash: "mock-night-utxo-tx",
      txIndex: 0,
      quantity: unlockedQty,
      decimals: 6,
      displayAmount: formatNight(unlockedQty),
      blockTime: "2026-06-01T00:00:00.000Z",
      blockHeight: 10500000,
      raw: {},
    },
  ]

  const asset = nightAsset(totalQty)

  return {
    stakeAddress: MOCK_STAKE,
    assets: [asset],
    nightAsset: asset,
    nightBalance: totalQty,
    nightBalanceDisplay: formatNight(totalQty),
    nightUtxos: [...unlockedUtxo, ...lockedUtxo],
    vestingSchedule:
      lockedQty && vestingThawMs !== undefined
        ? {
            nextThawTimestampMs: vestingThawMs,
            thawsCompleted: 2,
            intervalMs: 7_776_000_000,
          }
        : null,
    source: "koios",
    checkedAt: CHECKED_AT,
    raw: {},
  }
}

function indexerStatus(
  overrides: Partial<DustGenerationStatus>,
): DustGenerationStatus {
  return {
    stakeAddress: MOCK_STAKE,
    registered: false,
    dustAddress: null,
    nightBalance: null,
    generationRate: null,
    maxCapacity: null,
    currentCapacity: null,
    utxoTxHash: null,
    utxoOutputIndex: null,
    raw: {},
    source: "midnight-indexer",
    checkedAt: CHECKED_AT,
    ...overrides,
  }
}

function registrationEvent(
  type: RegistrationEvent["type"],
  daysAgo: number,
  overrides?: Partial<RegistrationEvent>,
): RegistrationEvent {
  const d = new Date(CHECKED_AT)
  d.setDate(d.getDate() - daysAgo)
  return {
    type,
    txHash: `mock-tx-${type}-${daysAgo}`,
    blockTime: d.toISOString(),
    stakeAddress: MOCK_STAKE,
    dustAddress: type === "registration_created" ? MOCK_DUST : null,
    blockHeight: 10500000 - daysAgo * 720,
    confidence: "high",
    summary:
      type === "registration_created"
        ? "DUST registration created"
        : "DUST registration removed",
    technicalDetails: [],
    raw: {},
    ...overrides,
  }
}

function timeline(events: RegistrationEvent[]): RegistrationTimeline {
  return {
    stakeAddress: MOCK_STAKE,
    events: [...events].reverse(),
    activeRegistrationCount: events.filter((e) => e.type === "registration_created").length,
    checkedAt: CHECKED_AT,
    source: "koios",
    scannedTransactionCount: 25,
    note: "",
  }
}

function formatNight(qty: string): string {
  try {
    const n = BigInt(qty)
    const whole = n / 1_000_000n
    const frac = (n % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "")
    return frac ? `${whole}.${frac}` : whole.toString()
  } catch {
    return qty
  }
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

export type PreviewScenario = {
  id: string
  title: string
  description: string
  snapshot: CardanoAccountSnapshot | null
  indexerStatus: DustGenerationStatus | null
  onChainState: OnChainRegistrationState | null
  isOnChainLoading: boolean
  dustGrowthStatus: "unchecked" | "checking" | "growing" | "stable"
  timeline: RegistrationTimeline | null
  recentActivity: RegistrationEvent | null
}

export const previewScenarios: PreviewScenario[] = [
  {
    id: "not-registered-no-night",
    title: "Not registered — no NIGHT",
    description: "Wallet has no NIGHT and has never registered.",
    snapshot: null,
    indexerStatus: indexerStatus({ registered: false, nightBalance: "0" }),
    onChainState: { kind: "not_registered" },
    isOnChainLoading: false,
    dustGrowthStatus: "stable",
    timeline: null,
    recentActivity: null,
  },
  {
    id: "not-registered-with-night",
    title: "Not registered — NIGHT available",
    description: "Wallet holds NIGHT but has not yet registered for DUST generation.",
    snapshot: nightSnapshot("50000000000"),
    indexerStatus: indexerStatus({ registered: false, nightBalance: "50000000000" }),
    onChainState: { kind: "not_registered" },
    isOnChainLoading: false,
    dustGrowthStatus: "stable",
    timeline: null,
    recentActivity: null,
  },
  {
    id: "registered-growing",
    title: "Registered — DUST growing",
    description: "Healthy state. NIGHT is registered, DUST is actively generating.",
    snapshot: nightSnapshot("94114390552"),
    indexerStatus: indexerStatus({
      registered: true,
      dustAddress: MOCK_DUST,
      nightBalance: "94114390552",
      generationRate: "1.25",
      maxCapacity: "100",
      currentCapacity: "42",
      utxoTxHash: "mock-registration-tx-hash",
      utxoOutputIndex: "0",
    }),
    onChainState: { kind: "registered_active" },
    isOnChainLoading: false,
    dustGrowthStatus: "growing",
    timeline: timeline([registrationEvent("registration_created", 14)]),
    recentActivity: registrationEvent("registration_created", 14),
  },
  {
    id: "registered-cap-full",
    title: "Registered — DUST cap reached",
    description: "Registration active but DUST capacity is at zero. No new DUST is being generated.",
    snapshot: nightSnapshot("94114390552"),
    indexerStatus: indexerStatus({
      registered: true,
      dustAddress: MOCK_DUST,
      nightBalance: "94114390552",
      generationRate: "1.25",
      maxCapacity: "100",
      currentCapacity: "0",
      utxoTxHash: "mock-registration-tx-hash",
      utxoOutputIndex: "0",
    }),
    onChainState: { kind: "registered_active" },
    isOnChainLoading: false,
    dustGrowthStatus: "stable",
    timeline: timeline([registrationEvent("registration_created", 30)]),
    recentActivity: registrationEvent("registration_created", 30),
  },
  {
    id: "deregistration-pending",
    title: "Deregistration pending",
    description: "UTxO is already spent on-chain but the indexer hasn't caught up yet.",
    snapshot: nightSnapshot("94114390552"),
    indexerStatus: indexerStatus({
      registered: true,
      dustAddress: MOCK_DUST,
      nightBalance: "94114390552",
      generationRate: "1.25",
      maxCapacity: "100",
      currentCapacity: "10",
      utxoTxHash: "mock-spent-utxo-tx-hash",
      utxoOutputIndex: "0",
    }),
    onChainState: { kind: "deregistration_pending" },
    isOnChainLoading: false,
    dustGrowthStatus: "stable",
    timeline: timeline([
      registrationEvent("registration_created", 60),
      registrationEvent("registration_removed", 1),
    ]),
    recentActivity: registrationEvent("registration_removed", 1),
  },
  {
    id: "vesting-countdown",
    title: "Airdrop Vesting — countdown",
    description: "Locked NIGHT from airdrop vesting. Next thaw is in the future.",
    snapshot: nightSnapshot(
      "88359765449",
      "5754625102",
      Date.now() + 35 * 24 * 60 * 60 * 1000,
    ),
    indexerStatus: indexerStatus({
      registered: true,
      dustAddress: MOCK_DUST,
      nightBalance: "88359765449",
      generationRate: "1.25",
      maxCapacity: "100",
      currentCapacity: "25",
      utxoTxHash: "mock-registration-tx-hash",
      utxoOutputIndex: "0",
    }),
    onChainState: { kind: "registered_active" },
    isOnChainLoading: false,
    dustGrowthStatus: "growing",
    timeline: timeline([registrationEvent("registration_created", 90)]),
    recentActivity: registrationEvent("registration_created", 90),
  },
  {
    id: "vesting-claimable",
    title: "Airdrop Vesting — claimable now",
    description: "Locked NIGHT is claimable. The thaw timestamp has passed.",
    snapshot: nightSnapshot(
      "88359765449",
      "5754625102",
      Date.now() - 60 * 60 * 1000,
    ),
    indexerStatus: indexerStatus({
      registered: true,
      dustAddress: MOCK_DUST,
      nightBalance: "88359765449",
      generationRate: "1.25",
      maxCapacity: "100",
      currentCapacity: "25",
      utxoTxHash: "mock-registration-tx-hash",
      utxoOutputIndex: "0",
    }),
    onChainState: { kind: "registered_active" },
    isOnChainLoading: false,
    dustGrowthStatus: "growing",
    timeline: timeline([registrationEvent("registration_created", 90)]),
    recentActivity: registrationEvent("registration_created", 90),
  },
  {
    id: "timeline-history",
    title: "Timeline — registration history",
    description: "Multiple registration and deregistration events visible in the timeline.",
    snapshot: nightSnapshot("94114390552"),
    indexerStatus: indexerStatus({
      registered: true,
      dustAddress: MOCK_DUST,
      nightBalance: "94114390552",
      generationRate: "1.25",
      maxCapacity: "100",
      currentCapacity: "30",
      utxoTxHash: "mock-registration-tx-hash",
      utxoOutputIndex: "0",
    }),
    onChainState: { kind: "registered_active" },
    isOnChainLoading: false,
    dustGrowthStatus: "growing",
    timeline: timeline([
      registrationEvent("registration_created", 90),
      registrationEvent("registration_removed", 60),
      registrationEvent("registration_created", 5),
    ]),
    recentActivity: registrationEvent("registration_created", 5),
  },
  {
    id: "indexer-error",
    title: "Indexer error",
    description: "The Midnight indexer could not be reached.",
    snapshot: null,
    indexerStatus: null,
    onChainState: null,
    isOnChainLoading: false,
    dustGrowthStatus: "stable",
    timeline: null,
    recentActivity: null,
  },
  {
    id: "onchain-loading",
    title: "On-chain check loading",
    description: "Indexer result is shown while the on-chain state is still being verified.",
    snapshot: nightSnapshot("94114390552"),
    indexerStatus: indexerStatus({
      registered: true,
      dustAddress: MOCK_DUST,
      nightBalance: "94114390552",
      generationRate: "1.25",
      maxCapacity: "100",
      currentCapacity: "42",
      utxoTxHash: "mock-registration-tx-hash",
      utxoOutputIndex: "0",
    }),
    onChainState: null,
    isOnChainLoading: true,
    dustGrowthStatus: "growing",
    timeline: timeline([registrationEvent("registration_created", 14)]),
    recentActivity: registrationEvent("registration_created", 14),
  },
]
