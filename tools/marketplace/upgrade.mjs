// `omakit upgrade`: update the tool, and only the tool.
//
// This command exists against my earlier judgement, and the reason is worth
// writing down. The objection to an upgrade command was that "upgrade" can mean
// two things here and one of them must never happen on its own: bumping the
// marketplace pin changes where the submission contract and the baseline policy
// are read from, and the procedure for that ends in re-proving transport parity
// and committing the evidence. That objection stands, and it is enforced below
// rather than argued: this command fast-forwards the tool's own checkout and
// touches nothing in .cache. The pin moves when a human edits MARKETPLACE_PIN,
// never here.
//
// What changed my mind is the ordinary case. After a global install nobody
// remembers where the checkout went, and a tool people cannot update is a tool
// people run stale. That is a worse outcome than the one I was protecting
// against.
//
// It is not a self-updater in the sense this repository warns other people
// about. It does not fetch and execute arbitrary code: it hands the update to
// the installer that put the tool here. A Git checkout is fast-forwarded from
// the remote it was cloned from; an npm install is reinstalled by the `npm` on
// PATH, with frozen arguments, at the exact version the registry named, and
// only when that version is newer. It refuses if any of that is not true.

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import { getJson } from "./github.mjs"
import { progress } from "./progress.mjs"
import { action, colourEnabled, GUTTER, mark, styler, verdict, wrap } from "./style.mjs"

export const REPOSITORY = "https://github.com/mtolhuys/omakit"

/** Identify only the three supported delivery shapes; npm wins under /usr/node_modules. */
export function installKind(repoRoot) {
  const root = resolve(repoRoot)
  if (existsSync(join(root, ".git"))) return "git"
  if (root.split(sep).includes("node_modules")) return "npm"
  if (root === "/usr/lib/omakit" || root.startsWith("/usr/lib/omakit/")) return "distro"
  return "npm"
}

export function upgradeCommand(repoRoot, name = "omakit") {
  return {
    git: "omakit upgrade",
    npm: "omakit upgrade",
    distro: `sudo pacman -Syu ${name}`,
  }[installKind(repoRoot)]
}

/**
 * The frozen shape of the one `npm` invocation this tool makes. The package
 * spec appended to it is `<name>@<version>` with the version the registry just
 * reported, never `latest`, so what is printed is what is run. No sudo, no
 * script execution (`--ignore-scripts`), and tests/unit/read-only.test.mjs
 * asserts that npm is spawned nowhere else and with nothing else.
 */
export const NPM_UPGRADE_ARGS = Object.freeze(["install", "--global", "--ignore-scripts", "--no-fund", "--no-audit"])

/** The newest published version, or null when the registry did not answer. */
export async function latestOnRegistry(name) {
  return (await registryLatest(name)).version
}

/** The registry the newest version is read from, named in doctor's evidence. */
export const NPM_REGISTRY = "https://registry.npmjs.org"

/**
 * The newest published version, with the reason when there is none: the
 * failure code from the one GET call site (network-unavailable,
 * github-unavailable's npm sibling, not-found for an unpublished name), or
 * `unpublished` when the registry answered without a version. `doctor` prints
 * the code; `upgrade` only needs the version.
 *
 * @returns {Promise<{ version: string|null, error: { code: string, message: string }|null }>}
 */
export async function registryLatest(name) {
  try {
    const meta = await getJson(`${NPM_REGISTRY}/${encodeURIComponent(name)}/latest`)
    return meta?.version
      ? { version: meta.version, error: null }
      : { version: null, error: { code: "unpublished", message: "the registry answered without a version" } }
  } catch (error) {
    return { version: null, error: { code: error?.code || "error", message: String(error?.message || error) } }
  }
}

function installedVersion(repoRoot) {
  try {
    return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version || null
  } catch {
    return null
  }
}

/** Where the `npm` on PATH installs global packages, or null when there is no npm. */
function npmGlobalRoot() {
  try {
    return resolve(execFileSync("npm", ["root", "--global"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim())
  } catch {
    return null
  }
}

/**
 * The frozen shape of the one other question this tool asks npm: where its
 * global prefix is, whose `bin` is where `npm install --global` put the
 * `omakit` command. Read-only; tests/unit/read-only.test.mjs holds npm to
 * this shape, `root --global` and the install above, and to this file.
 */
export const NPM_PREFIX_ARGS = Object.freeze(["prefix", "--global"])

/** The `npm` on PATH's global prefix, or null when there is no npm. */
export function npmGlobalPrefix() {
  try {
    return resolve(execFileSync("npm", [...NPM_PREFIX_ARGS], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim())
  } catch {
    return null
  }
}

function git(dir, args) {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

/** Same repository, whatever spelling the remote uses. */
export function isExpectedRemote(url, expected = REPOSITORY) {
  const normalise = (value) => String(value || "")
    .trim()
    .replace(/^git@github\.com:/i, "https://github.com/")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase()
  return normalise(url) === normalise(expected)
}

/**
 * @param {{ repoRoot: string, stream?: NodeJS.WriteStream, dryRun?: boolean,
 *           expectedRemote?: string }} options `expectedRemote` exists so the
 *   successful path can be tested end to end against a local remote; it is not
 *   a way to point the command at somebody else's repository, because nothing
 *   on the command line reaches it.
 */
/**
 * After a successful install, the completion step of the omakit that was
 * just installed: it renders the script with its own version and proves it
 * in a new shell, and never asks the rc question (the loader does not
 * change with an upgrade). Run as a child of the new entry point, not in
 * this process, whose code is the old version's. Frozen arguments.
 */
export const COMPLETION_REFRESH_ARGS = Object.freeze(["setup", "--completion"])

function refreshCompletionWith(root, stream) {
  const entryPoint = join(root, "bin/omakit")
  if (!existsSync(entryPoint)) return { ran: false, reason: `${entryPoint} is not there` }
  try {
    const out = execFileSync(process.execPath, [entryPoint, ...COMPLETION_REFRESH_ARGS], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    stream.write(out)
    return { ran: true, ok: true }
  } catch (error) {
    stream.write(error.stdout || "")
    return { ran: true, ok: false, reason: String(error.stderr || error.message).trim() }
  }
}

export async function upgrade({ repoRoot, stream = process.stdout, dryRun = false, expectedRemote = REPOSITORY, latest = latestOnRegistry, npmRoot = npmGlobalRoot, name = "omakit", refreshCompletion = refreshCompletionWith }) {
  const c = styler(colourEnabled(stream))
  const out = (line = "") => stream.write(`${line}\n`)
  const lines = (list) => { for (const line of list) out(line) }
  const refuse = (reason, fix = null) => {
    lines(verdict("fail", "REFUSED", reason, c))
    if (fix) lines(action(fix, c, { indent: 0 }))
    return { ok: false, reason }
  }
  const note = (text) => out(`${mark("advisory", c)}${wrap(text, { indent: GUTTER }, c).join("\n").trimStart()}`)
  const ok = (text) => out(`${mark("pass", c)}${wrap(text, { indent: GUTTER }, c).join("\n").trimStart()}`)

  if (!existsSync(join(repoRoot, ".git"))) {
    if (installKind(repoRoot) === "distro") {
      return refuse("this is a distro package under /usr, so omakit leaves upgrades to the package manager.", upgradeCommand(repoRoot))
    }
    return upgradeNpm({ repoRoot, stream, dryRun, latest, npmRoot, name, refuse, note, ok, out, lines, c, refreshCompletion })
  }

  let remote
  try {
    remote = git(repoRoot, ["remote", "get-url", "origin"])
  } catch {
    return refuse("this checkout has no `origin` remote, so there is nowhere to update from.")
  }
  if (!isExpectedRemote(remote, expectedRemote)) {
    return refuse(
      `the \`origin\` of this checkout is ${remote}, not ${expectedRemote}. Pulling code from somewhere else is not this command's business.`,
      `git -C ${repoRoot} pull`,
    )
  }

  if (git(repoRoot, ["status", "--porcelain"]).length) {
    return refuse(
      "this checkout has local changes. Updating would either lose them or leave you mid-merge; both are worse than stopping.",
      `git -C ${repoRoot} status`,
    )
  }

  const before = git(repoRoot, ["rev-parse", "HEAD"])
  const branch = git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])
  if (branch === "HEAD") {
    return refuse("this checkout is on a detached HEAD, so there is no branch to fast-forward.")
  }

  const spinner = progress({ stream: stream === process.stdout ? process.stderr : stream })
  spinner.phase(`fetching origin/${branch}`)
  try {
    git(repoRoot, ["fetch", "--quiet", "origin", branch])
  } catch (error) {
    spinner.done()
    const reason = String(error?.stderr || "").trim().split("\n").filter((line) => /^fatal:/.test(line)).pop()
      || "git fetch failed"
    return refuse(
      `origin could not be fetched: ${reason.replace(/^fatal:\s*/, "")}`,
      "Connect to the network, then run `omakit upgrade` again.",
    )
  }
  spinner.done()
  const target = git(repoRoot, ["rev-parse", `origin/${branch}`])

  if (target === before) {
    ok(`already current at ${before.slice(0, 7)} on ${branch}`)
    out()
    lines(wrap("The marketplace pin is a separate thing and is never touched here. `omakit doctor` says whether it is behind.", {}, c))
    return { ok: true, changed: false, commit: before }
  }

  // Fast-forward only. A merge or a rebase here would be this command deciding
  // what to do with someone else's history.
  try {
    git(repoRoot, ["merge-base", "--is-ancestor", before, target])
  } catch {
    return refuse(
      `this checkout at ${before.slice(0, 7)} is not an ancestor of origin/${branch} at ${target.slice(0, 7)}, so it cannot be fast-forwarded.`,
      `git -C ${repoRoot} log --oneline HEAD..origin/${branch}`,
    )
  }

  const log = git(repoRoot, ["log", "--oneline", `${before}..${target}`]).split("\n").filter(Boolean)
  // A commit subject is the one thing a person actually reads here, so the sha
  // takes the emphasis and the subject keeps the terminal's own foreground.
  const body = " ".repeat(GUTTER)
  const subject = (line) => {
    const split = line.match(/^(\S+)\s+([\s\S]*)$/)
    return split ? `${body}${c("name", split[1])} ${c("prose", split[2])}` : `${body}${c("prose", line)}`
  }
  if (dryRun) {
    note(`${log.length} commit(s) available, not applied (--dry-run)`)
    for (const line of log) out(subject(line))
    out()
    lines(action("omakit upgrade", c, { indent: 0 }))
    return { ok: true, changed: false, commit: before, available: log.length }
  }

  git(repoRoot, ["merge", "--ff-only", `origin/${branch}`])
  const after = git(repoRoot, ["rev-parse", "HEAD"])

  ok(`${before.slice(0, 7)} to ${after.slice(0, 7)} on ${branch}, ${log.length} commit(s)`)
  for (const line of log) out(subject(line))
  out()
  const completion = refreshCompletion(resolve(repoRoot), stream)
  if (completion.ran === false) note(`tab completion was not refreshed: ${completion.reason}. Run \`omakit setup\`.`)
  lines(wrap("The marketplace pin did not move: this updated the tool, not the commit its rules are read from. `omakit doctor` says whether that pin is behind, and docs/UPSTREAM_CONTRACT.md says what moving it involves.", {}, c))
  return { ok: true, changed: true, from: before, to: after, commits: log.length, completion }
}

/**
 * The npm route. `latest` and `npmRoot` are injectable for the tests only, the
 * way `expectedRemote` is: nothing on the command line reaches them.
 */
async function upgradeNpm({ repoRoot, stream, dryRun, latest, npmRoot, name, refuse, note, ok, out, lines, c, refreshCompletion }) {
  const root = resolve(repoRoot)
  const globalRoot = npmRoot()
  if (!globalRoot) {
    return refuse("this is an npm package install, but no `npm` is on PATH to update it with.", `npm install --global ${name}@latest`)
  }
  if (root !== join(globalRoot, name)) {
    return refuse(
      `this omakit is installed at ${root}, but the npm on PATH installs global packages under ${globalRoot}. Updating with a different npm would leave this one where it is.`,
      `npm install --global ${name}@latest`,
    )
  }
  const current = installedVersion(root)
  const spinner = progress({ stream: stream === process.stdout ? process.stderr : stream })
  spinner.phase("asking the npm registry for the newest published version")
  const newest = await latest(name)
  spinner.done()
  if (!newest) {
    return refuse("the npm registry did not answer, so there is nothing to compare against.", "Connect to the network, then run `omakit upgrade` again.")
  }
  if (newest === current) {
    ok(`already current at ${current}, the newest published version`)
    out()
    lines(wrap("The marketplace pin is a separate thing and is never touched here. `omakit doctor` says whether it is behind.", {}, c))
    return { ok: true, changed: false, version: current }
  }
  const spec = `${name}@${newest}`
  if (dryRun) {
    note(`${newest} is published, this is ${current}; not applied (--dry-run)`)
    out(`${" ".repeat(GUTTER)}${c("prose", `npm ${[...NPM_UPGRADE_ARGS, spec].join(" ")}`)}`)
    out()
    lines(action("omakit upgrade", c, { indent: 0 }))
    return { ok: true, changed: false, version: current, available: newest }
  }
  spinner.phase(`npm install --global ${spec}`)
  try {
    execFileSync("npm", [...NPM_UPGRADE_ARGS, spec], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  } catch (error) {
    spinner.done()
    const reason = String(error?.stderr || "").trim().split("\n").filter((line) => /^npm (?:error|ERR!)/.test(line)).pop() || "npm install failed"
    return refuse(`npm could not install ${spec}: ${reason.replace(/^npm (?:error|ERR!)\s*/, "")}`, `npm ${[...NPM_UPGRADE_ARGS, spec].join(" ")}`)
  }
  spinner.done()
  const after = installedVersion(root)
  if (after !== newest) {
    return refuse(`npm finished, but ${root} reports ${after || "no version"} rather than ${newest}.`, `npm ${[...NPM_UPGRADE_ARGS, spec].join(" ")}`)
  }
  ok(`${current} to ${after}, through the npm that installed it`)
  out()
  const completion = refreshCompletion(root, stream)
  if (completion.ran === false) note(`tab completion was not refreshed: ${completion.reason}. Run \`omakit setup\`.`)
  lines(wrap("The marketplace pin did not move: this updated the tool, not the commit its rules are read from. `omakit doctor` says whether that pin is behind, and docs/UPSTREAM_CONTRACT.md says what moving it involves.", {}, c))
  return { ok: true, changed: true, from: current, to: after, completion }
}
