// The review patterns of docs/INSPECT.md as data. Part 2 of the design
// note fills this table; until then it is empty, and the report ends on
// the blind spots and the closing line.

export const PATTERNS = Object.freeze([])

/**
 * @param {object} facts the observed facts of one document
 * @returns {{ patterns: Array, lookedFor: string[] }}
 */
export function evaluatePatterns(facts) {
  const patterns = []
  const lookedFor = []
  for (const pattern of PATTERNS) {
    const found = pattern.precondition(facts)
    if (found.sites.length) patterns.push({ id: pattern.id, observedCount: found.sites.length, sites: found.sites, observation: found.observation, measurement: pattern.measurement, share: pattern.share })
    else lookedFor.push(pattern.id)
  }
  return { patterns, lookedFor }
}
