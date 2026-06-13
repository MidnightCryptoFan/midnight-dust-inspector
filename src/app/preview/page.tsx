"use client"

import { notFound } from "next/navigation"
import { useState } from "react"
import { CardanoInspectionPanel } from "@/components/CardanoInspectionPanel"
import { previewScenarios, type PreviewScenario } from "./scenarios"

export default function PreviewPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound()
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Dev preview</strong> — all states use mock data. This page
          returns 404 in production.
        </div>

        <h1 className="text-xl font-bold text-slate-800">UI State Preview</h1>

        {previewScenarios.map((scenario) => (
          <ScenarioCard key={scenario.id} scenario={scenario} />
        ))}
      </div>
    </div>
  )
}

function ScenarioCard({ scenario }: { scenario: PreviewScenario }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left hover:bg-slate-50"
      >
        <div>
          <p className="font-semibold text-slate-800">{scenario.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {scenario.description}
          </p>
        </div>
        <span className="mt-0.5 text-slate-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-4">
          <CardanoInspectionPanel
            snapshot={scenario.snapshot}
            indexerStatus={scenario.indexerStatus}
            onChainState={scenario.onChainState}
            isOnChainLoading={scenario.isOnChainLoading}
            walletConnected={false}
            midnightAddress={null}
            dustGrowthStatus={scenario.dustGrowthStatus}
            activeRegistrationLookup={{ status: "idle" }}
            timeline={scenario.timeline}
            timelineError={null}
            recentActivity={scenario.recentActivity}
            onRegister={() => {}}
            onDeregister={() => {}}
            onFindActiveSource={() => {}}
            onInspectActiveSource={() => {}}
            onRefresh={() => {}}
          />
        </div>
      )}
    </div>
  )
}
