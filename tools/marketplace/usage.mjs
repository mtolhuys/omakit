// The help text, as data rather than one painted string.
//
// Kept as structure so it can be coloured without pattern-matching a paragraph,
// and so the same words serve a terminal and a pipe. A signature is coloured by
// token: what you type is cyan, what you replace is yellow, the brackets that
// merely group them stay out of the way.

import { MARKETPLACE_PIN } from "./pin.mjs"
import { colourEnabled, styler } from "./style.mjs"

export const TAGLINE = "marketplace submit preflight for Omarchy Quattro plugins"

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
      "Fetch or verify the pinned marketplace checkout in .cache/marketplace.",
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
      "the plugin repository's current default-branch HEAD, and say what moves",
      "the pin. Read-only.",
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
    signature: "omakit doctor [--offline] [--json]",
    lines: [
      "What is installed, what is pinned, and what has moved since. Reads and",
      "prints; it installs nothing and never moves the pin.",
    ],
  },
  {
    signature: "omakit parity [--count <n>] [--offset <n>]",
    lines: [
      "The official baseline over GitHub versus the local transport on real",
      "listed repositories; writes docs/evidence/parity/<date>-local-vs-github.json.",
    ],
  },
])

export const TARGET_NOTE = "<target> is a local Git repository path, or <https url>@<40-char sha>."

export const ENVIRONMENT = Object.freeze([
  ["GITHUB_TOKEN", "Optional, read-only. Never written to disk."],
  ["OMAKIT_MARKETPLACE_PIN", "Override the pinned checkout location."],
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
const TOKEN = /(^\s*omakit +[a-z][a-z-]*)|(<[^>]+>)|(--[a-z-]+)|(\bomakit\b)|([[\]])/g

export function paintSignature(signature, c) {
  return signature.replace(TOKEN, (token, lead, placeholder, flag, bare, bracket) => {
    if (lead) {
      const [, indent, name, gap, subcommand] = lead.match(/^(\s*)(omakit)( +)([a-z][a-z-]*)$/)
      return `${indent}${c("cyan.bold", name)}${gap}${c("bold", subcommand)}`
    }
    if (placeholder) return c("yellow", placeholder)
    if (flag) return c("cyan", flag)
    if (bare) return c("cyan.bold", bare)
    return c("grey", bracket)
  })
}

/**
 * @param {{ colour?: boolean, heading?: boolean }} [options] `heading: false`
 *   when the banner has already said the name and the tagline, so the same
 *   sentence is not printed twice.
 */
export function renderUsage({ colour = colourEnabled(), heading = true } = {}) {
  const c = styler(colour)
  const out = heading ? [`${c("cyan.bold", "omakit")}${c("grey", ":")} ${TAGLINE}`, ""] : []

  for (const command of COMMANDS) {
    for (const line of [].concat(command.signature)) {
      out.push(`  ${paintSignature(line, c)}`)
    }
    for (const line of command.lines) {
      out.push(`      ${c("default", line)}`)
    }
    out.push("")
  }

  out.push(`  ${paintSignature(TARGET_NOTE, c)}`)
  out.push("")
  out.push(c("bold", "Environment:"))
  const width = Math.max(...ENVIRONMENT.map(([name]) => name.length))
  for (const [name, description] of ENVIRONMENT) {
    out.push(`  ${c("green", name.padEnd(width))}  ${c("grey", description)}`)
  }
  return `${out.join("\n")}\n`
}
