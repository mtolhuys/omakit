// `omakit doctor`: what is installed, what is pinned, and what has moved.
//
// It reads and it prints. It installs nothing, updates nothing and touches no
// checkout, because the two things a person might want "upgraded" here are not
// the same thing and only one of them may ever move on its own.
//
// The tool version belongs to the installer: `omakit upgrade` hands it to Git
// for a checkout and to npm for its package, and names pacman for a distro
// package. A CLI that fetches and executes its own replacement is the
// supply-chain shape this repository warns about.
//
// The pin must not move by itself. Bumping it changes where the submission
// contract is read from, and the procedure in docs/UPSTREAM_CONTRACT.md requires
// re-proving transport parity and committing the evidence afterwards. An
// `upgrade` that quietly advanced the pin would break the one guarantee this
// tool sells. So doctor reports what moved, graded, and that is all it does:
// the procedure is the maintainer's, it lives in that document and in this
// comment, and it is never printed, because the person running doctor is a
// user of a package that does not even ship docs/. What a user can do is run
// `omakit upgrade` when a newer omakit is published, since it may carry the
// new pin; otherwise the weekly pin-freshness workflow in this repository
// has already told the maintainer, and there is nothing to open.
//
// That the pin goes stale unnoticed is, of course, exactly the defect class
// `omakit watch` exists to report. It would be poor form not to apply it here.
//
// And "behind" is not the same as "behind in something omakit reads". Measured
// on 2026-09-13 (docs/MEASUREMENTS.md M7): 4,201 of the marketplace's 4,293
// commits in 30 days touched only registry.json, which omakit reads live,
// while nothing under scripts/ or .github/ISSUE_TEMPLATE/ changed since the
// pin. A doctor that only said "behind" would say it about every run. So it
// compares each path in PIN_PATHS between the pin and HEAD, by tree or blob
// id, and splits the ones that moved by the same list registry.mjs reads
// live from: the two data files, which a moved HEAD cannot make stale, and
// everything else, which only a new pin can carry. Measured on 0.1.7: with
// only registry.json and site/catalog.json moved, doctor said `note` and
// pointed a user at docs/UPSTREAM_CONTRACT.md, though the pin was behind in
// nothing the tool uses.
//
// Nor is "scripts/ moved" the same as "a file omakit reads moved". Measured
// on 2026-09-21 (M7): of the three marketplace commits that touched
// scripts/ since the first pin 38060f89, one (5e401552) changed only
// repository-identity.mjs, a file none of omakit's reads reach, and doctor
// graded the tree id's change as advice, a user read "run omakit upgrade",
// and the maintainer moved the pin for a verdict that could not change.
// So under scripts/ the comparison is by blob, over the 16 files
// pinnedReadSet() names, and the verdict is graded: `ok` when none of them
// moved, `info` when the only moved files are ones omakit takes wording or
// a label out of (WORDING_READS), `advice` when a file omakit executes or
// reads a rule from moved, a read file is gone at HEAD, or the form
// directory moved, which is the contract itself. The two policy constants
// are read at HEAD as text and printed beside the grade, so a person sees
// whether the baseline itself changed; they never soften the grade, since
// a rule can change without its version. The other two commits (7dd6e56,
// 40315f2) touched submission.mjs and the policy module, both executed,
// and the forms, so they grade advice either way.

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { MARKETPLACE_PIN, PIN_PATHS, POLICY_MODULE, WORDING_READS, marketplacePinDir, pinDiskUsage, pinShape, pinnedReadSet, policyConstants, requirePin } from "./pin.mjs"
import { LIVE_PATHS, headTextUrl } from "./registry.mjs"
import { credential, defaultBranchHead, getJson, getText, GitHubError } from "./github.mjs"
import { compareVersions, NPM_REGISTRY, registryLatest, upgradeCommand } from "./upgrade.mjs"
import { sourceCommit } from "../blocks/add.mjs"
import { recordedCommit } from "../blocks/record-commit.mjs"
import { pathHint } from "./path-hint.mjs"
import { completionStatus } from "./completion-check.mjs"
import { inspectLab } from "../lab/inspect.mjs"
import { labDoctorChecks } from "../lab/report.mjs"

export function tool(repoRoot) {
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
    return { name: pkg.name, version: pkg.version, engines: pkg.engines?.node || null }
  } catch {
    return { name: "omakit", version: "unknown", engines: null }
  }
}

/** The first line a command prints for `--version`, or null when it is not there; shared with `setup`. */
export function version(command, args = ["--version"]) {
  try {
    return execFileSync(command, args, { timeout: 60_000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0]
  } catch {
    return null
  }
}

/** The object id a path has at a commit in the pinned checkout: a tree id for a directory, a blob id for a file. Local; a blob-filtered clone still has every tree. */
function pinObjectId(pinDir, commit, path) {
  return execFileSync("git", ["-C", pinDir, "rev-parse", `${commit}:${path}`], { timeout: 60_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

/** A PIN_PATHS pattern as a path: "/site/catalog.json" -> "site/catalog.json". */
const asPath = (pattern) => pattern.replace(/^\/|\/$/g, "")

/** The form directory: the whole contract, compared by tree id and graded advice when it moved. */
const FORMS = "/.github/ISSUE_TEMPLATE/"

/**
 * The pin against `headCommit`, path by path and, under scripts/, file by
 * file. The pin side is read from the local checkout; the HEAD side walks
 * the git-trees API from the exact commit, one read per tree on the way:
 * three for PIN_PATHS as it stands, a fourth for the scripts/ tree only
 * when its id moved, since an identical tree has identical blobs. Each
 * PIN_PATHS entry compares by its own object id (a directory by tree id, a
 * file by blob id) into `changedPaths`; each file in `reads`
 * (pinnedReadSet by default) compares by blob id into `moved`, or
 * `missing` when HEAD no longer has it. A PIN_PATHS entry missing at HEAD
 * counts as changed.
 *
 * When the policy module is among `moved`, its text at HEAD is read once
 * through `fetchText` (the raw file host at the exact commit, the one GET
 * call site; a fifth request) and its two constants are returned as
 * `policyAtHead`; otherwise `policyAtHead` is null, because an identical
 * blob has identical constants. The text is never imported.
 *
 * `fetchJson` and `fetchText` are injectable for tests.
 *
 * @returns {Promise<{ changedPaths: string[], reads: number, moved: string[], missing: string[],
 *                     policyAtHead: { baselineVersion: string, enforcementMode: string }|null }>}
 */
export async function comparePin({ pinDir, headCommit, pinCommit = MARKETPLACE_PIN.commit, fetchJson = getJson, fetchText = getText, reads = pinnedReadSet(pinDir) }) {
  const match = MARKETPLACE_PIN.repository.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/)
  const trees = new Map()
  const tree = async (sha) => {
    if (!trees.has(sha)) {
      const read = await fetchJson(`https://api.github.com/repos/${match[1]}/${match[2]}/git/trees/${sha}`)
      if (!Array.isArray(read?.tree)) throw new GitHubError("head-unreadable", `the tree ${sha} at the marketplace's HEAD did not read as a tree`)
      trees.set(sha, read.tree)
    }
    return trees.get(sha)
  }
  const headObjectId = async (path) => {
    const segments = path.split("/")
    let entries = await tree(headCommit)
    let id = null
    for (const [index, segment] of segments.entries()) {
      const entry = entries.find((candidate) => candidate.path === segment)
      if (!entry) return null
      id = entry.sha
      // Descend only on the way to a deeper segment: the path's own tree id
      // is the comparison, and its contents need no read.
      if (index < segments.length - 1) {
        if (entry.type !== "tree") return null
        entries = await tree(entry.sha)
      }
    }
    return id
  }
  const changedPaths = []
  for (const pattern of PIN_PATHS) {
    if (pinObjectId(pinDir, pinCommit, asPath(pattern)) !== await headObjectId(asPath(pattern))) changedPaths.push(pattern)
  }
  const moved = []
  const missing = []
  if (changedPaths.includes("/scripts/")) {
    for (const { path } of reads) {
      const atHead = await headObjectId(path)
      if (atHead === null) missing.push(path)
      else if (atHead !== pinObjectId(pinDir, pinCommit, path)) moved.push(path)
    }
  }
  const policyAtHead = moved.includes(POLICY_MODULE) ? policyConstants(await fetchText(headTextUrl(headCommit, POLICY_MODULE))) : null
  return { changedPaths, reads: reads.length, moved, missing, policyAtHead }
}

/** "a", "a and b", "a, b and c". */
function list(items) {
  return items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
}

/** "baseline 3 (selective)". */
const policyText = (policy) => `baseline ${policy.baselineVersion} (${policy.enforcementMode})`

/** The moved files a verdict can depend on: everything omakit executes or reads a rule from, which is every read outside WORDING_READS. */
const verdictBearing = (paths) => paths.filter((path) => !WORDING_READS.includes(path))

/**
 * The pin against the marketplace's HEAD, for a user, graded by what the
 * difference can do to a verdict. `comparison` is the answer from
 * comparePin(): its `changedPaths` split by LIVE_PATHS into `readLive`, the
 * data files a moved HEAD cannot make stale because registry.mjs reads them
 * from HEAD, and `pinned`, everything only a new pin can carry; its `moved`
 * and `missing` name the files omakit reads under scripts/ whose blob
 * differs at HEAD; its `policyAtHead` carries the two policy constants
 * there when the policy module moved.
 *
 *   ok      nothing omakit reads moved: HEAD moved elsewhere, or only in
 *           the live-read data files, or scripts/ moved in none of the
 *           files omakit reads.
 *   info    the only read files that moved are ones omakit takes wording
 *           or a label out of (WORDING_READS): what it prints may differ
 *           at HEAD, what it passes or refuses cannot. A newer omakit will
 *           carry the pin. Nothing for a user to do.
 *   advice  a file omakit executes or reads a rule from moved (a verdict
 *           may differ at HEAD, whether or not the two policy constants
 *           still read the same, since a rule can change without its
 *           version), a read file is gone at HEAD, or the form directory
 *           moved (the contract itself). The action is `upgrade` (the
 *           command, when the caller found a newer omakit published), else
 *           that the maintainer is notified; never an issue to open, since
 *           the weekly pin-freshness workflow opens the one there is. The
 *           two constants are printed beside the grade in both cases.
 *
 * Null for `comparison` means the comparison was not made, which stays
 * advice: HEAD moved and nothing here can say the pin is fine. Full commits
 * in the evidence; short ones in the detail.
 */
export function pinFreshness(identity, head, comparison = null, { upgrade = null } = {}) {
  const current = head.commit === identity.commit
  const branch = head.branch || "default"
  const compared = !current && comparison !== null
  const changed = compared ? comparison.changedPaths : []
  const readLive = changed.filter((pattern) => LIVE_PATHS.includes(asPath(pattern)))
  const pinned = changed.filter((pattern) => !LIVE_PATHS.includes(asPath(pattern)))
  const moved = compared ? comparison.moved : []
  const missing = compared ? comparison.missing : []
  const pinPolicy = { baselineVersion: identity.baselineVersion, enforcementMode: identity.enforcementMode }
  const headPolicy = (compared && comparison.policyAtHead) || pinPolicy
  const policyDiffers = headPolicy.baselineVersion !== pinPolicy.baselineVersion || headPolicy.enforcementMode !== pinPolicy.enforcementMode
  const formMoved = pinned.includes(FORMS)
  const verdictMoved = verdictBearing(moved)
  const graded = moved.length > 0 || missing.length > 0 || formMoved
  const state = current ? "ok"
    : comparison === null || policyDiffers || formMoved || missing.length || verdictMoved.length ? "advice"
      : moved.length ? "info"
        : "ok"

  const where = `pin ${identity.commit.slice(0, 7)}; marketplace ${branch} at ${head.commit.slice(0, 7)}`
  const clauses = []
  if (comparison === null) clauses.push("the paths omakit reads were not compared")
  else if (!changed.length) clauses.push("nothing omakit reads moved")
  else {
    if (moved.length) clauses.push(`moved since the pin: ${list(moved)}${verdictMoved.length ? "" : " (wording and labels only)"}`)
    if (missing.length) clauses.push(`gone at HEAD: ${list(missing)}`)
    if (formMoved) clauses.push(`the form moved (${asPath(FORMS)}/)`)
    if (pinned.includes("/scripts/") && !moved.length && !missing.length) clauses.push(`scripts/ moved in none of the ${comparison.reads} files omakit reads`)
    if (graded) clauses.push(policyDiffers ? `${policyText(pinPolicy)} at the pin, ${policyText(headPolicy)} at HEAD` : `${policyText(pinPolicy)} at both`)
  }
  const live = readLive.length ? `${list(readLive.map(asPath))} moved${clauses.length ? " too" : ""}, and ${readLive.length === 1 ? "that is" : "those are"} read live` : ""
  const tail = !live ? "" : clauses.length ? ` (${live})` : `only ${live}`
  const detail = current ? `the pin is the marketplace's current ${branch}-branch HEAD` : `${where}; ${clauses.join("; ")}${tail}`

  const action = state === "info"
    ? `${moved.length === 1 ? "That file is" : "Those files are"} read for wording and labels, not for a pass or a refusal; what omakit prints may differ at HEAD, what it decides cannot. A newer omakit will carry the pin; nothing to do.`
    : state === "advice"
      ? upgrade
        ? `A newer omakit is published and may carry the pin: run \`${upgrade}\`. Until then every verdict here is the pin's, and the marketplace's own run on your issue is the one that counts.`
        : "The maintainer is notified by the weekly pin-freshness run; a newer omakit will carry the pin. Until then every verdict here is the pin's, and the marketplace's own run on your issue is the one that counts."
      : null

  return {
    id: "pin.freshness",
    state,
    detail,
    action,
    evidence: {
      pinCommit: identity.commit,
      marketplaceHead: head.commit,
      branch,
      ...(comparison === null ? {} : {
        changedPaths: changed,
        readLive,
        pinned,
        reads: comparison.reads,
        moved,
        verdictMoved,
        missing,
        policy: { pin: pinPolicy, head: headPolicy },
      }),
    },
  }
}

/**
 * @param {{ repoRoot: string, offline?: boolean, env?: object, npmPrefix?: () => string|null,
 *           resolveHead?: typeof defaultBranchHead, latest?: typeof registryLatest, compare?: typeof comparePin }} options
 *   `env` and `npmPrefix` are injectable for tests of the PATH check;
 *   `resolveHead`, `latest` and `compare` for tests of the two checks that
 *   read the network, whose defaults are the tool's one HEAD resolver, its
 *   one registry read and the pin comparison above.
 */
export async function doctor({ repoRoot, offline = false, onPhase, env = process.env, npmPrefix, resolveHead = defaultBranchHead, latest: latestVersion = registryLatest, compare = comparePin }) {
  // Optional: told what is being read while the network answers. Never
  // affects the result.
  const phase = onPhase || (() => {})
  const checks = []
  const add = (id, state, detail, action = null, evidence = null) => checks.push({
    id,
    state,
    detail,
    action,
    ...(evidence ? { evidence } : {}),
  })

  const self = tool(repoRoot)
  // What is installed and what is published, one check: the two facts are
  // one question, "is this the current omakit", and were two lines before.
  // Offline, the first fact alone, as information. The evidence carries both
  // and where the second came from. `upgrade` is the command when a newer
  // omakit is published, for pin.freshness to name below.
  let upgrade = null
  const versionCheck = (state, detail, action = null, latest = null, source = null) =>
    add("omakit.version", state, detail, action, { installed: self.version, latest, source })
  if (offline) {
    versionCheck("info", `${self.version}; the newest published version is not checked (--offline)`)
  } else {
    phase("asking the npm registry for the newest published version")
    const published = await latestVersion(self.name)
    if (published.version) {
      const comparison = compareVersions(published.version, self.version)
      if (comparison === null) {
        versionCheck("unknown", `${self.version}; the installed or published version is invalid`)
      } else {
        if (comparison > 0) upgrade = upgradeCommand(repoRoot, self.name)
        versionCheck(comparison > 0 ? "advice" : "ok",
          comparison === 0 ? `${self.version}, the newest published version`
            : comparison < 0 ? `${self.version}; ahead of the newest published version ${published.version}`
              : `${self.version}; ${published.version} is published`,
          comparison > 0 ? `run \`${upgrade}\`` : null,
          published.version, NPM_REGISTRY)
      }
    } else {
      versionCheck("unknown", `${self.version}; could not read the npm registry (${published.error?.code || "error"})`)
    }
  }

  // Where this omakit's code comes from, and whether `add` can name it: a
  // checkout (git is the source), a package the release step stamped
  // (tools/blocks/commit.json), or a package packed without that step,
  // which names no commit and refuses `add`. Measured on 2026-09-19: a
  // candidate packed with a raw `npm pack` called itself the published
  // version and nothing said it could not add a block.
  {
    const commit = sourceCommit(repoRoot)
    const checkout = existsSync(join(repoRoot, ".git"))
    const recorded = recordedCommit(repoRoot)
    if (checkout && commit) add("omakit.source", "ok", `a checkout at ${commit.slice(0, 7)}; add stamps that commit`, null, { origin: "checkout", commit })
    else if (commit) add("omakit.source", "ok", `a package the release step stamped with commit ${commit.slice(0, 7)}${recorded ? "" : " (npm's gitHead)"}; add stamps that commit`, null, { origin: "package", commit })
    else add("omakit.source", "advice", "a package packed without the release step: it names no source commit, so `omakit add` refuses (no-source-commit)", "install an artifact the release step packed (`npm run pack:release` in a checkout, or the registry's release of this version once published)", { origin: "unstamped", commit: null })
  }

  // Reachable as a bare command, or the one line that makes it so for this
  // install (path-hint.mjs). Measured: an npm prefix whose bin is not on PATH
  // installs a command nobody can run, and nothing said so.
  const reach = pathHint({ repoRoot, entryPoint: join(repoRoot, "bin/omakit"), env, ...(npmPrefix ? { npmPrefix } : {}) })
  add("omakit.path", reach.reachable ? "ok" : "advice",
    reach.reachable
      ? `\`omakit\` is reachable as a command from PATH (${reach.kind} install)`
      : `${reach.reason}${reach.where ? ` Keep the line below in ${reach.where}.` : ""}`,
    reach.reachable ? null : reach.line)

  // Tab completion, as it is and not as it was written: the script, its
  // omakit version and pin against this one's, and a new shell asked
  // whether it loads (completion-check.mjs). Measured before this (M8):
  // setup reported success for a script no shell was ever asked about.
  const completion = completionStatus({ version: self.version, pin: MARKETPLACE_PIN.commit, env })
  add("omakit.completion", completion.state, completion.detail, completion.action, completion.evidence)

  const node = process.versions.node
  const major = Number(node.split(".")[0])
  add("node", major >= 22 ? "ok" : "problem", `node ${node}${self.engines ? ` (needs ${self.engines})` : ""}`,
    major >= 22 ? null : "Install Node 22 or newer.")

  const git = version("git")
  add("git", git ? "ok" : "problem", git || "git was not found on PATH", git ? null : "Install git.")

  // The blocks start their supervisor and helper through /usr/bin/python3
  // by absolute path (blocks/run/Run.qml), never through PATH, so this is
  // the one path that matters; a stock Omarchy 4.0.3 has it as a
  // dependency of its desktop packages. Advice, not a problem: nothing
  // omakit runs here needs it, and a plugin without a block never will.
  const python = version("/usr/bin/python3")
  add("blocks.python", python ? "ok" : "advice",
    python ? `${python} at /usr/bin/python3, where the Run and Store blocks start it` : "/usr/bin/python3 was not found; a plugin's Run block reports python-missing here",
    python ? null : "Install python (the blocks start /usr/bin/python3 by absolute path).")

  const dir = marketplacePinDir(repoRoot)
  let identity = null
  try {
    identity = requirePin(repoRoot).identity
    add("pin.checkout", "ok",
      `${identity.commit} (baseline ${identity.baselineVersion}, ${identity.enforcementMode}) at ${dir}`)
    const shape = pinShape(dir)
    add("pin.size", shape.sparse ? "ok" : "advice", `${pinDiskUsage(dir)}${shape.sparse ? ", sparse: the pinned paths and nothing else" : `, a full checkout: ${shape.extra.length} entr${shape.extra.length === 1 ? "y" : "ies"} beyond the pinned paths (${shape.extra.slice(0, 5).join(", ")}${shape.extra.length > 5 ? ", ..." : ""})`}`,
      shape.sparse ? null : `This checkout carries more than the four paths omakit reads. Remove ${dir} and run \`omakit pin\` to refetch only those.`, { sparse: shape.sparse, extra: shape.extra, sparseCheckoutConfig: shape.sparseCheckoutConfig })
  } catch (error) {
    add("pin.checkout", "problem", error.message, error.remedy || "omakit pin")
  }

  if (!offline && identity) {
    phase("reading the marketplace's current default-branch HEAD")
    try {
      const head = await resolveHead(MARKETPLACE_PIN.repository)
      let comparison = { changedPaths: [], reads: pinnedReadSet(dir).length, moved: [], missing: [], policyAtHead: null }
      if (head.commit !== identity.commit) {
        phase("comparing each file omakit reads between the pin and HEAD")
        comparison = await compare({ pinDir: dir, headCommit: head.commit, pinCommit: identity.commit })
      }
      checks.push(pinFreshness(identity, head, comparison, { upgrade }))
    } catch (error) {
      add("pin.freshness", "unknown", `could not read the marketplace's HEAD (${error.code || "error"})`,
        error.code === "network-unavailable" ? "Connect to the network, or pass --offline to skip the two checks that need it." : null,
        { pinCommit: identity.commit, marketplaceHead: null, branch: null })
    }

  }

  // Where the credential comes from, said out loud. Borrowing someone's `gh`
  // login is the right default and a bad secret: a tool that quietly picks up a
  // credential is a tool you cannot audit by reading its help text, so doctor
  // names the source every time.
  // Just "gh version 2.62.0": the build date gh prints after it would nest a
  // second parenthetical inside this line.
  phase("reading the GitHub credential from gh")
  const cli = version("gh")?.replace(/\s*\(.*\)\s*$/, "") || null
  const auth = credential({ refresh: true })
  add("github.auth", auth.value ? "ok" : "info",
    auth.source === "gh"
      ? `read-only, from your \`gh\` login${cli ? ` (${cli})` : ""}; omakit stores nothing`
      : `${auth.detail}. \`submit\` and \`verify\` need none at all; \`watch\` and \`parity\` are capped without one`,
    auth.value
      ? null
      : cli
        ? "`gh auth login` is enough. omakit reads that login for GET requests only and never copies it anywhere."
        : "Install GitHub's `gh` CLI and run `gh auth login`. omakit reads that login for GET requests only.")

  // The lab: KVM, QEMU, the firmware, gpg, free disk, the verified ISO and
  // the base, each with its measured reason, every one advice and never a
  // problem, because the lab is optional and doctor installs nothing.
  // Read-only: inspectLab creates no directory, verifies nothing online
  // and starts nothing.
  phase("reading the lab")
  for (const check of labDoctorChecks(await inspectLab({ env }))) checks.push(check)

  return { checks, problems: checks.filter((check) => check.state === "problem").length }
}

export { GitHubError }
