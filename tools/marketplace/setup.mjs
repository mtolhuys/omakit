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
import { action, colourEnabled, GUTTER, mark, styler, wrap } from "./style.mjs"
import { TAGLINE } from "./usage.mjs"
import { installCompletion } from "./completion.mjs"
import { submissionContract } from "./form.mjs"

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
  // A step is a status line: the mark, then the fact, wrapped under itself.
  const step = (state, text) => out(`${mark(state, c)}${wrap(text, { indent: GUTTER }, c).join("\n").trimStart()}`)
  // The one action under a step sits in the step's body; under a sentence it
  // sits where the sentence does.
  const fix = (text, indent = GUTTER) => { for (const line of action(text, c, { indent })) out(line) }

  // The one place the wordmark runs through `ttfx` (effect.mjs): a first run
  // already spending seconds fetching the pin.
  await banner({ stream, tagline: TAGLINE, effect: true })

  const node = process.versions.node
  const major = Number(node.split(".")[0])
  if (major < 22) {
    step("fail", `node ${node} is too old; omakit needs 22 or newer.`)
    fix("Install Node 22 or newer, then run `omakit setup` again.")
    return { ok: false }
  }
  step("pass", `node ${node}`)

  const git = version("git")
  if (!git) {
    step("fail", "git was not found on PATH. omakit needs it for the pin and for reading a commit's tree.")
    fix("Install git, then run `omakit setup` again.")
    return { ok: false }
  }
  step("pass", git)

  // GitHub access, before the pin, because this is the one step a newcomer might
  // otherwise think they have to prepare a token for. They do not.
  const auth = credential({ refresh: true })
  if (auth.source === "gh") {
    step("pass", "GitHub: your `gh` login, read-only. omakit stores nothing.")
  } else {
    step("info", `no GitHub login. \`submit\` and \`verify\` need none at all; \`watch\` and \`parity\` are capped at ${UNAUTHENTICATED_LIMIT} requests an hour without one.`)
    fix("`gh auth login` is enough; omakit reads it read-only and stores nothing.")
  }

  const dir = marketplacePinDir(repoRoot)
  const spinner = progress()
  let identity
  try {
    identity = ensurePin(repoRoot, (line) => {
      if (line.state === "fetching") spinner.phase(line.text)
    }).identity
  } catch (error) {
    spinner.done()
    step("fail", error.message)
    fix(error.remedy || (error.code === "network-unavailable"
      ? "Connect to the network, then run `omakit setup` again."
      : "Remove the checkout, then run `omakit setup` again."))
    return { ok: false }
  }
  spinner.done()
  step("pass", `marketplace pin ${identity.commit.slice(0, 7)} (baseline ${identity.baselineVersion}, ${identity.enforcementMode}), ${pinDiskUsage(dir)}`)
  out()
  for (const line of wrap("Every rule omakit checks is read from that checkout, at that exact commit. It never moves on its own. `omakit doctor` says when it is behind.", {}, c)) out(line)
  out()

  if (!onPath()) {
    step("info", "`omakit` is not on your PATH yet. This puts it there:")
    fix(`ln -s ${entryPoint} ~/.local/bin/omakit`)
    out()
  }

  // Tab completion, installed for the shell in $SHELL where that shell loads
  // it from, so nobody has to know the path. The script carries the pin's
  // categories and tags, so it is rewritten when the pin has moved and left
  // alone otherwise.
  try {
    const contract = await submissionContract({ repoRoot })
    const completion = installCompletion({ contract, pin: identity.commit })
    if (completion.state === "unsupported") {
      step("info", completion.shell
        ? `tab completion: no script for ${completion.shell}; \`omakit completion bash|zsh|fish\` prints one for those.`
        : "tab completion: $SHELL is not set, so no script was installed; `omakit completion bash|zsh|fish` prints one.")
    } else {
      const what = { installed: "installed", updated: "updated for this pin", current: "already installed" }[completion.state]
      step("pass", `tab completion for ${completion.shell} ${what} at ${completion.display}${completion.note ? `, ${completion.note}` : ""}.`)
    }
  } catch (error) {
    step("info", `tab completion was not installed: ${error.message}`)
  }
  out()

  out("Try it on a plugin you have checked out:")
  out()
  fix("omakit submit <plugin-repo> --category Widgets --tags bar,quickshell", 0)
  out()
  for (const line of wrap("It prints the issue title and body. It never posts anything.", {}, c)) out(line)
  return { ok: true }
}
