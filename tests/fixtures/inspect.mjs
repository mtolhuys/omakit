// The inspect fixtures, materialised the way every check reads a plugin: a
// temporary Git repository at one commit, with an origin so the marketplace
// baseline runs over it. The trees live under tests/fixtures/inspect/<name>/
// (and tests/fixtures/weigh/timer-180ms/ for the timer), the expected
// document beside each as <name>.expected.json.

import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { materialise } from "./plugins.mjs"

const HERE = fileURLToPath(new URL(".", import.meta.url))

/** Every inspect fixture by name, with the directory its tree is read from. */
export const INSPECT_FIXTURES = Object.freeze([
  ...readdirSync(join(HERE, "inspect"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  "timer-180ms",
].sort())

export function inspectFixtureDir(name) {
  return name === "timer-180ms" ? join(HERE, "weigh", name) : join(HERE, "inspect", name)
}

export function inspectExpectedPath(name) {
  return join(HERE, "inspect", `${name}.expected.json`)
}

function readTree(dir, base = dir, out = {}) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) readTree(path, base, out)
    else out[relative(base, path)] = readFileSync(path, "utf8")
  }
  return out
}

/**
 * @param {string} name
 * @returns {{ dir: string, commit: string, origin: string }}
 */
export function materialiseInspectFixture(name) {
  const origin = `https://github.com/example/omarchy-plugin-fixture-${name}`
  const files = readTree(inspectFixtureDir(name))
  return { ...materialise(files, { origin }), origin }
}
