// The help text, as data rather than one painted string.
//
// Kept as structure so it can be coloured without pattern-matching a paragraph,
// and so the same words serve a terminal and a pipe. A signature is coloured by
// token: what you type is cyan, what you replace is yellow, the brackets that
// merely group them stay out of the way.

import { UNAUTHENTICATED_LIMIT } from "./github.mjs"
import { MARKETPLACE_PIN } from "./pin.mjs"
import { colourEnabled, paintProse, STEP, styler, withOutputStream, wrap } from "./style.mjs"

/**
 * "Safe" means one thing, everywhere it appears: this runs on your own
 * machine, posts nothing, opens no issue and spends nobody's attention. It is
 * never a claim about the security of a plugin or a submission; the baseline's
 * outcome is reported verbatim and is never restated as one.
 */
export const TAGLINE = "the safe place to find out"

/** The shells `omakit setup` installs tab completion for; completion.mjs holds the scripts. */
export const COMPLETION_SHELLS = Object.freeze(["bash", "zsh", "fish"])

export const COMMANDS = Object.freeze([
  {
    signature: "omakit setup [--yes] [--completion]",
    lines: [
      "First run, in one command: check the environment, fetch the pinned",
      "marketplace checkout, install tab completion and prove it in a new shell,",
      "and say what to try first. Idempotent. When a new shell has no completion",
      "loader it asks once before adding one guarded block to the rc file; --yes",
      "answers for an agent. --completion is that step alone, never the question.",
    ],
  },
  {
    signature: "omakit pin",
    lines: [
      "Fetch or verify the pinned marketplace checkout in the user cache:",
      "$XDG_CACHE_HOME/omakit/marketplace, or ~/.cache/omakit/marketplace.",
      `Read-only, exact commit ${MARKETPLACE_PIN.commit}.`,
    ],
  },
  {
    signature: [
      "omakit audit <plugin-id-or-dir> [--drift] [--json] [--out <file>] [--offline]",
      "omakit audit [--drift] [--json] [--out <file>] [--offline]",
    ],
    lines: [
      "Compare every installed third-party plugin's running commit with the",
      "exact commits the marketplace records as validated. Read-only. --drift",
      "shows only rows that are not validated; --offline reads the pin.",
    ],
  },
  {
    signature: [
      "omakit submit <target> --category <c> --tags <a,b> [--notes <text>]",
      "                      [--suggest-tag <t>] [--name <n>] [--offline]",
      "                      [--allow-dirty] [--json] [--out <file>]",
    ],
    lines: [
      "Every check that is knowable before submitting, the resolved commit, and",
      "the exact issue title and body. Prints them. Never posts anything.",
      "Three outcomes: READY (exit 0, the body), REFUSED (exit 1, no body), and",
      "LISTED (exit 0): the plugin is already listed by its own repository, so",
      "the submission form is not the route and nothing is asked. An id taken",
      "by another repository is refused. An unlisted plugin without a category",
      "and tags is asked at a terminal, with the form's lists numbered; in a",
      "pipe or with --json that is a usage error, exit 2. A READY or REFUSED",
      "report ends with the command line that repeats the run unasked.",
    ],
  },
  {
    signature: [
      "omakit watch <issue-url> [--json] [--out <file>]",
      "omakit watch [--all | --list] [--user <login>] [--json] [--out <file>]",
    ],
    lines: [
      "Compare the commit the marketplace validated on a submission issue with",
      "the plugin repository's current default-branch HEAD, and say what makes",
      "it validate a newer one. Read-only.",
      "--all checks your open marketplace issues; --list lists them first.",
      "Without a URL or either flag, a terminal asks which issues to check.",
      "Uses your gh account, or --user to read another public account. JSON",
      "and pipes never prompt: use --all or --list. Each run is one snapshot.",
    ],
  },
  {
    signature: "omakit verify <target> [--allow-dirty] [--json] [--out <file>]",
    lines: [
      "The official marketplace security baseline over the local Git transport,",
      "reported verbatim beside the pin identity. A report for a person; --json",
      "prints the document itself, and --out writes it to a file.",
    ],
  },
  {
    signature: "omakit inspect <target> [--json] [--out <file>] [--offline] [--allow-dirty]",
    lines: [
      "What a plugin tree does, as observations: every process with its argv,",
      "every host with its timeout and size-cap flags, every write with whether",
      "it falls under a directory the plugin controls, every timer with its",
      "interval, and the capabilities the marketplace baseline records. Below",
      "the facts, the review classes the marketplace's human review raised,",
      "each with its measured share, only where the tree shows the class.",
      "Regular expressions over QML and shell, labelled observed; runs nothing",
      "from the tree, decides nothing, exits 0 with a report and 2 when the",
      "target cannot be read. --json prints the document; --out writes it too.",
    ],
  },
  {
    signature: "omakit help --agent",
    lines: [
      "The operating instructions for a coding agent, printed from skills/, so an",
      "agent can read the contract out of the tool instead of the repository.",
    ],
  },
  {
    signature: "omakit upgrade [--dry-run]",
    lines: [
      "Update omakit through the installer that made it: npm, at the exact",
      "version the registry names, or a fast-forward of a clone. Refuses",
      "anything else, and never moves the marketplace pin.",
    ],
  },
  {
    signature: "omakit doctor [--offline] [--json] [--out <file>]",
    lines: [
      "What is installed, what is pinned, and what has moved since. Reads and",
      "prints; it installs nothing and never moves the pin.",
      "Checks the newest npm release explicitly. Normal terminal use also",
      "checks at most once daily; DISABLE_UPDATE_NOTIFIER=1 disables notices.",
    ],
  },
  {
    signature: "omakit parity [--count <n>] [--offset <n>] [--out <file>]",
    lines: [
      "The official baseline over GitHub versus the local transport on real",
      "listed repositories; a packaged install requires --out for evidence.",
    ],
  },
  {
    signature: [
      "omakit weigh <plugin-id-or-dir> [--runs <n>] [--window <s>] [--settle <s>]",
      "                    [--yes] [--json] [--out <file>]",
      "omakit weigh --all",
      "omakit weigh --list [--json]",
    ],
    lines: [
      "What a plugin weighs on the shell, measured: the shell is restarted",
      "without it and with it, several runs, and the difference is the weight,",
      "with the baseline's own spread as the noise floor; memory is printed as",
      "the shell's own startup variance, CPU and child processes as the weight.",
      "The one command that changes your machine: it edits shell.json for the",
      "duration, backs it up first, restores it on every exit path, and asks",
      "before the first restart (--yes answers for you): about a minute per",
      "restart, six restarts for one plugin at three runs. --all weighs every",
      "enabled third-party plugin and is sized for a lab machine, not a working",
      "desktop. Writes the document to --out, by default",
      "$XDG_STATE_HOME/omakit/weigh/<date>.json, and ends with the sentence",
      "for the plugin's README. --list is read-only: every installed plugin",
      "and when it was last weighed, unweighed enabled plugins first.",
    ],
  },
])

// A command sits one STEP in from the heading; what it does sits one STEP in
// from the command's name, which starts after "omakit ".
const INDENT = " ".repeat(STEP)
const DESCRIPTION = " ".repeat(STEP * 3)

export const TARGET_NOTE = "<target> is a local Git repository path, or <https url>@<40-char sha>."

/**
 * The answer to "what do I have to set up?" is "nothing", and it is said in
 * so many words. There is no environment section because omakit reads no
 * credential variable of its own: `gh` is the one credential source and honours
 * GH_TOKEN and GITHUB_TOKEN itself, the pin follows XDG unless explicitly overridden, and
 * the terminal's own conventions (a pipe, TERM=dumb, NO_COLOR) are what turn
 * colour and motion off.
 */
export const AUTHENTICATION = Object.freeze([
  "Read-only, and optional. omakit uses your `gh` login if you have one, and",
  "otherwise goes unauthenticated. `verify` needs no network once the pin",
  "exists, except to fetch a reviewer-mode <https url>@<sha> target, once;",
  "`submit` reads two things online and `--offline` turns both off; `watch` and",
  `\`parity\` are capped at ${UNAUTHENTICATED_LIMIT} requests an hour without a login. omakit never`,
  "writes a credential anywhere.",
])

/**
 * Colour a signature by token: what you type is cyan, what you replace is
 * yellow, the subcommand is bold because that is the word you are scanning for,
 * and the brackets that merely group things stay out of the way.
 *
 * One pass, deliberately. Two passes would let the second one find the escape
 * sequences the first inserted and colour the `[` inside them, which corrupts
 * every sequence downstream of it.
 */
const TOKEN = /(^\s*omakit +[a-z][a-z-]*)|(<[^>]+>)|(--[a-z-]+)|(\bomakit\b)|(\b[a-z]+(?:\|[a-z]+)+\b)|([[\]])/g

export function paintSignature(signature, c) {
  return signature.replace(TOKEN, (token, lead, placeholder, flag, bare, choice, bracket) => {
    if (lead) {
      const [, indent, name, gap, subcommand] = lead.match(/^(\s*)(omakit)( +)([a-z][a-z-]*)$/)
      return `${indent}${c("typeable.bold", name)}${gap}${c("name", subcommand)}`
    }
    if (placeholder) return c("placeholder", placeholder)
    if (flag) return c("typeable", flag)
    if (bare) return c("typeable.bold", bare)
    // A choice like bash|zsh|fish: each word is one you could type, and the
    // bar between them is grouping.
    if (choice) return choice.split("|").map((word) => c("typeable", word)).join(c("punctuation", "|"))
    return c("punctuation", bracket)
  })
}

/**
 * The front door: the commands and nothing else.
 *
 * The measured reason this exists. The full reference is 53 lines and a
 * terminal is not 60 rows tall, so a bare `omakit` scrolled its own first
 * lines off the top of the screen before anyone could read them. A list of
 * what you can run fits, and the reference is one command away.
 *
 * @param {{ colour?: boolean, heading?: boolean }} [options]
 */
function commandSignatures(command) {
  const signatures = []
  for (const line of [].concat(command.signature)) {
    if (line.startsWith("omakit ")) signatures.push(line)
    else signatures[signatures.length - 1] += ` ${line}`
  }
  return signatures
}

function signatureLines(signature, c) {
  // A placeholder or bracketed optional argument stays whole, like the
  // backticked typeable spans used by the shared wrapper.
  const grouped = signature.replace(/\[[^\]]+\]|<[^>]+>(?:@<[^>]+>)?/g, (part) => `\`${part}\``)
  return wrap(grouped, { indent: STEP * 3, first: STEP }).map((line) => paintSignature(line, c))
}

export function renderSummary({ stream = process.stdout, colour = colourEnabled(stream), heading = true } = {}) {
  return withOutputStream(stream, () => {
    const c = styler(colour)
    const out = heading ? [`${c("typeable.bold", "omakit")}${c("punctuation", ":")} ${TAGLINE}`, ""] : []
    if (stream.isTTY && heading) out.splice(0, 1, ...wrap(out[0]))
    for (const command of COMMANDS) {
      if (stream.isTTY) out.push(...signatureLines([].concat(command.signature)[0], c))
      else out.push(`${INDENT}${paintSignature([].concat(command.signature)[0], c)}`)
    }
    out.push("")
    if (stream.isTTY) {
      out.push(...wrap("`omakit help` is the same list with what each command does, and what it reads. `omakit setup` is the one to run first.", { indent: STEP }, c))
    } else {
      out.push(`${INDENT}${paintProse("`omakit help` is the same list with what each command does, and", c)}`)
      out.push(`${INDENT}${paintProse("what it reads. `omakit setup` is the one to run first.", c)}`)
    }
    return `${out.join("\n")}\n`
  })
}

/**
 * @param {{ colour?: boolean, heading?: boolean }} [options] `heading: false`
 *   when the line above has already named the tool, as under an unknown
 *   command, so the same sentence is not printed twice.
 */
export function renderUsage({ stream = process.stdout, colour = colourEnabled(stream), heading = true } = {}) {
  return withOutputStream(stream, () => {
    const c = styler(colour)
    const out = heading ? [`${c("typeable.bold", "omakit")}${c("punctuation", ":")} ${TAGLINE}`, ""] : []
    if (stream.isTTY && heading) out.splice(0, 1, ...wrap(out[0]))

    for (const command of COMMANDS) {
      if (stream.isTTY) {
        for (const signature of commandSignatures(command)) out.push(...signatureLines(signature, c))
        out.push(...wrap(command.lines.join(" "), { indent: STEP * 3 }, c))
      } else {
        for (const line of [].concat(command.signature)) out.push(`${INDENT}${paintSignature(line, c)}`)
        for (const line of command.lines) out.push(`${DESCRIPTION}${paintProse(line, c)}`)
      }
      out.push("")
    }

    if (stream.isTTY) out.push(...signatureLines(TARGET_NOTE, c))
    else out.push(`${INDENT}${paintSignature(TARGET_NOTE, c)}`)
    out.push("")
    out.push(c("heading", "GitHub access:"))
    if (stream.isTTY) out.push(...wrap(AUTHENTICATION.join(" "), { indent: STEP }, c))
    else for (const line of AUTHENTICATION) out.push(`${INDENT}${paintProse(line, c)}`)
    return `${out.join("\n")}\n`
  })
}
