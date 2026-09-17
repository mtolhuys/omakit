// Tab completion for bash, zsh and fish, installed by `omakit setup` for the
// shell it runs from.
//
// Everything the script completes is derived, never retyped: the subcommands
// and their flags from COMMANDS in usage.mjs, so a command added there cannot
// be missing here, and the categories and tags from the submission form at the
// marketplace pin, the same source the checks read. Those controlled values are
// baked into the emitted script rather than fetched on every keypress: node's
// startup plus a pin read is not something to put behind a TAB. The script says
// in its own header which pin it came from and how to regenerate it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { tagSlug } from "./form.mjs"
import { COMMANDS, COMPLETION_SHELLS } from "./usage.mjs"
import { withHomeAbbreviated } from "./paths.mjs"
import { shippedBlocks } from "../blocks/registry.mjs"

/**
 * The completion model, read out of the help data. A subcommand is the word
 * after `omakit` in its signature; a flag is every `--word` in it, valued when
 * a `<placeholder>` follows it; `<target>` or `<plugin-id-or-dir>` in the
 * signature means the first positional can be a directory.
 *
 * @param {ReadonlyArray<{ signature: string|string[], lines: string[] }>} commands
 */
export function subcommandsOf(commands = COMMANDS) {
  return commands.map((command) => {
    const signature = [].concat(command.signature).join(" ")
    const name = signature.match(/^omakit +([a-z][a-z-]*)/)?.[1]
    if (!name) throw new Error(`completion: no subcommand in signature ${JSON.stringify(signature)}`)
    // A flag named on two signature lines (`--json` on weigh's main line and
    // on its `--list` line) is one flag.
    const seen = new Set()
    const flags = [...signature.matchAll(/(--[a-z][a-z-]*)(?: <([^>]+)>)?/g)]
      .filter(([, flag]) => !seen.has(flag) && seen.add(flag))
      .map(([, flag, placeholder]) => ({
        flag,
        value: placeholder ? placeholderKind(placeholder) : null,
      }))
    const sentence = command.lines.join(" ").replace(/`/g, "").split(/(?<=\.)\s/)[0]
    // `<target>` completes as a directory; `<plugin-id-or-dir>` as the ids
    // the running shell has installed, read at TAB time, with a directory
    // as the fallback.
    // `omakit add <block> [<plugin-dir>]`: the block names omakit ships for
    // the first word, a directory for the second.
    const target = /^omakit +add\b/.test(signature) ? "block" : /<plugin-id-or-dir>/.test(signature) ? "plugin" : /<target>/.test(signature) ? "directory" : false
    return { name, description: sentence, flags, target, blocks: target === "block" ? shippedBlocks().map((block) => block.name) : [] }
  })
}

/**
 * The plugin ids a TAB offers for `omakit weigh <TAB>` and `omakit audit <TAB>`:
 * what the running
 * shell reports through `omarchy-shell shell listPlugins`, filtered with
 * `jq` at TAB time, enabled ids first and whole bars left out, since a bar
 * cannot be weighed. No node process behind the TAB: a shell that does not
 * answer within a second yields nothing, and the script falls back to a
 * directory. The pipeline is the same in every shell's script and the jq
 * expression is exported so a test can run it through jq.
 */
export const PLUGIN_IDS_JQ = "[.[] | select(((.kinds // []) | index(\"bar\")) | not)] | sort_by(.enabled | not) | .[].id"
/**
 * The pipeline, in the shell's own syntax. `timeout 1` bounds the wait
 * where coreutils has it; a system without `timeout` (measured: the macOS
 * runner in CI, where the TAB fell back to directories) runs the command
 * unbounded rather than never, since `omarchy-shell` itself gives up on
 * its IPC timeout.
 */
export const PLUGIN_IDS_COMMAND = `omarchy-shell shell listPlugins 2>/dev/null | jq -r '${PLUGIN_IDS_JQ}' 2>/dev/null`
export const PLUGIN_IDS_TIMED = `timeout 1 ${PLUGIN_IDS_COMMAND}`

/** What a valued flag takes, by its placeholder: a controlled value, a file, or free text. */
function placeholderKind(placeholder) {
  if (placeholder === "c") return "category"
  if (placeholder === "a,b") return "tags"
  if (placeholder === "file") return "file"
  return "text"
}

/**
 * @param {"bash"|"zsh"|"fish"} shell
 * @param {{ contract: { categories: string[], tagLabels: string[] }, pin: string, commands?: typeof COMMANDS }} options
 * @returns {string} the script
 */
export function renderCompletion(shell, { contract, pin, version = "unknown", commands = COMMANDS }) {
  if (!COMPLETION_SHELLS.includes(shell)) throw new Error(`completion: no script for ${shell}`)
  const model = {
    subcommands: subcommandsOf(commands),
    categories: [...contract.categories],
    tags: contract.tagLabels.map(tagSlug),
    pin,
    version,
  }
  return { bash, zsh, fish }[shell](model)
}

/**
 * The first line of every script names the omakit version and the pin it
 * was rendered from, in one line, so the run-time staleness check
 * (completion-check.mjs) reads one line and nothing else. The pin is what
 * decides the categories and tags; the version is what decides the
 * subcommands and flags, and a script from 0.1.9 knows no `weigh`.
 */
function header(comment, shell, pin, version) {
  return [
    `${comment} omakit completion for ${shell}, omakit ${version}, marketplace pin ${pin}.`,
    `${comment} Generated by \`omakit setup\`; the categories and tags below are that pin's`,
    `${comment} submission form and the commands are that version's. Regenerate it by`,
    `${comment} running setup again.`,
  ]
}

/**
 * The version and the pin a script names, from its first line (its second
 * for zsh, under `#compdef`), or null when
 * the line is not one omakit wrote (a script from before the version was
 * recorded reads as version null and its pin from the old header).
 *
 * @param {string} text the first two lines are enough
 * @returns {{ shell: string|null, version: string|null, pin: string|null }}
 */
export function parseCompletionHeader(text) {
  // zsh's script starts with its `#compdef` line; the header is the next.
  const lines = String(text).split("\n", 2)
  const line = lines[0].startsWith("#compdef") ? lines[1] || "" : lines[0]
  const current = line.match(/^# omakit completion for (\w+), omakit (\S+), marketplace pin ([0-9a-f]{40})\.$/)
  if (current) return { shell: current[1], version: current[2], pin: current[3] }
  const older = line.match(/^#\s*omakit completion for (\w+)\./)
  return { shell: older ? older[1] : null, version: null, pin: null }
}

const single = (text) => `'${String(text).replace(/'/g, "'\\''")}'`

// --- bash ---------------------------------------------------------------------

function bash({ subcommands, categories, tags, pin, version }) {
  const lines = [...header("#", "bash", pin, version), ""]
  lines.push("_omakit() {")
  lines.push("  local cur prev command")
  lines.push("  cur=${COMP_WORDS[COMP_CWORD]}")
  lines.push("  prev=${COMP_WORDS[COMP_CWORD-1]}")
  lines.push(`  local commands=${single(subcommands.map((c) => c.name).join(" "))}`)
  lines.push(`  local categories=${single(categories.join("\n"))}`)
  lines.push(`  local tags=${single(tags.join(" "))}`)
  lines.push("  COMPREPLY=()")
  lines.push("  if ((COMP_CWORD == 1)); then")
  lines.push('    COMPREPLY=($(compgen -W "$commands" -- "$cur"))')
  lines.push("    return")
  lines.push("  fi")
  lines.push("  command=${COMP_WORDS[1]}")
  lines.push('  case "$command" in')
  for (const sub of subcommands) {
    lines.push(`  ${sub.name})`)
    const valued = sub.flags.filter((f) => f.value)
    if (valued.length) {
      lines.push('    case "$prev" in')
      for (const { flag, value } of valued) {
        if (value === "category") lines.push(`    ${flag}) _omakit_values "$categories" "$cur"; return ;;`)
        else if (value === "tags") lines.push(`    ${flag}) _omakit_list "$tags" "$cur"; return ;;`)
        else if (value === "file") lines.push(`    ${flag}) COMPREPLY=($(compgen -f -- "$cur")); compopt -o filenames 2>/dev/null; return ;;`)
        else lines.push(`    ${flag}) return ;;`)
      }
      lines.push("    esac")
    }
    if (sub.flags.length) {
      lines.push('    if [[ "$cur" == -* ]]; then')
      lines.push(`      COMPREPLY=($(compgen -W ${single(sub.flags.map((f) => f.flag).join(" "))} -- "$cur"))`)
      lines.push("      return")
      lines.push("    fi")
    }
    if (sub.target === "plugin") {
      lines.push('    if ((COMP_CWORD == 2)); then')
      lines.push('      COMPREPLY=($(compgen -W "$(_omakit_plugin_ids)" -- "$cur"))')
      lines.push('      if ((${#COMPREPLY[@]} == 0)); then COMPREPLY=($(compgen -d -- "$cur")); compopt -o filenames 2>/dev/null; fi')
      lines.push("    fi")
    } else if (sub.target === "block") {
      lines.push('    if ((COMP_CWORD == 2)); then')
      lines.push(`      COMPREPLY=($(compgen -W ${single(sub.blocks.join(" "))} -- "$cur"))`)
      lines.push('    elif ((COMP_CWORD == 3)); then')
      lines.push('      COMPREPLY=($(compgen -d -- "$cur")); compopt -o filenames 2>/dev/null')
      lines.push("    fi")
    } else if (sub.target) {
      lines.push('    COMPREPLY=($(compgen -d -- "$cur"))')
      lines.push("    compopt -o filenames 2>/dev/null")
    }
    lines.push("    ;;")
  }
  lines.push("  esac")
  lines.push("}")
  lines.push("")
  lines.push("# The plugin ids the running shell has installed, enabled first, whole bars")
  lines.push("# left out, read at TAB time; nothing when the shell does not answer in a")
  lines.push("# second, and the caller falls back to a directory.")
  lines.push("_omakit_plugin_ids() {")
  lines.push(`  if command -v timeout >/dev/null 2>&1; then ${PLUGIN_IDS_TIMED}; else ${PLUGIN_IDS_COMMAND}; fi`)
  lines.push("}")
  lines.push("")
  lines.push("# A controlled value may contain a space, so each match is one line and is")
  lines.push("# escaped on the way out, the way the shell would have to type it.")
  lines.push("_omakit_values() {")
  lines.push("  local IFS=$'\\n' i")
  lines.push('  COMPREPLY=($(compgen -W "$1" -- "${2//\\\\ / }"))')
  lines.push('  for i in "${!COMPREPLY[@]}"; do COMPREPLY[i]=$(printf \'%q\' "${COMPREPLY[i]}"); done')
  lines.push("}")
  lines.push("")
  lines.push("# A comma-separated list: complete the segment after the last comma and keep")
  lines.push("# what came before it.")
  lines.push("_omakit_list() {")
  lines.push('  local prefix="" part="$2"')
  lines.push('  if [[ "$2" == *,* ]]; then prefix="${2%,*},"; part="${2##*,}"; fi')
  lines.push('  COMPREPLY=($(compgen -P "$prefix" -W "$1" -- "$part"))')
  lines.push("}")
  lines.push("")
  lines.push("complete -F _omakit omakit")
  return `${lines.join("\n")}\n`
}

// --- zsh ----------------------------------------------------------------------

const zshDescribe = (name, description) => single(`${name}:${description.replace(/:/g, "\\:")}`)

function zsh({ subcommands, categories, tags, pin, version }) {
  const lines = ["#compdef omakit", ...header("#", "zsh", pin, version), ""]
  lines.push("_omakit() {")
  lines.push("  local curcontext=\"$curcontext\" state line")
  lines.push("  typeset -A opt_args")
  lines.push("  local -a commands categories tags shells")
  lines.push("  commands=(")
  for (const sub of subcommands) lines.push(`    ${zshDescribe(sub.name, sub.description)}`)
  lines.push("  )")
  lines.push(`  categories=(${categories.map(single).join(" ")})`)
  lines.push(`  tags=(${tags.map(single).join(" ")})`)
  lines.push("  _arguments -C '1:command:->command' '*::arguments:->arguments'")
  lines.push('  case "$state" in')
  lines.push("  command)")
  lines.push("    _describe -t commands 'omakit command' commands")
  lines.push("    ;;")
  lines.push("  arguments)")
  lines.push('    case "$line[1]" in')
  for (const sub of subcommands) {
    lines.push(`    ${sub.name})`)
    const specs = sub.flags.map(({ flag, value }) => {
      if (value === "category") return single(`${flag}:category:{compadd -a categories}`)
      if (value === "tags") return single(`${flag}:tags:{_values -s , tag $tags}`)
      if (value === "file") return single(`${flag}:file:_files`)
      if (value === "text") return single(`${flag}:text:`)
      return single(flag)
    })
    if (sub.target === "plugin") specs.push(single("1:plugin:_omakit_plugins"))
    else if (sub.target === "block") specs.push(single(`1:block:(${sub.blocks.join(" ")})`), single("2:plugin directory:_directories"))
    else if (sub.target) specs.push(single("1:target:_directories"))
    if (specs.length) lines.push(`      _arguments ${specs.join(" ")}`)
    lines.push("      ;;")
  }
  lines.push("    esac")
  lines.push("    ;;")
  lines.push("  esac")
  lines.push("}")
  lines.push("")
  lines.push("# The plugin ids the running shell has installed, enabled first, whole bars")
  lines.push("# left out, read at TAB time; a directory when the shell does not answer.")
  lines.push("_omakit_plugins() {")
  lines.push("  local -a ids")
  lines.push(`  if (( $+commands[timeout] )); then ids=(\${(f)"$(${PLUGIN_IDS_TIMED})"}); else ids=(\${(f)"$(${PLUGIN_IDS_COMMAND})"}); fi`)
  lines.push("  if (( ${#ids} )); then compadd -a ids; else _directories; fi")
  lines.push("}")
  lines.push("")
  lines.push('_omakit "$@"')
  return `${lines.join("\n")}\n`
}

// --- fish ---------------------------------------------------------------------

const fishWord = (text) => String(text).replace(/([\\'" ])/g, "\\$1")

function fish({ subcommands, categories, tags, pin, version }) {
  const lines = [...header("#", "fish", pin, version), ""]
  lines.push("complete -c omakit -f")
  lines.push("")
  lines.push("# The plugin ids the running shell has installed, enabled first, whole bars")
  lines.push("# left out, read at TAB time; nothing when the shell does not answer, and")
  lines.push("# the directories offered beside them stand.")
  lines.push("function __omakit_plugin_ids")
  lines.push(`  if command -q timeout; ${PLUGIN_IDS_TIMED}; else; ${PLUGIN_IDS_COMMAND}; end`)
  lines.push("end")
  lines.push("")
  for (const sub of subcommands) {
    lines.push(`complete -c omakit -n __fish_use_subcommand -a ${sub.name} -d ${single(sub.description)}`)
  }
  for (const sub of subcommands) {
    const when = `-n ${single(`__fish_seen_subcommand_from ${sub.name}`)}`
    if (sub.target === "plugin") lines.push(`complete -c omakit ${when} -a '(__omakit_plugin_ids)'`)
    if (sub.target === "block") lines.push(`complete -c omakit ${when} -a ${single(sub.blocks.join(" "))}`)
    if (sub.target) lines.push(`complete -c omakit ${when} -a '(__fish_complete_directories)'`)
    for (const { flag, value } of sub.flags) {
      const long = `-l ${flag.slice(2)}`
      if (value === "category") lines.push(`complete -c omakit ${when} ${long} -x -a ${single(categories.map(fishWord).join(" "))}`)
      else if (value === "tags") lines.push(`complete -c omakit ${when} ${long} -x -a ${single(tags.join(" "))}`)
      else if (value === "file") lines.push(`complete -c omakit ${when} ${long} -r`)
      else if (value === "text") lines.push(`complete -c omakit ${when} ${long} -x`)
      else lines.push(`complete -c omakit ${when} ${long}`)
    }
  }
  return `${lines.join("\n")}\n`
}

// --- where a shell loads it from --------------------------------------------

/**
 * Where the user's shell would load the script from, so `omakit setup` can say
 * how to install it and only when it is not there. bash-completion reads the
 * XDG data directory; fish reads its config directory; zsh has no user
 * directory of its own, and `~/.zfunc` is the convention, added to `fpath`.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ shell: string, path: string, display: string, note: string|null } | null}
 */
export function completionInstall(env = process.env) {
  const shell = basename(env.SHELL || "")
  const home = env.HOME || ""
  if (!home || !COMPLETION_SHELLS.includes(shell)) return null
  const tilde = (dir) => withHomeAbbreviated(dir, env)
  if (shell === "bash") {
    const dir = join(env.XDG_DATA_HOME || join(home, ".local/share"), "bash-completion/completions")
    return { shell, path: join(dir, "omakit"), display: `${tilde(dir)}/omakit`, note: null }
  }
  if (shell === "fish") {
    const dir = join(env.XDG_CONFIG_HOME || join(home, ".config"), "fish/completions")
    return { shell, path: join(dir, "omakit.fish"), display: `${tilde(dir)}/omakit.fish`, note: null }
  }
  const dir = join(env.ZDOTDIR || home, ".zfunc")
  return { shell, path: join(dir, "_omakit"), display: `${tilde(dir)}/_omakit`, note: "with `fpath+=~/.zfunc` before `compinit` in your .zshrc" }
}

/**
 * Install the script where the shell in $SHELL loads it from, so a person
 * never has to know the path: `omakit setup` calls this. Idempotent: a script
 * that is already there and names the current pin is left alone; a missing
 * one, or one from another pin, is written. The only file this writes is
 * the completion script at the path `completionInstall` names, and
 * tests/unit/self-containment.test.mjs holds it to that.
 *
 * @param {{ contract: { categories: string[], tagLabels: string[] }, pin: string, version?: string, env?: NodeJS.ProcessEnv }} options
 * @returns {{ state: "installed"|"updated"|"current"|"unsupported", shell: string|null, display: string|null, note: string|null, path?: string }}
 */
export function installCompletion({ contract, pin, version = "unknown", env = process.env }) {
  const target = completionInstall(env)
  if (!target) return { state: "unsupported", shell: basename(env.SHELL || "") || null, display: null, note: null }
  const script = renderCompletion(target.shell, { contract, pin, version })
  let existing = null
  try {
    existing = readFileSync(target.path, "utf8")
  } catch {
    existing = null
  }
  if (existing === script) return { state: "current", ...target }
  mkdirSync(dirname(target.path), { recursive: true })
  const completionFile = target.path
  writeFileSync(completionFile, script)
  return { state: existing === null ? "installed" : "updated", ...target }
}
