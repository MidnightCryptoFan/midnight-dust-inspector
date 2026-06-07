import type { RegistrationTimelineInspectionResult } from "@/domain/registrationTimeline"

export async function inspectRegistrationTimelineFromApi(
  stakeAddress: string,
): Promise<RegistrationTimelineInspectionResult> {
  const response = await fetch("/api/registration-timeline", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ stakeAddress }),
  })

  return (await response.json()) as RegistrationTimelineInspectionResult
}
