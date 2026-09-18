// `omakit setup`: the first run, in one command.
//
// It replaces the three things a newcomer otherwise has to know: that a pinned
// marketplace checkout has to be fetched before anything works, where it goes,
// and what to try first. It is idempotent, so running it again on a machine that
// is already set up just confirms that.
//
// It writes the pinned checkout, through the same `ensurePin` that `omakit
// pin` uses, and the completion script where the shell in $SHELL loads it
// from. It does not create symlinks or install anything, and it edits a shell
// profile in exactly one case, after an explicit yes: the guarded block that
// makes completions load, when a new shell has no loader. Everywhere else a
// step that is the user's to take is printed as the command, and stops.

import { banner } from "./banner.mjs"
import { version } from "./doctor.mjs"
import { credential, UNAUTHENTICATED_LIMIT } from "./github.mjs"
import { ensurePin, marketplacePinDir, pinDiskUsage } from "./pin.mjs"
import { progress } from "./progress.mjs"
import { action, colourEnabled, GUTTER, mark, styler, wrap } from "./style.mjs"
import { TAGLINE } from "./usage.mjs"
import { installCompletion } from "./completion.mjs"
import { appendLoaderBlock, completionWorks, loaderBlock, loaderBlockPresent, verifyCompletion } from "./completion-check.mjs"
import { submissionContract } from "./form.mjs"
import { pathHint } from "./path-hint.mjs"
import { withHomeAbbreviated } from "./paths.mjs"
import { askYes } from "../weigh/confirm.mjs"
import { tool } from "./doctor.mjs"

/**
 * Tab completion, end to end: the script written for the shell in $SHELL
 * where that shell loads it from, then a new interactive shell asked
 * whether it can complete `omakit`, the way TAB asks. Measured before this
 * (docs/MEASUREMENTS.md M8): setup reported the script installed and never
 * asked a shell. When the shell has no completion loader, the one guarded
 * block that gives it one is offered, once, and appended only on yes; with
 * `askRc: false` (the step `upgrade` re-runs) it is named and not offered.
 * `▁ ok` is printed only when a new shell shows the spec.
 *
 * @param {{ repoRoot: string, pin: string, version: string, stream?: NodeJS.WriteStream, env?: object,
 *           yes?: boolean, askRc?: boolean, input?: NodeJS.ReadStream, verify?: typeof verifyCompletion }} options
 * @returns {Promise<{ state: "ok"|"note"|"unsupported"|"error", shell: string|null, rcAppended: boolean }>}
 */
export async function completionStep({ repoRoot, pin, version, stream = process.stdout, env = process.env, yes = false, askRc = true, input = process.stdin, verify = verifyCompletion }) {
  const c = styler(colourEnabled(stream))
  const out = (line = "") => stream.write(`${line}\n`)
  const step = (state, text) => out(`${mark(state, c)}${wrap(withHomeAbbreviated(text, env), { indent: GUTTER }, c).join("\n").trimStart()}`)
  const fix = (text) => { for (const line of action(withHomeAbbreviated(text, env), c)) out(line) }
  let completion
  try {
    const contract = await submissionContract({ repoRoot })
    completion = installCompletion({ contract, pin, version, env })
  } catch (error) {
    step("info", `tab completion was not installed: ${error.message}`)
    return { state: "error", shell: null, rcAppended: false }
  }
  if (completion.state === "unsupported") {
    step("info", completion.shell
      ? `tab completion: no script for ${completion.shell}; there is one for bash, zsh and fish.`
      : "tab completion: $SHELL is not set, so no script was installed.")
    return { state: "unsupported", shell: completion.shell, rcAppended: false }
  }
  const what = { installed: "installed", updated: "updated for this omakit and pin", current: "already installed" }[completion.state]
  const where = `${completion.display}${completion.note ? `, ${completion.note}` : ""}`
  let probe = verify(completion.shell, { env })
  let rcAppended = false
  if (!probe.ran) {
    step("advisory", `tab completion for ${completion.shell} ${what} at ${where}, but a new ${completion.shell} could not be asked whether it loads: ${probe.reason}.`)
    return { state: "note", shell: completion.shell, rcAppended }
  }
  if (!probe.loader) {
    const block = loaderBlock(completion.shell, env)
    const missing = completion.shell === "bash"
      ? "a new bash has no completion loader: /usr/share/bash-completion/bash_completion is not sourced, so a script under ~/.local/share/bash-completion/ is never read"
      : "a new zsh has not run compinit, so no completion function is ever loaded"
    step("advisory", `tab completion for ${completion.shell} ${what} at ${where}, but ${missing}.`)
    if (block && !loaderBlockPresent(completion.shell, env)) {
      const question = `Add one guarded line to ${block.display} so completions load?`
      const agreed = askRc ? (yes || (Boolean(input.isTTY) && Boolean(stream.isTTY) && await askYes({ input, output: process.stderr, question }))) : false
      if (agreed) {
        const wrote = appendLoaderBlock(completion.shell, env)
        rcAppended = wrote.appended
        step("info", `appended to ${block.display}, marked \`${block.lines[0]}\`; omakit never edits or removes it.`)
        probe = verify(completion.shell, { env })
      } else {
        step("info", `nothing was written. The lines that make completions load, for ${block.display}:`)
        for (const line of block.lines) fix(line)
        return { state: "note", shell: completion.shell, rcAppended }
      }
    } else if (block) {
      step("info", `${block.display} already carries the \`${block.lines[0]}\` block; a new shell still reports no loader, so something later in that file undoes it.`)
      return { state: "note", shell: completion.shell, rcAppended }
    }
  }
  if (completionWorks(probe)) {
    step("pass", `tab completion for ${completion.shell} ${what} at ${where}; a new ${completion.shell} completes \`omakit\`${probe.spec === "lazy" ? " on the first TAB" : ""}.${rcAppended ? ` Open terminals need a new shell: \`exec ${completion.shell}\`.` : ""}`)
    return { state: "ok", shell: completion.shell, rcAppended }
  }
  step("advisory", `tab completion for ${completion.shell} ${what} at ${where}, but a new ${completion.shell} ${probe.loader ? "does not load it" : "still has no completion loader"}${rcAppended ? " even after the block was appended" : ""}.`)
  fix(`Open a new shell (\`exec ${completion.shell}\`) and run \`omakit doctor\`; it reports the script, the loader and the spec as \`omakit.completion\`.`)
  return { state: "note", shell: completion.shell, rcAppended }
}


/**
 * @param {{ repoRoot: string, entryPoint: string, stream?: NodeJS.WriteStream, env?: object, yes?: boolean,
 *           input?: NodeJS.ReadStream, verify?: typeof verifyCompletion }} options
 *   `env` is where `$HOME` is read from: this is output for a person, so a
 *   path under it is printed as `~/...`. `yes` answers the one question
 *   setup can ask (the rc block for completion), for an agent.
 */
export async function setup({ repoRoot, entryPoint, stream = process.stdout, env = process.env, yes = false, input = process.stdin, verify = verifyCompletion }) {
  const c = styler(colourEnabled(stream))
  const out = (line = "") => stream.write(`${line}\n`)
  // A step is a status line: the mark, then the fact, wrapped under itself.
  const step = (state, text) => out(`${mark(state, c)}${wrap(withHomeAbbreviated(text, env), { indent: GUTTER }, c).join("\n").trimStart()}`)
  // The one action under a step sits in the step's body; under a sentence it
  // sits where the sentence does.
  const fix = (text, indent = GUTTER) => { for (const line of action(withHomeAbbreviated(text, env), c, { indent })) out(line) }

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

  // The hint is for the install that is here: a symlink for a clone, the npm
  // prefix's bin on PATH for a package, in the shell in $SHELL (path-hint.mjs).
  const reach = pathHint({ repoRoot, entryPoint })
  if (!reach.reachable) {
    step("info", reach.line
      ? `${reach.reason} This puts it there${reach.where ? `; keep it in ${reach.where}` : ""}:`
      : reach.reason)
    if (reach.line) fix(reach.line)
    out()
  }

  // Tab completion, installed for the shell in $SHELL where that shell loads
  // it from, and then proven in a new shell (completionStep).
  await completionStep({ repoRoot, pin: identity.commit, version: tool(repoRoot).version, stream, env, yes, askRc: true, input, verify })
  out()

  out("Try it on a plugin you have checked out:")
  out()
  fix("omakit submit <plugin-repo> --category Widgets --tags bar,quickshell", 0)
  out()
  for (const line of wrap("It prints the issue title and body. It never posts anything.", {}, c)) out(line)
  return { ok: true }
}
