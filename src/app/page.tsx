import { Suspense } from "react"
import { InspectorApp } from "@/components/InspectorApp"

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-100">
      <Suspense>
        <InspectorApp />
      </Suspense>
    </main>
  )
}
