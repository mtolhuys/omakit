// The one contract every command leaves through (tools/marketplace/outcome.mjs,
// docs/COMMANDS.md), held here per command and per outcome, in a table:
//
//   exit     0 success, 1 a refusal or failure the tool means, 2 usage; a
//            stop asked for by a signal exits 128 plus the signal number.
//   --json   exactly one document on stdout, whatever happened:
//            { command, ok, error, ...document }, error null on success and
//            { code, message, remedy } otherwise, remedy never null; the
//            sentence is on stderr too.
//   streams  the text is on stdout on exit 0 and on stderr on any other exit;
//            a piped stderr is empty on success.
//   --out    the document, written on every outcome; with --json stdout then
//            carries nothing at all, and without it the text says so.
//
// Measured on 2026-09-19 by a first user (docs/evidence/ux/2026-09-19-
// first-user-test.json, finding 10) and an acceptance tester (docs/evidence/
// ux/2026-09-19-acceptance.json, findings 2 and 3): four commands left
// stdout empty on a failure, seven shaped their documents seven ways, `lab
// prune --json` printed nothing, `watch` exited 2 on a verdict, `add` on
// EACCES carried `remedy: null`, `lab inspect` and `audit` wrote a failing
// result to stdout only, and a failed `--json --out` created no file. Every
// row below runs the real entry point on a fixture and holds all of it.
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir, userInfo } from "node:os"
import { join } from "node:path"
import { ACCEPTED } from "../../tools/marketplace/options.mjs"
import { EXIT, SIGNAL_EXIT } from "../../tools/marketplace/outcome.mjs"
import { materialise, GOOD } from "../fixtures/plugins.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

const pinDir = requirePinForTests()
const ENTRY = join(REPO_ROOT, "bin/omakit")

function omakit(args, { env = {}, root = REPO_ROOT, cwd } = {}) {
  const result = spawnSync(process.execPath, [join(root, "bin/omakit"), ...args], { timeout: 120_000, encoding: "utf8", cwd, env: { ...process.env, TERM: "dumb", NO_COLOR: "1", FORCE_COLOR: undefined, ...env } })
  return { status: result.status, signal: result.signal, out: result.stdout, err: result.stderr }
}

const scratch = mkdtempSync(join(tmpdir(), "omakit-contract-"))
const readOnly = []
test.after(() => {
  for (const dir of readOnly) chmodSync(dir, 0o755)
  rmSync(scratch, { recursive: true, force: true })
})

/** A HOME of its own with the real pin linked into its cache, so nothing fetches and nothing reads this machine's state. */
function isolatedHome(name) {
  const home = join(scratch, name)
  mkdirSync(join(home, "cache/omakit"), { recursive: true })
  if (!existsSync(join(home, "cache/omakit/marketplace"))) symlinkSync(pinDir, join(home, "cache/omakit/marketplace"))
  return { HOME: home, XDG_CACHE_HOME: join(home, "cache"), XDG_STATE_HOME: join(home, "state"), XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "share") }
}
/** A HOME with no pin, no lab, nothing: what a first run meets. */
function emptyHome(name) {
  const home = join(scratch, name)
  mkdirSync(home, { recursive: true })
  return { HOME: home, XDG_CACHE_HOME: join(home, "cache"), XDG_STATE_HOME: join(home, "state"), XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "share") }
}

const good = materialise(GOOD, { origin: "https://github.com/example/omarchy-plugin-fixture-good" })
const dirty = materialise(GOOD, { origin: "https://github.com/example/omarchy-plugin-fixture-good", dirty: true })
const LISTED_MANIFEST = JSON.stringify({ ...JSON.parse(GOOD["manifest.json"]), id: "io.github.mtolhuys.disk-lens" }) + "\n"
const taken = materialise({ ...GOOD, "manifest.json": LISTED_MANIFEST }, { origin: "https://github.com/example/omarchy-plugin-fixture-taken" })

/** A plugin directory for `add`: a manifest and nothing else. */
function pluginDir(name) {
  const dir = join(scratch, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify({ schemaVersion: 1, id: `fixture.${name}`, name, version: "0.0.1" })}\n`)
  return dir
}

/** A copy of the tool with a .git and no origin, for upgrade's refusal; and one whose cache has no pin, for doctor's problem. */
function copyOfTool(name, { git = false } = {}) {
  const root = join(scratch, name)
  for (const entry of ["bin", "tools", "package.json"]) cpSync(join(REPO_ROOT, entry), join(root, entry), { recursive: true })
  if (git) execFileSync("git", ["-C", root, "init", "-q"], { timeout: 60_000 })
  return root
}

/**
 * The audit stubs of tests/unit/audit.test.mjs: an `omarchy` and an
 * `omarchy-plugin-catalog` that answer from the environment, and a `git`
 * that answers the audit's read-only questions for one directory.
 */
function auditStubs(name, { sourceDir = true, head } = {}) {
  const root = join(scratch, name)
  const bin = join(root, "bin")
  const plugin = join(root, "plugin")
  mkdirSync(bin, { recursive: true })
  mkdirSync(plugin, { recursive: true })
  const catalog = JSON.parse(readFileSync(join(pinDir, "site/catalog.json"), "utf8"))
  const entry = catalog.plugins.find((plugin) => plugin.sourceType !== "builtin" && (plugin.upstreamValidatedCommit || plugin.listingValidatedCommit))
  const validated = (entry.upstreamValidatedCommit || entry.listingValidatedCommit).toLowerCase()
  const realGit = spawnSync("sh", ["-c", "command -v git"], { timeout: 120_000, encoding: "utf8" }).stdout.trim()
  const script = (file, text) => { writeFileSync(join(bin, file), `#!/bin/sh\n${text}\n`); chmodSync(join(bin, file), 0o755) }
  script("omarchy", "printf '%s\\n' \"$AUDIT_INSTALLED_JSON\"")
  script("omarchy-plugin-catalog", "printf '%s\\n' \"$AUDIT_SHELL_CATALOG\"")
  script("git", [
    'if [ "$1" = "-C" ] && [ "$2" = "$AUDIT_SOURCE_DIR" ]; then',
    '  case "$3 $4 $5" in',
    '    "rev-parse HEAD ") printf "%s\\n" "$AUDIT_HEAD"; exit 0 ;;',
    '    "status --porcelain ") exit 0 ;;',
    '    "remote get-url origin") printf "%s\\n" "$AUDIT_REPOSITORY"; exit 0 ;;',
    '    "cat-file -e "*) exit 0 ;;',
    '    "merge-base --is-ancestor"*) exit 0 ;;',
    '    "rev-list --count "*) printf "2\\n"; exit 0 ;;',
    "  esac",
    "fi",
    'exec "$AUDIT_REAL_GIT" "$@"',
  ].join("\n"))
  return {
    PATH: `${bin}:${process.env.PATH}`,
    AUDIT_INSTALLED_JSON: JSON.stringify([{ id: entry.id, name: entry.name, kinds: entry.kinds || [], enabled: true, firstParty: false }]),
    AUDIT_SHELL_CATALOG: JSON.stringify([sourceDir ? { id: entry.id, sourceDir: plugin } : { id: entry.id }]),
    AUDIT_SOURCE_DIR: plugin,
    AUDIT_REPOSITORY: entry.repo,
    AUDIT_REAL_GIT: realGit,
    AUDIT_HEAD: head === "validated" ? validated : "f".repeat(40),
  }
}

/** Does the command's option table take the flag, so a mode applies to it. */
function accepts(command, flag) {
  const table = ACCEPTED[command.split(" ")[0]]
  return Boolean(table && (table.flags.includes(flag) || table.valued.includes(flag)))
}

/**
 * One row of the table: what to run, the exit and the error code expected,
 * and (`setup`) how to prepare each run. Every row is run in every mode
 * its command accepts: as a person would, with --json, with --out, and
 * with both.
 */
const isRoot = userInfo().uid === 0
const canUnshare = process.platform === "linux" && spawnSync("unshare", ["-rn", "true"], { timeout: 60_000 }).status === 0
const ROWS = [
  // help and the front door
  { name: "help", command: "help", args: ["help"], exit: 0 },
  { name: "help --agent", command: "help", args: ["help", "--agent"], exit: 0 },
  { name: "help with an unknown option", command: "help", args: ["help", "--wat"], exit: 2, code: "usage" },
  // pin
  { name: "pin, present", command: "pin", args: ["pin"], exit: 0, env: () => isolatedHome("pin-present") },
  { name: "pin with an option it does not take", command: "pin", args: ["pin", "--wat"], exit: 2, code: "usage" },
  // setup
  { name: "setup with an unknown option", command: "setup", args: ["setup", "--wat"], exit: 2, code: "usage" },
  // submit
  { name: "submit ready", command: "submit", args: ["submit", good.dir, "--category", "Widgets", "--tags", "bar", "--offline"], exit: 0 },
  { name: "submit refused", command: "submit", args: ["submit", taken.dir, "--offline"], exit: 1, code: "refused" },
  { name: "submit without the editorial flags", command: "submit", args: ["submit", good.dir, "--offline"], exit: 2, code: "usage" },
  { name: "submit on a dirty tree", command: "submit", args: ["submit", dirty.dir, "--category", "Widgets", "--tags", "bar", "--offline"], exit: 1, code: "dirty-worktree" },
  { name: "submit with an empty target", command: "submit", args: ["submit", "", "--offline"], exit: 2, code: "usage" },
  { name: "submit with --category twice", command: "submit", args: ["submit", good.dir, "--category", "Widgets", "--category", "System", "--tags", "bar", "--offline"], exit: 2, code: "usage" },
  // watch
  { name: "watch with two modes", command: "watch", args: ["watch", "--all", "--list"], exit: 2, code: "usage" },
  { name: "watch without the network", command: "watch", args: ["watch", "https://github.com/omacom/omarchy-plugin-marketplace/issues/4403"], exit: 1, code: "network-unavailable", offline: true, skip: !canUnshare && "unshare -rn is not available here" },
  // verify
  { name: "verify a clean tree", command: "verify", args: ["verify", good.dir], exit: 0 },
  { name: "verify a dirty tree", command: "verify", args: ["verify", dirty.dir], exit: 1, code: "dirty-worktree" },
  { name: "verify without a target", command: "verify", args: ["verify"], exit: 2, code: "usage" },
  // parity
  { name: "parity --count 0", command: "parity", args: ["parity", "--count", "0"], exit: 2, code: "usage" },
  { name: "parity --count twice", command: "parity", args: ["parity", "--count", "1", "--count", "2"], exit: 2, code: "usage" },
  // audit
  { name: "audit without a shell", command: "audit", args: ["audit", "--offline"], exit: 1, code: "shell-not-running", env: () => ({ PATH: "/nonexistent" }) },
  { name: "audit with an unknown option", command: "audit", args: ["audit", "--wat"], exit: 2, code: "usage" },
  { name: "audit with an empty target", command: "audit", args: ["audit", ""], exit: 2, code: "usage" },
  { name: "audit, every row validated", command: "audit", args: ["audit", "--offline"], exit: 0, env: () => auditStubs("audit-validated", { head: "validated" }) },
  { name: "audit, drift", command: "audit", args: ["audit", "--offline"], exit: 1, code: "drift", env: () => auditStubs("audit-drift") },
  { name: "audit, nothing could be compared", command: "audit", args: ["audit", "--offline"], exit: 1, code: "not-compared", env: () => auditStubs("audit-unknown", { sourceDir: false }) },
  // weigh
  { name: "weigh with an unknown option", command: "weigh", args: ["weigh", "x", "--wat"], exit: 2, code: "usage" },
  { name: "weigh on a machine without omarchy-shell", command: "weigh", args: ["weigh", "x", "--yes"], exit: 1, code: "no-omarchy-shell", env: () => ({ PATH: "/nonexistent" }) },
  { name: "weigh --list without a shell", command: "weigh", args: ["weigh", "--list"], exit: 1, env: () => ({ PATH: "/nonexistent" }), anyCode: true, modes: ["human", "json"] },
  // inspect
  { name: "inspect a tree", command: "inspect", args: ["inspect", good.dir, "--offline"], exit: 0 },
  { name: "inspect a dirty tree", command: "inspect", args: ["inspect", dirty.dir, "--offline"], exit: 1, code: "dirty-worktree" },
  { name: "inspect a missing directory", command: "inspect", args: ["inspect", join(scratch, "nowhere")], exit: 2, code: "subject-not-found" },
  { name: "inspect with an empty target", command: "inspect", args: ["inspect", ""], exit: 2, code: "usage" },
  // add
  { name: "add run into a plugin", command: "add", args: ["add", "run", (mode) => pluginDir(`add-fresh-${mode}`)], exit: 0 },
  { name: "add run over a file that is there", command: "add", args: ["add", "run", (mode) => { const dir = pluginDir(`add-over-${mode}`); mkdirSync(join(dir, "omakit")); writeFileSync(join(dir, "omakit/Run.qml"), "// the plugin's own\n"); return dir }], exit: 1, code: "exists" },
  { name: "add an unknown block", command: "add", args: ["add", "nosuch", (mode) => pluginDir(`add-unknown-${mode}`)], exit: 1, code: "unknown-block" },
  { name: "add into a read-only directory", command: "add", args: ["add", "run", (mode) => { const dir = pluginDir(`add-readonly-${mode}`); chmodSync(dir, 0o555); readOnly.push(dir); return dir }], exit: 1, code: "EACCES", skip: isRoot && "root writes anywhere" },
  { name: "add with an unknown option", command: "add", args: ["add", "run", "--wat"], exit: 2, code: "usage" },
  // lab
  { name: "lab inspect on an empty home", command: "lab inspect", args: ["lab", "inspect", "--offline"], exit: 1, code: "lab-not-ready", env: () => emptyHome("lab-inspect") },
  { name: "lab inspect with a suite", command: "lab inspect", args: ["lab", "inspect", "run"], exit: 2, code: "usage" },
  { name: "lab prove on an empty home", command: "lab prove", args: ["lab", "prove", "run"], exit: 1, code: "lab-not-ready", env: () => emptyHome("lab-prove") },
  { name: "lab prove an unknown suite", command: "lab prove", args: ["lab", "prove", "nosuch"], exit: 2, code: "usage", env: () => emptyHome("lab-prove-usage") },
  { name: "lab setup blocked", command: "lab setup", args: ["lab", "setup"], exit: 1, code: "lab-blocked", env: () => emptyHome("lab-setup") },
  { name: "lab prune with nothing to prune", command: "lab prune", args: ["lab", "prune"], exit: 0, env: () => emptyHome("lab-prune-nothing") },
  { name: "lab prune unconfirmed in a pipe", command: "lab prune", args: ["lab", "prune"], exit: 2, code: "not-confirmed", env: () => { const env = emptyHome("lab-prune-ask"); mkdirSync(join(env.XDG_CACHE_HOME, "omakit/lab/plugins"), { recursive: true }); writeFileSync(join(env.XDG_CACHE_HOME, "omakit/lab/plugins/x"), "x"); return env } },
  { name: "lab with an unknown action", command: "lab", args: ["lab", "wat"], exit: 2, code: "usage" },
  // doctor
  { name: "doctor offline", command: "doctor", args: ["doctor", "--offline"], exit: 0, env: () => isolatedHome("doctor-ok") },
  { name: "doctor with a problem", command: "doctor", args: ["doctor", "--offline"], exit: 1, code: "problems", env: () => emptyHome("doctor-problem"), root: () => copyOfTool("doctor-nopin") },
  { name: "doctor with an unknown option", command: "doctor", args: ["doctor", "--wat"], exit: 2, code: "usage" },
  // upgrade
  { name: "upgrade refused", command: "upgrade", args: ["upgrade"], exit: 1, code: "refused", root: () => copyOfTool("upgrade-noorigin", { git: true }) },
  { name: "upgrade with an unknown option", command: "upgrade", args: ["upgrade", "--wat"], exit: 2, code: "usage" },
  // the unknown command
  { name: "an unknown command", command: null, args: ["wat"], exit: 2, plain: true },
]

/** The invariants of one run in one mode. */
function check(row, mode, result, { outFile = null } = {}) {
  const label = `${row.name} [${mode}]`
  assert.equal(result.status, row.exit, `${label}: exit ${result.status}\nstdout: ${result.out}\nstderr: ${result.err}`)
  const json = mode.includes("json")
  const out = mode.includes("out")
  // A usage error trusts no option on the refused command line: no --out is
  // written, and the document is on stdout.
  const fileExpected = out && row.code !== "usage"
  if (json) {
    if (fileExpected) {
      assert.equal(result.out, "", `${label}: with --json --out stdout carries nothing`)
    } else {
      assert.ok(result.out.trim().length > 0, `${label}: a document on stdout`)
      const document = JSON.parse(result.out) // one document: two would not parse
      assertEnvelope(row, document, label)
    }
    if (row.exit !== 0) assert.ok(result.err.trim().length > 0, `${label}: the failure's sentence is on stderr under --json`)
    else assert.equal(result.err, "", `${label}: nothing on stderr on success`)
  } else if (row.exit === 0) {
    assert.equal(result.err, "", `${label}: a piped stderr is empty on success`)
    if (row.command !== "pin") assert.ok(result.out.length > 0, `${label}: the text is on stdout`)
  } else {
    assert.equal(result.out, "", `${label}: nothing on stdout on exit ${row.exit}`)
    assert.ok(result.err.trim().length > 0, `${label}: the text is on stderr on exit ${row.exit}`)
    assert.doesNotMatch(result.err, /^\s+at /m, `${label}: no stack trace`)
  }
  if (fileExpected) {
    assert.ok(existsSync(outFile), `${label}: --out is written on every outcome`)
    const document = JSON.parse(readFileSync(outFile, "utf8"))
    assertEnvelope(row, document, `${label} (file)`)
    if (!json) assert.match(row.exit === 0 ? result.out : result.err, /wrote /, `${label}: the text says where the file went`)
  } else if (out) {
    assert.equal(existsSync(outFile), false, `${label}: a usage error writes no --out`)
  }
}

function assertEnvelope(row, document, label) {
  assert.deepEqual(Object.keys(document).slice(0, 3), ["command", "ok", "error"], `${label}: the envelope first`)
  assert.equal(document.command, row.command, `${label}: the command`)
  assert.equal(document.ok, row.exit === 0, `${label}: ok is the exit`)
  if (row.exit === 0) {
    assert.equal(document.error, null, `${label}: no error on success`)
  } else {
    assert.equal(typeof document.error, "object", `${label}: an error object`)
    if (!row.anyCode) assert.equal(document.error.code, row.code, `${label}: the code`)
    assert.ok(typeof document.error.message === "string" && document.error.message.length > 0, `${label}: a message`)
    assert.ok(/[.?!]$/.test(document.error.message) && !/\.\.$/.test(document.error.message), `${label}: one sentence, one full stop: ${document.error.message}`)
    assert.ok(typeof document.error.remedy === "string" && document.error.remedy.length > 0, `${label}: the remedy is never null`)
  }
}

for (const row of ROWS) {
  test(`contract: ${row.name}`, (t) => {
    if (row.skip) return t.skip(row.skip)
    const modes = row.modes || (row.plain ? ["human"] : ["human", ...(accepts(row.command, "--json") ? ["json"] : []), ...(accepts(row.command, "--out") ? ["out"] : []), ...(accepts(row.command, "--json") && accepts(row.command, "--out") ? ["json+out"] : [])])
    // One environment and one copy of the tool per row: the rows read, and
    // the one that writes (add) names a fresh directory per mode.
    const env = row.env ? row.env() : {}
    const root = row.root ? row.root() : REPO_ROOT
    for (const mode of modes) {
      const args = row.args.map((arg) => (typeof arg === "function" ? arg(mode) : arg))
      const outFile = join(scratch, `out-${row.name.replace(/[^a-z0-9]+/gi, "-")}-${mode}.json`)
      const extra = [...(mode.includes("json") ? ["--json"] : []), ...(mode.includes("out") ? ["--out", outFile] : [])]
      let result
      if (row.offline) {
        const run = spawnSync("unshare", ["-rn", process.execPath, join(root, "bin/omakit"), ...args, ...extra], { timeout: 120_000, encoding: "utf8", env: { ...process.env, TERM: "dumb", NO_COLOR: "1", FORCE_COLOR: undefined, ...env } })
        result = { status: run.status, out: run.stdout, err: run.stderr }
      } else {
        result = omakit([...args, ...extra], { env, root })
      }
      check(row, mode, result, { outFile })
    }
  })
}

test("contract: --out that cannot be written is the failure, in the document on stdout", () => {
  // A file where the directory would have to be: mkdir fails with ENOTDIR.
  writeFileSync(join(scratch, "blocker"), "")
  const result = omakit(["inspect", good.dir, "--offline", "--json", "--out", join(scratch, "blocker/out.json")], {})
  assert.equal(result.status, 1)
  const document = JSON.parse(result.out)
  assert.equal(document.ok, false)
  assert.match(document.error.message, /--out .* could not be written/)
  assert.ok(document.error.remedy.length > 0)
})

test("contract: an unhandled signal ends inspect with the signal's own status, 130 for SIGINT and 143 for SIGTERM", async (t) => {
  // A tree big enough that the kill lands mid-inspection: the good fixture
  // with two hundred QML files added and committed.
  const big = materialise(GOOD, { origin: "https://github.com/example/omarchy-plugin-fixture-good" })
  for (let index = 0; index < 400; index += 1) writeFileSync(join(big.dir, `file-${index}.qml`), `import QtQuick\nItem { property int n: ${index}; Timer { interval: 1000; running: true; repeat: true; onTriggered: n += 1 } }\n`)
  execFileSync("git", ["-C", big.dir, "add", "-A"], { timeout: 60_000 })
  execFileSync("git", ["-C", big.dir, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "big"], { timeout: 60_000 })
  for (const [signal, expected] of Object.entries(SIGNAL_EXIT)) {
    const script = `node ${JSON.stringify(ENTRY)} inspect ${JSON.stringify(big.dir)} --offline --json > /dev/null 2>&1 & p=$!; sleep 0.4; kill -${signal.slice(3)} $p; wait $p; echo "exit=$?"`
    const result = spawnSync("bash", ["-c", script], { timeout: 120_000, encoding: "utf8", env: { ...process.env, PATH: `${join(process.execPath, "..")}:${process.env.PATH}` } })
    const status = Number(result.stdout.match(/exit=(\d+)/)?.[1])
    if (status === 0) {
      t.diagnostic(`${signal}: the inspection finished before the signal landed; nothing to hold`)
      continue
    }
    assert.equal(status, expected, `${signal}: the shell sees ${expected}`)
  }
})

test("contract: the exit table and the signal table are what the documentation states", () => {
  assert.deepEqual(EXIT, { ok: 0, refused: 1, usage: 2 })
  assert.deepEqual(SIGNAL_EXIT, { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 })
  const commands = readFileSync(join(REPO_ROOT, "docs/COMMANDS.md"), "utf8")
  for (const phrase of ["exit 0", "exit 1", "exit 2", "130", "143", "129", "remedy", "`{ \"command\"", "--out"]) assert.ok(commands.includes(phrase), `docs/COMMANDS.md states ${phrase}`)
})
