// The help text, as data rather than one painted string.
//
// Kept as structure so it can be coloured without pattern-matching a paragraph,
// and so the same words serve a terminal and a pipe. A signature is coloured by
// token: what you type is cyan, what you replace is yellow, the brackets that
// merely group them stay out of the way.

import { UNAUTHENTICATED_LIMIT } from "./github.mjs"
import { MARKETPLACE_PIN } from "./pin.mjs"
import { colourEnabled, paintProse, STEP, styler } from "./style.mjs"

/**
 * "Safe" means one thing, everywhere it appears: this runs on your own
 * machine, posts nothing, opens no issue and spends nobody's attention. It is
 * never a claim about the security of a plugin or a submission; the baseline's
 * outcome is reported verbatim and is never restated as one.
 */
export const TAGLINE = "the safe place to find out"

/** The shells `omakit completion` has a script for; completion.mjs holds the scripts. */
export const COMPLETION_SHELLS = Object.freeze(["bash", "zsh", "fish"])

export const COMMANDS = Object.freeze([
  {
    signature: "omakit setup",
    lines: [
      "First run, in one command: check the environment, fetch the pinned",
      "marketplace checkout, and say what to try first. Idempotent.",
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
      "omakit submit <target> --category <c> --tags <a,b> [--notes <text>]",
      "                      [--suggest-tag <t>] [--name <n>] [--offline]",
      "                      [--allow-dirty] [--json] [--out <file>]",
    ],
    lines: [
      "Every check that is knowable before submitting, the resolved commit, and",
      "the exact issue title and body. Prints them. Never posts anything.",
    ],
  },
  {
    signature: "omakit watch <issue-url> [--json]",
    lines: [
      "Compare the commit the marketplace validated on a submission issue with",
      "the plugin repository's current default-branch HEAD, and say what makes",
      "it validate a newer one. Read-only.",
    ],
  },
  {
    signature: "omakit verify <target> [--allow-dirty] [--out <file>]",
    lines: [
      "The official marketplace security baseline over the local Git transport,",
      "reported verbatim beside the pin identity.",
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
      "Fast-forward this checkout of omakit itself. Refuses a dirty tree, an",
      "unexpected remote and anything that is not a fast-forward. Never moves",
      "the marketplace pin.",
    ],
  },
  {
    signature: "omakit doctor [--offline] [--json]",
    lines: [
      "What is installed, what is pinned, and what has moved since. Reads and",
      "prints; it installs nothing and never moves the pin.",
    ],
  },
  {
    signature: `omakit completion ${COMPLETION_SHELLS.join("|")}`,
    lines: [
      "The completion script `omakit setup` installs for your shell, printed",
      "for another one. It carries the pin's own categories and tags.",
    ],
  },
  {
    signature: "omakit parity [--count <n>] [--offset <n>] [--out <file>]",
    lines: [
      "The official baseline over GitHub versus the local transport on real",
      "listed repositories; a packaged install requires --out for evidence.",
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
  "otherwise goes unauthenticated. `submit` and `verify` need no network at",
  `all; \`watch\` and \`parity\` are capped at ${UNAUTHENTICATED_LIMIT} requests an hour without a`,
  "login. omakit never writes a credential anywhere.",
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
 * The measured reason this exists. The full reference is 53 lines, a wordmark
 * is 7 more, and a terminal is not 60 rows tall, so a bare `omakit` printed a
 * banner that scrolled off the top of the screen before anyone could read it.
 * A list of what you can run fits, which means the wordmark above it stays on
 * screen, and the reference is one command away.
 *
 * @param {{ colour?: boolean, heading?: boolean }} [options]
 */
export function renderSummary({ colour = colourEnabled(), heading = true } = {}) {
  const c = styler(colour)
  const out = heading ? [`${c("typeable.bold", "omakit")}${c("punctuation", ":")} ${TAGLINE}`, ""] : []
  for (const command of COMMANDS) {
    out.push(`${INDENT}${paintSignature([].concat(command.signature)[0], c)}`)
  }
  out.push("")
  out.push(`${INDENT}${paintProse("`omakit help` is the same list with what each command does, and", c)}`)
  out.push(`${INDENT}${paintProse("what it reads. `omakit setup` is the one to run first.", c)}`)
  return `${out.join("\n")}\n`
}

/**
 * @param {{ colour?: boolean, heading?: boolean }} [options] `heading: false`
 *   when the banner has already said the name and the tagline, so the same
 *   sentence is not printed twice.
 */
export function renderUsage({ colour = colourEnabled(), heading = true } = {}) {
  const c = styler(colour)
  const out = heading ? [`${c("typeable.bold", "omakit")}${c("punctuation", ":")} ${TAGLINE}`, ""] : []

  for (const command of COMMANDS) {
    for (const line of [].concat(command.signature)) {
      out.push(`${INDENT}${paintSignature(line, c)}`)
    }
    for (const line of command.lines) {
      out.push(`${DESCRIPTION}${paintProse(line, c)}`)
    }
    out.push("")
  }

  out.push(`${INDENT}${paintSignature(TARGET_NOTE, c)}`)
  out.push("")
  out.push(c("heading", "GitHub access:"))
  for (const line of AUTHENTICATION) out.push(`${INDENT}${paintProse(line, c)}`)
  return `${out.join("\n")}\n`
}
