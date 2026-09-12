// `omakit verify <target>`: the pinned official baseline over the local Git
// transport, reported verbatim beside the pin identity. `omakit submit` builds on
// this; `verify` exists on its own so the raw official result can be inspected
// without any Omakit check around it.
import { runBaseline } from "./run-baseline.mjs"
import { MARKETPLACE_PIN } from "./pin.mjs"
import { ASSUMED_BY_ADAPTER } from "./local-transport.mjs"

const MARKETPLACE_STATEMENT =
  "Official baseline preview over a local snapshot. The marketplace rescans the public commit itself. This is not approval, listing, verification or a security audit."

/**
 * @param {{ repoRoot: string, subject: { dir: string, commit: string, repository: { url: string|null } }, listedPlugins?: Array }} options
 * @returns the `marketplaceBaseline` section: pin, transport, adapter
 *   assumptions, the official result verbatim, and the statement.
 */
export async function marketplaceBaselineSection({ repoRoot, subject, listedPlugins }) {
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
      listedPlugins,
    })
  } catch (error) {
    if (error && typeof error.code === "string" && error.code.startsWith("security-baseline-")) {
      // The official code refused the snapshot (scan limit, unreadable file):
      // that refusal is the official result and is reported verbatim.
      return {
        pin,
        transport: "local-git",
        assumedByAdapter: [...ASSUMED_BY_ADAPTER],
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
    assumedByAdapter: [...run.adapter.assumedByAdapter],
    invoked: true,
    skipReason: null,
    official: run.result,
    statement: MARKETPLACE_STATEMENT,
  }
}
