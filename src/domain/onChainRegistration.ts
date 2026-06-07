/**
 * The on-chain state of a DUST registration, derived by cross-referencing the
 * Midnight indexer response with the actual Cardano UTxO set via Koios.
 *
 * The indexer can lag significantly behind the chain (hours to days). This
 * combined state lets us show the user exactly what is happening.
 */
export type OnChainRegistrationState =
  /** Indexer: registered=true AND the registration UTxO is still unspent on-chain. Normal active state. */
  | { kind: "registered_active" }
  /** Indexer: registered=true BUT the UTxO is already spent. Deregistration is on-chain confirmed, indexer is catching up. */
  | { kind: "deregistration_pending" }
  /** Indexer: registered=false. Nothing to cross-reference (no UTxO pointer available). */
  | { kind: "not_registered" }
  /** Could not determine on-chain state (network error, etc.). */
  | { kind: "unknown"; error: string }
