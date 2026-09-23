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
//   omakit add run|store [dir]       copy a block into the plugin's omakit/ directory
//   omakit lab prove|inspect|setup|prune  a suite proved in a disposable Omarchy guest; docs/LAB.md
//
// Nothing here writes to the marketplace. There is no POST, PATCH, PUT or
// DELETE anywhere in this repository, and `tests/unit/read-only.test.mjs`
// proves it. `weigh` is the one command that changes the user's own machine,
// their shell and its configuration for the duration of a measurement, and
// it confirms first; docs/WEIGH.md says what it writes and how it restores.
// `add` is the one command that writes into a plugin tree: the block's own
// files under omakit/, never over a modified copy; docs/BLOCKS.md says what.

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ensurePin, requirePin } from "./pin.mjs"
import { marketplaceBaselineSection } from "./verify.mjs"
import { resolveSubject, SubjectError } from "../subject/resolve.mjs"
import { submitPreflight } from "./submit.mjs"
import { askChoices, askWatchIssues } from "./ask.mjs"
import { validationWatch, discoverWatchIssues, validationWatchAll, resolveWatchSubject } from "./watch.mjs"
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
import { renderSummary, renderUsage, TAGLINE } from "./usage.mjs"
import { action, AUDIT_VERDICTS, colourEnabled, GUTTER, labelled, mark, outputColumns, styler, withOutputStream, wrap } from "./style.mjs"
import { conclude, Exit, exitFor, failure, failureBlock, leave, optionValue, SIGNAL_EXIT, signalExit, verdictBlock } from "./outcome.mjs"
import { omakitCacheDir, withHomeAbbreviated } from "./paths.mjs"
import { DEFAULTS as WEIGH_DEFAULTS, measureWeigh, planWeigh } from "../weigh/audit.mjs"
import { confirmationQuestion, renderList, renderWeigh, renderPlan } from "../weigh/report.mjs"
import { listWeighings } from "../weigh/list.mjs"
import { askYes } from "../weigh/confirm.mjs"
import { auditInstalled } from "../audit/audit.mjs"
import { auditSummary, renderAudit } from "../audit/report.mjs"
import { inspectPlugin, NOT_READABLE } from "../inspect/inspect.mjs"
import { renderInspect } from "../inspect/report.mjs"
import { addBlock } from "../blocks/add.mjs"
import { inspectLab } from "../lab/inspect.mjs"
import { runSuite } from "../lab/run.mjs"
import { CONSENT_QUESTION, planSetup, recordToolchain, setupLab } from "../lab/setup.mjs"
import { checkNewestRelease } from "../lab/release.mjs"
import { planPrune, prune } from "../lab/prune.mjs"
import { renderLab, renderPrunePlan, renderPruneResult, renderRunIdentity, renderRunResult, renderSetupPlan, renderSetupResult } from "../lab/report.mjs"

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
  "not-a-directory": "Pass the plugin's repository directory, not a file inside it.",
  "commit-not-found": "Commit first; the checks read the tree at an exact commit, never the working copy.",
  "network-unavailable": "Connect to the network, then run it again; `omakit watch --user <login>` reads a public account, and needs the network too.",
  "github-unavailable": "Wait for GitHub, then run it again. `gh auth login` raises the rate limit if that is what ran out.",
  "not-found": "Check the issue URL: it has to be an existing issue on the marketplace repository.",
  "head-unreadable": "Check that the plugin repository is public and its URL is right.",
  "login-required": "gh auth login",
  "not-confirmed": "Run it again and answer y, or pass --yes when the person whose shell it is has agreed.",
  "interrupted": "shell.json was restored; run it again when the desktop is yours to restart.",
  "refused": "Fix what the report names, then run it again.",
  "unknown": "Read what could not be compared in the report above; each row says why.",
  "wrong-repository": "Edit the issue and set the Repository URL field to the plugin's origin, printed in the report. Change nothing else.",
  "no-origin": "Give the checkout a github.com origin remote, or pass the repository URL as the subject.",
  "drift": "Return each plugin to its validated commit with the git checkout printed beside it, or validate the newer commit through the form the report names.",
  "not-compared": "Run it in the desktop session whose shell runs these plugins: omarchy-plugin-catalog named no readable source directory for them.",
  "problems": "omakit setup",
  "not-proved": "Read the suite's log under the run's record directory, then run it again.",
  "lab-blocked": "omakit lab inspect names what the host lacks, with the one command for each.",
  "setup-incomplete": "Read the lines above; each failed step names its fix, and `omakit doctor` re-checks.",
  "backup-present": "Compare the backup with shell.json, copy it over if the difference is not yours, then remove it and run weigh again.",
  "exists": "omakit add run [<plugin-dir>] --update",
  "modified": "Keep your copy, or move it aside and run add again; omakit/NOTICE is where modifications are listed.",
  "not-a-plugin": "Pass the plugin's directory, the one with its manifest.json.",
  "plugin-dir-not-found": "Pass the plugin's directory, the one with its manifest.json.",
  "unknown-block": "omakit add run [<plugin-dir>], or omakit add store [<plugin-dir>]",
  "no-source-commit": "Run omakit from a checkout of the repository, or install an artifact the release step packed (`npm run pack:release` in the checkout, or the registry's release of this version once it is published); a raw `npm pack` names no commit.",
  "lab-not-ready": "omakit lab inspect",
  "lab-busy": "omakit lab inspect",
  "iso-mismatch": "omakit lab prune, then omakit lab setup",
  "size-mismatch": "omakit lab setup: Omarchy changed the object at the versioned URL since the release was read, and setup reads it again.",
  "sidecar-mismatch": "omakit lab setup: Omarchy republished the release while setup ran, and setup reads it again.",
  "key-mismatch": "The packaged signing key is not the one the pin names: reinstall omakit from the registry (`omakit upgrade`).",
  "release-unavailable": "omakit lab inspect names the newest release and why the newer ones were passed over; run it again once Omarchy has published the ISO, its .sha256 and its .sig.",
  "signer-changed": "omakit upgrade: a newer omakit carries Omarchy's new key once it is verified. Until then the lab keeps the base it has.",
  "toolchain-missing": "omakit lab inspect prints the one command that prepares the toolchain.",
  "toolchain-mismatch": "omakit lab inspect prints the one command that prepares the toolchain.",
  "guest-mismatch": "omakit lab prune removes the staged base; an ISO that installs another release's omarchy package is not used as that release.",
  "build-failed": "Read build.log under the lab's staging directory, then omakit lab prune and omakit lab setup again.",
  "qemu-failed": "Read qemu.log in the run directory; omakit lab inspect names what the host lacks.",
  "overlay-failed": "omakit lab inspect: the base must be ready and the disk must have room for one overlay.",
  "no-port": "Free a port between 2222 and 2271 on 127.0.0.1, or wait for the run that holds one.",
  "guest-exited": "Read qemu.log and serial.log in the run directory, then run it again.",
  "guest-timeout": "Read qemu.log and serial.log in the run directory, then run it again.",
  "session-timeout": "Read qemu.log in the run directory and the screenshots beside it, then run it again.",
  "plugin-fetch-failed": "Connect to the network, then omakit lab setup --plugins again.",
  "prune-refused": "Remove the symbolic link by hand; the lab wrote none and follows none.",
})

/*
 * Every command ends in `conclude()` (outcome.mjs): the one place that
 * writes the document under --json, the text on the stream the exit status
 * chooses, and the --out file, and sets the exit status. A command that has
 * written its result leaves through `process.exitCode`, never
 * `process.exit()`: stdout is an API, and on a pipe whose reader has not
 * started reading yet the exit cuts the output (measured on 0.4.1:
 * `omakit submit <listed plugin> --json | (sleep 2; cat)` delivered 8,192 of
 * 14,033 bytes). A failure state throws `Exit`, which the dispatcher at the
 * bottom catches, drains both streams for, and only then exits with.
 */

/** The command being run and its arguments, for the envelope: set by the dispatcher before anything runs. */
const CONTEXT = { command: null, args: [] }

/**
 * A failure state: the document under --json, the block on stderr, the
 * --out file, and the exit. `usage` errors carry the signature that was
 * expected, so the remedy is the reference and not a restatement of the
 * message. `body` is extra labelled lines between the message and the
 * arrow, for a usage error that has values to list; `extra` rides in the
 * document beside the code (`missing`, `usage`).
 */
function fail(code, message, exit = exitFor(code), remedy = REMEDY[code], body = () => [], extra = {}, render = null) {
  const error = failure({ code, message, remedy, table: REMEDY, ...extra })
  conclude({ command: CONTEXT.command, args: CONTEXT.args, exit, error, render: render || ((problem, c) => failureBlock(problem, c, { body })) })
  throw new Exit(exit)
}

/**
 * A thrown error becomes a failure state when it carries a code; anything
 * else is a bug and keeps its stack. The exit status follows the code the
 * same way for every command: 2 for a usage error and for a question a
 * pipe could not answer, the signal's own status for an interrupt, 1 for
 * the rest, an error the operating system raised included, whose remedy
 * comes from its errno. An error that names what is missing (`missing`:
 * what, what it costs, the one command) lists it between the sentence and
 * the arrow.
 */
function failFrom(error, render = null) {
  if (error?.code && typeof error.code === "string") {
    fail(error.code, error.message, exitFor(error.code, error.signal), error.remedy || REMEDY[error.code], () => [], error.missing?.length ? { missing: error.missing } : {}, render)
  }
  throw error
}

/** The value of a valued option, `--name value` or `--name=value`; a repeat with another value is refused by the table before this reads it. */
function option(args, name) {
  return optionValue(args, name)
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

/** A success: the document, the report for a person, exit 0, through the one layer. */
function succeed(args, document, human = null) {
  return conclude({ command: CONTEXT.command, args, exit: 0, document, human })
}

/** A refusal the tool means, with the report that explains it: the document and the report, exit 1, the error beside them. */
function refuse(args, document, human, error) {
  return conclude({ command: CONTEXT.command, args, exit: 1, document, human, error: failure({ ...error, table: REMEDY }) })
}

/**
 * `--body-out`: the rendered issue body, byte for byte and nothing else,
 * so a retry edit is the body `submit` renders and never a body retyped.
 * On #7787 (2026-09-20) the retry was typed, and the Repository URL came
 * out as another account. A person passes the file to `gh`'s
 * `issue edit --body-file`; this tool writes a local file and posts
 * nothing. A body that was not rendered (a refusal, a
 * listing) writes no file and says so.
 */
function writeBodyOut(out, body) {
  writeFileSync(resolve(out), body)
  return resolve(out)
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
      const flags = usage.missing.join(" and ")
      fail("usage", `submit needs ${flags}: ${usage.missing.length === 1 ? "it is" : "they are"} an editorial choice nobody else can make, from the pinned form's own lists.`, 2,
        `omakit submit ${target} --category <c> --tags <a,b>`,
        (c) => [
          ...labelled("categories", usage.categories.join(", "), c),
          ...labelled(`tags, 1 to ${usage.maximumTags}`, usage.tags.join(", "), c),
        ], { usage })
    }
    failFrom(error)
  }
  spinner.done()
  const bodyOut = option(args, "--body-out")
  if (bodyOut && result.issue?.body) {
    try {
      result.bodyFile = writeBodyOut(bodyOut, result.issue.body)
    } catch (error) {
      failFrom(Object.assign(error, { message: `--body-out ${resolve(bodyOut)} could not be written: ${error.message}` }))
    }
  } else if (bodyOut) {
    result.bodyFile = null
  }
  const human = (colour) => {
    const text = renderSubmit(result, { colour })
    if (!bodyOut) return text
    const c = styler(colour)
    return `${text.replace(/\n+$/, "")}\n${result.bodyFile ? `${mark("pass", c)}wrote the body to ${withHomeAbbreviated(result.bodyFile)}` : `${mark("skipped", c)}no body was rendered, so --body-out wrote nothing`}\n`
  }
  // Three outcomes, two exit codes: `ready` and `listed` are both healthy
  // states, and only a refusal is a 1.
  if (result.outcome === "refused") {
    const blocking = result.blocking || []
    refuse(args, result, human, { code: "refused", message: `${blocking.length} blocking check${blocking.length === 1 ? "" : "s"} failed (${blocking.join(", ")}), so no body is produced` })
    return
  }
  succeed(args, result, human)
}

async function cmdWatch(args) {
  const [issueUrl, subjectTarget] = positionals(args)
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
  if (subjectTarget !== undefined && !issueUrl) {
    fail("usage", "a subject belongs to one issue: `omakit watch <issue-url> <subject>`.", 2)
  }
  const spinner = spinnerFor(args)
  let result
  try {
    if (issueUrl) {
      // The subject is the plugin's own origin: a path or a github.com URL
      // given after the issue, or the current directory when it is a
      // checkout with one. The issue's Repository URL is compared with it.
      const subject = resolveWatchSubject(subjectTarget)
      result = await validationWatch({ repoRoot: ROOT, issueUrl, subject, onPhase: spinner.phase })
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
  const human = (colour) => render(result, { colour })
  // A comparison that could not be made is a refusal the tool means, exit
  // 1: the validated commit is not known to be current. Stale is a fact
  // about the marketplace, not a failure, and exits 0. Measured on
  // 2026-09-19: an unknown verdict exited 2, the usage status. An issue
  // that names the wrong repository, or one the marketplace refused, is
  // the same kind of refusal: nothing on it is being validated, and the
  // verdict's own action is the remedy.
  if (["unknown", "wrong-repository", "refused"].includes(result.verdict?.state)) {
    refuse(args, result, human, { code: result.verdict.state, message: result.verdict.summary, remedy: result.verdict.action || REMEDY[result.verdict.state] })
    return
  }
  if (result.summary?.unknown > 0 || result.summary?.refused > 0) {
    const counts = [result.summary.unknown > 0 && `${result.summary.unknown} could not be compared`, result.summary.refused > 0 && `${result.summary.refused} refused by the marketplace`].filter(Boolean).join(", ")
    refuse(args, result, human, { code: result.summary.unknown > 0 ? "unknown" : "refused", message: `${counts} of ${result.summary.total} issue${result.summary.total === 1 ? "" : "s"}`, remedy: result.summary.unknown > 0 ? REMEDY.unknown : "Read each refused row: the marketplace's own reason and action are printed beside it." })
    return
  }
  succeed(args, result, human)
}

async function cmdFrontDoor() {
  // A bare `omakit` is the front door: the wordmark, through `ttfx` when it is
  // there, then the short list, which fits under it on any screen. The banner
  // already says the name and the tagline, so the heading would repeat it.
  const drew = bannerEnabled()
  await banner({ tagline: TAGLINE, effect: true })
  process.stdout.write(renderSummary({ heading: !drew }))
  process.exitCode = 0
}

async function cmdSetup(args) {
  // `--completion` is the one step on its own: write the script and prove
  // it in a new shell, never the rc question. `upgrade` runs it through the
  // freshly installed omakit, so the script carries the new version.
  // setup narrates as it goes, on stdout, and asks its one question at a
  // terminal; what it could not do is the failure, on stderr, at the end.
  if (args.includes("--completion")) {
    const identity = requirePin(ROOT).identity
    const result = await completionStep({ repoRoot: ROOT, pin: identity.commit, version: VERSION, askRc: false })
    if (result.state === "ok") return succeed(args, result)
    refuse(args, result, null, { code: "setup-incomplete", message: `tab completion is ${result.state}${result.error ? `: ${result.error}` : ""}` })
    return
  }
  const result = await setup({ repoRoot: ROOT, entryPoint: resolve(ROOT, "bin/omakit"), yes: args.includes("--yes") })
  if (result.ok) return succeed(args, result)
  refuse(args, result, null, { code: "setup-incomplete", message: "setup did not complete every step; the lines above name the one that failed" })
}

async function cmdUpgrade(args) {
  // upgrade writes its account of the update into a buffer, so the text
  // lands on the stream the outcome chooses: stdout when it applied or had
  // nothing to do, stderr when it refused.
  const buffer = { text: "", write(chunk) { this.text += chunk; return true } }
  const result = await upgrade({ repoRoot: ROOT, stream: buffer, dryRun: args.includes("--dry-run") })
  if (result.ok) return succeed(args, result, buffer.text.trimEnd())
  refuse(args, result, buffer.text.trimEnd(), { code: "refused", message: result.reason || "the upgrade was refused" })
}

async function cmdDoctor(args) {
  const spinner = spinnerFor(args)
  const result = await doctor({ repoRoot: ROOT, offline: args.includes("--offline"), onPhase: spinner.phase })
  spinner.done()
  const human = (colour) => renderDoctor(result, { colour })
  if (result.problems) {
    const failed = result.checks.filter((check) => check.state === "problem")
    refuse(args, result, human, { code: "problems", message: `${failed.length} check${failed.length === 1 ? "" : "s"} found a problem: ${failed.map((check) => check.id).join(", ")}`, remedy: failed.find((check) => check.action)?.action || REMEDY.problems })
    return
  }
  succeed(args, result, human)
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
  // printed under the envelope; a person at the terminal gets the report,
  // in the register submit uses for its checks.
  const blockingRules = !args.includes("--json") && section.invoked && section.official && !section.official.error
    ? (await consequence(requirePin(ROOT).dir, section.official)).selectivelyBlockingRules
    : []
  succeed(args, document, (colour) => renderVerify(document, { colour, blockingRules }))
}

async function cmdParity(args) {
  // The runner takes everything as arguments. Before 0.1.8 this handed over
  // four PARITY_* variables and an OMAKIT_ROOT through the process
  // environment, and OMAKIT_ROOT was the one OMAKIT_* name in the tree.
  let run
  try {
    // Imported here, not at the top: the runner ships with the package, but
    // no other command needs it, and a copy of bin/ and tools/ alone runs
    // everything else.
    const { runParity } = await import("../../tests/parity/run.mjs")
    const count = option(args, "--count")
    const offset = option(args, "--offset")
    if (count !== undefined && !(/^\d+$/.test(count) && Number(count) >= 1)) fail("usage", `--count needs an integer of at least 1, not ${JSON.stringify(count)}.`, 2, "omakit parity [--count <n>] [--offset <n>] [--out FILE]")
    if (offset !== undefined && !/^\d+$/.test(offset)) fail("usage", `--offset needs an integer of at least 0, not ${JSON.stringify(offset)}.`, 2, "omakit parity [--count <n>] [--offset <n>] [--out FILE]")
    run = await runParity({
      repoRoot: ROOT,
      count: count ? Number(count) : undefined,
      offset: offset ? Number(offset) : undefined,
      out: option(args, "--out") || null,
    })
  } catch (error) {
    failFrom(error)
  }
  // The evidence file the runner wrote is the document; with --out it is
  // rewritten there under the envelope, the same bytes every other command
  // puts in its --out.
  const { summary, outFile, ok } = run
  const document = { ...summary, evidence: outFile }
  const words = `identical ${summary.identical} of ${summary.corpusSize}, ${summary.mismatches} mismatch${summary.mismatches === 1 ? "" : "es"}, ${summary.failures} failure${summary.failures === 1 ? "" : "s"}; evidence at ${withHomeAbbreviated(outFile)}`
  if (ok) return succeed(args, document, (colour) => `${mark("pass", styler(colour))}PARITY  ${words}`)
  refuse(args, document, (colour) => `${mark("fail", styler(colour))}NOT PARITY  ${words}`, { code: "parity-mismatch", message: `the local transport and the GitHub transport did not agree: ${words}`, remedy: "Read the evidence file's rows with differingKeys or an error; docs/UPSTREAM_CONTRACT.md says what a mismatch means for the pin." })
}

/** Every way audit stops without a comparison, in its own register: `█ NOT AUDITED  sentence`, then the one action. */
const notAuditedRegister = (error, c) => verdictBlock(AUDIT_VERDICTS.unavailable, error, c)

async function cmdAudit(args) {
  const parsed = checkArgs(args, ACCEPTED.audit)
  if (parsed.offending !== null) fail("usage", `${parsed.reason}. Accepted: ${acceptedWords("audit")}.`, 2, "omakit audit [<plugin-id-or-dir>] [--drift] [--json] [--out FILE] [--offline]", () => [], {}, notAuditedRegister)
  let document
  try {
    document = await auditInstalled({
      repoRoot: ROOT,
      target: parsed.positionals[0],
      drift: parsed.options.has("--drift"),
      offline: parsed.options.has("--offline"),
    })
  } catch (error) {
    failFrom(error, notAuditedRegister)
  }
  const human = (colour) => renderAudit(document, { colour })
  if (document.ok) return succeed(args, document, human)
  // Drift is a refusal the tool means; a row it could not compare is not
  // drift, and is said as such (audit/report.mjs, one sentence for both).
  const drifted = document.counts.drift.value > 0
  refuse(args, document, human, { code: drifted ? "drift" : "not-compared", message: auditSummary(document) })
}

/**
 * `omakit inspect`: a report, exit 0 whatever it observed; exit 2 when the
 * target could not be read (no directory, no Git checkout, no commit, no
 * manifest), in the one failure register. There is no exit status for
 * "found something", because finding something is the normal outcome.
 * `--out` writes the document to a file beside whatever stdout gets, the
 * way every command's does.
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
  succeed(args, document, (colour) => renderInspect(document, { full: parsed.options.has("--full"), colour }))
}

/**
 * `omakit add <block> [plugin-dir]`: the one command that writes into a
 * plugin tree, and only the block's files under omakit/. Every refusal is
 * a failure state before anything is written; the report is one line per
 * file with what happened to it, or the document under --json.
 */
async function cmdAdd(args) {
  const parsed = checkArgs(args, ACCEPTED.add)
  if (parsed.offending !== null) fail("usage", `${parsed.reason}. Accepted: ${acceptedWords("add")}.`, 2, "omakit add <block> [<plugin-dir>] [--update] [--json]")
  const [block, dir] = parsed.positionals
  if (!block) fail("usage", "add needs a block: `omakit add run [<plugin-dir>]` or `omakit add store [<plugin-dir>]`", 2, "omakit add <block> [<plugin-dir>] [--update] [--json]")
  let result
  try {
    result = addBlock({ repoRoot: ROOT, block, dir: dir || ".", update: parsed.options.has("--update") })
  } catch (error) {
    failFrom(error)
  }
  succeed(args, result, (colour) => {
    const c = styler(colour)
    const lines = []
    for (const file of [...result.files, result.notice]) {
      const state = file.state === "current" ? "info" : "pass"
      const from = file.from ? ` (from ${file.block} ${file.from})` : ""
      const other = file.block && file.block !== result.block ? ` (${file.block}, which ${result.block} uses)` : ""
      lines.push(`${mark(state, c)}${c("label", file.state.padEnd(8))} ${file.path}${from}${other}`)
    }
    lines.push(...labelled("block", `${result.block} ${result.version}${result.requires.length ? `, with ${result.requires.join(", ")}` : ""}, from omakit commit ${result.commit}`, c))
    lines.push(...labelled("into", withHomeAbbreviated(result.dir), c))
    if (result.files.some((file) => file.state !== "current")) lines.push(...action(result.block === "store" ? "import \"omakit\" in the QML that keeps state, and use Store { } there; docs/BLOCKS.md is the contract" : "import \"omakit\" in the QML that starts a process, and use Run { } there; docs/BLOCKS.md is the contract", c))
    return lines.join("\n")
  })
}

/**
 * Every way `weigh` stops without weighing, in one register: the closing
 * word a report would have ended with, negated, then the sentence naming
 * what is missing, then the one thing to do. Exit 2 for a usage error and
 * an unanswered confirmation, the signal's status for an interrupt, 1 for
 * the rest.
 */
const notWeighedRegister = (error, c) => verdictBlock("NOT WEIGHED", error, c)
function notWeighed(code, message, remedy, exit = exitFor(code)) {
  fail(code, message, exit, remedy, () => [], {}, notWeighedRegister)
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
      failFrom(error, notWeighedRegister)
    }
    succeed(args, list.rows, (colour) => renderList(list, { colour }))
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
    failFrom(error, notWeighedRegister)
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
  // The consent is a value handed to the measurement, not a flag it reads
  // for itself: `--yes`, or a `y` typed at a terminal on both ends. Without
  // it measureWeigh refuses, and so does every write under tools/weigh/.
  let consent = parsed.options.has("--yes") ? { consented: true, how: "--yes" } : null
  if (!consent) {
    const interactive = !json && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY)
    if (!interactive) notWeighed("not-confirmed", `this restarts the shell ${plan.restarts} times and edits shell.json for the duration; a pipe, an agent or --json cannot answer for the person whose shell it is.`, REMEDY["not-confirmed"], 2)
    const agreed = await askYes({ question: confirmationQuestion(plan) })
    if (!agreed) notWeighed("not-confirmed", "not confirmed; nothing was changed.", REMEDY["not-confirmed"], 2)
    consent = { consented: true, how: "answered y at the terminal" }
  }
  narrate.write("\n")
  // An interrupt is a request to stop, not a reason to leave the user's
  // shell on a measurement configuration: the signal aborts the run, the
  // measurement's own finally restores shell.json and restarts the shell,
  // and only then does the process exit, with the signal's own status (130
  // for SIGINT, 143 for SIGTERM, 129 for SIGHUP, a terminal that closed).
  const controller = new AbortController()
  let stoppedBy = null
  const interrupt = (signal) => {
    stoppedBy = stoppedBy || signal
    if (!controller.signal.aborted) narrate.write(`\n${mark("advisory", c)}interrupted (${signal}): restoring shell.json before exiting\n`)
    controller.abort(signal)
  }
  for (const signal of Object.keys(SIGNAL_EXIT)) process.on(signal, interrupt)
  const spinner = spinnerFor(args)
  let document
  try {
    document = await measureWeigh(plan, { consent, signal: controller.signal, omakitVersion: VERSION, onPhase: spinner.phase, onLine: (line) => { spinner.done(); say(line) } })
  } catch (error) {
    spinner.done()
    if (error?.code === "interrupted") notWeighed("interrupted", `interrupted by ${error.signal || stoppedBy || "a signal"} before the measurement completed.`, REMEDY.interrupted, signalExit(error.signal || stoppedBy))
    failFrom(error, notWeighedRegister)
  } finally {
    for (const signal of Object.keys(SIGNAL_EXIT)) process.off(signal, interrupt)
  }
  spinner.done()
  if (!json) narrate.write("\n")
  succeed(args, document, (colour) => renderWeigh(document, { colour }))
}

/**
 * `omakit lab <prove|inspect|setup|prune>`: one command surface, four
 * actions, docs/LAB.md the contract. Every refusal is the failure
 * register with the one command; a missing thing is listed with its cost
 * before the arrow. `setup` and `prune` ask once at a terminal and take
 * `--yes` anywhere else; `run` and `inspect` never ask.
 */
async function cmdLab(args) {
  const parsed = checkArgs(args, ACCEPTED.lab)
  const signature = "omakit lab prove <suite> [--offline] | inspect [--verify] [--offline] | setup [--from <file>] [--toolchain <dir>] [--plugins] [--offline] [--yes] | prune [--keep-iso] [--records] [--yes]"
  if (parsed.offending !== null) fail("usage", `${parsed.reason}. Accepted: ${acceptedWords("lab")}.`, 2, signature)
  const [what, suite] = parsed.positionals
  if (!["prove", "inspect", "setup", "prune"].includes(what || "")) fail("usage", `lab needs one of prove, inspect, setup or prune${what ? `, not ${JSON.stringify(what)}` : ""}.`, 2, signature)
  const json = parsed.options.has("--json")
  const interactive = !json && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY)
  const c = styler(colourEnabled(json ? process.stderr : process.stdout))
  const narrate = json ? process.stderr : process.stdout
  const say = (line) => narrate.write(`${line.state === "prose" ? " ".repeat(GUTTER) : mark(line.state, c)}${withHomeAbbreviated(line.text)}\n`)
  const spinner = spinnerFor(args)
  const controller = new AbortController()
  let stoppedBy = null
  const interrupt = (signal) => {
    stoppedBy = stoppedBy || signal
    if (!controller.signal.aborted) narrate.write(`\n${mark("advisory", c)}interrupted (${signal}): ending the guest and cleaning up before exiting\n`)
    controller.abort(signal)
  }
  const listen = () => { for (const signal of Object.keys(SIGNAL_EXIT)) process.on(signal, interrupt) }
  const unlisten = () => { for (const signal of Object.keys(SIGNAL_EXIT)) process.off(signal, interrupt) }
  // The newest Omarchy release, read from the release list once per
  // command, with its own deadline so a network that drops packets costs
  // at most that; --offline skips it and says so.
  const offline = parsed.options.has("--offline")
  const newestRelease = async (seconds = 45) => offline
    ? { checked: false, code: "offline", reason: "--offline" }
    : checkNewestRelease({ signal: AbortSignal.any([controller.signal, AbortSignal.timeout(seconds * 1000)]) })
  /** A lab error that stopped for a signal carries the signal, so the exit status follows it. */
  const stopped = (error) => {
    if (error?.code === "interrupted" && !error.signal) error.signal = stoppedBy
    return error
  }

  if (what === "inspect") {
    if (suite) fail("usage", `inspect takes no suite, so ${JSON.stringify(suite)} is one argument more than it takes.`, 2, signature)
    let lab
    try {
      if (!offline) spinner.phase("looking for the newest Omarchy release")
      const newest = await newestRelease()
      spinner.phase(parsed.options.has("--verify") ? "hashing the ISO and checking its signature" : "reading the lab")
      lab = await inspectLab({ newest, verify: parsed.options.has("--verify") })
    } catch (error) {
      spinner.done()
      failFrom(error)
    }
    spinner.done()
    const human = (colour) => renderLab(lab, { colour })
    if (!lab.missing.length) return succeed(args, lab, human)
    // The inventory is complete and the lab is not ready: the report says
    // what is missing, and the exit says a run would refuse.
    refuse(args, lab, human, { code: "lab-not-ready", message: `the lab is not ready: ${lab.missing.map((item) => item.what).join(", ")} missing`, remedy: lab.missing.find((item) => item.command)?.command || REMEDY["lab-not-ready"], missing: lab.missing })
    return
  }

  if (what === "prove") {
    if (!suite) fail("usage", "prove needs a suite: `omakit lab prove <run|store|weigh|weigh-evidence>`", 2, signature)
    const runs = parsed.options.has("--runs") ? Number(parsed.options.get("--runs")) : undefined
    if (parsed.options.has("--runs") && !(Number.isInteger(runs) && runs >= 1)) fail("usage", `--runs needs an integer of at least 1, not ${JSON.stringify(parsed.options.get("--runs"))}.`, 2, signature)
    listen()
    let record
    try {
      record = await runSuite({
        suiteName: suite,
        repoRoot: ROOT,
        options: { runs },
        signal: controller.signal,
        checkNewest: () => newestRelease(30),
        onPhase: spinner.phase,
        onLine: (line) => {
          spinner.done()
          // The identity block, once the guest has been read: the line
          // packaging/LAB_PLAN.md says every run prints before its suite.
          if (line.record) {
            narrate.write(`${withOutputStream(narrate, () => renderRunIdentity(line.record, { colour: colourEnabled(narrate) }))}\n\n`)
            return
          }
          say(line)
        },
      })
    } catch (error) {
      spinner.done()
      failFrom(stopped(error))
    } finally {
      unlisten()
    }
    spinner.done()
    if (!json) narrate.write("\n")
    const human = (colour) => renderRunResult(record, { colour })
    if (record.ok) return succeed(args, record, human)
    refuse(args, record, human, { code: "not-proved", message: `${record.suite}: ${record.assertion?.reason || "the suite did not pass"}` })
    return
  }

  if (what === "setup") {
    if (suite) fail("usage", `setup takes no suite, so ${JSON.stringify(suite)} is one argument more than it takes.`, 2, signature)
    try {
      if (parsed.options.has("--toolchain")) {
        const recorded = recordToolchain({ dir: parsed.options.get("--toolchain") })
        narrate.write(`${mark("pass", c)}toolchain recorded: ${withHomeAbbreviated(recorded.dir)} (harness sha256 ${recorded.sha256.slice(0, 12)}, the pinned patched one)\n`)
      }
    } catch (error) {
      failFrom(error)
    }
    let plan
    const from = parsed.options.get("--from") || null
    try {
      // First what no release changes: a host that cannot build is told so
      // before the network is read. Then the newest release, and the plan
      // that prepares it.
      plan = planSetup({ from, plugins: parsed.options.has("--plugins"), repoRoot: ROOT })
      if (!plan.blockers.length) {
        if (!offline) spinner.phase("looking for the newest Omarchy release")
        const newest = await newestRelease()
        spinner.done()
        // A newer release signed by a key omakit does not ship is a finding,
        // not a lookup that failed: the lab cannot be brought current, and
        // the person has to know, whatever base is there.
        if (!newest.checked && newest.code === "signer-changed") failFrom(Object.assign(new Error(newest.reason), { code: "signer-changed", remedy: "omakit upgrade: a newer omakit carries the new key once it is verified" }))
        plan = planSetup({ newest, from, plugins: parsed.options.has("--plugins"), repoRoot: ROOT })
      }
    } catch (error) {
      spinner.done()
      failFrom(error)
    }
    // The plan is narrated before the question, so the record says what
    // was agreed to; a plan that cannot run is the failure, on stderr.
    if (plan.blockers.length) {
      refuse(args, plan, (colour) => renderSetupPlan(plan, { colour }), { code: "lab-blocked", message: `setup cannot start: ${plan.blockers.map((item) => item.what).join("; ")} missing` })
      return
    }
    if (!plan.steps.length) return succeed(args, plan, (colour) => renderSetupPlan(plan, { colour }))
    // A pipe without --yes is known to refuse before the plan is shown, so
    // the plan is the refusal's text, on stderr, with the document; only a
    // terminal sees the plan first and is then asked.
    let consented = parsed.options.has("--yes")
    if (!consented && !interactive) {
      conclude({ command: CONTEXT.command, args, exit: 2, document: plan, human: (colour) => renderSetupPlan(plan, { colour }), error: failure({ code: "not-confirmed", message: "not confirmed: a pipe, an agent or --json cannot answer for the person whose disk this is; nothing was fetched, nothing was built", remedy: "omakit lab setup --yes" }) })
      return
    }
    narrate.write(`${withOutputStream(narrate, () => renderSetupPlan(plan, { colour: colourEnabled(narrate) }))}\n`)
    if (!consented) {
      narrate.write("\n")
      consented = await askYes({ question: CONSENT_QUESTION })
      if (!consented) failFrom(Object.assign(new Error("not confirmed; nothing was fetched, nothing was built"), { code: "not-confirmed", remedy: "omakit lab setup --yes" }))
    }
    narrate.write("\n")
    listen()
    let result
    let lastProgress = 0
    try {
      result = await setupLab({
        plan,
        consented,
        repoRoot: ROOT,
        signal: controller.signal,
        onPhase: spinner.phase,
        onLine: (line) => { spinner.done(); say(line) },
        onProgress: (read, total) => {
          const now = Date.now()
          if (now - lastProgress < 1000) return
          lastProgress = now
          spinner.phase(`${read.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} B (${((read / total) * 100).toFixed(1)}%)`)
        },
      })
    } catch (error) {
      spinner.done()
      failFrom(stopped(error))
    } finally {
      unlisten()
    }
    spinner.done()
    succeed(args, result, (colour) => renderSetupResult(result, { colour }))
    return
  }

  // prune
  if (suite) fail("usage", `prune takes no suite, so ${JSON.stringify(suite)} is one argument more than it takes.`, 2, signature)
  let plan
  try {
    plan = await planPrune({ keepIso: parsed.options.has("--keep-iso"), runs: parsed.options.has("--records") })
  } catch (error) {
    failFrom(error)
  }
  if (plan.blockers.length) {
    refuse(args, plan, (colour) => renderPrunePlan(plan, { colour }), { code: "lab-busy", message: `prune refuses while ${plan.blockers.join("; ")}` })
    return
  }
  // Nothing to remove is a result with a document, like every other outcome.
  if (!plan.targets.length) return succeed(args, { targets: [], total: 0, remaining: plan.remaining }, (colour) => renderPrunePlan(plan, { colour }))
  let consented = parsed.options.has("--yes")
  if (!consented && !interactive) {
    conclude({ command: CONTEXT.command, args, exit: 2, document: plan, human: (colour) => renderPrunePlan(plan, { colour }), error: failure({ code: "not-confirmed", message: `not confirmed: ${plan.targets.length} target${plan.targets.length === 1 ? "" : "s"}, ${plan.total.toLocaleString("en-US")} B, and a pipe cannot answer for the person whose disk this is; nothing was removed`, remedy: "omakit lab prune --yes" }) })
    return
  }
  narrate.write(`${withOutputStream(narrate, () => renderPrunePlan(plan, { colour: colourEnabled(narrate) }))}\n`)
  if (!consented) {
    narrate.write("\n")
    consented = await askYes({ question: `Remove these ${plan.targets.length} lab-owned target${plan.targets.length === 1 ? "" : "s"}?` })
    if (!consented) failFrom(Object.assign(new Error("not confirmed; nothing was removed"), { code: "not-confirmed", remedy: "omakit lab prune --yes" }))
  }
  let result
  try {
    result = prune(plan)
  } catch (error) {
    failFrom(error)
  }
  narrate.write("\n")
  succeed(args, { removed: result.removed, recovered: result.recovered, remaining: result.remaining }, (colour) => renderPruneResult(result, { colour }))
}

const VERSION = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version

const [command, ...rest] = process.argv.slice(2)
CONTEXT.command = command === "lab" && ["prove", "inspect", "setup", "prune"].includes(rest.find((arg) => !arg.startsWith("-"))) ? `lab ${rest.find((arg) => !arg.startsWith("-"))}` : command || null
CONTEXT.args = rest

// A reader that closes early (`omakit audit --json | head`) is not an
// error worth a trace: the write fails with EPIPE and the command is over,
// with whatever exit code it had decided on.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error) => {
    if (error?.code === "EPIPE") process.exit(process.exitCode ?? 0)
    throw error
  })
}

try {
// Every token checked against the command's table before anything runs
// (options.mjs): an option the command does not know, an option without its
// value, an empty argument, a valued option given twice, or one positional
// too many is a usage error naming the token and the accepted list. `weigh`
// reports it in its own register, below.
{
  const name = command === "marketplace-pin" ? "pin" : command
  const table = name === "weigh" ? null : ACCEPTED[name] || ((command === "--help" || command === "-h") ? ACCEPTED.pin : null)
  if (table) {
    const parsed = checkArgs(rest, table)
    if (parsed.offending !== null) {
      const accepted = acceptedWords(name)
      fail("usage", `${parsed.reason}.${accepted ? ` Accepted: ${accepted}.` : ` \`omakit ${name}\` takes no options.`}`, 2, "omakit help", () => [], {}, name === "audit" ? notAuditedRegister : null)
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
  let pinned
  try {
    pinned = ensurePin(ROOT, (line) => {
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
  succeed(rest, { dir: pinned.dir, commit: pinned.identity.commit, fetched: pinned.fetched })
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
} else if (command === "lab") {
  await cmdLab(rest)
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
  process.exitCode = 0
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
  throw new Exit(2)
}
} catch (error) {
  if (error instanceof Exit) await leave(error.exit)
  throw error
}
