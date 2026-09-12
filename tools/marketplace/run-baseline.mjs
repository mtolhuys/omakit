// Run the pinned official Omarchy marketplace security baseline over one
// commit, either through GitHub (the transport the marketplace itself uses) or
// through the local Git transport in this directory.
//
// Omakit never copies or edits marketplace policy: the analysis below is the
// official code, imported unmodified from a pinned read-only checkout.

import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { createLocalTransport, ADAPTER_VERSION, ASSUMED_BY_ADAPTER } from "./local-transport.mjs"
import { requirePin } from "./pin.mjs"

async function loadScanner(pinDir) {
  const url = pathToFileURL(join(pinDir, "scripts/security-baseline-scanner.mjs")).href
  return import(url)
}

/**
 * @param {{ repoRoot: string, repoUrl: string, commitSha: string, transport: "local"|"github",
 *           repoDir?: string, listedPlugins?: Array, token?: string }} options
 */
export async function runBaseline(options) {
  const { dir: pinDir, identity } = requirePin(options.repoRoot)
  const pin = { commit: identity.commit, baselineVersion: identity.baselineVersion, enforcementMode: identity.enforcementMode }
  const { runSecurityBaseline } = await loadScanner(pinDir)

  const scanOptions = { checkedAt: "1970-01-01T00:00:00.000Z" }
  if (options.listedPlugins) scanOptions.listedPlugins = options.listedPlugins
  let adapter = null

  if (options.transport === "local") {
    const transport = createLocalTransport({
      repoDir: options.repoDir,
      repoUrl: options.repoUrl,
      commitSha: options.commitSha,
    })
    scanOptions.fetchImpl = transport.fetchImpl
    adapter = {
      transport: "local-git",
      adapterVersion: ADAPTER_VERSION,
      assumedByAdapter: ASSUMED_BY_ADAPTER,
      requests: transport.stats,
    }
  } else {
    if (options.token) scanOptions.token = options.token
    adapter = { transport: "github" }
  }

  const result = await runSecurityBaseline(options.repoUrl, options.commitSha, scanOptions)
  return { pin, adapter, result }
}

function arg(name) {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const repoRoot = resolve(arg("repo-root") || process.cwd())
  const transport = arg("transport") === "github" ? "github" : "local"
  const out = await runBaseline({
    repoRoot,
    repoUrl: arg("repo-url"),
    commitSha: arg("commit"),
    transport,
    repoDir: arg("dir") ? resolve(arg("dir")) : undefined,
    token: process.env.GITHUB_TOKEN,
  })
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
}
