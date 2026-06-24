# Changelog

All notable changes to DUST Inspector are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased] – 0.5.6

### Added

- _(nothing yet)_

---

## [0.5.5] – 2026-06-24

### Added

- Required-signer hardening for registration: the registration transaction now
  also declares the `c_wallet` payment key as a required signer, because the
  minting policy runs the same `check_auth` as the spend (deregistration) path.

### Changed

- Removing multiple registrations now happens in a **single transaction**
  (collect every selected script UTxO and burn `-N`) instead of several
  back-to-back submissions, which could chain unconfirmed wallet inputs and
  fail. The contract restricts minting to `+1` per transaction but does not
  restrict the burn quantity.
- Before signing a removal, each referenced UTxO is verified on-chain: it must
  still exist unspent at the script address, hold the registration NFT, and
  carry an inline datum whose `c_wallet` matches the connected wallet. Stale or
  foreign UTxOs are now rejected up front instead of failing on-chain.

### Fixed

- The deregistration fallback no longer assumes output index `0` when only a
  transaction hash is known — without a definite output index the UTxO is not
  offered, since a UTxO is identified by `txHash` **and** `outputIndex`.

---

## [0.5.4] – 2026-06-24

### Added

- The Deregister flow can now clean up **multiple DUST registrations** at once.
  It scans the registration script directly for every active registration of
  the connected wallet, lists each with its DUST address, and lets you remove
  several in one pass — one transaction per registration, since the contract
  burns exactly one registration token per transaction. The registration
  matching your connected Midnight wallet is kept by default; duplicates are
  pre-selected for removal, with a progress indicator while signing.

### Fixed

- Deregistration transactions now declare the registered `c_wallet` payment key
  as a required signer. Without it the on-chain validator's `check_auth` check
  rejected the spend and burn, so a deregistration could never be submitted.

---

## [0.5.3] – 2026-06-14

### Added

- Client-side Koios fetching: timeline data is now requested directly from the
  user's browser instead of routing through the Vercel server. Each user's own
  IP is used for Koios API calls, eliminating the shared server-side rate-limit
  problem. A server-side fallback is used automatically if the browser fetch fails.
- In-memory cache with 60 s TTL and incremental refresh: the first lookup
  fetches up to 100 transactions; subsequent refreshes within 60 s return cached
  data with no Koios call. After 60 s only the latest 5 transaction hashes are
  checked; a full re-fetch is only triggered when new transactions are found.

### Fixed

- Footer version no longer shows the pre-release suffix (`-dev`) duplicated
  alongside the channel badge — e.g. "v0.5.3-devdev" now correctly shows
  "v0.5.3 dev".
- Stake key extracted from a payment address is now shown in truncated form in
  the validation note (`stake1u8ese…etxq` style) to avoid wrapping on small screens.

---

## [0.5.2] – 2026-06-14

### Fixed

- NIGHT transfer amounts in the registration timeline showed inflated values
  (e.g. 9.62k, 7.22k, 4.81k) instead of the correct single-tranche amount
  (~2.41k). Vesting contract addresses (`addr1z…`) embed the user's stake key
  and were therefore counted as user-owned outputs, inflating every release
  event. Fixed by restricting NIGHT input/output accounting to key-payment
  addresses (`addr1q`, `addr1v`) only — script-controlled addresses are now
  excluded from the nightIn/nightOut calculation.

---

## [0.5.1] – 2026-06-13

### Fixed

- TypeScript build error: `dustCapFull` prop missing in the preview page
  `CardanoInspectionPanel` usage — caused Vercel production builds to fail

---

## [0.5.0] – 2026-06-13

### Added

- Security notice below the header: confirms the tool never requests seed phrases
  or private keys and that wallet connections are read-only unless the user signs
  a transaction inside their wallet extension
- Read-only notice in the Cardano wallet section: registration actions require
  explicit wallet confirmation
- Independent tool disclaimer in the footer
- Two new FAQ entries: "Do I need to connect a wallet?" and "What happens during
  registration?"
- Tooltips (browser `title` attributes) on DUST balance, DUST cap, generation
  rate, and registration status tiles

### Changed

- Page `<h1>` renamed from "DUST Dashboard" to "Midnight DUST Inspector"; benefit
  subtitle added below the title
- Page `<title>` updated to "Check DUST Generation and Registration Status"
- FAQ reordered: safety first, then "Do I need to connect?", two wallets, no DUST
  detected, DUST cap, what happens during registration
- "Support this tool" panel moved to after the FAQ section
- "Connect Lace" fallback button replaced by plain "Scan again" in both the
  Cardano and Midnight no-wallet states — no wallet-specific connect button is
  shown when no wallet is detected
- NIGHT-stays-in-wallet notice separated into its own line and made more explicit
  in the Midnight wallet panel
- Midnight wallet discovery message no longer names Lace specifically; now says
  "Unlock your Midnight wallet extension"
- Primary "Check Stake Address" button styled in violet to distinguish it as the
  primary action; label updated from "Check DUST status"
- Stake address validation now rejects mixed-case input and validates Bech32
  structure; testnet addresses show a warning note instead of being silently
  accepted as mainnet; error messages are more specific
- `NEXT_PUBLIC_APP_CHANNEL` now read from the environment variable rather than
  hardcoded, allowing per-branch values without code changes
- Dev server port changed to 3000

### Fixed

- "Register now" button is now disabled and replaced with an explanatory notice
  when the connected Midnight wallet shows DUST balance ≥ DUST cap; the full cap
  indicates existing DUST accumulation and registering again would not be
  actionable

### Security

- `Referrer-Policy: strict-origin-when-cross-origin` header added to all responses

---

## [0.4.0] – 2026-06-12

### Added

- Cardanoscan explorer link on every transaction in the registration timeline
- URL parameter support (`?stake=`): pre-fills and auto-submits the address on
  page load; URL is updated after every successful lookup for easy sharing
- DUST icon displayed in the page header, spanning both title lines
- DUST generation rate from the Midnight indexer shown as a summary tile in the
  Cardano panel — visible without a Midnight wallet connected
- Auto-refresh toggle (60-second interval) for the Cardano inspection panel,
  placed in the connected wallet header below Disconnect
- Auto-refresh toggle (60-second interval) for the Midnight wallet panel,
  placed in the connected wallet header below Disconnect; manual Refresh button
  is hidden while auto-refresh is active
- Copy button next to the stake address in the Cardano connected wallet header
- Copy button next to the DUST address in the Midnight connected wallet header
- Midnight connected wallet header now mirrors the Cardano layout: wallet icon,
  wallet name, address label, truncated address, Connected badge, Disconnect

---

## [0.3.1] – 2026-06-12

### Added

- GitHub repository link on "MidnightCryptoFan" in the footer

### Fixed

- `CARDANO_TIMELINE_TRANSACTION_LIMIT` in `.env.example` corrected from 25 to 100
  to match the code default set in v0.2.0

---

## [0.3.0] – 2026-06-12

### Added

- Channel badge in the footer (`dev` / `rc` / empty = stable), driven by
  `NEXT_PUBLIC_APP_CHANNEL` in `next.config.ts` — value differs per branch

---

## [0.2.0] – 2026-06-12

### Added

- Version number displayed in the page footer, sourced from `package.json`
- Channel badge in footer (`dev` / `rc`) configurable via `NEXT_PUBLIC_APP_CHANNEL`
- "Created by MidnightCryptoFan" credit in the footer
- Transaction scan count shown below the registration timeline so users can
  see how many transactions were analysed vs. displayed
- NIGHT transfer events in the registration timeline (receive / send)

### Fixed

- Address input now accepts full Cardano payment addresses (`addr1…`) in
  addition to stake addresses (`stake1…`); the stake key is extracted
  automatically and the label/description text reflects this
- Generation rate panel now shows an informational notice when the Midnight
  indexer confirms an active registration but the 10-second wallet measurement
  returns zero — this happens with very small NIGHT balances where the per-10 s
  DUST increment is below one atomic unit
- Default transaction scan limit raised from 25 to 100

---

## [0.1.0] – 2026-05-01

### Added

- Initial release of the Midnight DUST Inspector
- Cardano stake address lookup via Koios API
- Midnight indexer DUST generation status query
- On-chain registration state verification (UTxO spent check)
- Registration and deregistration flows via connected Cardano wallet
- Midnight DUST wallet connection (Lace) with live balance and rate measurement
- Registration timeline with high-confidence detection via contract address
  and metadata heuristics
- Active registration source lookup by DUST address
- Custom DUST favicon and Apple touch icon
