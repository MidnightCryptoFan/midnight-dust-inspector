import { useEffect, useState } from "react"
import type { CardanoAccountSnapshot, VestingSchedule } from "@/domain/cardanoAccount"
import type { OnChainRegistrationState } from "@/domain/onChainRegistration"
import type { DustGenerationStatus } from "@/domain/dustStatus"
import type {
  RegistrationEvent,
  RegistrationTimeline,
  RegistrationTimelineError,
} from "@/domain/registrationTimeline"
import { formatCheckedAt, formatCompactAtomicQuantity } from "@/lib/formatting"
import { decodeBech32 } from "@/lib/bech32"

type DustGrowthStatus = "unchecked" | "checking" | "growing" | "stable"

export type ActiveRegistrationLookup =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "found"
      stakeAddress: string | null
      paymentKeyHash: string | null
      txHash: string
      outputIndex: number
    }
  | { status: "not_found"; reason: string }

type EffectiveState =
  | { kind: "loading" }
  | { kind: "registered_active" }
  | { kind: "deregistration_pending" }
  | { kind: "not_registered" }
  | { kind: "unknown"; error: string }

type NightSummary = {
  unlockedTotal: bigint
  lockedTotal: bigint
  atomicUnitsPerNight: bigint
  hasData: boolean
  vestingSchedule: VestingSchedule | null
}

type Props = {
  snapshot: CardanoAccountSnapshot | null
  indexerStatus: DustGenerationStatus | null
  onChainState: OnChainRegistrationState | null
  isOnChainLoading: boolean
  walletConnected: boolean
  midnightAddress: string | null
  dustGrowthStatus: DustGrowthStatus
  activeRegistrationLookup: ActiveRegistrationLookup
  timeline: RegistrationTimeline | null
  timelineError: RegistrationTimelineError | null
  recentActivity: RegistrationEvent | null
  onRegister: () => void
  onDeregister: () => void
  onFindActiveSource: () => void
  onInspectActiveSource: (stakeAddress: string) => void
  onRefresh: () => void
}

export function CardanoInspectionPanel({
  snapshot,
  indexerStatus,
  onChainState,
  isOnChainLoading,
  walletConnected,
  midnightAddress,
  dustGrowthStatus,
  activeRegistrationLookup,
  timeline,
  timelineError,
  recentActivity,
  onRegister,
  onDeregister,
  onFindActiveSource,
  onInspectActiveSource,
  onRefresh,
}: Props) {
  const effectiveState = resolveEffectiveState(
    indexerStatus,
    onChainState,
    isOnChainLoading,
  )
  const nightSummary = computeNightSummary(snapshot)

  const registeredDustAddress = indexerStatus?.dustAddress ?? null
  const addressesMatch =
    registeredDustAddress != null &&
    midnightAddress != null &&
    registeredDustAddress.toLowerCase() === midnightAddress.toLowerCase()

  // Newest first for display (timeline is built oldest-first for count logic).
  const registrationEvents = (
    timeline?.events.filter(
      (e) => e.type !== "unknown",
    ) ?? []
  )
    .slice()
    .reverse()

  return (
    <div className="space-y-4">
      {timelineError && !timeline && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          Cardano on-chain data is temporarily unavailable. The Midnight indexer
          result above is still valid.
        </div>
      )}

      <SummaryTiles
        nightSummary={nightSummary}
        effectiveState={effectiveState}
        generationRate={indexerStatus?.generationRate ?? null}
      />

      {effectiveState.kind === "registered_active" && registeredDustAddress && (
        <RegisteredDustAddress
          address={registeredDustAddress}
          matchesMidnightWallet={addressesMatch}
          midnightAddressConnected={midnightAddress !== null}
        />
      )}

      {effectiveState.kind === "registered_active" && (
        <ActiveActions
          walletConnected={walletConnected}
          recentActivity={recentActivity}
          onDeregister={onDeregister}
        />
      )}

      {effectiveState.kind === "deregistration_pending" && (
        <DeregistrationPendingNote onRefresh={onRefresh} />
      )}

      {effectiveState.kind === "not_registered" && (
        <NotRegisteredActions
          walletConnected={walletConnected}
          midnightAddress={midnightAddress}
          dustGrowthStatus={dustGrowthStatus}
          activeRegistrationLookup={activeRegistrationLookup}
          recentActivity={recentActivity}
          onRegister={onRegister}
          onFindActiveSource={onFindActiveSource}
          onInspectActiveSource={onInspectActiveSource}
        />
      )}

      {effectiveState.kind === "unknown" && (
        <UnknownStateNote error={effectiveState.error} onRefresh={onRefresh} />
      )}

      {registrationEvents.length > 0 && (
        <RegistrationEventList
          events={registrationEvents}
          effectiveState={effectiveState}
          indexerUtxoTxHash={indexerStatus?.utxoTxHash ?? null}
          atomicUnitsPerNight={nightSummary.atomicUnitsPerNight}
          referenceTime={
            indexerStatus?.checkedAt ??
            timeline?.checkedAt ??
            snapshot?.checkedAt ??
            null
          }
        />
      )}
      {timeline && timeline.scannedTransactionCount > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {timeline.scannedTransactionCount}{" "}
          {timeline.scannedTransactionCount === 1
            ? "transaction"
            : "transactions"}{" "}
          scanned
          {timeline.scannedTransactionCount > registrationEvents.length
            ? ` · ${timeline.scannedTransactionCount - registrationEvents.length} not shown (no DUST or NIGHT activity detected)`
            : ""}
        </p>
      )}
    </div>
  )
}

// --- Summary tiles ---

function formatIndexerRate(rate: string | null): string {
  if (!rate) return "—"
  if (rate === "pending") return "Pending"
  const num = parseFloat(rate)
  if (!isFinite(num) || num === 0) return "0 DUST/h"
  return `${num.toLocaleString("en-US", { maximumFractionDigits: 4 })} DUST/h`
}

function SummaryTiles({
  nightSummary,
  effectiveState,
  generationRate,
}: {
  nightSummary: NightSummary
  effectiveState: EffectiveState
  generationRate: string | null
}) {
  const { unlockedTotal, lockedTotal, atomicUnitsPerNight, hasData } =
    nightSummary
  const hasVesting = lockedTotal > 0n

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <MetricTile
        label="Night Balance"
        value={
          hasData
            ? `${formatCompactAtomicQuantity(unlockedTotal, atomicUnitsPerNight)} NIGHT`
            : "—"
        }
        sub="counts toward DUST cap"
        valueColor="text-teal-700 dark:text-teal-300"
      />
      {hasVesting && (
        <VestingTile
          lockedTotal={lockedTotal}
          atomicUnitsPerNight={atomicUnitsPerNight}
          vestingSchedule={nightSummary.vestingSchedule}
        />
      )}
      <MetricTile
        label="DUST Rate"
        value={formatIndexerRate(generationRate)}
        sub="per indexer"
        valueColor={
          generationRate && parseFloat(generationRate) > 0
            ? "text-violet-700 dark:text-violet-300"
            : "text-slate-500 dark:text-slate-400"
        }
      />
      <RegistrationTile effectiveState={effectiveState} />
    </div>
  )
}

function MetricTile({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string
  value: string
  sub: string
  valueColor: string
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </dt>
      <dd className={`mt-1 text-sm font-semibold ${valueColor}`}>{value}</dd>
      <dd className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        {sub}
      </dd>
    </div>
  )
}

function formatVestingCountdown(diffMs: number): string {
  const totalMinutes = Math.floor(diffMs / 60_000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return "< 1m"
}

function VestingTile({
  lockedTotal,
  atomicUnitsPerNight,
  vestingSchedule,
}: {
  lockedTotal: bigint
  atomicUnitsPerNight: bigint
  vestingSchedule: VestingSchedule | null
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const amount = `${formatCompactAtomicQuantity(lockedTotal, atomicUnitsPerNight)} NIGHT`

  let sub: string
  let isClaimable = false

  if (vestingSchedule) {
    const diffMs = vestingSchedule.nextThawTimestampMs - now
    isClaimable = diffMs <= 0
    sub = isClaimable ? "Now" : `thaw in ${formatVestingCountdown(diffMs)}`
  } else {
    sub = "not counted"
  }

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Airdrop Vesting
      </dt>
      <dd className="mt-1 text-sm font-semibold text-amber-600 dark:text-amber-400">
        {amount}
      </dd>
      <dd className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sub}</dd>
      {isClaimable && (
        <dd className="mt-1.5">
          <a
            href="https://redeem.midnight.gd/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
          >
            Claim NIGHT now →
          </a>
        </dd>
      )}
    </div>
  )
}

function RegistrationTile({
  effectiveState,
}: {
  effectiveState: EffectiveState
}) {
  if (effectiveState.kind === "loading") {
    return (
      <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800">
        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Active Registration
        </dt>
        <dd className="mt-1 flex items-center gap-1.5">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Checking…
          </span>
        </dd>
      </div>
    )
  }

  const config: Record<
    Exclude<EffectiveState["kind"], "loading" | "unknown">,
    { value: string; sub: string; valueColor: string; dot: string }
  > = {
    registered_active: {
      value: "Active",
      sub: "DUST generating",
      valueColor: "text-teal-700 dark:text-teal-300",
      dot: "bg-teal-500",
    },
    deregistration_pending: {
      value: "Removing…",
      sub: "Indexer catching up",
      valueColor: "text-blue-700 dark:text-blue-300",
      dot: "bg-blue-500 animate-pulse",
    },
    not_registered: {
      value: "Inactive",
      sub: "Not generating DUST",
      valueColor: "text-slate-600 dark:text-slate-400",
      dot: "bg-slate-400",
    },
  }

  const tile =
    effectiveState.kind === "unknown"
      ? {
          value: "Unknown",
          sub: "Check did not complete",
          valueColor: "text-amber-700 dark:text-amber-400",
          dot: "bg-amber-500",
        }
      : config[effectiveState.kind]

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Active Registration
      </dt>
      <dd
        className={`mt-1 flex items-center gap-1.5 text-sm font-semibold ${tile.valueColor}`}
      >
        <span className={`h-2 w-2 rounded-full ${tile.dot}`} />
        {tile.value}
      </dd>
      <dd className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        {tile.sub}
      </dd>
    </div>
  )
}

// --- Registered DUST address ---

function RegisteredDustAddress({
  address,
  matchesMidnightWallet,
  midnightAddressConnected,
}: {
  address: string
  matchesMidnightWallet: boolean
  midnightAddressConnected: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        matchesMidnightWallet
          ? "border-teal-200 bg-teal-50 dark:border-teal-800 dark:bg-teal-950/30"
          : midnightAddressConnected
            ? "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
            : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <dt className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Registered DUST address
        </dt>
        {matchesMidnightWallet && (
          <span className="rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-semibold text-teal-800 dark:bg-teal-900/60 dark:text-teal-300">
            ✓ Matches connected Midnight wallet
          </span>
        )}
        {!matchesMidnightWallet && midnightAddressConnected && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/60 dark:text-amber-300">
            ⚠ Address mismatch
          </span>
        )}
      </div>
      <dd className="mt-2 break-all font-mono text-xs text-slate-700 dark:text-slate-300">
        {address}
      </dd>
      {!matchesMidnightWallet && midnightAddressConnected && (
        <p className="mt-2 text-xs leading-5 text-amber-800 dark:text-amber-300">
          The connected Midnight wallet uses a different DUST address. Make sure
          you are using the same wallet that was connected during registration.
        </p>
      )}
    </div>
  )
}

// --- Actions ---

function ActiveActions({
  walletConnected,
  recentActivity,
  onDeregister,
}: {
  walletConnected: boolean
  recentActivity: RegistrationEvent | null
  onDeregister: () => void
}) {
  const isLocked = recentActivity !== null

  return (
    <div className="space-y-3">
      {isLocked && (
        <IndexerLockWarning event={recentActivity} action="deregister" />
      )}
      {walletConnected ? (
        <button
          className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${
            isLocked
              ? "cursor-not-allowed bg-slate-400 dark:bg-slate-600"
              : "bg-red-600 hover:bg-red-700 focus:ring-red-500"
          }`}
          type="button"
          disabled={isLocked}
          onClick={onDeregister}
        >
          Deregister
        </button>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Connect your Cardano wallet to deregister.
        </p>
      )}
    </div>
  )
}

function NotRegisteredActions({
  walletConnected,
  midnightAddress,
  dustGrowthStatus,
  activeRegistrationLookup,
  recentActivity,
  onRegister,
  onFindActiveSource,
  onInspectActiveSource,
}: {
  walletConnected: boolean
  midnightAddress: string | null
  dustGrowthStatus: DustGrowthStatus
  activeRegistrationLookup: ActiveRegistrationLookup
  recentActivity: RegistrationEvent | null
  onRegister: () => void
  onFindActiveSource: () => void
  onInspectActiveSource: (stakeAddress: string) => void
}) {
  const dustIsGrowing = dustGrowthStatus === "growing"
  const dustIsChecking = dustGrowthStatus === "checking"
  const hasMidnightWallet = midnightAddress !== null
  const isLocked =
    dustIsGrowing ||
    dustIsChecking ||
    recentActivity !== null ||
    !hasMidnightWallet

  return (
    <div className="space-y-3">
      {dustIsChecking && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <div className="flex items-center gap-2">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
            <p className="font-semibold">Checking DUST generation status…</p>
          </div>
          <p className="mt-1 text-xs">
            Registration is blocked until the check confirms no DUST is being
            generated — an active registration elsewhere would make this one
            redundant or conflicting.
          </p>
        </div>
      )}

      {dustIsGrowing && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <p className="font-semibold">
            DUST is actively growing — do not register again.
          </p>
          <p className="mt-1 text-xs">
            An active registration exists somewhere. Identify the registered
            stake address before creating another.
          </p>
          <button
            className="mt-3 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-wait disabled:opacity-70 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-amber-950/60"
            disabled={activeRegistrationLookup.status === "loading"}
            type="button"
            onClick={onFindActiveSource}
          >
            {activeRegistrationLookup.status === "loading"
              ? "Finding source..."
              : "Find active source"}
          </button>
        </div>
      )}

      {dustIsGrowing && activeRegistrationLookup.status !== "idle" && (
        <ActiveSourceLookupResult
          lookup={activeRegistrationLookup}
          recentActivity={recentActivity}
          onInspectActiveSource={onInspectActiveSource}
        />
      )}

      {!dustIsGrowing && !dustIsChecking && recentActivity && (
        <IndexerLockWarning event={recentActivity} action="register" />
      )}

      {/* Hide registration entirely when DUST is growing and no source was found —
          there is no actionable path until the Midnight indexer catches up. */}
      {!(dustIsGrowing && activeRegistrationLookup.status === "not_found") &&
        (walletConnected ? (
          <div className="space-y-3">
            {!hasMidnightWallet &&
              !dustIsGrowing &&
              !dustIsChecking &&
              !recentActivity && (
                <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 text-sm leading-6 text-violet-900 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300">
                  <p className="font-semibold">
                    Connect your Midnight wallet first.
                  </p>
                  <p className="mt-1 text-xs">
                    The registration transaction encodes your Midnight DUST
                    address on-chain. Connect the Midnight wallet above so the
                    correct address is used — otherwise a conflicting
                    registration could be created.
                  </p>
                </div>
              )}
            <button
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${
                isLocked
                  ? "cursor-not-allowed bg-slate-400 dark:bg-slate-600"
                  : "bg-teal-600 hover:bg-teal-700 focus:ring-teal-500"
              }`}
              type="button"
              disabled={isLocked}
              onClick={onRegister}
            >
              Register now
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Connect your Cardano wallet to register.
          </p>
        ))}
    </div>
  )
}

function ActiveSourceLookupResult({
  lookup,
  recentActivity,
  onInspectActiveSource,
}: {
  lookup: ActiveRegistrationLookup
  recentActivity: RegistrationEvent | null
  onInspectActiveSource: (stakeAddress: string) => void
}) {
  if (lookup.status === "idle") {
    return null
  }

  if (lookup.status === "loading") {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
        <div className="flex items-center gap-2">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
          <p className="font-semibold">Scanning active registration UTxOs...</p>
        </div>
        <p className="mt-1 text-xs">
          This checks the public DUST registration script for a datum containing
          the connected Midnight DUST address.
        </p>
      </div>
    )
  }

  if (lookup.status === "not_found") {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
        <p className="font-semibold">No active on-chain source found.</p>
        <p className="mt-1 text-xs">
          DUST is still growing, but no unspent registration UTxO was found for
          this Midnight address. That usually means Cardano already removed the
          registration and the Midnight wallet/indexer is still catching up.
        </p>
        <p className="mt-2 text-xs">
          Wait before registering again: first useful re-check is about 1 hour
          after the latest registration change, and normal catch-up can take up
          to 24 hours.
        </p>
        {recentActivity?.blockTime ? (
          <p className="mt-2 text-xs">
            Latest registration change seen here:{" "}
            <span className="font-semibold">
              {formatCheckedAt(recentActivity.blockTime)}
            </span>
            .
          </p>
        ) : null}
        <p className="mt-2 text-xs opacity-80">{lookup.reason}</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm leading-6 text-teal-900 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-300">
      <p className="font-semibold">Active registration source found.</p>
      <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
        <LookupDetail
          label="Registered stake address"
          value={lookup.stakeAddress ?? "Could not resolve"}
        />
        <LookupDetail
          label="Registration UTxO"
          value={`${lookup.txHash.slice(0, 12)}...${lookup.txHash.slice(-8)}#${lookup.outputIndex}`}
        />
        <LookupDetail
          label="Payment key hash"
          value={lookup.paymentKeyHash ?? "Could not resolve"}
        />
      </dl>
      {lookup.stakeAddress ? (
        <button
          className="mt-3 rounded-md bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-800"
          type="button"
          onClick={() => onInspectActiveSource(lookup.stakeAddress!)}
        >
          Inspect source
        </button>
      ) : (
        <p className="mt-2 text-xs">
          The active registration UTxO exists, but its stake address could not
          be resolved from the registration transaction inputs.
        </p>
      )}
    </div>
  )
}

function LookupDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold uppercase tracking-wide text-teal-700/70 dark:text-teal-300/70">
        {label}
      </dt>
      <dd className="mt-0.5 break-all font-mono text-teal-950 dark:text-teal-200">
        {value}
      </dd>
    </div>
  )
}

function DeregistrationPendingNote({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
        <p className="font-semibold">Deregistration confirmed on-chain.</p>
        <p className="mt-1 text-xs">
          The Midnight indexer still shows the old registration — it takes up to
          24 h to catch up. Avoid submitting another removal in the meantime.
        </p>
      </div>
      <button
        className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        type="button"
        onClick={onRefresh}
      >
        Check again
      </button>
    </div>
  )
}

function UnknownStateNote({
  error,
  onRefresh,
}: {
  error: string
  onRefresh: () => void
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
        <p className="text-xs">{error}</p>
      </div>
      <button
        className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        type="button"
        onClick={onRefresh}
      >
        Try again
      </button>
    </div>
  )
}

function IndexerLockWarning({
  event,
  action,
}: {
  event: RegistrationEvent
  action: "register" | "deregister"
}) {
  const age = event.blockTime
    ? `at ${formatCheckedAt(event.blockTime)}`
    : "recently"

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
      <p className="font-semibold">
        Indexer sync in progress — {action} blocked for now.
      </p>
      <p className="mt-1 text-xs">
        A registration change was submitted {age}. The Midnight indexer takes up
        to 24 h to process changes. Submitting another transaction before it
        catches up can create conflicting entries.
      </p>
    </div>
  )
}

// --- Registration event list ---

function RegistrationEventList({
  events,
  effectiveState,
  indexerUtxoTxHash,
  atomicUnitsPerNight,
  referenceTime,
}: {
  events: RegistrationEvent[]
  effectiveState: EffectiveState
  indexerUtxoTxHash: string | null
  atomicUnitsPerNight: bigint
  referenceTime: string | null
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
        On-chain registration history
      </h3>
      <ol className="space-y-2">
        {events.map((event, index) => (
          <RegistrationEventCard
            key={event.txHash}
            event={event}
            atomicUnitsPerNight={atomicUnitsPerNight}
            // Only the most recent non-transfer event (index 0) can be in a sync conflict.
            eventWarning={
              index === 0
                ? getRegistrationEventWarning({ event, effectiveState, referenceTime })
                : null
            }
            isIndexerReported={
              indexerUtxoTxHash != null &&
              event.txHash.toLowerCase() === indexerUtxoTxHash.toLowerCase()
            }
          />
        ))}
      </ol>
    </div>
  )
}

function RegistrationEventCard({
  event,
  eventWarning,
  isIndexerReported,
  atomicUnitsPerNight,
}: {
  event: RegistrationEvent
  eventWarning: RegistrationEventWarning | null
  isIndexerReported: boolean
  atomicUnitsPerNight: bigint
}) {
  if (event.type === "night_transfer") {
    const isReceived = event.nightDirection === "received"
    const formattedAmount =
      event.nightAmount
        ? formatCompactAtomicQuantity(BigInt(event.nightAmount), atomicUnitsPerNight)
        : "?"
    const badgeStyle = isReceived
      ? "bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-300"
      : "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300"
    return (
      <li className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-widest text-blue-700 dark:text-blue-300">
            {isReceived ? "NIGHT Received" : "NIGHT Sent"}
          </p>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeStyle}`}>
            {formattedAmount} NIGHT
          </span>
        </div>
        <dl className="mt-2 grid gap-1.5 text-xs sm:grid-cols-2">
          <EventDetail label="Block time" value={formatCheckedAt(event.blockTime)} />
          <TransactionDetail txHash={event.txHash} />
        </dl>
      </li>
    )
  }

  const isCreated = event.type === "registration_created"

  const cardStyle = isCreated
    ? "border-teal-200 bg-teal-50 dark:border-teal-800 dark:bg-teal-950/30"
    : "border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30"

  const label = isCreated
    ? event.confidence === "high"
      ? "DUST Registration"
      : "Likely DUST Registration"
    : event.confidence === "high"
      ? "DUST De-registration"
      : "Likely De-registration"

  const labelColor = isCreated
    ? "text-teal-700 dark:text-teal-300"
    : "text-rose-700 dark:text-rose-300"

  return (
    <li className={`rounded-md border p-3 ${cardStyle}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p
          className={`text-xs font-bold uppercase tracking-widest ${labelColor}`}
        >
          {label}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {isIndexerReported && (
            <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-800 dark:bg-teal-900/60 dark:text-teal-300">
              active registration
            </span>
          )}
          {event.confidence !== "high" && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                event.confidence === "medium"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                  : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400"
              }`}
            >
              {event.confidence} confidence
            </span>
          )}
        </div>
      </div>

      <dl className="mt-2 grid gap-1.5 text-xs sm:grid-cols-2">
        <EventDetail
          label="Block time"
          value={formatCheckedAt(event.blockTime)}
        />
        <TransactionDetail txHash={event.txHash} />
        {event.dustAddress && (
          <EventDetail
            label="DUST address"
            value={`${event.dustAddress.slice(0, 20)}…`}
          />
        )}
      </dl>
      {eventWarning ? (
        <RegistrationEventWarningPanel warning={eventWarning} />
      ) : null}
    </li>
  )
}

function TransactionDetail({ txHash }: { txHash: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  )

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(txHash)
      setCopyState("copied")
      window.setTimeout(() => setCopyState("idle"), 1_500)
    } catch {
      setCopyState("failed")
      window.setTimeout(() => setCopyState("idle"), 2_500)
    }
  }

  return (
    <div>
      <dt className="font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Transaction
      </dt>
      <dd className="mt-0.5 flex flex-wrap items-center gap-2">
        <span className="font-mono text-slate-700 dark:text-slate-300">
          {txHash.slice(0, 12)}...{txHash.slice(-8)}
        </span>
        <button
          className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          type="button"
          onClick={handleCopy}
        >
          {copyState === "copied"
            ? "Copied"
            : copyState === "failed"
              ? "Copy failed"
              : "Copy"}
        </button>
        <a
          href={`https://cardanoscan.io/transaction/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Cardanoscan ↗
        </a>
      </dd>
    </div>
  )
}

type RegistrationEventWarning = {
  kind: "syncing" | "support"
  title: string
  message: string
}

function RegistrationEventWarningPanel({
  warning,
}: {
  warning: RegistrationEventWarning
}) {
  const isSupport = warning.kind === "support"

  return (
    <div
      className={`mt-3 rounded-md border p-3 text-xs leading-5 ${
        isSupport
          ? "border-rose-200 bg-white/70 text-rose-900 dark:border-rose-800 dark:bg-slate-900/60 dark:text-rose-300"
          : "border-amber-200 bg-white/70 text-amber-900 dark:border-amber-800 dark:bg-slate-900/60 dark:text-amber-300"
      }`}
    >
      <p className="flex items-center gap-2 font-semibold">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
            isSupport
              ? "bg-rose-100 text-rose-800 dark:bg-rose-900/70 dark:text-rose-200"
              : "bg-amber-100 text-amber-800 dark:bg-amber-900/70 dark:text-amber-200"
          }`}
          aria-hidden="true"
        >
          !
        </span>
        {warning.title}
      </p>
      <p className="mt-1 pl-7">{warning.message}</p>
    </div>
  )
}

function EventDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-slate-700 dark:text-slate-300">
        {value}
      </dd>
    </div>
  )
}

// --- Helpers ---

const REGISTRATION_STATUS_SYNC_WINDOW_MS = 48 * 60 * 60 * 1000

function getRegistrationEventWarning({
  event,
  effectiveState,
  referenceTime,
}: {
  event: RegistrationEvent
  effectiveState: EffectiveState
  referenceTime: string | null
}): RegistrationEventWarning | null {
  if (!event.blockTime || !referenceTime) return null

  const eventTime = Date.parse(event.blockTime)
  const checkedTime = Date.parse(referenceTime)
  if (!Number.isFinite(eventTime) || !Number.isFinite(checkedTime)) return null

  const ageMs = checkedTime - eventTime
  if (ageMs < 0) return null

  // A conflict exists only when the most recent on-chain event contradicts what
  // the Midnight indexer currently reports for THIS stake key. DUST growing from
  // a different stake key is not a conflict here.
  const contradictsCurrentStatus =
    (event.type === "registration_removed" &&
      (effectiveState.kind === "registered_active" ||
        effectiveState.kind === "deregistration_pending")) ||
    (event.type === "registration_created" &&
      effectiveState.kind === "not_registered")

  if (!contradictsCurrentStatus) return null

  if (ageMs < REGISTRATION_STATUS_SYNC_WINDOW_MS) {
    return {
      kind: "syncing",
      title: "Recent change - status may still sync",
      message:
        "This transaction is less than 48 hours old and the Cardano/Midnight status currently conflicts. Wait before submitting another registration or removal.",
    }
  }

  return {
    kind: "support",
    title: "Needs support review",
    message:
      "This transaction is older than 48 hours and the status still conflicts. Do not submit another transaction yet. Copy the transaction ID and contact Midnight support with the debug report.",
  }
}

function resolveEffectiveState(
  indexerStatus: DustGenerationStatus | null,
  onChainState: OnChainRegistrationState | null,
  isOnChainLoading: boolean,
): EffectiveState {
  if (isOnChainLoading) return { kind: "loading" }
  if (!indexerStatus || !indexerStatus.registered)
    return { kind: "not_registered" }

  if (!onChainState || onChainState.kind === "unknown") {
    const error =
      onChainState?.kind === "unknown"
        ? onChainState.error
        : "On-chain check could not be completed."
    return { kind: "unknown", error }
  }

  if (onChainState.kind === "deregistration_pending") {
    return { kind: "deregistration_pending" }
  }

  return { kind: "registered_active" }
}

function computeNightSummary(
  snapshot: CardanoAccountSnapshot | null,
): NightSummary {
  if (!snapshot) {
    return {
      unlockedTotal: 0n,
      lockedTotal: 0n,
      atomicUnitsPerNight: 1_000_000n,
      hasData: false,
      vestingSchedule: null,
    }
  }

  const decimals =
    snapshot.nightAsset?.decimals != null && snapshot.nightAsset.decimals > 0
      ? snapshot.nightAsset.decimals
      : 6
  const atomicUnitsPerNight = 10n ** BigInt(decimals)

  const parseBigInt = (v: string) => {
    try {
      return BigInt(v)
    } catch {
      return 0n
    }
  }

  const unlockedTotal = snapshot.nightUtxos
    .filter((u) => !isScriptPaymentAddress(u.address))
    .reduce((sum, u) => sum + parseBigInt(u.quantity), 0n)

  const lockedTotal = snapshot.nightUtxos
    .filter((u) => isScriptPaymentAddress(u.address))
    .reduce((sum, u) => sum + parseBigInt(u.quantity), 0n)

  return {
    unlockedTotal,
    lockedTotal,
    atomicUnitsPerNight,
    hasData: true,
    vestingSchedule: snapshot.vestingSchedule,
  }
}

function isScriptPaymentAddress(address: string): boolean {
  if (!address.toLowerCase().startsWith("addr")) return false
  const decoded = decodeBech32(address)
  if (!decoded || decoded.bytes.length < 1) return false
  const addrType = (decoded.bytes[0]! >> 4) & 0xf
  return (addrType & 1) === 1
}
