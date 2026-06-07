import { z } from "zod"
import { stakeAddressSchema } from "@/lib/validation"
import { inspectRegistrationTimeline } from "@/services/registrationTimelineClient"

const requestSchema = z.object({
  stakeAddress: stakeAddressSchema,
})

export async function POST(request: Request) {
  const checkedAt = new Date().toISOString()

  let body: unknown

  try {
    body = await request.json()
  } catch {
    return Response.json(
      {
        timeline: null,
        cardanoAccountSnapshot: null,
        controlledError: {
          code: "UNKNOWN_ERROR",
          message: "The request body could not be read.",
          userMessage: "The Cardano timeline could not be checked.",
          technicalDetails: ["The API request body was not valid JSON."],
          raw: null,
          checkedAt,
        },
      },
      { status: 400 },
    )
  }

  const parsedBody = requestSchema.safeParse(body)

  if (!parsedBody.success) {
    return Response.json(
      {
        timeline: null,
        cardanoAccountSnapshot: null,
        controlledError: {
          code: "INVALID_ADDRESS",
          message: "The submitted stake address could not be checked.",
          userMessage:
            parsedBody.error.issues[0]?.message ??
            "The stake address could not be checked.",
          technicalDetails: parsedBody.error.issues.map(
            (issue) =>
              `${issue.path.join(".") || "stakeAddress"}: ${issue.message}`,
          ),
          raw: body,
          checkedAt,
        },
      },
      { status: 400 },
    )
  }

  const result = await inspectRegistrationTimeline(
    parsedBody.data.stakeAddress,
    {
      checkedAt,
    },
  )

  return Response.json(result)
}
