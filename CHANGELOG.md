# Changelog

All notable changes to DUST Inspector are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased] – 0.5.0

### Added
- *(nothing yet)*

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
