// `omakit verify <target>`: the pinned official baseline over the local Git
// transport, reported verbatim beside the pin identity. `omakit submit` builds on
// this; `verify` exists on its own so the raw official result can be inspected
// without any Omakit check around it.
import { runBaseline } from "./run-baseline.mjs"
import { MARKETPLACE_PIN } from "./pin.mjs"
import { ASSUMED_BY_ADAPTER } from "./local-transport.mjs"

/** The one assumption a subtree scan adds: the tree the official code saw is the plugin directory, not the repository root. */
function subtreeAssumption(subdir) {
  return subdir ? [`tree.root=${subdir.replace(/\/+$/, "")}/ (the plugin directory below the repository root, not the root)`] : []
}

const MARKETPLACE_STATEMENT =
  "Official baseline preview over a local snapshot. The marketplace rescans the public commit itself. This is not approval, listing, verification or a security audit."

/**
 * @param {{ repoRoot: string, subject: { dir: string, commit: string, repository: { url: string|null } }, listedPlugins?: Array, subdir?: string }} options
 *   `subdir`, when given, is a directory below the repository root that the
 *   local transport serves as the whole tree, so the official code scans the
 *   plugin's directory and not the repository around it; the section records
 *   it under `assumedByAdapter`. `verify` and `submit` pass none and scan the
 *   root, which for them is the repository the marketplace would fetch.
 * @returns the `marketplaceBaseline` section: pin, transport, adapter
 *   assumptions, the official result verbatim, and the statement.
 */
export async function marketplaceBaselineSection({ repoRoot, subject, listedPlugins, subdir = "" }) {
  const pin = {
    repository: MARKETPLACE_PIN.repository,
    commit: MARKETPLACE_PIN.commit,
    baselineVersion: MARKETPLACE_PIN.baselineVersion,
    enforcementMode: MARKETPLACE_PIN.enforcementMode,
  }
  if (!subject.repository.url) {
    return {
      pin,
      transport: "none",
      assumedByAdapter: [],
      invoked: false,
      skipReason: "no declared GitHub repository URL",
      official: null,
      statement: MARKETPLACE_STATEMENT,
    }
  }
  let run
  try {
    run = await runBaseline({
      repoRoot,
      repoUrl: subject.repository.url,
      commitSha: subject.commit,
      transport: "local",
      repoDir: subject.dir,
      repoSubdir: subdir,
      listedPlugins,
    })
  } catch (error) {
    if (error && typeof error.code === "string" && error.code.startsWith("security-baseline-")) {
      // The official code refused the snapshot (scan limit, unreadable file):
      // that refusal is the official result and is reported verbatim.
      return {
        pin,
        transport: "local-git",
        assumedByAdapter: [...ASSUMED_BY_ADAPTER, ...subtreeAssumption(subdir)],
        invoked: true,
        skipReason: null,
        official: { error: { code: error.code, message: error.message, ...(error.details || {}) } },
        statement: MARKETPLACE_STATEMENT,
      }
    }
    throw error
  }
  return {
    pin: { ...pin, commit: run.pin.commit, baselineVersion: run.pin.baselineVersion, enforcementMode: run.pin.enforcementMode },
    transport: "local-git",
    assumedByAdapter: [...run.adapter.assumedByAdapter, ...subtreeAssumption(subdir)],
    invoked: true,
    skipReason: null,
    official: run.result,
    statement: MARKETPLACE_STATEMENT,
  }
}
