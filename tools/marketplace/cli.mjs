#!/usr/bin/env node
// The single entry point.
//
//   omakit pin                       fetch or verify the pinned marketplace checkout
//   omakit submit <target> ...       everything knowable before submitting; prints, never posts
//   omakit watch <issue-url>         is this submission's review pin still current?
//   omakit verify <target>           the official baseline over the local transport, verbatim
//   omakit parity [--count n]        prove the local transport equals the GitHub transport
//
// Nothing here writes to the marketplace. There is no POST, PATCH, PUT or
// DELETE anywhere in this repository, and `tests/unit/read-only.test.mjs`
// proves it.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ensurePin, MARKETPLACE_PIN } from "./pin.mjs"
import { marketplaceBaselineSection } from "./verify.mjs"
import { resolveSubject, SubjectError } from "../subject/resolve.mjs"
import { submitPreflight } from "./submit.mjs"
import { pinWatch } from "./watch.mjs"
import { renderSubmit, renderWatch, renderDoctor } from "./report.mjs"
import { doctor } from "./doctor.mjs"
import { setup } from "./setup.mjs"
import { upgrade } from "./upgrade.mjs"
import { banner, bannerEnabled } from "./banner.mjs"
import { progress } from "./progress.mjs"
import { renderUsage, TAGLINE } from "./usage.mjs"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")


function fail(code, message, exit = 1) {
  process.stderr.write(`${code}: ${message}\n`)
  process.exit(exit)
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
    process.stdout.write(`ok - wrote ${resolve(out)}\n`)
  } else {
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`)
  }
}

async function cmdSubmit(args) {
  const target = positionals(args)[0]
  if (!target) fail("usage", "submit <target> --category <c> --tags <a,b>", 2)
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
    if (error?.code) fail(error.code, error.message, error.code === "usage" ? 2 : 1)
    throw error
  }
  spinner.done()
  emit(args, args.includes("--json") ? `${JSON.stringify(result, null, 2)}\n` : renderSubmit(result))
  process.exit(result.ready ? 0 : 1)
}

async function cmdWatch(args) {
  const issueUrl = positionals(args)[0]
  if (!issueUrl) fail("usage", "watch <issue-url>", 2)
  let result
  try {
    result = await pinWatch({ repoRoot: ROOT, issueUrl })
  } catch (error) {
    if (error?.code) fail(error.code, error.message, error.code === "usage" ? 2 : 1)
    throw error
  }
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
  // The scan runs here too. It is on a budget now (banner.mjs: BUDGET_MS), so
  // repeating it on a command people run repeatedly costs a fraction of a
  // second rather than the second and a half the first version took.
  if (!args.includes("--json")) await banner()
  const result = await doctor({ repoRoot: ROOT, offline: args.includes("--offline") })
  emit(args, args.includes("--json") ? `${JSON.stringify(result, null, 2)}\n` : renderDoctor(result))
  process.exit(result.problems ? 1 : 0)
}

async function cmdVerify(args) {
  const target = positionals(args)[0]
  if (!target) fail("usage", "verify <path | https-url@sha>", 2)
  let subject
  try {
    subject = resolveSubject(target, { cacheRoot: resolve(ROOT, ".cache"), allowDirty: args.includes("--allow-dirty") })
  } catch (error) {
    if (error instanceof SubjectError) fail(error.code, error.message, error.code === "usage" ? 2 : 1)
    throw error
  }
  let section
  try {
    section = await marketplaceBaselineSection({ repoRoot: ROOT, subject })
  } catch (error) {
    fail("marketplace-unavailable", error.message)
  }
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

const [command, ...rest] = process.argv.slice(2)
if (command === "setup") {
  await cmdSetup()
} else if (command === "pin" || command === "marketplace-pin") {
  try {
    ensurePin(ROOT, (line) => process.stdout.write(`${line}\n`))
  } catch (error) {
    fail("marketplace-unavailable", error.message)
  }
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
    // The scan, then the usage. It is short enough (banner.mjs: BUDGET_MS) that
    // the text is there by the time a reader's eyes have left the wordmark,
    // which is the whole reason the schedule is derived from a budget.
    // The banner already says the name and the tagline; printing the same
    // sentence again directly underneath is just noise.
    const drew = bannerEnabled()
    await banner({ tagline: TAGLINE })
    process.stdout.write(renderUsage({ heading: !drew }))
  }
} else {
  process.stderr.write(`unknown command: ${command}\n\n${renderUsage({ colour: false })}`)
  process.exit(2)
}
