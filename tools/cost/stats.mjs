// The arithmetic behind every figure: a median with its spread, and the
// comparison that decides "within noise". Kept apart so tests/unit/cost.test.mjs
// can hold it to known inputs without a shell.

/** The median of a list; null when the list is empty. */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Highest minus lowest; null when the list is empty. */
export function spread(values) {
  if (!values.length) return null
  return Math.max(...values) - Math.min(...values)
}

/**
 * A figure over runs: `{ median, spread, min, max, runs }`. `runs` keeps the
 * value per run, in run order, so a reader can see the three numbers a
 * median came from.
 */
export function stats(values) {
  return {
    median: median(values),
    spread: spread(values),
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    runs: [...values],
  }
}

/**
 * Within noise: the median delta is not larger in magnitude than the
 * baseline's own spread. Null median (no run completed) is unknown, and a
 * null floor (no baseline run) is unknown too.
 *
 * @returns {"within-noise"|"above-noise"|"unknown"}
 */
export function verdict(delta, floor) {
  if (delta === null || delta === undefined || floor === null || floor === undefined) return "unknown"
  return Math.abs(delta) <= floor ? "within-noise" : "above-noise"
}

/** A number for a person: two decimals, no trailing zeros beyond the first, never "-0". */
export function figure(value, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "?"
  const rounded = Number(value.toFixed(decimals))
  return String(Object.is(rounded, -0) ? 0 : rounded)
}
