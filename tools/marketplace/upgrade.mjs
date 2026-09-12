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
// about. It does not fetch and execute arbitrary code: it fast-forwards a Git
// checkout the user cloned themselves, from the remote they cloned it from, and
// it refuses if any of that is not true.

import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { progress } from "./progress.mjs"
import { action, colourEnabled, GUTTER, mark, styler, verdict, wrap } from "./style.mjs"

export const REPOSITORY = "https://github.com/mtolhuys/omakit"

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
export async function upgrade({ repoRoot, stream = process.stdout, dryRun = false, expectedRemote = REPOSITORY }) {
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
    return refuse(
      "this is not a Git checkout, so there is nothing to fast-forward. It looks like a package install.",
      "npm i -g omakit@latest",
    )
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
    return split ? `${body}${c("bold", split[1])} ${c("default", split[2])}` : `${body}${c("default", line)}`
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
  lines(wrap("The marketplace pin did not move: this updated the tool, not the commit its rules are read from. `omakit doctor` says whether that pin is behind, and docs/UPSTREAM_CONTRACT.md says what moving it involves.", {}, c))
  return { ok: true, changed: true, from: before, to: after, commits: log.length }
}
