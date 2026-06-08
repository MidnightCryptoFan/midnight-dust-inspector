"use client"

import { useState } from "react"

const TIP_ADDRESS =
  "addr1qyv69hnr0mft9adpzsukvst3lt33xv77fzxyc03g0z6k2984t3vksywnhmat59eg9ltexupat2hpp9cmwdns9j054ayqykv7ae"

export function TipPanel() {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(TIP_ADDRESS)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard not available
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Support this tool
        </h2>
        <a
          href="https://midnightcryptofan.github.io/midnight-dust-inspector-help/#support"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          ? Help
        </a>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        This is a free, open-source community tool built and maintained by a
        Midnight community member.
      </p>

      <div className="mt-3">
        <button
          onClick={() => setOpen(true)}
          className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          I want to support this tool
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Support this tool
              </h3>
              <button
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
              Thank you! You can send ADA or NIGHT to the Cardano address below.
              Every tip helps keep this tool free and actively maintained.
            </p>

            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Tip address (ADA / NIGHT)
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 font-mono text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {TIP_ADDRESS}
                </code>
              </div>
              <button
                onClick={handleCopy}
                className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                {copied ? "Copied!" : "Copy address"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
