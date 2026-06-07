## Midnight DUST Inspector

Midnight DUST Inspector is a public web tool for understanding why DUST generation does or does not appear to work for a Cardano NIGHT registration.

The inspector can run without a wallet by checking a Cardano stake address. Optional wallet management features can connect a Cardano wallet and prepare registration or removal transactions that the user must review and sign in their wallet extension. A separate optional Midnight wallet connection can read the wallet's DUST address, DUST balance, and DUST cap.

The tool explains the current Midnight Indexer status in plain language, compares it with Cardano NIGHT holdings, compares the registered DUST recipient with a connected Midnight wallet when available, and shows a conservative Cardano transaction timeline. It helps users distinguish between a healthy registration, no active registration, multiple active registrations, a missing DUST address, zero generation rate, zero current capacity, indexer errors, Cardano/indexer mismatches, wallet recipient mismatches, and unclear states.

## Safety disclaimer

Inspection mode is read-only. Wallet management actions are optional and require an explicit wallet signature.

- It never asks for seed phrases.
- It never asks for private keys.
- It never stores wallet data.
- It does not send user-entered addresses to analytics.
- It can inspect a stake address without connecting a wallet.
- If a wallet is connected, the browser wallet extension handles signing locally.
- Registration and removal transactions are only prepared after the user chooses that action.
- The user must review and approve every transaction in their wallet extension.
- The optional Midnight wallet balance check reads address and balance data only; it does not request signatures or submit transactions.

The tool may call public Midnight Indexer and Cardano provider endpoints to inspect status data.

## How to run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## How to configure the indexer endpoint

Copy `.env.example` to `.env.local` and set:

```bash
NEXT_PUBLIC_MIDNIGHT_INDEXER_URL=https://example-indexer/graphql
```

The default public mainnet endpoint is:

```bash
NEXT_PUBLIC_MIDNIGHT_INDEXER_URL=https://indexer.mainnet.midnight.network/api/v4/graphql
```

You can also set `MIDNIGHT_INDEXER_URL` as a server-only override when deploying. The app calls its own read-only `/api/dust-status` route, and that route calls the Midnight Indexer.

The Midnight wallet connector defaults to mainnet:

```bash
NEXT_PUBLIC_MIDNIGHT_NETWORK_ID=mainnet
```

This is used only when the user chooses to connect a Midnight DApp Connector wallet for DUST address, balance, and cap checks.

The on-chain timeline uses Koios by default:

```bash
CARDANO_KOIOS_URL=https://api.koios.rest/api/v1
CARDANO_TIMELINE_TRANSACTION_LIMIT=25
CARDANO_NIGHT_POLICY_ID=0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa
CARDANO_NIGHT_ASSET_NAME=4e49474854
```

The Cardano scan checks current NIGHT holdings under the stake key and scans recent Cardano transactions for readable DUST registration or removal signals. Unknown transactions are kept available for review, but they are not treated as registration evidence.

## Mock mode

For local development without a live indexer:

```bash
NEXT_PUBLIC_USE_MOCK_INDEXER=true
```

When mock mode is enabled, the UI shows a developer-only selector for healthy registration, not registered, multiple registrations detected, missing DUST address, zero generation rate, zero current capacity, and indexer error examples.
For real indexer responses, leave this unset or set it to `false`.

## How to run tests

```bash
npm run test:run
```

For watch mode:

```bash
npm test
```

## Other quality commands

```bash
npm run lint
npm run typecheck
npm run format:check
```

## What the tool does

- Validates likely Cardano stake address prefixes.
- Connects to supported CIP-30 Cardano wallets when the user chooses wallet mode.
- Connects to supported Midnight DApp Connector wallets when the user chooses to read DUST wallet data.
- Calls a configurable public Midnight Indexer endpoint.
- Calls a configurable read-only Cardano provider for current NIGHT holdings and the on-chain timeline.
- Validates external responses with Zod.
- Converts network, HTTP, GraphQL, and schema issues into controlled errors.
- Runs deterministic diagnosis logic outside React.
- Shows user-friendly status, explanation, recommended action, and technical details.
- Compares Cardano-held NIGHT with the Midnight indexer NIGHT counted for DUST generation.
- Shows wallet-reported DUST address, DUST balance, and DUST cap when a Midnight wallet is connected.
- Compares the registered DUST recipient address with the connected Midnight wallet DUST address.
- Cross-checks whether a registration UTxO still exists on Cardano when enough information is available.
- Can prepare registration and removal transactions in the browser for explicit wallet signing.
- Keeps raw technical data behind an advanced collapsible section.
- Exports a JSON debug report for support conversations.
- Shows a real Cardano transaction timeline with conservative registration/removal classification.

## What the tool does not do

- It does not decode every possible Midnight registration payload format yet.
- It does not custody funds.
- It does not receive seed phrases or private keys.
- It does not sign transactions itself; signing happens in the user's wallet extension.
- It does not automatically submit repair transactions.
- It does not guarantee that a registration or removal transaction is the right action for every case.
- It does not prove that the indexer is fully caught up with Cardano.
- It does not read private Midnight wallet state beyond the DApp Connector methods the user explicitly authorizes.

## Why diagnose first?

Users may already be paying fees for failed or unclear repair attempts. A diagnostic tool should first explain the state before proposing actions.

Transaction creation and repair flows require stronger validation than a status check. The UI should help users understand what appears to be wrong before they submit another fee-paying transaction.

## Known limitations

- The indexer endpoint is configurable because the exact production endpoint may change.
- The first version trusts the public indexer response after schema validation.
- Multiple-registration detection checks indexer data and controlled error details, but it does not yet inspect Cardano transactions directly.
- The Cardano scan uses Koios account asset and UTxO endpoints. It can show that a stake key holds NIGHT even when the Midnight indexer reports zero NIGHT counted for DUST generation.
- The on-chain timeline scans recent Cardano transactions through Koios and uses conservative metadata matching. Unknown entries do not mean a transaction failed, and the app does not guess when public metadata is not recognizable.
- The DUST wallet balance comes from the connected Midnight wallet's DApp Connector. If no compatible Midnight wallet is installed or authorized, only the registered recipient address from the indexer can be shown.

## Future roadmap

- More precise Midnight registration payload decoding
- Provider adapters for Blockfrost, Maestro, Ogmios, and Kupo
- Guided repair preview
- Support issue export template
- Community-maintained known issue database

## Project structure

```text
src/
  app/
  components/
  domain/
  lib/
  services/
  test/
```

Business and diagnosis logic live in `src/domain`. API access lives in `src/services`. React components focus on UI and user interaction.

## Contributor notes

Keep user-facing text calm, clear, and non-accusatory. Keep diagnosis logic deterministic and covered by unit tests. Treat wallet transaction flows as high-risk UI: every action must be explicit, English-language, and clear about fees, signing, and indexer lag.
