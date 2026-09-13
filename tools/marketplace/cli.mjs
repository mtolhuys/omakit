#!/usr/bin/env node
// The single entry point.
//
//   omakit pin                       fetch or verify the pinned marketplace checkout
//   omakit submit <target> ...       everything knowable before submitting; prints, never posts
//   omakit watch <issue-url>         is this submission's validated commit still current?
//   omakit verify <target>           the official baseline over the local transport, verbatim
//   omakit parity [--count n]        prove the local transport equals the GitHub transport
//   omakit completion <shell>        a completion script for bash, zsh or fish, on stdout
//
// Nothing here writes to the marketplace. There is no POST, PATCH, PUT or
// DELETE anywhere in this repository, and `tests/unit/read-only.test.mjs`
// proves it.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ensurePin, MARKETPLACE_PIN, requirePin } from "./pin.mjs"
import { marketplaceBaselineSection } from "./verify.mjs"
import { resolveSubject, SubjectError } from "../subject/resolve.mjs"
import { submitPreflight } from "./submit.mjs"
import { validationWatch } from "./watch.mjs"
import { renderSubmit, renderWatch, renderDoctor } from "./report.mjs"
import { doctor } from "./doctor.mjs"
import { setup } from "./setup.mjs"
import { upgrade } from "./upgrade.mjs"
import { progress } from "./progress.mjs"
import { COMMANDS, COMPLETION_SHELLS, renderSummary, renderUsage } from "./usage.mjs"
import { renderCompletion } from "./completion.mjs"
import { submissionContract } from "./form.mjs"
import { action, colourEnabled, GUTTER, mark, styler, wrap } from "./style.mjs"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

/**
 * The one action for each way a command can stop. A failure state says what
 * happened (the code), what it means (the message the module raised) and the
 * single command that fixes it, in that order, every time. A code with no
 * entry here gets the first two and no arrow, which is the honest rendering of
 * a state nobody has written a fix for yet.
 */
const REMEDY = Object.freeze({
  "usage": "omakit help",
  "marketplace-unavailable": "omakit pin",
  "dirty-worktree": "Commit the changes, or pass --allow-dirty to check the tree as it is.",
  "subject-not-found": "Pass a local Git repository path, or <https url>@<40-char sha>.",
  "not-a-git-repository": "Pass a local Git repository path, or <https url>@<40-char sha>.",
  "commit-not-found": "Commit first; the checks read the tree at an exact commit, never the working copy.",
  "network-unavailable": "Connect to the network, then run it again.",
  "github-unavailable": "Wait for GitHub, then run it again. `gh auth login` raises the rate limit if that is what ran out.",
  "not-found": "Check the issue URL: it has to be an existing issue on the marketplace repository.",
  "head-unreadable": "Check that the plugin repository is public and its URL is right.",
})

/**
 * Every failure, in one register, on stderr. `usage` errors carry the
 * signature that was expected, so the remedy is the reference and not a
 * restatement of the message.
 */
function fail(code, message, exit = 1) {
  const c = styler(colourEnabled(process.stderr))
  const lines = [`${mark("fail", c)}${c("name", code)}`, ...wrap(message, { indent: GUTTER }, c)]
  if (REMEDY[code]) lines.push(...action(REMEDY[code], c))
  process.stderr.write(`${lines.join("\n")}\n`)
  process.exit(exit)
}

/** A thrown error becomes a failure state when it carries a code; anything else is a bug and keeps its stack. */
function failFrom(error) {
  if (error?.code && typeof error.code === "string") fail(error.code, error.message, error.code === "usage" ? 2 : 1)
  throw error
}

function option(args, name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function positionals(args) {
  const valued = new Set(["--profile", "--plugin", "--out", "--category", "--tags", "--notes", "--suggest-tag", "--name", "--count", "--offset"])
  return args.filter((value, index) => !value.startsWith("--") && !valued.has(args[index - 1]))
}

function emit(args, text) {
  const out = option(args, "--out")
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true })
    writeFileSync(resolve(out), text.endsWith("\n") ? text : `${text}\n`)
    const c = styler(colourEnabled())
    process.stdout.write(`${mark("pass", c)}wrote ${resolve(out)}\n`)
  } else {
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`)
  }
}

async function cmdSubmit(args) {
  const target = positionals(args)[0]
  if (!target) fail("usage", "submit needs a target: `omakit submit <target> --category <c> --tags <a,b>`", 2)
  const spinner = args.includes("--json") ? { phase: () => {}, done: () => {} } : progress()
  let result
  try {
    result = await submitPreflight({
      repoRoot: ROOT,
      target,
      onPhase: spinner.phase,
      category: option(args, "--category"),
      tags: option(args, "--tags"),
      notes: option(args, "--notes"),
      suggestedTag: option(args, "--suggest-tag"),
      pluginName: option(args, "--name"),
      allowDirty: args.includes("--allow-dirty"),
      offline: args.includes("--offline"),
    })
  } catch (error) {
    spinner.done()
    failFrom(error)
  }
  spinner.done()
  emit(args, args.includes("--json") ? `${JSON.stringify(result, null, 2)}\n` : renderSubmit(result))
  process.exit(result.ready ? 0 : 1)
}

async function cmdWatch(args) {
  const issueUrl = positionals(args)[0]
  if (!issueUrl) fail("usage", "watch needs an issue: `omakit watch <issue-url>`", 2)
  const spinner = args.includes("--json") ? { phase: () => {}, done: () => {} } : progress()
  let result
  try {
    result = await validationWatch({ repoRoot: ROOT, issueUrl, onPhase: spinner.phase })
  } catch (error) {
    spinner.done()
    failFrom(error)
  }
  spinner.done()
  emit(args, args.includes("--json") ? `${JSON.stringify(result, null, 2)}\n` : renderWatch(result))
  process.exit(result.verdict.state === "unknown" ? 2 : 0)
}

async function cmdSetup() {
  const result = await setup({ repoRoot: ROOT, entryPoint: resolve(ROOT, "bin/omakit") })
  process.exit(result.ok ? 0 : 1)
}

async function cmdUpgrade(args) {
  const result = await upgrade({ repoRoot: ROOT, dryRun: args.includes("--dry-run") })
  process.exit(result.ok ? 0 : 1)
}

async function cmdDoctor(args) {
  const spinner = args.includes("--json") ? { phase: () => {}, done: () => {} } : progress()
  const result = await doctor({ repoRoot: ROOT, offline: args.includes("--offline"), onPhase: spinner.phase })
  spinner.done()
  emit(args, args.includes("--json") ? `${JSON.stringify(result, null, 2)}\n` : renderDoctor(result))
  process.exit(result.problems ? 1 : 0)
}

async function cmdVerify(args) {
  const target = positionals(args)[0]
  if (!target) fail("usage", "verify needs a target: `omakit verify <path | https-url@sha>`", 2)
  let subject
  try {
    subject = resolveSubject(target, { cacheRoot: resolve(ROOT, ".cache"), allowDirty: args.includes("--allow-dirty") })
  } catch (error) {
    if (error instanceof SubjectError) fail(error.code, error.message, error.code === "usage" ? 2 : 1)
    throw error
  }
  const spinner = progress()
  let section
  try {
    spinner.phase("running the official security baseline over a local snapshot")
    section = await marketplaceBaselineSection({ repoRoot: ROOT, subject })
  } catch (error) {
    spinner.done()
    fail(error?.code === "marketplace-unavailable" ? error.code : "baseline-unavailable", error.message)
  }
  spinner.done()
  emit(args, `${JSON.stringify({
    subject: {
      repository: subject.repository,
      commit: subject.commit,
      cleanTree: { clean: subject.clean, proof: "git-status-porcelain-empty" },
      mode: subject.mode,
    },
    marketplaceBaseline: section,
  }, null, 2)}\n`)
}

async function cmdParity(args) {
  const count = option(args, "--count")
  const offset = option(args, "--offset")
  if (count) process.env.PARITY_COUNT = count
  if (offset) process.env.PARITY_OFFSET = offset
  process.env.OMAKIT_ROOT = ROOT
  await import("../../tests/parity/run.mjs")
}

/**
 * A script on stdout and nothing else: no banner, no colour, no progress. The
 * controlled values come from the pin's form, so a missing pin is the same
 * failure state every other command reports.
 */
async function cmdCompletion(args) {
  const shell = positionals(args)[0]
  if (!COMPLETION_SHELLS.includes(shell)) {
    fail("usage", `completion needs a shell it has a script for: \`omakit completion ${COMPLETION_SHELLS.join("|")}\``, 2)
  }
  try {
    const { identity } = requirePin(ROOT)
    const contract = await submissionContract({ repoRoot: ROOT })
    process.stdout.write(renderCompletion(shell, { contract, pin: identity.commit, commands: COMMANDS }))
  } catch (error) {
    failFrom(error)
  }
}

const [command, ...rest] = process.argv.slice(2)
if (command === "setup") {
  await cmdSetup()
} else if (command === "pin" || command === "marketplace-pin") {
  const c = styler(colourEnabled())
  const spinner = progress()
  try {
    ensurePin(ROOT, (line) => {
      // ensurePin narrates: a state line to keep, then a fetch it is about to
      // start. The fetch is the slow part, so it gets the progress line.
      if (line.state === "fetching") spinner.phase(line.text)
      else process.stdout.write(`${mark(line.state, c)}${wrap(line.text, { indent: GUTTER }, c).join("\n").trimStart()}\n`)
    })
  } catch (error) {
    spinner.done()
    fail(error?.code || "marketplace-unavailable", error.message)
  }
  spinner.done()
} else if (command === "submit") {
  await cmdSubmit(rest)
} else if (command === "upgrade") {
  await cmdUpgrade(rest)
} else if (command === "doctor") {
  await cmdDoctor(rest)
} else if (command === "watch") {
  await cmdWatch(rest)
} else if (command === "verify") {
  await cmdVerify(rest.filter((value, index) => value !== "marketplace" || rest[index - 1] !== "--profile"))
} else if (command === "parity") {
  await cmdParity(rest)
} else if (command === "completion") {
  await cmdCompletion(rest)
} else if (command === "help" || command === "--help" || command === "-h" || command === undefined) {
  if (rest.includes("--agent")) {
    // The skills ship in the npm package, so this works from a global install
    // with no repository checked out.
    const dir = resolve(ROOT, "skills")
    const parts = []
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const file = entry.isDirectory() ? resolve(dir, entry.name, "SKILL.md") : resolve(dir, entry.name)
      if (!file.endsWith(".md")) continue
      try {
        parts.push(readFileSync(file, "utf8").trim())
      } catch {
        // A skill directory without a SKILL.md is not an error worth failing on.
      }
    }
    process.stdout.write(`${parts.join("\n\n---\n\n")}\n`)
  } else {
    // A bare `omakit` is the front door and gets the short list; `omakit help`
    // is the reference and gets all of it. Both open with the name and the
    // tagline as one line of text: the wordmark is drawn in `setup` only.
    process.stdout.write(command === undefined ? renderSummary() : renderUsage())
  }
} else {
  // The short list on a typo, not 53 lines of reference, in the same register
  // as every other failure: what happened, what it means, what to run.
  const c = styler(colourEnabled(process.stderr))
  process.stderr.write([
    `${mark("fail", c)}${c("name", "unknown command")}`,
    ...wrap(`\`${command}\` is not something omakit does. The commands it has are listed below.`, { indent: GUTTER }, c),
    ...action("omakit help", c),
    "",
    renderSummary({ colour: colourEnabled(process.stderr), heading: false }),
  ].join("\n"))
  process.exit(2)
}
