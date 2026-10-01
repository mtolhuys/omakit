// M7 reproduction: every marketplace commit in a range that touched a pinned
// path other than the two data files (scripts/ and the form), graded as a
// change from its parent, the parent as the pin and the commit as HEAD,
// under the three comparisons doctor has shipped: tree, 0.6.6's (any such
// path's tree or blob id moved); blob, 0.6.7's (pinFreshness without the
// text-read values); value, the one since 0.6.10 (pinFreshness as it
// ships). It runs the shipped comparePin() and pinFreshness() against a
// local clone of the marketplace's history (a blob-filtered clone is
// enough) and answers each request the comparison would make from that
// clone, counting it: nothing is fetched by this script and nothing from
// the clone is run. Measured on 2026-10-01: over the seven such commits
// since 38060f89, the three grades it gives equal those of the v0.6.6 and
// v0.6.7 tags' own code (docs/evidence/pin-freshness/2026-10-01-grades.json).
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { PIN_PATHS, POLICY_MODULE, pinnedReadSet, policyConstants } from "./pin.mjs"
import { LIVE_PATHS } from "./registry.mjs"
import { comparePin, pinFreshness } from "./doctor.mjs"

/** The pinned paths a grade can turn on: PIN_PATHS less the two data files read live. */
export const GRADED_PATHS = Object.freeze(PIN_PATHS.map((pattern) => pattern.replace(/^\/|\/$/g, "")).filter((path) => !LIVE_PATHS.includes(path)))

/**
 * The two kinds of request comparePin() makes, answered from the clone: a
 * tree read by `git ls-tree`, a file's text at a commit by `git show`.
 * `requests` lists each, in order.
 */
export function cloneTransport(clone) {
  const git = (...args) => execFileSync("git", ["-C", clone, ...args], { timeout: 60_000, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const requests = []
  const fetchJson = async (url) => {
    requests.push(url)
    const sha = String(url).match(/\/git\/trees\/([0-9a-f]{40})$/)?.[1]
    if (!sha) throw new Error(`not a tree read at an object id: ${url}`)
    const tree = git("ls-tree", sha).split("\n").filter(Boolean).map((line) => {
      const [meta, path] = line.split("\t")
      const [, type, id] = meta.split(" ")
      return { path, type, sha: id }
    })
    return { sha, tree, truncated: false }
  }
  const fetchText = async (url) => {
    requests.push(url)
    const [, commit, path] = String(url).match(/\/([0-9a-f]{40})\/(.+)$/) || []
    if (!commit) throw new Error(`not a file read at a commit: ${url}`)
    return git("show", `${commit}:${path}`)
  }
  return { git, requests, fetchJson, fetchText }
}

/** One change graded three ways, with the read set resolved at `pin` and what the value comparison says of it. */
export async function gradeChange(clone, pin, head) {
  const transport = cloneTransport(clone)
  const reads = pinnedReadSet(clone, undefined, (path) => transport.git("show", `${pin}:${path}`))
  const identity = { commit: pin, ...policyConstants(transport.git("show", `${pin}:${POLICY_MODULE}`)) }
  const comparison = await comparePin({ pinDir: clone, headCommit: head, pinCommit: pin, fetchJson: transport.fetchJson, fetchText: transport.fetchText, reads })
  const at = { commit: head, branch: null }
  const value = pinFreshness(identity, at, comparison)
  const blob = pinFreshness(identity, at, { ...comparison, textReads: {} })
  return {
    readSet: reads.map((read) => read.path),
    requests: transport.requests.length,
    tree: value.evidence.pinned.length ? "advice" : "ok",
    blob: blob.state,
    value: value.state,
    detail: value.detail,
    effective: value.evidence.effective,
    textReads: value.evidence.textReads,
  }
}

/**
 * Every commit in `since..until` that touched GRADED_PATHS, oldest first,
 * each graded by gradeChange() against its first parent, and how many of
 * those that touched a file in the read set each comparison grades advice.
 */
export async function measurePinGrades({ clone, since, until }) {
  const git = (...args) => execFileSync("git", ["-C", clone, ...args], { timeout: 60_000, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const range = `${git("rev-parse", since).trim()}..${git("rev-parse", until).trim()}`
  const listed = git("log", "--reverse", "--format=%H%x09%cI%x09%s", range, "--", ...GRADED_PATHS).split("\n").filter(Boolean)
  const commits = []
  for (const line of listed) {
    const [commit, committedAt, subject] = line.split("\t")
    const parent = git("rev-parse", `${commit}^`).trim()
    const touched = git("log", "-1", "--format=", "--name-only", commit, "--", ...GRADED_PATHS).split("\n").filter(Boolean)
    const { readSet, ...graded } = await gradeChange(clone, parent, commit)
    commits.push({ commit, committedAt, subject, parent, touched, inReadSet: touched.filter((path) => readSet.includes(path)), ...graded })
  }
  const touching = commits.filter((row) => row.inReadSet.length)
  const advice = (rows, rule) => rows.filter((row) => row[rule] === "advice").length
  return {
    measurement: "M7",
    measuredAt: new Date().toISOString(),
    range,
    gradedPaths: GRADED_PATHS,
    method: "Each commit in the range that touched a graded path, graded against its first parent by the shipped comparePin() and pinFreshness(), every request answered from the local clone: tree is 0.6.6's rule (a graded path's object id moved), blob 0.6.7's (pinFreshness without text-read values), value the shipped grade.",
    commits,
    touchingReadSet: touching.length,
    advice: { tree: advice(touching, "tree"), blob: advice(touching, "blob"), value: advice(touching, "value") },
    adviceOverAll: { commits: commits.length, tree: advice(commits, "tree"), blob: advice(commits, "blob"), value: advice(commits, "value") },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const option = (name) => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }
  const clone = option("--clone")
  const since = option("--since")
  const until = option("--until") || "HEAD"
  if (!clone || !since || args.length !== (option("--until") ? 6 : 4)) {
    process.stderr.write("usage: node tools/marketplace/measure-pin-grades.mjs --clone <marketplace clone> --since <commit> [--until <commit>]\n")
    process.exit(2)
  }
  process.stdout.write(`${JSON.stringify(await measurePinGrades({ clone: resolve(clone), since, until }), null, 2)}\n`)
}
