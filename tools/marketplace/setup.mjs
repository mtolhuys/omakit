// `omakit setup`: the first run, in one command.
//
// It replaces the three things a newcomer otherwise has to know: that a pinned
// marketplace checkout has to be fetched before anything works, where it goes,
// and what to try first. It is idempotent, so running it again on a machine that
// is already set up just confirms that.
//
// It writes exactly one thing: the pinned checkout, through the same `ensurePin`
// that `omakit pin` uses. It does not create symlinks, edit a shell profile or
// install anything. Where a step is the user's to take, it prints the command
// and stops, which is the same contract every other command here keeps.

import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"
import { banner } from "./banner.mjs"
import { credential, UNAUTHENTICATED_LIMIT } from "./github.mjs"
import { ensurePin, marketplacePinDir, pinDiskUsage } from "./pin.mjs"
import { progress } from "./progress.mjs"
import { colourEnabled, paintProse, styler } from "./style.mjs"

function version(command) {
  try {
    return execFileSync(command, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim()
      .split("\n")[0]
  } catch {
    return null
  }
}

/** Is `omakit` reachable as a bare command, without asking a shell? */
export function onPath(name = "omakit", env = process.env) {
  return (env.PATH || "").split(delimiter).some((dir) => dir && existsSync(join(dir, name)))
}

/**
 * @param {{ repoRoot: string, entryPoint: string, stream?: NodeJS.WriteStream }} options
 */
export async function setup({ repoRoot, entryPoint, stream = process.stdout }) {
  const c = styler(colourEnabled(stream))
  const out = (line = "") => stream.write(`${line}\n`)

  await banner({ stream, tagline: "marketplace submit preflight for Omarchy Quattro plugins" })

  const node = process.versions.node
  const major = Number(node.split(".")[0])
  if (major < 22) {
    out(`${c("red.bold", "PROBLEM")} node ${node} is too old; omakit needs 22 or newer.`)
    return { ok: false }
  }
  out(`${c("green", "ok")}  node ${node}`)

  const git = version("git")
  if (!git) {
    out(`${c("red.bold", "PROBLEM")} git was not found on PATH. omakit needs it for the pin and for reading a commit's tree.`)
    return { ok: false }
  }
  out(`${c("green", "ok")}  ${git}`)

  // GitHub access, before the pin, because this is the one step a newcomer might
  // otherwise think they have to prepare a token for. They do not.
  const auth = credential({ refresh: true })
  if (auth.source === "gh") {
    out(`${c("green", "ok")}  GitHub: your \`gh\` login, read-only. omakit stores nothing.`)
  } else if (auth.source) {
    out(`${c("green", "ok")}  GitHub: ${auth.source}, read-only. Never written to disk.`)
  } else {
    out(`${c("yellow", "note")} No GitHub login. \`submit\` and \`verify\` need none at all;`)
    out(`      \`watch\` and \`parity\` are capped at ${UNAUTHENTICATED_LIMIT} requests an hour without one.`)
    out(`      ${c("cyan", "gh auth login")} is enough; omakit reads it read-only and stores nothing.`)
  }

  const dir = marketplacePinDir(repoRoot)
  const spinner = progress()
  let identity
  try {
    spinner.phase("fetching the pinned marketplace checkout")
    identity = ensurePin(repoRoot).identity
  } catch (error) {
    spinner.done()
    out(`${c("red.bold", "PROBLEM")} ${error.message}`)
    return { ok: false }
  }
  spinner.done()
  out(`${c("green", "ok")}  marketplace pin ${identity.commit.slice(0, 7)} (baseline ${identity.baselineVersion}, ${identity.enforcementMode}), ${pinDiskUsage(dir)}`)
  out()
  out(paintProse("Every rule omakit checks is read from that checkout, at that exact commit.", c))
  out(paintProse("It never moves on its own. `omakit doctor` says when it is behind.", c))
  out()

  if (!onPath()) {
    out(`${c("yellow", "note")} \`omakit\` is not on your PATH yet. This puts it there:`)
    out()
    out(`    ln -s ${entryPoint} ~/.local/bin/omakit`)
    out()
  }

  out("Try it on a plugin you have checked out:")
  out()
  out(c("cyan", "    omakit submit <plugin-repo> --category Widgets --tags bar,quickshell"))
  out()
  out(paintProse("It prints the issue title and body. It never posts anything.", c))
  return { ok: true }
}
