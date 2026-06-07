import type { IndexerInspectionResult } from "@/domain/dustStatus"

export async function inspectDustGenerationStatusFromApi(
  stakeAddress: string,
): Promise<IndexerInspectionResult> {
  const response = await fetch("/api/dust-status", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ stakeAddress }),
  })

  return (await response.json()) as IndexerInspectionResult
}
