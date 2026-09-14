// Read-only against omacom/omarchy-plugin-marketplace at all times.
//
// This test reads every source file in the repository and proves that no
// mutation path exists: one GET-only call site, a `gh` invocation that can only
// read a token, no push, and no code that creates an issue, comment, label or
// pull request. `submit` prints a body; a person posts it.
import test from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { CREDENTIAL_HOST, GH_ARGS, getJson } from "../../tools/marketplace/github.mjs"
import { NPM_PREFIX_ARGS, NPM_UPGRADE_ARGS } from "../../tools/marketplace/upgrade.mjs"
import { TTFX_ARGS, TTFX_PROBE } from "../../tools/marketplace/effect.mjs"
import { MOTION } from "../../tools/marketplace/style.mjs"
import { REPO_ROOT } from "./helpers.mjs"

// The filesystem, not `git ls-files`: an untracked file in the working tree can
// still be executed, so it is held to the same rule.
const SKIP = new Set([".git", ".cache", "node_modules"])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (/\.(?:mjs|js|cjs|sh)$/.test(entry.name) || entry.name === "omakit") out.push(path)
  }
  return out
}

// This file necessarily contains the patterns it forbids, so it excludes itself
// and is instead held to the rule by review.
const SELF = "tests/unit/read-only.test.mjs"

const sources = walk(REPO_ROOT)
  .map((path) => ({ path: relative(REPO_ROOT, path), text: readFileSync(path, "utf8") }))
  .filter((source) => source.path !== SELF)

test("the repository has source files to check", () => {
  assert.ok(sources.length >= 10, `only found ${sources.length} tracked sources`)
})

test("no HTTP method other than GET", () => {
  for (const { path, text } of sources) {
    for (const match of text.matchAll(/method\s*:\s*["'`]([A-Za-z]+)["'`]/g)) {
      assert.equal(match[1].toUpperCase(), "GET", `${path} uses method ${match[1]}`)
    }
    assert.doesNotMatch(text, /-X\s+(POST|PUT|PATCH|DELETE)/, `${path} shells out a mutating request`)
  }
})

test("the GitHub CLI is only ever asked for a token", () => {
  // Borrowing `gh`'s credential is the right default: the audience already has
  // it, and a read-only preflight should not make anyone mint a secret. But
  // `gh` can do everything a maintainer can do, so the arguments are frozen,
  // asserted here, and the only ones any source file may pass.
  assert.deepEqual([...GH_ARGS], ["auth", "token", "--hostname", "github.com"])
  for (const { path, text } of sources) {
    for (const [call, args] of [...text.matchAll(/\w+\s*\(\s*["'`]gh["'`]\s*,\s*(\[[^\]]*\])/g)]
      .map((match) => [match[0], match[1]])) {
      assert.match(args.replace(/\s+/g, ""), /^\[\.\.\.GH_ARGS\]$/, `${path} spawns gh as ${call}`)
    }
    // A gh subcommand that writes may be named for exactly one reason: this
    // tool prints `gh issue create ...` for a person to run, which is the whole
    // "produces but does not post" design. Printing it is allowed; reaching it
    // from a spawn is not.
    const WRITES = /\bgh (?:issue|pr|repo|api|release|gist|secret|variable|workflow|label|ruleset) /
    for (const line of text.split("\n")) {
      if (!WRITES.test(line)) continue
      assert.match(line, /out\.push\(|\.write\(|^\s*\/\//,
        `${path} names a writing gh subcommand somewhere other than printed output: ${line.trim()}`)
      assert.doesNotMatch(line, /(?:execFile|execFileSync|spawn|spawnSync|exec|execSync)\s*\(/,
        `${path} spawns a writing gh subcommand`)
    }
  }
})

test("ttfx is only ever handed the wordmark on stdin, with frozen arguments", () => {
  // The one text effect is an enhancement of the wordmark, and `ttfx` is a binary
  // that reads files and runs a random effect if asked. So the arguments are
  // frozen here: stdin only, no input file, no path, no `--random-effect`, one
  // pinned effect and one seed, so the recorded GIF stays reproducible.
  assert.deepEqual([...TTFX_PROBE], ["--version"])
  assert.deepEqual([...TTFX_ARGS], ["--no-color", "--no-restore-cursor", "--seed", "1", "--frame-rate", String(MOTION.effectFrameRate), "expand"])
  assert.ok(!TTFX_ARGS.some((arg) => /^-i$|^--input-file$|^-R$|^--random-effect$|\/|\./.test(arg)), "no input file, no random effect, no path")
  for (const { path, text } of sources) {
    for (const [call, args] of [...text.matchAll(/\w+\s*\(\s*(?:["'`]ttfx["'`]|TTFX)\s*,\s*(\[[^\]]*\])/g)]
      .map((match) => [match[0], match[1]])) {
      assert.match(args.replace(/\s+/g, ""), /^\[\.\.\.(TTFX_ARGS|TTFX_PROBE)\]$/, `${path} spawns ttfx as ${call}`)
    }
    // Tests may name the binary: they put a fake one on PATH. The tool may not,
    // outside effect.mjs; a comment may explain it.
    if (!path.startsWith("tests/") && path !== "tools/marketplace/effect.mjs") {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
      assert.doesNotMatch(code, /["'`]ttfx["'`]/, `${path} names the ttfx binary; only effect.mjs may spawn it`)
    }
  }
})

test("npm is spawned only by upgrade, with frozen arguments, at an exact version, never with sudo", () => {
  // `omakit upgrade` on an npm install hands the update to the npm on PATH.
  // The arguments are frozen: a global install of one package spec, scripts
  // ignored, and the spec is `<name>@<version>` with the version the registry
  // just named, never `latest`, so the printed command is the executed one.
  assert.deepEqual([...NPM_UPGRADE_ARGS], ["install", "--global", "--ignore-scripts", "--no-fund", "--no-audit"])
  // The other two questions npm is asked are where it installs and what its
  // prefix is, for the PATH hint; both read-only, both frozen.
  assert.deepEqual([...NPM_PREFIX_ARGS], ["prefix", "--global"])
  for (const { path, text } of sources) {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    assert.doesNotMatch(code, /\w+\s*\(\s*["'`]sudo["'`]/, `${path} spawns sudo`)
    const spawns = [...code.matchAll(/\w+\s*\(\s*["'`]npm["'`]\s*,\s*(\[[^\]]*\])/g)].map((match) => match[1].replace(/\s+/g, ""))
    // A test may run npm (package.test.mjs reads the real `npm pack`); the
    // tool itself may only in upgrade.mjs.
    if (path.startsWith("tests/")) continue
    if (path !== "tools/marketplace/upgrade.mjs") {
      assert.deepEqual(spawns, [], `${path} spawns npm; only upgrade.mjs may`)
      continue
    }
    assert.ok(spawns.length >= 1, "upgrade.mjs spawns npm")
    for (const args of spawns) {
      assert.match(args, /^\[\.\.\.NPM_UPGRADE_ARGS,spec\]$|^\["root","--global"\]$|^\[\.\.\.NPM_PREFIX_ARGS\]$/, `upgrade.mjs spawns npm as ${args}`)
    }
    assert.doesNotMatch(code, /@latest["'`]\s*\]|`\$\{name\}@latest`\s*\]/, "the executed spec is never @latest")
  }
})

test("only the cost command spawns an Omarchy command, only from its command table, and only tools/cost may name a shell restart", () => {
  // `omakit cost` is the one command that changes the user's own machine,
  // and it does so through the Omarchy commands and nothing else: no
  // `quickshell kill`, no `hyprctl`, no `systemctl` beyond reading the
  // session environment. Every spawn under tools/cost/ goes through one
  // call site in commands.mjs whose binary and arguments come from a frozen
  // table, so what the command can run is a list, not a search. Nothing
  // outside tools/cost/ may name a restart at all.
  const RESTART = /omarchy-restart-shell|quickshell kill|["'`]hyprctl["'`]/
  const SPAWN = /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)\s*\(/g
  for (const { path, text } of sources) {
    if (path.startsWith("tests/")) continue
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    if (!path.startsWith("tools/cost/")) {
      assert.doesNotMatch(code, RESTART, `${path} names a shell restart; only tools/cost/ may`)
      continue
    }
    const spawns = [...code.matchAll(SPAWN)]
    if (path !== "tools/cost/commands.mjs") {
      assert.deepEqual(spawns, [], `${path} spawns a process; only commands.mjs may`)
      continue
    }
    assert.equal(spawns.length, 1, "commands.mjs has exactly one spawn call site")
    assert.match(code, /spawnSync\(entry\.command, \[\.\.\.entry\.args, \.\.\.extra\]/, "and it runs a frozen entry of the command table")
  }
})

test("there is exactly one HTTP call site, and it is the read-only one", () => {
  // The credential a `gh` login hands over usually carries write scopes. What
  // keeps this tool read-only is therefore not the scope, it is that every
  // request in the repository goes through one function whose method is the
  // literal "GET".
  const callers = sources.filter(({ text }) => /(?<!\w)fetch\s*\(/.test(text)).map(({ path }) => path)
  assert.deepEqual(callers, ["tools/marketplace/github.mjs"],
    "a second fetch call site means the GET-only guarantee is no longer structural")
})

test("every request host is one of the four known ones, and the raw file host is reached only at an explicit commit", () => {
  // The GET-only guarantee says nothing about where a GET goes. Four hosts
  // are known: the API, github.com for the commit feed, the npm registry for
  // `upgrade`, and raw.githubusercontent.com for the two live registry files.
  // The last one is a file server: what it hands back at a branch name can
  // change between two requests, so it may be addressed only through the one
  // builder that refuses anything but a 40-character commit and anything but
  // the two data files (tests/unit/registry.test.mjs proves both refusals).
  const HOSTS = new Set(["api.github.com", "github.com", "registry.npmjs.org", "raw.githubusercontent.com"])
  const RAW = "raw.githubusercontent.com"
  for (const { path, text } of sources) {
    if (path.startsWith("tests/")) continue
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    for (const match of code.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
      assert.ok(HOSTS.has(match[1]), `${path} reaches ${match[1]}, which is not a known host`)
    }
    // local-transport.mjs also names the raw host: it answers the official
    // resolver's requests for it from a local clone, and never sends one.
    if (path !== "tools/marketplace/registry.mjs" && path !== "tools/marketplace/local-transport.mjs") {
      assert.ok(!code.includes(RAW), `${path} names ${RAW}; only registry.mjs may request it, through liveFileUrl()`)
    }
  }
  const registry = sources.find((source) => source.path === "tools/marketplace/registry.mjs")
  assert.equal(registry.text.split(RAW).length - 1, 1, "registry.mjs names the raw host exactly once")
  assert.match(registry.text, /export function liveFileUrl\(commit, path\) \{\s*\n\s*if \(!\/\^\[0-9a-f\]\{40\}\$\/\.test\(String\(commit\)\)\)/,
    "liveFileUrl refuses anything but a 40-character commit before it builds a URL")
})

test("no git verb that writes to a remote", () => {
  // Every git invocation's first verb must be one of these. `fetch`, `init`,
  // `remote add` and `checkout` are how the pinned checkout and a reviewer-mode
  // subject are created inside .cache; nothing reaches out and writes.
  const ALLOWED = new Set([
    "-C", "init", "remote", "fetch", "checkout", "rev-parse", "rev-list", "status",
    "ls-tree", "ls-files", "cat-file", "show", "log", "config", "add", "commit",
    // `omakit upgrade` fast-forwards the tool's own checkout. Local only: it
    // reads the remote and moves a local branch, and never writes to a remote.
    "merge", "merge-base",
  ])
  for (const { path, text } of sources) {
    for (const token of ["push", "send-pack", "request-pull", "am", "apply"]) {
      // The tool is held to this strictly. A test fixture that pushes into a
      // throwaway bare repository it created itself is not the tool reaching
      // out, and `omakit upgrade` can only be driven end to end against a local
      // remote, so tests/ is exempt for exactly this.
      if (path.startsWith("tests/")) continue
      assert.ok(
        !new RegExp(`["'\`]${token}["'\`]`).test(text),
        `${path} mentions the git verb "${token}"`,
      )
    }
    // Staging and committing belong to the throwaway fixture repositories only.
    const allowed = path.startsWith("tests/") ? ALLOWED : new Set([...ALLOWED].filter((verb) => verb !== "add" && verb !== "commit"))
    for (const match of text.matchAll(/\bgit\w*\s*\(\s*[^,()]+,\s*\[\s*(?:\.\.\.[^,\]]+,\s*)?["'`]([\w-]+)["'`]/g)) {
      assert.ok(allowed.has(match[1]), `${path} calls git ${match[1]}`)
    }
  }
})

test("nothing creates an issue, comment, label or pull request", () => {
  for (const { path, text } of sources) {
    for (const pattern of [
      /\/issues\/\d*\/comments["'`]\s*,\s*\{[^}]*method/i,
      /issues\/\{[^}]*\}\/labels/i,
      /\/pulls["'`]\s*,\s*\{[^}]*method/i,
    ]) {
      assert.doesNotMatch(text, pattern, `${path} looks like a write to the issue tracker`)
    }
  }
})

test("the credential is read from gh alone, and never written down", () => {
  // gh honours GH_TOKEN and GITHUB_TOKEN itself, so omakit reads neither:
  // one credential source, one frozen spawn, and no variable of its own.
  for (const { path, text } of sources) {
    if (path.startsWith("tests/")) continue
    assert.doesNotMatch(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""), /env\.(?:GITHUB_TOKEN|GH_TOKEN)|"(?:GITHUB_TOKEN|GH_TOKEN)"/, `${path} reads a token from the environment`)
  }
  for (const { path, text } of sources) {
    for (const writer of ["writeFileSync", "appendFileSync", "writeFile", "appendFile", "createWriteStream"]) {
      assert.doesNotMatch(
        text,
        new RegExp(`${writer}\\([^)]*(?:GITHUB_TOKEN|GH_TOKEN|token\\(\\)|credential\\(\\)|\\bauth\\.value)`),
        `${path} looks like it writes a credential to disk`,
      )
    }
  }
})

test("no marketplace security-baseline marker can be emitted", () => {
  for (const { path, text } of sources) {
    assert.doesNotMatch(text, /marketplace-security-baseline:v/, `${path} contains a baseline marker literal`)
    assert.doesNotMatch(text, /serializeSecurityBaselineMarker/, `${path} constructs a baseline marker`)
  }
})

test("the borrowed credential is sent to api.github.com and to no other host", async () => {
  // Measured 2026-09-13 on a machine with a gh login: the bearer token went
  // to registry.npmjs.org with every version check, npm answered 401, and
  // `omakit upgrade` refused with "the npm registry did not answer".
  assert.equal(CREDENTIAL_HOST, "api.github.com")
  const seen = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    seen.push({ host: new URL(url).host, authorization: init.headers.authorization || null, accept: init.headers.accept })
    return { ok: true, json: async () => ({}), text: async () => "", headers: { get: () => null } }
  }
  try {
    await getJson("https://registry.npmjs.org/omakit/latest")
    await getJson("https://raw.githubusercontent.com/omacom/omarchy-plugin-marketplace/0000000000000000000000000000000000000000/registry.json")
    await getJson("https://api.github.com/repos/omacom/omarchy-plugin-marketplace")
  } finally {
    globalThis.fetch = realFetch
  }
  for (const request of seen) {
    if (request.host !== CREDENTIAL_HOST) {
      assert.equal(request.authorization, null, `${request.host} was sent a credential`)
      assert.equal(request.accept, "application/json", `${request.host} was asked for GitHub's media type`)
    }
  }
  const github = seen.find((request) => request.host === CREDENTIAL_HOST)
  assert.equal(github.accept, "application/vnd.github+json")
  // Whether a bearer went to GitHub depends on whether this machine has a gh
  // login; that it goes nowhere else does not.
})
