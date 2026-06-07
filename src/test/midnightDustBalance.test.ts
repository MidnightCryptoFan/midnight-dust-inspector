import { describe, expect, test } from "vitest"
import {
  createMidnightWalletError,
  formatDustQuantity,
} from "@/domain/midnightDustBalance"

describe("Midnight DUST balance helpers", () => {
  test("formats wallet-reported DUST quantities", () => {
    expect(formatDustQuantity("0")).toBe("0 DUST")
    expect(formatDustQuantity("441800")).toBe("<1 DUST")
    expect(formatDustQuantity("1000000000000000")).toBe("1 DUST")
    expect(formatDustQuantity("55544952560721783320")).toBe("55.54k DUST")
    expect(formatDustQuantity("56116180242237885826")).toBe("56.12k DUST")
    expect(formatDustQuantity("441798827245000000000")).toBe("441.8k DUST")
    expect(formatDustQuantity(null)).toBe("Not reported")
  })

  test("creates user-friendly controlled wallet errors", () => {
    const error = createMidnightWalletError({
      code: "NO_WALLET",
      message: "Wallet missing.",
      userMessage: "The selected Midnight wallet was not found.",
      checkedAt: "2026-06-06T00:00:00.000Z",
    })

    expect(error.code).toBe("NO_WALLET")
    expect(error.userMessage).toContain("Midnight wallet")
  })
})
