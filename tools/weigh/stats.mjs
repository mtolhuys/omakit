// The arithmetic behind every figure: a median with its spread, and the
// comparison that decides "within noise". Kept apart so tests/unit/weigh.test.mjs
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
 * Within noise, or above it. A delta is above noise only when its magnitude
 * exceeds the baseline's own spread and exceeds `quantum`, the smallest
 * difference the measurement can express. For CPU that is one clock tick
 * over the window (`tickPercent`); for memory it is zero, because a page is
 * far below any floor. Measured in the lab on 14 September 2026: a plugin
 * whose CPU delta was one tick over its 15.003 s window (-0.066662%) read
 * as above a floor of one tick over a 15.005 s window (0.066653%), and one
 * tick against one tick is no difference at all. A null median (no run
 * completed) or a null floor (no baseline run) is unknown.
 *
 * @returns {"within-noise"|"above-noise"|"unknown"}
 */
export function verdict(delta, floor, quantum = 0) {
  if (delta === null || delta === undefined || floor === null || floor === undefined) return "unknown"
  const size = Math.abs(delta)
  return size > floor && size > quantum ? "above-noise" : "within-noise"
}

/** One clock tick over the window, as CPU percent: the quantum of every CPU figure here. */
export function tickPercent(clockTicksPerSecond, windowSeconds) {
  return 100 / (clockTicksPerSecond * windowSeconds)
}

/** A number for a person: two decimals, no trailing zeros beyond the first, never "-0". */
export function figure(value, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "?"
  const rounded = Number(value.toFixed(decimals))
  return String(Object.is(rounded, -0) ? 0 : rounded)
}
