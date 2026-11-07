# Midnight DUST Inspector

A free, open-source tool to check your [Midnight](https://midnight.network) DUST generation status — without giving up your keys or seed phrase.

You enter a Cardano stake address (or connect your wallet) and the inspector shows you:

- Whether your NIGHT is registered for DUST generation
- How much DUST you are generating and at what rate
- Whether the Cardano on-chain state matches what the Midnight indexer reports
- A timeline of available registration and de-registration transactions (provider limits or errors may make it incomplete)

> **Non-custodial.** The tool never asks for your seed phrase or private keys. All wallet actions happen inside your own wallet extension.

---

## What you need

| Requirement                      | Notes                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [Node.js](https://nodejs.org) 22 | Download the LTS version from nodejs.org                                                                |
| A browser                        | Chrome, Firefox, Brave, or Edge                                                                         |
| A Cardano wallet extension       | Optional — needed only to register/deregister. Works with Lace, Eternl, Nami, and other CIP-30 wallets. |
| A Midnight wallet extension      | Optional — needed only to read your live DUST balance and address. Keep it updated for Ledger 9.        |

---

## Installation

**1. Download the project**

If you have Git installed:

```bash
git clone https://github.com/MidnightCryptoFan/midnight-dust-inspector.git
cd midnight-dust-inspector
```

Or click **Code → Download ZIP** on GitHub, unzip the folder, and open a terminal inside it.

**2. Install dependencies**

```bash
npm ci
```

This downloads all required packages into a local `node_modules` folder. Nothing is installed system-wide.

**3. Create your configuration file**

```bash
cp .env.example .env.local
```

The defaults point to Midnight mainnet, but live indexer reads require a free Blockfrost Midnight project token. Add it to `.env.local` as described under Configuration.

**4. Start the app**

```bash
npm run dev
```

**5. Open your browser**

Go to [http://localhost:3000](http://localhost:3000)

The inspector is now running locally on your computer. To show status data, it queries the configured public Midnight Indexer and Cardano Koios endpoints.

---

## How to use it

### Check a stake address without a wallet

Enter your Cardano stake address (starts with `stake1...`) in the input field and press **Inspect**. You will see your NIGHT balance, registration status, and transaction history.

### Connect your Cardano wallet

Click **Connect** in the Cardano section and choose your wallet extension. This lets you register or deregister directly from the inspector. Every transaction must be reviewed and signed in your wallet — the tool never signs anything on your behalf.

### Connect your Midnight wallet

Click **Connect** in the Midnight section to read your DUST balance, capacity cap, and DUST address. This is read-only — the tool cannot submit Midnight transactions.

---

## Safety

- The tool **never asks for your seed phrase or private keys**
- Wallet data is handled in memory for the current session; the app does not persist wallet credentials
- Stake addresses you inspect are sent to the configured Midnight Indexer and Cardano Koios endpoints so the app can read public status and on-chain history
- The inspected stake address is reflected in the page URL as `?stake=...` for refresh/share support; the app sends a referrer policy that avoids leaking the full URL to external sites
- Wallet signing always happens **inside your wallet extension**, not in this app
- Inspection without a wallet is completely **read-only**
- The Cardano and Midnight wallet connections can be **disconnected** at any time

---

## Configuration

The file `.env.local` controls which endpoints the app uses. Midnight mainnet indexer requests use Blockfrost because the former public Midnight indexer was retired. Blockfrost includes Midnight in its free plan (currently 50,000 requests per day with no credit card required), so visitors do not pay and do not need their own account. The project token stays on the server.

```bash
# Free Blockfrost Midnight project token (server-only)
MIDNIGHT_BLOCKFROST_PROJECT_ID=your_project_token

# Optional: use your own GraphQL indexer instead
# MIDNIGHT_INDEXER_URL=https://your-indexer.example/graphql

# Midnight network
NEXT_PUBLIC_MIDNIGHT_NETWORK_ID=mainnet

# Cardano data provider (Koios) for server-side API routes
CARDANO_KOIOS_URL=https://api.koios.rest/api/v1

# Browser-visible Koios endpoint used when building wallet transactions
NEXT_PUBLIC_CARDANO_KOIOS_URL=https://api.koios.rest/api/v1

# NIGHT token identifiers
CARDANO_NIGHT_POLICY_ID=0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa
CARDANO_NIGHT_ASSET_NAME=4e49474854
```

Create one free Midnight project in Blockfrost and put its token in `.env.local`. Do not prefix the variable with `NEXT_PUBLIC_`; that would expose the token to browsers. You only need to change the endpoint variables if you run your own indexer or a private Cardano data provider.

### Ledger 9 compatibility

Midnight Mainnet moved to Ledger 9 on 6 November 2026. The inspector is compatible with that upgrade:

- It uses the current Blockfrost Mainnet indexer endpoint. Blockfrost must run Midnight Indexer 4.4.101 or newer; older indexers report DUST capacity incorrectly after the upgrade.
- Existing Mainnet DUST registrations were replayed automatically to their full cap at the same DUST address. Users should not register again merely because of the upgrade.
- Midnight wallet extensions must use Wallet SDK 2.0.0 or newer to show the post-upgrade DUST balance correctly. Update the extension if its balance differs from the indexer.
- The inspector does not build or submit Midnight transactions, so it does not bundle Midnight.js or the Wallet SDK. Registration transactions are Cardano transactions and remain reviewed and signed by the Cardano wallet.
- Preview was reset as a new Ledger 9 chain, but this inspector intentionally accepts Mainnet addresses only.

See the official [Ledger 9 upgrade notes](https://docs.midnight.network/relnotes/ledger-9) and [current network endpoints](https://docs.midnight.network/relnotes/network).

---

## Stopping the app

Press `Ctrl + C` in the terminal where `npm run dev` is running.

---

## Troubleshooting

**The page does not load**
Make sure `npm run dev` is still running and open [http://localhost:3000](http://localhost:3000) (not https).

**"Cannot find module" error after `npm run dev`**
Run `npm ci` again. This usually fixes missing packages.

**Wallet does not appear in the list**
Make sure the wallet extension is installed and enabled in your browser. Some wallets need to be unlocked first.

**Registration status looks wrong**
The Midnight indexer can take up to 24 hours to reflect a recent Cardano transaction. The inspector shows you both the on-chain Cardano state and the indexer state so you can see exactly where any delay is. After the Ledger 9 upgrade, also update the Midnight wallet extension; Wallet SDK 1.x cannot show the new Mainnet state correctly.

---

## For developers

```bash
npm run dev          # Start development server
npm run build        # Production build
npm run typecheck    # TypeScript check
npm run lint         # ESLint
npm run test:run     # Run all tests once
npm test             # Run tests in watch mode
npm run format       # Auto-format with Prettier
```

### Mock mode

To develop without a live Midnight indexer:

```bash
# in .env.local
NEXT_PUBLIC_USE_MOCK_INDEXER=true
```

This enables a developer-only scenario selector with pre-built states (registered, not registered, indexer error, etc.).

### Project structure

```
src/
  app/          Next.js routes and API handlers
  components/   React UI components
  domain/       Business logic and diagnosis (framework-free, fully tested)
  lib/          Shared utilities
  services/     External API clients (Midnight indexer, Koios, wallet connectors)
  test/         Unit and component tests
```

---

## License

[GNU General Public License v3.0](LICENSE) — free to use, modify, and share. Derivative works must remain open-source under the same license.
