#!/usr/bin/env node
// The single entry point.
//
//   omakit pin                       fetch or verify the pinned marketplace checkout
//   omakit submit <target> ...       everything knowable before submitting; prints, never posts
//   omakit watch <issue-url>         is this submission's validated commit still current?
//   omakit verify <target>           the official baseline over the local transport, verbatim
//   omakit parity [--count n]        prove the local transport equals the GitHub transport
//   omakit weigh <plugin> | --all     what a plugin weighs on the shell, measured by restarting it
//   omakit inspect <plugin-dir>      what a plugin tree does, as observations; decides nothing
//   omakit add run [plugin-dir]      copy the Run block into the plugin's omakit/ directory
//
// Nothing here writes to the marketplace. There is no POST, PATCH, PUT or
// DELETE anywhere in this repository, and `tests/unit/read-only.test.mjs`
// proves it. `weigh` is the one command that changes the user's own machine,
// their shell and its configuration for the duration of a measurement, and
// it confirms first; docs/WEIGH.md says what it writes and how it restores.
// `add` is the one command that writes into a plugin tree: the block's own
// files under omakit/, never over a modified copy; docs/BLOCKS.md says what.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ensurePin, MARKETPLACE_PIN, requirePin } from "./pin.mjs"
import { marketplaceBaselineSection } from "./verify.mjs"
import { resolveSubject, SubjectError } from "../subject/resolve.mjs"
import { submitPreflight } from "./submit.mjs"
import { askChoices, askWatchIssues } from "./ask.mjs"
import { validationWatch, discoverWatchIssues, validationWatchAll } from "./watch.mjs"
import { renderSubmit, renderWatch, renderWatchList, renderWatchAll, renderDoctor, renderVerify } from "./report.mjs"
import { consequence } from "./preflight.mjs"
import { doctor } from "./doctor.mjs"
import { completionStep, setup } from "./setup.mjs"
import { staleCompletionNotice } from "./completion-check.mjs"
import { ACCEPTED, acceptedWords, checkArgs } from "./options.mjs"
import { upgrade } from "./upgrade.mjs"
import { updateCheckEnabled, updateNotice } from "./update-check.mjs"
import { progress } from "./progress.mjs"
import { banner, bannerEnabled } from "./banner.mjs"
import { COMMANDS, renderSummary, renderUsage, TAGLINE } from "./usage.mjs"
import { action, AUDIT_VERDICTS, colourEnabled, GUTTER, labelled, mark, outputColumns, styler, verdict, withOutputStream, wrap } from "./style.mjs"
import { omakitCacheDir, withHomeAbbreviated } from "./paths.mjs"
import { DEFAULTS as WEIGH_DEFAULTS, measureWeigh, planWeigh } from "../weigh/audit.mjs"
import { confirmationQuestion, renderList, renderWeigh, renderPlan } from "../weigh/report.mjs"
import { listWeighings } from "../weigh/list.mjs"
import { askYes } from "../weigh/confirm.mjs"
import { auditInstalled } from "../audit/audit.mjs"
import { renderAudit } from "../audit/report.mjs"
import { inspectPlugin, NOT_READABLE } from "../inspect/inspect.mjs"
import { renderInspect } from "../inspect/report.mjs"
import { addBlock } from "../blocks/add.mjs"

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
  "dirty-worktree": "Commit the changes, or pass --allow-dirty to read HEAD as committed; uncommitted edits are not read.",
  "subject-not-found": "Pass a local Git repository path, or <https url>@<40-char sha>.",
  "not-a-git-repository": "Pass a local Git repository path, or <https url>@<40-char sha>.",
  "commit-not-found": "Commit first; the checks read the tree at an exact commit, never the working copy.",
  "network-unavailable": "Connect to the network, then run it again.",
  "github-unavailable": "Wait for GitHub, then run it again. `gh auth login` raises the rate limit if that is what ran out.",
  "not-found": "Check the issue URL: it has to be an existing issue on the marketplace repository.",
  "head-unreadable": "Check that the plugin repository is public and its URL is right.",
  "login-required": "gh auth login",
  "not-confirmed": "Run it again and answer y, or pass --yes when the person whose shell it is has agreed.",
  "interrupted": "shell.json was restored; run it again when the desktop is yours to restart.",
  "exists": "omakit add run [<plugin-dir>] --update",
  "modified": "Keep your copy, or move it aside and run add again; omakit/NOTICE is where modifications are listed.",
  "not-a-plugin": "Pass the plugin's directory, the one with its manifest.json.",
  "plugin-dir-not-found": "Pass the plugin's directory, the one with its manifest.json.",
  "unknown-block": "omakit add run [<plugin-dir>]",
})

/*
 * A command that has written its result leaves through `process.exitCode`,
 * never `process.exit()`: stdout is an API, and on a pipe whose reader has
 * not started reading yet the exit cuts the output. Measured on 0.4.1:
 * `omakit submit <listed plugin> --json | (sleep 2; cat)` delivered 8,192 of
 * 14,033 bytes, and a parser downstream saw invalid JSON. The failure
 * states below still exit at once: they write one short block to stderr,
 * and their callers use them the way a throw is used.
 */

/**
 * Every failure, in one register, on stderr. `usage` errors carry the
 * signature that was expected, so the remedy is the reference and not a
 * restatement of the message. `body` is extra labelled lines between the
 * message and the arrow, for a usage error that has values to list.
 */
function fail(code, message, exit = 1, remedy = REMEDY[code], body = () => []) {
  const c = styler(colourEnabled(process.stderr))
  const lines = withOutputStream(process.stderr, () => [
    `${mark("fail", c)}${c("name", code)}`, ...wrap(message, { indent: GUTTER }, c), ...body(c),
    ...(remedy ? action(remedy, c) : []),
  ])
  process.stderr.write(`${lines.join("\n")}\n`)
  process.exit(exit)
}

/** A thrown error becomes a failure state when it carries a code; anything else is a bug and keeps its stack. */
function failFrom(error) {
  if (error?.code && typeof error.code === "string") fail(error.code, error.message, error.code === "usage" ? 2 : 1, error.remedy || REMEDY[error.code])
  throw error
}

/**
 * The value of a valued option, written either way the table accepts,
 * `--name value` or `--name=value`, the last occurrence winning as it does
 * in options.mjs. Measured on 0.4.1: the table accepted `--out=FILE` and the
 * value was looked up as the token after `--out`, so `doctor --out=x` wrote
 * nothing and exited 0, and `submit --category=Widgets` said the flag was
 * missing.
 */
function option(args, name) {
  let value
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) value = args[index + 1]
    else if (args[index].startsWith(`${name}=`)) value = args[index].slice(name.length + 1)
  }
  return value
}

/** The bare arguments, with every valued option's value (options.mjs, one table) left out. */
function positionals(args) {
  const valued = new Set(Object.values(ACCEPTED).flatMap((spec) => spec.valued))
  return args.filter((value, index) => !value.startsWith("--") && !valued.has(args[index - 1]))
}

/**
 * The progress line for a command, or nothing under --json: a machine
 * reading the document on stdout gets no decoration on stderr either.
 * Measured on 0.1.6: submit, watch and doctor silenced it and verify did
 * not, so `verify --json` at a terminal drew a progress line the others
 * never drew.
 */
const SILENT = Object.freeze({ phase: () => {}, done: () => {} })
function spinnerFor(args) {
  return args.includes("--json") ? SILENT : progress()
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

function reportText(args, render, result, options = {}) {
  const out = option(args, "--out")
  return withOutputStream(out ? { isTTY: false } : process.stdout,
    () => render(result, { ...options, ...(out ? { colour: false } : {}) }))
}

async function cmdSubmit(args) {
  const target = positionals(args)[0]
  if (!target) fail("usage", "submit needs a target: `omakit submit <target> --category <c> --tags <a,b>`", 2)
  const json = args.includes("--json")
  const spinner = spinnerFor(args)
  // A missing --category or --tags on an unlisted plugin is asked for, once
  // each, when a person is at a terminal on both ends and no machine is
  // reading the result. Anything else, a pipe, an agent, --json, gets the
  // usage error with the form's lists, exit 2. Decided after the registry:
  // a listed plugin is never asked for a choice that does not matter.
  const interactive = !json && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY)
  const chooser = interactive
    ? async (asked) => {
      spinner.done()
      return askChoices({ ...asked, input: process.stdin, output: process.stderr })
    }
    : undefined
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
      chooser,
    })
  } catch (error) {
    spinner.done()
    if (error?.code === "usage" && error.usage) {
      const usage = error.usage
      if (json) {
        process.stdout.write(`${JSON.stringify({ usage }, null, 2)}\n`)
        process.exitCode = 2
        return
      }
      const flags = usage.missing.join(" and ")
      fail("usage", `submit needs ${flags}: ${usage.missing.length === 1 ? "it is" : "they are"} an editorial choice nobody else can make, from the pinned form's own lists.`, 2,
        `omakit submit ${target} --category <c> --tags <a,b>`,
        (c) => [
          ...labelled("categories", usage.categories.join(", "), c),
          ...labelled(`tags, 1 to ${usage.maximumTags}`, usage.tags.join(", "), c),
        ])
    }
    failFrom(error)
  }
  spinner.done()
  emit(args, args.includes("--json") ? `${JSON.stringify(result, null, 2)}\n` : reportText(args, renderSubmit, result))
  // Three outcomes, two exit codes: `ready` and `listed` are both healthy
  // states, and only a refusal is a 1.
  process.exitCode = result.outcome === "refused" ? 1 : 0
}

async function cmdWatch(args) {
  const issueUrl = positionals(args)[0]
  const all = args.includes("--all")
  const list = args.includes("--list")
  const user = option(args, "--user")
  const interactive = !args.includes("--json") && !option(args, "--out") && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY)
  if ((all && list) || (issueUrl && (all || list || user !== undefined))) {
    fail("usage", "Use an issue URL, --all, or --list; --user belongs to account-wide discovery.", 2)
  }
  if (!issueUrl && !all && !list && !interactive) {
    fail("usage", "watch needs an issue or a mode: `omakit watch <issue-url>`, `omakit watch --all`, or `omakit watch --list`. A terminal can pick issues with `omakit watch`.", 2)
  }
  const spinner = spinnerFor(args)
  let result
  try {
    if (issueUrl) {
      result = await validationWatch({ repoRoot: ROOT, issueUrl, onPhase: spinner.phase })
    } else {
      const discovery = await discoverWatchIssues({ user, onPhase: spinner.phase })
      if (list) {
        result = discovery
      } else {
        if (!all && discovery.issues.length) {
          spinner.done()
          discovery.issues = await askWatchIssues({ issues: discovery.issues })
        }
        result = await validationWatchAll({ repoRoot: ROOT, discovery, onPhase: spinner.phase })
      }
    }
  } catch (error) {
    spinner.done()
    failFrom(error)
  }
  spinner.done()
  const render = result.mode === "list" ? renderWatchList : result.mode === "all" ? renderWatchAll : renderWatch
  emit(args, args.includes("--json") ? `${JSON.stringify(result, null, 2)}\n` : reportText(args, render, result))
  process.exitCode = result.verdict?.state === "unknown" || result.summary?.unknown > 0 ? 2 : 0
}

async function cmdFrontDoor() {
  // A bare `omakit` is the front door: the wordmark, through `ttfx` when it is
  // there, then the short list, which fits under it on any screen. The banner
  // already says the name and the tagline, so the heading would repeat it.
  const drew = bannerEnabled()
  await banner({ tagline: TAGLINE, effect: true })
  process.stdout.write(renderSummary({ heading: !drew }))
}

async function cmdSetup(args) {
  // `--completion` is the one step on its own: write the script and prove
  // it in a new shell, never the rc question. `upgrade` runs it through the
  // freshly installed omakit, so the script carries the new version.
  if (args.includes("--completion")) {
    const identity = requirePin(ROOT).identity
    const result = await completionStep({ repoRoot: ROOT, pin: identity.commit, version: VERSION, askRc: false })
    process.exitCode = result.state === "ok" ? 0 : 1
    return
  }
  const result = await setup({ repoRoot: ROOT, entryPoint: resolve(ROOT, "bin/omakit"), yes: args.includes("--yes") })
  process.exitCode = result.ok ? 0 : 1
}

async function cmdUpgrade(args) {
  const result = await upgrade({ repoRoot: ROOT, dryRun: args.includes("--dry-run") })
  process.exitCode = result.ok ? 0 : 1
}

async function cmdDoctor(args) {
  const spinner = spinnerFor(args)
  const result = await doctor({ repoRoot: ROOT, offline: args.includes("--offline"), onPhase: spinner.phase })
  spinner.done()
  emit(args, args.includes("--json") ? `${JSON.stringify(result, null, 2)}\n` : reportText(args, renderDoctor, result))
  process.exitCode = result.problems ? 1 : 0
}

async function cmdVerify(args) {
  const target = positionals(args)[0]
  if (!target) fail("usage", "verify needs a target: `omakit verify <path | https-url@sha>`", 2)
  let subject
  try {
    subject = resolveSubject(target, { cacheRoot: omakitCacheDir(), allowDirty: args.includes("--allow-dirty") })
  } catch (error) {
    if (error instanceof SubjectError) fail(error.code, error.message, error.code === "usage" ? 2 : 1)
    throw error
  }
  const spinner = spinnerFor(args)
  let section
  try {
    spinner.phase("running the official security baseline over a local snapshot")
    section = await marketplaceBaselineSection({ repoRoot: ROOT, subject })
  } catch (error) {
    spinner.done()
    fail(error?.code === "marketplace-unavailable" ? error.code : "baseline-unavailable", error.message)
  }
  spinner.done()
  const document = {
    subject: {
      repository: subject.repository,
      commit: subject.commit,
      cleanTree: { clean: subject.clean, proof: "git-status-porcelain-empty" },
      mode: subject.mode,
    },
    marketplaceBaseline: section,
  }
  // The JSON is the document itself, byte for byte what verify always
  // printed, for --json and for --out; a person at the terminal gets the
  // report, in the register submit uses for its checks.
  if (args.includes("--json") || option(args, "--out")) {
    emit(args, `${JSON.stringify(document, null, 2)}\n`)
    return
  }
  const blockingRules = section.invoked && section.official && !section.official.error
    ? (await consequence(requirePin(ROOT).dir, section.official)).selectivelyBlockingRules
    : []
  emit(args, reportText(args, renderVerify, document, { blockingRules }))
}

async function cmdParity(args) {
  // The runner takes everything as arguments. Before 0.1.8 this handed over
  // four PARITY_* variables and an OMAKIT_ROOT through the process
  // environment, and OMAKIT_ROOT was the one OMAKIT_* name in the tree.
  let ok = false
  try {
    // Imported here, not at the top: the runner ships with the package, but
    // no other command needs it, and a copy of bin/ and tools/ alone runs
    // everything else.
    const { runParity } = await import("../../tests/parity/run.mjs")
    const count = option(args, "--count")
    const offset = option(args, "--offset")
    ;({ ok } = await runParity({
      repoRoot: ROOT,
      count: count ? Number(count) : undefined,
      offset: offset ? Number(offset) : undefined,
      out: option(args, "--out") || null,
    }))
  } catch (error) {
    failFrom(error)
  }
  process.exitCode = ok ? 0 : 1
}

function notAudited(message, remedy = null, exit = 1) {
  const c = styler(colourEnabled(process.stderr))
  const lines = verdict("fail", AUDIT_VERDICTS.unavailable, message, c)
  if (remedy) lines.push(...action(remedy, c, { indent: 0 }))
  process.stderr.write(`${lines.join("\n")}\n`)
  process.exit(exit)
}

async function cmdAudit(args) {
  const parsed = checkArgs(args, ACCEPTED.audit)
  if (parsed.offending !== null) notAudited(`${parsed.reason}. Accepted: ${acceptedWords("audit")}.`, "omakit audit [<plugin-id-or-dir>] [--drift] [--json] [--out FILE] [--offline]", 2)
  let document
  try {
    document = await auditInstalled({
      repoRoot: ROOT,
      target: parsed.positionals[0],
      drift: parsed.options.has("--drift"),
      offline: parsed.options.has("--offline"),
    })
  } catch (error) {
    if (error?.code && typeof error.code === "string") notAudited(`${error.message}.`, error.remedy || REMEDY[error.code])
    throw error
  }
  const json = `${JSON.stringify(document, null, 2)}\n`
  const out = parsed.options.get("--out")
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true })
    writeFileSync(resolve(out), json)
  }
  if (parsed.options.has("--json")) process.stdout.write(json)
  else process.stdout.write(`${renderAudit(document)}\n`)
  process.exitCode = document.ok ? 0 : 1
}

/**
 * `omakit inspect`: a report, exit 0 whatever it observed; exit 2 when the
 * target could not be read (no directory, no Git checkout, no commit, no
 * manifest), in the one failure register. There is no exit status for
 * "found something", because finding something is the normal outcome.
 * `--out` writes the document to a file beside whatever stdout gets, the
 * way `audit --out` does.
 */
async function cmdInspect(args) {
  const parsed = checkArgs(args, ACCEPTED.inspect)
  if (parsed.offending !== null) fail("usage", `${parsed.reason}. Accepted: ${acceptedWords("inspect")}.`, 2, "omakit inspect <plugin-dir> [--full] [--json] [--out FILE] [--offline] [--allow-dirty]")
  const target = parsed.positionals[0]
  if (!target) fail("usage", "inspect needs a plugin directory: `omakit inspect <plugin-dir>`", 2, "omakit inspect <plugin-dir> [--full] [--json] [--out FILE] [--offline] [--allow-dirty]")
  const spinner = spinnerFor(args)
  let document
  try {
    document = await inspectPlugin({
      repoRoot: ROOT,
      target,
      offline: parsed.options.has("--offline"),
      allowDirty: parsed.options.has("--allow-dirty"),
      omakitVersion: VERSION,
      onPhase: spinner.phase,
    })
  } catch (error) {
    spinner.done()
    if (error?.code && typeof error.code === "string") {
      fail(error.code, error.message, NOT_READABLE.includes(error.code) ? 2 : 1, error.remedy || REMEDY[error.code])
    }
    throw error
  }
  spinner.done()
  const json = `${JSON.stringify(document, null, 2)}\n`
  const out = parsed.options.get("--out")
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true })
    writeFileSync(resolve(out), json)
  }
  if (parsed.options.has("--json")) process.stdout.write(json)
  else process.stdout.write(`${renderInspect(document, { full: parsed.options.has("--full") })}\n`)
  process.exitCode = 0
}

/**
 * `omakit add <block> [plugin-dir]`: the one command that writes into a
 * plugin tree, and only the block's files under omakit/. Every refusal is
 * a failure state before anything is written; the report is one line per
 * file with what happened to it, or the document under --json.
 */
async function cmdAdd(args) {
  const parsed = checkArgs(args, ACCEPTED.add)
  if (parsed.offending !== null) fail("usage", `${parsed.reason}. Accepted: ${acceptedWords("add")}.`, 2, "omakit add run [<plugin-dir>] [--update] [--json]")
  const [block, dir] = parsed.positionals
  if (!block) fail("usage", "add needs a block: `omakit add run [<plugin-dir>]`", 2, "omakit add run [<plugin-dir>] [--update] [--json]")
  let result
  try {
    result = addBlock({ repoRoot: ROOT, block, dir: dir || ".", update: parsed.options.has("--update") })
  } catch (error) {
    failFrom(error)
  }
  if (parsed.options.has("--json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  const c = styler(colourEnabled())
  const lines = []
  for (const file of [...result.files, result.notice]) {
    const state = file.state === "current" ? "info" : "pass"
    const from = file.from ? ` (from ${result.block} ${file.from})` : ""
    lines.push(`${mark(state, c)}${c("label", file.state.padEnd(8))} ${file.path}${from}`)
  }
  lines.push(...labelled("block", `${result.block} ${result.version}, from omakit commit ${result.commit}`, c))
  lines.push(...labelled("into", withHomeAbbreviated(result.dir), c))
  if (result.files.some((file) => file.state !== "current")) lines.push(...action("import \"omakit\" in the QML that starts a process, and use Run { } there; docs/BLOCKS.md is the contract", c))
  process.stdout.write(`${lines.join("\n")}\n`)
}

/**
 * Every way `weigh` stops without weighing, in one register: the closing
 * word a report would have ended with, negated, then the sentence naming
 * what is missing, then the one thing to do. Exit 2 for a usage error and
 * an unanswered confirmation, 130 for an interrupt, 1 for the rest.
 */
function notWeighed(code, message, remedy, exit = 1) {
  const c = styler(colourEnabled(process.stderr))
  const lines = verdict("fail", "NOT WEIGHED", message, c)
  if (remedy) lines.push(...action(remedy, c, { indent: 0 }))
  process.stderr.write(`${lines.join("\n")}\n`)
  process.exit(exit)
}

async function cmdWeigh(args) {
  // Every token is checked before anything else: an option weigh does not
  // know, or a second positional, is refused with the accepted list.
  const parsed = checkArgs(args, ACCEPTED.weigh)
  if (parsed.offending !== null) notWeighed("usage", `${parsed.reason}. Accepted: ${acceptedWords("weigh")}.`, "omakit weigh <plugin-id-or-dir> [--runs N] [--window S] [--settle S] [--yes] [--json] [--out FILE], or omakit weigh --list", 2)
  const json = parsed.options.has("--json")
  const all = parsed.options.has("--all")
  const target = parsed.positionals[0]
  // --list reads and prints: every installed plugin and its last weighing.
  // No preflight beyond listPlugins answering, no confirmation, no restart.
  if (parsed.options.has("--list")) {
    for (const other of ["--all", "--yes", "--runs", "--window", "--settle", "--out"]) {
      if (parsed.options.has(other)) notWeighed("usage", `--list only lists, so ${other} has nothing to apply to.`, "omakit weigh --list [--json]", 2)
    }
    if (target) notWeighed("usage", `--list lists every installed plugin, so ${JSON.stringify(target)} is one argument more than it takes.`, "omakit weigh --list [--json]", 2)
    let list
    try {
      list = listWeighings()
    } catch (error) {
      if (error?.code && typeof error.code === "string") notWeighed(error.code, `${error.message}.`, error.remedy || REMEDY[error.code])
      throw error
    }
    process.stdout.write(json ? `${JSON.stringify(list.rows, null, 2)}\n` : `${renderList(list)}\n`)
    return
  }
  if (!target && !all) notWeighed("usage", "weigh needs a plugin: `omakit weigh <plugin-id-or-dir>`, or `omakit weigh --all` for every enabled third-party plugin.", "omakit weigh <plugin-id-or-dir>", 2)
  if (target && all) notWeighed("usage", `--all weighs every enabled third-party plugin, so ${JSON.stringify(target)} is one argument more than it takes.`, "omakit weigh --all, or omakit weigh <plugin-id-or-dir>", 2)
  const integer = (name, fallback, letter, min = 1) => {
    if (!parsed.options.has(name)) return fallback
    const raw = parsed.options.get(name)
    if (!/^\d+$/.test(raw) || Number(raw) < min) notWeighed("usage", `${name} needs an integer of at least ${min}, not ${JSON.stringify(raw)}.`, `omakit weigh <plugin-id-or-dir> ${name} ${letter}`, 2)
    return Number(raw)
  }
  const runs = integer("--runs", WEIGH_DEFAULTS.runs, "N")
  const windowSeconds = integer("--window", WEIGH_DEFAULTS.windowSeconds, "S")
  const settleSeconds = integer("--settle", WEIGH_DEFAULTS.settleSeconds, "S", 0)
  let plan
  try {
    plan = planWeigh({ target, all, runs, windowSeconds, settleSeconds, out: parsed.options.get("--out") })
  } catch (error) {
    if (error?.code && typeof error.code === "string") notWeighed(error.code, `${error.message}.`, error.remedy || REMEDY[error.code], error.code === "usage" ? 2 : 1)
    throw error
  }
  // The narration: what was backed up and with which md5, and what was
  // restored. For a person it is part of the report, on stdout; under
  // --json stdout is the document alone, so it goes to stderr.
  const narrate = json ? process.stderr : process.stdout
  const c = styler(colourEnabled(narrate))
  const say = (line) => narrate.write(`${mark(line.state, c)}${wrap(withHomeAbbreviated(line.text), { indent: GUTTER }, c).join("\n").trimStart()}\n`)
  // The confirmation. The plan is printed either way, so the record says
  // what was agreed to; the question is asked only at a terminal on both
  // ends, and --yes is the only other way past it.
  narrate.write(`${withOutputStream(narrate, () => renderPlan(plan, { colour: colourEnabled(narrate) })).join("\n")}\n`)
  if (!parsed.options.has("--yes")) {
    const interactive = !json && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY)
    if (!interactive) notWeighed("not-confirmed", `this restarts the shell ${plan.restarts} times and edits shell.json for the duration; a pipe, an agent or --json cannot answer for the person whose shell it is.`, REMEDY["not-confirmed"], 2)
    const agreed = await askYes({ question: confirmationQuestion(plan) })
    if (!agreed) notWeighed("not-confirmed", "not confirmed; nothing was changed.", REMEDY["not-confirmed"], 2)
  }
  narrate.write("\n")
  // An interrupt is a request to stop, not a reason to leave the user's
  // shell on a measurement configuration: the signal aborts the run, the
  // measurement's own finally restores shell.json and restarts the shell,
  // and only then does the process exit, 130 as an interrupted program does.
  const controller = new AbortController()
  const interrupt = () => {
    if (!controller.signal.aborted) narrate.write(`\n${mark("advisory", c)}interrupted: restoring shell.json before exiting\n`)
    controller.abort()
  }
  process.on("SIGINT", interrupt)
  process.on("SIGTERM", interrupt)
  const spinner = spinnerFor(args)
  let document
  try {
    document = await measureWeigh(plan, { signal: controller.signal, omakitVersion: VERSION, onPhase: spinner.phase, onLine: (line) => { spinner.done(); say(line) } })
  } catch (error) {
    spinner.done()
    if (error?.code === "interrupted") notWeighed("interrupted", "interrupted before the measurement completed.", REMEDY.interrupted, 130)
    if (error?.code && typeof error.code === "string") notWeighed(error.code, `${error.message}.`, error.remedy || REMEDY[error.code])
    throw error
  } finally {
    process.off("SIGINT", interrupt)
    process.off("SIGTERM", interrupt)
  }
  spinner.done()
  if (json) {
    process.stdout.write(`${JSON.stringify(document, null, 2)}\n`)
  } else {
    process.stdout.write(`\n${renderWeigh(document)}\n`)
  }
}

const VERSION = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version

const [command, ...rest] = process.argv.slice(2)

// Every token checked against the command's table before anything runs
// (options.mjs): an option the command does not know, an option without its
// value, or one positional too many is a usage error naming the token and
// the accepted list. `weigh` reports it in its own register, below.
{
  const name = command === "marketplace-pin" ? "pin" : command
  const table = name === "weigh" ? null : ACCEPTED[name] || ((command === "--help" || command === "-h") ? ACCEPTED.pin : null)
  if (table) {
    const parsed = checkArgs(rest, table)
    if (parsed.offending !== null) {
      const accepted = acceptedWords(name)
      fail("usage", `${parsed.reason}.${accepted ? ` Accepted: ${accepted}.` : ` \`omakit ${name}\` takes no options.`}`, 2, "omakit help")
    }
  }
}

// Once a day, one dim line on stderr, only at a terminal: the installed
// completion script names another omakit, so `omakit we<TAB>` may not know
// `weigh`. One stat and one short read; never under a pipe, whose stderr
// stays empty on success, and never for setup, which is the fix.
if (updateCheckEnabled({ command, args: rest, stdinTTY: process.stdin.isTTY, stdoutTTY: process.stdout.isTTY, stderrTTY: process.stderr.isTTY })) {
  const notice = await updateNotice({ repoRoot: ROOT, version: VERSION })
  if (notice) process.stderr.write(`${wrap(notice, { width: outputColumns(process.stderr) }, styler(colourEnabled(process.stderr))).join("\n")}\n`)
}

if (command !== "setup" && process.stderr.isTTY) {
  const notice = staleCompletionNotice({ version: VERSION })
  if (notice) {
    const c = styler(colourEnabled(process.stderr))
    process.stderr.write(`${wrap(notice, { width: outputColumns(process.stderr) }).map((line) => c("label", line)).join("\n")}\n`)
  }
}

if (command === "setup") {
  await cmdSetup(rest)
} else if (command === "pin" || command === "marketplace-pin") {
  const c = styler(colourEnabled())
  const spinner = progress()
  try {
    ensurePin(ROOT, (line) => {
      // ensurePin narrates: a state line to keep, then a fetch it is about to
      // start. The fetch is the slow part, so it gets the progress line.
      if (line.state === "fetching") spinner.phase(line.text)
      else process.stdout.write(`${mark(line.state, c)}${wrap(withHomeAbbreviated(line.text), { indent: GUTTER }, c).join("\n").trimStart()}\n`)
    })
  } catch (error) {
    spinner.done()
    fail(error?.code || "marketplace-unavailable", error.message, 1, error?.remedy || REMEDY[error?.code])
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
  await cmdVerify(rest)
} else if (command === "parity") {
  await cmdParity(rest)
} else if (command === "audit") {
  await cmdAudit(rest)
} else if (command === "weigh") {
  await cmdWeigh(rest)
} else if (command === "inspect") {
  await cmdInspect(rest)
} else if (command === "add") {
  await cmdAdd(rest)
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
  } else if (command === undefined) {
    await cmdFrontDoor()
  } else {
    // `omakit help` is the reference and gets all of it, under the name and
    // the tagline as one line of text: 53 lines scroll a wordmark off the top
    // of the screen before anyone has read it, so it gets none.
    process.stdout.write(renderUsage())
  }
} else {
  // The short list on a typo, not 53 lines of reference, in the same register
  // as every other failure: what happened, what it means, what to run.
  const c = styler(colourEnabled(process.stderr))
  process.stderr.write(withOutputStream(process.stderr, () => [
    `${mark("fail", c)}${c("name", "unknown command")}`,
    ...wrap(`\`${command}\` is not something omakit does. The commands it has are listed below.`, { indent: GUTTER }, c),
    ...action("omakit help", c),
    "",
    renderSummary({ stream: process.stderr, colour: colourEnabled(process.stderr), heading: false }),
  ].join("\n")))
  process.exit(2)
}
