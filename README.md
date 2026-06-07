# Midnight DUST Inspector

A free, open-source tool to check your [Midnight](https://midnight.network) DUST generation status — without giving up your keys or seed phrase.

You enter a Cardano stake address (or connect your wallet) and the inspector shows you:

- Whether your NIGHT is registered for DUST generation
- How much DUST you are generating and at what rate
- Whether the Cardano on-chain state matches what the Midnight indexer reports
- A full history of your registration and de-registration transactions

> **Non-custodial.** The tool never asks for your seed phrase or private keys. All wallet actions happen inside your own wallet extension.

---

## What you need

| Requirement | Notes |
|---|---|
| [Node.js](https://nodejs.org) 18 or newer | Download the LTS version from nodejs.org |
| A browser | Chrome, Firefox, Brave, or Edge |
| A Cardano wallet extension | Optional — needed only to register/deregister. Works with Lace, Eternl, Nami, and other CIP-30 wallets. |
| A Midnight wallet extension | Optional — needed only to read your live DUST balance and address. |

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
npm install
```

This downloads all required packages into a local `node_modules` folder. Nothing is installed system-wide.

**3. Create your configuration file**
```bash
cp .env.example .env.local
```

The default values in `.env.example` already point to the public Midnight mainnet endpoints. You do not need to change anything for normal use.

**4. Start the app**
```bash
npm run dev
```

**5. Open your browser**

Go to [http://localhost:3000](http://localhost:3000)

The inspector is now running locally on your computer. Nothing is sent to any server you do not control.

---

## How to use it

### Check a stake address without a wallet

Enter your Cardano stake address (starts with `stake1...`) in the input field and press **Inspect**. You will see your NIGHT balance, registration status, and transaction history.

### Connect your Cardano wallet

Click **Connect** in the Cardano section and choose your wallet extension. This lets you register or deregister directly from the inspector. Every transaction must be reviewed and signed in your wallet — the tool never signs anything on your behalf.

### Connect your Midnight wallet

Click **Connect** in the Midnight section to read your DUST balance, generation rate, and DUST address. This is read-only — the tool cannot submit Midnight transactions.

---

## Safety

- The tool **never asks for your seed phrase or private keys**
- It **never stores** your wallet data
- Wallet signing always happens **inside your wallet extension**, not in this app
- Inspection without a wallet is completely **read-only**
- The Cardano and Midnight wallet connections can be **disconnected** at any time

---

## Configuration

The file `.env.local` controls which endpoints the app uses. The defaults work for Midnight mainnet.

```bash
# Midnight Indexer (GraphQL)
NEXT_PUBLIC_MIDNIGHT_INDEXER_URL=https://indexer.mainnet.midnight.network/api/v4/graphql

# Midnight network
NEXT_PUBLIC_MIDNIGHT_NETWORK_ID=mainnet

# Cardano data provider (Koios)
CARDANO_KOIOS_URL=https://api.koios.rest/api/v1

# NIGHT token identifiers
CARDANO_NIGHT_POLICY_ID=0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa
CARDANO_NIGHT_ASSET_NAME=4e49474854
```

You only need to change these if you run your own indexer or a private Cardano data provider.

---

## Stopping the app

Press `Ctrl + C` in the terminal where `npm run dev` is running.

---

## Troubleshooting

**The page does not load**
Make sure `npm run dev` is still running and open [http://localhost:3000](http://localhost:3000) (not https).

**"Cannot find module" error after `npm run dev`**
Run `npm install` again. This usually fixes missing packages.

**Wallet does not appear in the list**
Make sure the wallet extension is installed and enabled in your browser. Some wallets need to be unlocked first.

**Registration status looks wrong**
The Midnight indexer can take up to 24 hours to reflect a recent Cardano transaction. The inspector shows you both the on-chain Cardano state and the indexer state so you can see exactly where any delay is.

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
