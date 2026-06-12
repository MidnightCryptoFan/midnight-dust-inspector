"use client"

import { useState } from "react"

export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setState("copied")
      window.setTimeout(() => setState("idle"), 1_500)
    } catch {
      setState("failed")
      window.setTimeout(() => setState("idle"), 2_500)
    }
  }

  return (
    <button
      className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
      type="button"
      onClick={handleCopy}
    >
      {state === "copied" ? "Copied!" : state === "failed" ? "Failed" : "Copy"}
    </button>
  )
}
