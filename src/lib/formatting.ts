export function formatNullableValue(value: string | null | undefined): string {
  if (value == null || value.trim().length === 0) {
    return "Not reported"
  }

  return value
}

export function formatBooleanStatus(value: boolean | null | undefined): string {
  if (value === true) {
    return "Yes"
  }

  if (value === false) {
    return "No"
  }

  return "Not reported"
}

export function formatCheckedAt(value: string | null | undefined): string {
  if (!value) {
    return "Not checked"
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  })
}

export function formatCompactAtomicQuantity(
  atomicValue: bigint,
  atomicUnitsPerUnit: bigint,
): string {
  if (atomicUnitsPerUnit <= 0n) {
    throw new Error("atomicUnitsPerUnit must be positive.")
  }

  if (atomicValue === 0n) {
    return "0"
  }

  const sign = atomicValue < 0n ? "-" : ""
  const absoluteValue = atomicValue < 0n ? -atomicValue : atomicValue
  const suffixes = [
    { scale: 1_000_000_000_000n, suffix: "T" },
    { scale: 1_000_000_000n, suffix: "B" },
    { scale: 1_000_000n, suffix: "M" },
    { scale: 1_000n, suffix: "k" },
  ]

  for (const { scale, suffix } of suffixes) {
    const denominator = atomicUnitsPerUnit * scale

    if (absoluteValue >= denominator) {
      const hundredths = roundDiv(absoluteValue * 100n, denominator)
      const whole = hundredths / 100n
      const frac = hundredths % 100n

      if (frac === 0n) {
        return `${sign}${whole}${suffix}`
      }
      if (frac % 10n === 0n) {
        return `${sign}${whole}.${frac / 10n}${suffix}`
      }
      const fracStr = frac < 10n ? `0${frac}` : `${frac}`
      return `${sign}${whole}.${fracStr}${suffix}`
    }
  }

  const roundedWhole = roundDiv(absoluteValue, atomicUnitsPerUnit)

  if (roundedWhole === 0n) {
    return `${sign}<1`
  }

  return `${sign}${roundedWhole}`
}

function roundDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator
}

export function stringifyForDisplay(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, nestedValue: unknown) =>
      typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue,
    2,
  )
}
