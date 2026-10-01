// M4 and M6 reproduction: the registry figures at the pin, recorded per pin
// in docs/evidence/registry-figures.json and rendered from that one record
// into the three places that cite them: the literal block in
// tests/unit/registry-figures.test.mjs, the M4 block and the M6 row of
// docs/MEASUREMENTS.md, and the Registry facts row of
// docs/UPSTREAM_CONTRACT.md. Measured on the 0.6.10 bump: the same
// figures were retyped by hand in nine files, and four of them
// (preflight.mjs, MARKETPLACE.md, HOW.md, INSPECT_DESIGN.md) no test reads.
// Without --write it prints the record entry for the pin and names each
// file that is not yet rendered from it; with --write it records the entry
// and rewrites those files.
//
// Every name in the output (outcomes, capabilities, finding rules) is a key
// of the registry's own data, never typed here.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { MARKETPLACE_PIN, requirePin } from "./pin.mjs"
import { baselineFigures, figure } from "./registry.mjs"

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)))

export const RECORD_PATH = "docs/evidence/registry-figures.json"
export const TEST_PATH = "tests/unit/registry-figures.test.mjs"
export const MEASUREMENTS_PATH = "docs/MEASUREMENTS.md"
export const CONTRACT_PATH = "docs/UPSTREAM_CONTRACT.md"

const TEST_BLOCK = /\/\/ registry-figures:begin[^\n]*\n[\s\S]*?\/\/ registry-figures:end\n/
const M4_BLOCK = /<!-- registry-figures:m4 -->\n[\s\S]*?<!-- \/registry-figures:m4 -->\n/
const M6_ROW = /^\| Listed sources whose validated commit was superseded at least once \|.*\|$/m
const CONTRACT_ROW = /^\| Registry facts \|.*\|$/m

/** The record entry for the pinned checkout: its commit, when it was committed, and baselineFigures() over it. */
export function entryAtPin(pinDir) {
  const commit = execFileSync("git", ["-C", pinDir, "rev-parse", "HEAD"], { timeout: 60_000, encoding: "utf8" }).trim()
  const committedAt = execFileSync("git", ["-C", pinDir, "log", "-1", "--format=%cI", "HEAD"], { timeout: 60_000, encoding: "utf8" }).trim()
  return { commit, committedAt: new Date(committedAt).toISOString().replace(/\.000Z$/, "Z"), figures: baselineFigures({ pinDir }) }
}

/** The record with `entry` first, replacing an entry for the same commit; the others keep their order, newest first. */
export function upsert(record, entry) {
  return { ...record, pins: [entry, ...record.pins.filter((pin) => pin.commit !== entry.commit)] }
}

/** A table of counts, largest first and by name on a tie: the order every list here is printed in. */
const ranked = (table) => Object.entries(table).sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
const short = (commit) => commit.slice(0, 8)
const when = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
const percent = (part, whole) => ((part / whole) * 100).toFixed(1)

/** Prose wrapped at 76 columns, the way the documents are written. */
function wrap(text, width = 76) {
  const lines = []
  let line = ""
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines.join("\n")
}

/** The literal block the figures test holds the pin to. */
export function renderTest(text, record) {
  const [current] = record.pins
  const block = [
    `// registry-figures:begin rendered from ${RECORD_PATH} by \`node tools/marketplace/measure-registry-figures.mjs --write\`; change the record, not this block`,
    `const AT_PIN = Object.freeze(${JSON.stringify({ commit: current.commit, figures: current.figures }, null, 2)})`,
    "// registry-figures:end",
    "",
  ].join("\n")
  if (!TEST_BLOCK.test(text)) throw new Error(`${TEST_PATH} has no registry-figures block to render into`)
  return text.replace(TEST_BLOCK, () => block)
}

/** M4's figures and the earlier pins' table, and M6's superseded row. */
export function renderMeasurements(text, record) {
  const [current, ...earlier] = record.pins
  const f = current.figures
  const outcomes = ranked(f.outcomes)
  const lines = [
    "<!-- registry-figures:m4 -->",
    wrap(`From \`registry.json\` at the pin (\`${short(current.commit)}\`, ${when(current.committedAt)}): ${figure(f.sources)} listed sources, of which ${figure(f.withBaseline)} carry a recorded baseline (the rest were listed before the baseline existed or have no record):`),
    "",
    "| Outcome | Count |",
    "| --- | --- |",
    ...outcomes.map(([name, n]) => `| \`${name}\` | ${figure(n)} |`),
    `| Findings ever recorded, total | ${figure(f.findingsTotal)} (${ranked(f.findings).map(([name, n]) => `\`${name}\` ${figure(n)}`).join(", ")}) |`,
    "",
    wrap(`Capabilities recorded: ${ranked(f.capabilities).map(([name, n]) => `${name} ${figure(n)}`).join(", ")}.`),
  ]
  if (earlier.length) {
    lines.push(
      "",
      "At the earlier pins, counted the same way from the same two files:",
      "",
      `| Pin | Sources | With a baseline | ${outcomes.map(([name]) => `\`${name}\``).join(" | ")} |`,
      `| --- | --- | --- | ${outcomes.map(() => "---").join(" | ")} |`,
      ...earlier.map((pin) => `| \`${short(pin.commit)}\` (${when(pin.committedAt)}) | ${figure(pin.figures.sources)} | ${figure(pin.figures.withBaseline)} | ${outcomes.map(([name]) => figure(pin.figures.outcomes[name] || 0)).join(" | ")} |`),
    )
  }
  lines.push("<!-- /registry-figures:m4 -->", "")
  const superseded = (pin) => `${figure(pin.figures.superseded.sources)} of ${figure(pin.figures.sources)}, ${percent(pin.figures.superseded.sources, pin.figures.sources)}%, ${figure(pin.figures.superseded.commits)} commits`
  const row = `| Listed sources whose validated commit was superseded at least once | ${figure(f.superseded.sources)} of ${figure(f.sources)} (${percent(f.superseded.sources, f.sources)}%) at pin \`${short(current.commit)}\`, ${figure(f.superseded.commits)} superseded commits, one source revalidated ${f.superseded.most} times${earlier.length ? ` (${earlier.map((pin) => `at pin \`${short(pin.commit)}\`: ${superseded(pin)}`).join("; ")})` : ""} |`
  if (!M4_BLOCK.test(text)) throw new Error(`${MEASUREMENTS_PATH} has no registry-figures:m4 block to render into`)
  if (!M6_ROW.test(text)) throw new Error(`${MEASUREMENTS_PATH} has no superseded row in M6 to render into`)
  return text.replace(M4_BLOCK, () => lines.join("\n")).replace(M6_ROW, () => row)
}

/** The Registry facts row of the pinned-checkout table. */
export function renderContract(text, record) {
  const f = record.pins[0].figures
  const row = `| Registry facts | ${figure(f.listingValidated)} sources with \`listingValidatedCommit\`; ${figure(f.withBaseline)} with an \`automatedSecurityBaseline\` record (${ranked(f.outcomes).map(([name, n]) => `${figure(n)} ${name}`).join(", ")}); ${figure(f.catalogPlugins)} catalog plugin ids; ${figure(f.retiredIds)} retired ids; ${figure(f.superseded.sources)} sources (${percent(f.superseded.sources, f.sources)}%) with at least one superseded validated commit, ${figure(f.superseded.commits)} superseded commits in all |`
  if (!CONTRACT_ROW.test(text)) throw new Error(`${CONTRACT_PATH} has no Registry facts row to render into`)
  return text.replace(CONTRACT_ROW, () => row)
}

/** Each file the record renders into, as it is and as the record would have it. */
export function renderAll(record, read = (path) => readFileSync(join(ROOT, path), "utf8")) {
  return [
    { path: RECORD_PATH, now: read(RECORD_PATH), next: `${JSON.stringify(record, null, 2)}\n` },
    { path: TEST_PATH, now: read(TEST_PATH), next: renderTest(read(TEST_PATH), record) },
    { path: MEASUREMENTS_PATH, now: read(MEASUREMENTS_PATH), next: renderMeasurements(read(MEASUREMENTS_PATH), record) },
    { path: CONTRACT_PATH, now: read(CONTRACT_PATH), next: renderContract(read(CONTRACT_PATH), record) },
  ]
}

/**
 * The pin's entry recorded and every file rendered from the record. With
 * `write`, the files that differ are written; without, nothing is. Returns
 * the entry and, per file, whether it was (or would be) rewritten.
 */
export function measureRegistryFigures({ repoRoot = ROOT, pinDir = requirePin(repoRoot).dir, write = false } = {}) {
  const entry = entryAtPin(pinDir)
  if (entry.commit !== MARKETPLACE_PIN.commit) throw new Error(`the checkout at ${pinDir} is at ${entry.commit}, not the pin ${MARKETPLACE_PIN.commit}`)
  const read = (path) => readFileSync(join(repoRoot, path), "utf8")
  const record = upsert(JSON.parse(read(RECORD_PATH)), entry)
  const files = renderAll(record, read)
  if (write) {
    for (const file of files.filter((candidate) => candidate.next !== candidate.now)) writeFileSync(join(repoRoot, file.path), file.next)
  }
  return { entry, files: Object.fromEntries(files.map((file) => [file.path, file.next === file.now ? "current" : write ? "written" : "stale"])) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const unknown = args.filter((arg) => arg !== "--write")
  if (unknown.length) {
    process.stderr.write(`usage: node tools/marketplace/measure-registry-figures.mjs [--write]; not ${unknown.join(" ")}\n`)
    process.exit(2)
  }
  const result = measureRegistryFigures({ write: args.includes("--write") })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!args.includes("--write") && Object.values(result.files).includes("stale")) process.exitCode = 1
}
