"use client"

const faqs: { question: string; answer: string }[] = [
  {
    question: "Why are there two blockchains — and why might I need two wallets?",
    answer:
      "Midnight and Cardano are two separate but connected blockchains. Cardano is where your NIGHT tokens live and where registration transactions are submitted. Midnight is where DUST is generated and where the Midnight DApp ecosystem runs.\n\nBecause they are independent networks, each has its own wallet: a Cardano wallet (e.g. Lace or Eternl) manages your NIGHT and handles registration transactions, while a Midnight wallet holds your DUST and your Midnight address. The two wallets are linked by the registration — it tells the Midnight network which Midnight address should receive DUST for a given Cardano stake key.\n\nYou do not need to connect both wallets to use this inspector. A Cardano wallet or even just a stake address is enough to check your registration status. The Midnight wallet connection is optional and only needed to read your live DUST balance and address.",
  },
  {
    question: "What is DUST and where does it come from?",
    answer:
      "DUST is the native token of the Midnight network. It is generated automatically when you register your Cardano stake key that holds NIGHT tokens. Once registered, DUST accumulates over time based on your NIGHT balance — no manual claiming required.",
  },
  {
    question: "What is NIGHT and what does it have to do with DUST?",
    answer:
      "NIGHT is Midnight's token on the Cardano blockchain. It serves as the basis for DUST generation: the more unlocked NIGHT you hold under a registered stake key, the faster DUST is generated. Locked NIGHT (e.g. from airdrop vesting) does not count toward the DUST cap.",
  },
  {
    question: "What is the DUST cap — why does generation stop?",
    answer:
      "The DUST cap is the maximum amount of DUST your wallet can accumulate. It is calculated as 5× your unlocked NIGHT balance. Once your DUST balance reaches the cap, generation pauses until you spend some DUST on the Midnight network.",
  },
  {
    question: "How long does it take for a registration to become active?",
    answer:
      "The registration transaction confirms on Cardano within a few minutes. However, the Midnight indexer — which tracks registrations — can take up to 24 hours to reflect the change. During this window the inspector may still show your status as inactive even though everything is in order.",
  },
  {
    question: "Can I lose my NIGHT by registering?",
    answer:
      "No. Registration only creates a pointer on Cardano that tells the Midnight network which stake key to credit. Your NIGHT tokens stay in your wallet at all times and are never moved, locked, or at risk during registration or deregistration.",
  },
  {
    question: "What happens if I register more than once?",
    answer:
      "Only one active registration per Midnight wallet address is valid. Registering a second time from a different Cardano stake key while one is already active can create a conflict. This inspector checks for exactly this situation and warns you before you take action.",
  },
  {
    question: "I am registered but see no DUST — what should I do?",
    answer:
      "First check the DUST cap: if your DUST balance already equals 5× your unlocked NIGHT, generation has paused and will resume once you spend some DUST. If the cap is not reached, the Midnight indexer may still be syncing — wait up to 24 hours after your registration confirmed and check again.",
  },
  {
    question:
      "My status keeps switching between active and inactive — is that normal?",
    answer:
      "Not in the long run, but it can happen during the 24-hour window after a registration or deregistration. The Midnight indexer and the Cardano on-chain state update at different speeds. This inspector shows you both states so you can see exactly where any mismatch is coming from.",
  },
  {
    question: "Is this tool safe — does it get access to my wallet?",
    answer:
      "Yes, it is safe. The inspector never asks for your seed phrase or private keys. Wallet connections use your browser wallet extension (CIP-30 for Cardano, DApp Connector for Midnight), and all transaction signing happens inside the extension — never inside this app. You can also inspect any stake address without connecting a wallet at all.",
  },
  {
    question: "Which wallets are supported?",
    answer:
      "For Cardano: any CIP-30 compatible wallet extension, including Lace, Eternl, and Nami. For reading your DUST balance and address: a Midnight DApp Connector compatible wallet. Wallet connections are optional — the inspector works in read-only mode with just a stake address.",
  },
]

export function FaqPanel() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
          Frequently Asked Questions
        </h2>
        <a
          href="https://midnightcryptofan.github.io/midnight-dust-inspector-help/#faq"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          Help?
        </a>
      </div>
      <dl className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
        {faqs.map(({ question, answer }) => (
          <details key={question} className="group py-3">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-sm font-semibold text-slate-800 marker:hidden dark:text-slate-200">
              <span>{question}</span>
              <span className="mt-0.5 shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-180 dark:text-slate-500">
                ▾
              </span>
            </summary>
            <div className="mt-3 space-y-2">
              {answer.split("\n\n").map((paragraph, i) => (
                <p
                  key={i}
                  className="text-sm leading-6 text-slate-600 dark:text-slate-400"
                >
                  {paragraph}
                </p>
              ))}
            </div>
          </details>
        ))}
      </dl>
    </section>
  )
}
