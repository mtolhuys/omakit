// The suites `omakit lab prove` knows, as data: what each stages, what it
// runs, which document it writes, and what that document must say for the
// gate to pass. The host-side body of each is a bash file under
// tools/lab/suites/, run through tools/lab/harness.sh; the in-guest
// content (a suite that also runs on the desktop, its reader, its harness
// QML, the weigh fixtures) lives with the tests, under tests/lab/ and
// tests/fixtures/weigh/, and ships in the package too (package.json
// `files`), so an installed omakit proves a suite without a checkout.
// Measured on 2026-09-19 by a first user: the packaged `lab prove` refused
// for files that were repository-only, with a remedy that cloned the
// repository and then ran the global package again (docs/evidence/ux/
// 2026-09-19-first-user-test.json, finding 5). A suite whose content is
// missing is still named, not guessed at, and the remedy names the tree's
// own entry point.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { LAB_DIR } from "./pin.mjs"
import { marketplacePinDir } from "../marketplace/pin.mjs"

/** The listed plugins the weigh evidence gate weighs beside the fixtures, by id; their repositories and commits are the pinned catalog's to say. */
export const WEIGH_LISTED = Object.freeze(["io.github.calebhat.weather", "omaplug", "io.github.pablo-merino.altswitch"])
export const WEIGH_FIXTURES = Object.freeze(["clean", "timer-180ms", "poller", "idle-panel"])

const BLOCK_PLUMBING = ["tests/lab/run/suite.sh", "tests/lab/run/report.py", "tests/lab/run/harness/shell.qml", "blocks/run/Run.qml", "blocks/run/run-supervisor.py"]

export const SUITES = Object.freeze({
  run: Object.freeze({
    name: "run",
    title: "the Run block's lab scenarios on the stock guest",
    host: join(LAB_DIR, "suites/run.sh"),
    needs: Object.freeze(BLOCK_PLUMBING),
    document: "runlab.json",
    evidence: "run-lab-guest",
    timeoutSeconds: 1200,
    args: () => ["1"],
    /** `ok` over 19 summary entries (one per scenario, keyed by name), the count tests/lab/run/suite.sh names in its scenario list. */
    assert: (document) => {
      const summary = document?.summary
      const count = Array.isArray(summary) ? summary.length : summary && typeof summary === "object" ? Object.keys(summary).length : 0
      if (document?.ok !== true || count !== 19) return { ok: false, reason: `the document says ok=${document?.ok} over ${count} scenarios; the gate is ok over 19` }
      return { ok: true, reason: `ok over ${count} scenarios` }
    },
  }),
  store: Object.freeze({
    name: "store",
    title: "the Store block's lab scenarios on the stock guest, the foreign owner simulated",
    host: join(LAB_DIR, "suites/store.sh"),
    needs: Object.freeze([...BLOCK_PLUMBING, "tests/lab/store/suite.sh", "tests/lab/store/report.py", "tests/lab/store/harness/shell.qml", "blocks/store/Store.qml", "blocks/store/store-helper.py"]),
    document: "storelab.json",
    evidence: "store-lab-guest",
    timeoutSeconds: 1200,
    args: () => [],
    /** `ok` over 15 scenarios with `foreign-owner` not skipped: the chown happened. */
    assert: (document) => {
      const scenarios = Array.isArray(document?.scenarios) ? document.scenarios : []
      const foreign = scenarios.find((row) => row?.scenario === "foreign-owner")
      if (document?.ok !== true || scenarios.length !== 15) return { ok: false, reason: `the document says ok=${document?.ok} over ${scenarios.length} scenarios; the gate is ok over 15` }
      if (!foreign || foreign.skipped != null) return { ok: false, reason: "the foreign-owner scenario was skipped; the gate needs it simulated" }
      return { ok: true, reason: `ok over ${scenarios.length} scenarios, the foreign owner simulated` }
    },
  }),
  weigh: Object.freeze({
    name: "weigh",
    title: "omakit weigh against the stock shell: the smoke check, about a minute after the guest is up",
    host: join(LAB_DIR, "suites/weigh.sh"),
    needs: Object.freeze(["bin/omakit", "tools/weigh/contract.mjs", "tests/fixtures/weigh/clean/manifest.json", "tests/fixtures/weigh/timer-180ms/manifest.json"]),
    document: "omakit-weigh.json",
    evidence: null,
    timeoutSeconds: 1500,
    args: (options, layout) => ["smoke", "1", layout.plugins],
    assert: (document) => (document?.config?.restored === true ? { ok: true, reason: "the document says the shell configuration was restored" } : { ok: false, reason: "the document does not say the shell configuration was restored" }),
  }),
  "weigh-evidence": Object.freeze({
    name: "weigh-evidence",
    title: "omakit weigh against the stock shell: five runs over four fixtures and three listed plugins, about forty minutes",
    host: join(LAB_DIR, "suites/weigh.sh"),
    needs: Object.freeze(["bin/omakit", "tools/weigh/contract.mjs", ...WEIGH_FIXTURES.map((name) => `tests/fixtures/weigh/${name}/manifest.json`)]),
    document: "omakit-weigh.json",
    evidence: "weigh-lab",
    timeoutSeconds: 4200,
    plugins: WEIGH_LISTED,
    args: (options, layout) => ["evidence", String(options.runs || 5), layout.plugins, ...WEIGH_LISTED],
    assert: (document) => (document?.config?.restored === true ? { ok: true, reason: "the document says the shell configuration was restored" } : { ok: false, reason: "the document does not say the shell configuration was restored" }),
  }),
})

export function suiteNames() {
  return Object.keys(SUITES)
}

/**
 * What a suite is missing on this host, before any guest boots: the
 * repository files it stages, and for the evidence gate the listed
 * plugins in the lab's plugin cache at their validated commits.
 */
export function suitePreflight(suite, { repoRoot, layout, pinDir = marketplacePinDir(repoRoot) }) {
  const missing = []
  for (const relative of suite.needs) {
    if (!existsSync(join(repoRoot, relative))) missing.push({ what: relative, cost: `a file this omakit ships (${repoRoot}) and does not have; the tree is incomplete`, command: existsSync(join(repoRoot, ".git")) ? `git -C ${repoRoot} checkout -- ${relative} && ${join(repoRoot, "bin/omakit")} lab prove ${suite.name}` : "npm i -g omakit, then run it again" })
  }
  if (suite.plugins) {
    for (const id of suite.plugins) {
      const listing = listedPlugin(pinDir, id)
      if (!listing.ok) {
        missing.push({ what: `${id} in the pinned catalog`, cost: listing.reason, command: "omakit pin" })
        continue
      }
      const dir = join(layout.plugins, id)
      const head = existsSync(join(dir, ".git")) ? readHead(dir) : null
      if (head !== listing.commit) missing.push({ what: `${id} at ${listing.commit.slice(0, 12)} in ${dir}`, cost: `one shallow fetch of ${listing.repo} at that commit`, command: "omakit lab setup --plugins" })
    }
  }
  return missing
}

/** `<repo> <commit>` for a listed id, from the pinned catalog; never written here. */
export function listedPlugin(pinDir, id) {
  let catalog
  try {
    catalog = JSON.parse(readFileSync(join(pinDir, "site/catalog.json"), "utf8"))
  } catch {
    return { ok: false, reason: "the pinned catalog is not readable; the marketplace pin is not in place" }
  }
  const plugin = (catalog.plugins || []).find((entry) => entry && entry.id === id)
  const commit = plugin?.listingValidatedCommit
  if (!plugin || !/^[0-9a-f]{40}$/.test(String(commit || "")) || !/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(String(plugin.repo || ""))) {
    return { ok: false, reason: `${id} is not listed with a validated commit and a github.com repository in the pinned catalog` }
  }
  return { ok: true, repo: plugin.repo, commit }
}

function readHead(dir) {
  try {
    const head = readFileSync(join(dir, ".git/HEAD"), "utf8").trim()
    if (/^[0-9a-f]{40}$/.test(head)) return head
    const ref = head.match(/^ref: (.+)$/)?.[1]
    return ref ? readFileSync(join(dir, ".git", ref), "utf8").trim() : null
  } catch {
    return null
  }
}
