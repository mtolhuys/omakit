// This repository's own agent and skill files live at the root of the tool and
// must never travel into a plugin tree.
//
// Two things are proven here. First, that no code path in this repository copies
// anything into a subject or plugin directory: there is no scaffolder, no
// vendoring, no template writer, so nothing can carry an instruction file along.
// Second, that if such a path were ever added, the agent-control check would
// catch this repository's own files immediately — the check is run over this
// repository's tree and must flag them.
import test from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { findAgentControl, AGENT_CONTROL_FILES } from "../../tools/marketplace/agent-control.mjs"
import { REPO_ROOT } from "./helpers.mjs"

const SKIP = new Set([".git", ".cache", "node_modules"])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else out.push(path)
  }
  return out
}

const files = walk(REPO_ROOT).map((path) => relative(REPO_ROOT, path))
const sources = files
  .filter((path) => /\.mjs$/.test(path) && !path.startsWith("tests/"))
  .map((path) => ({ path, text: readFileSync(join(REPO_ROOT, path), "utf8") }))

test("this repository does carry agent-control files, at its own root", () => {
  const own = files.filter((path) => AGENT_CONTROL_FILES.includes(path.split("/").at(-1)) || path.startsWith("skills/"))
  assert.ok(own.length > 0, "the agent-facing files are a deliverable; they should exist")
  for (const path of own) {
    const depth = path.split("/").length
    assert.ok(
      depth === 1 || path.startsWith("skills/"),
      `${path} is an agent-control file somewhere other than the root of the tool`,
    )
  }
})

test("the agent-control check flags this repository's own files", () => {
  const entries = files.map((path) => ({ path, mode: "100644", type: "blob" }))
  const hits = findAgentControl(entries).map((hit) => hit.path)
  assert.ok(hits.includes("AGENTS.md"), "the check must see this repository's own AGENTS.md")
  assert.ok(hits.some((path) => path.startsWith("skills/")), "the check must see this repository's own skills")
})

test("nothing in this repository writes into a plugin or subject tree", () => {
  for (const { path, text } of sources) {
    // No copying primitives at all: a tool that cannot copy cannot smuggle.
    for (const primitive of ["cpSync", "copyFileSync", "copyFile", "renameSync", "symlinkSync", "linkSync"]) {
      assert.ok(!new RegExp(`\\b${primitive}\\s*\\(`).test(text), `${path} uses ${primitive}`)
    }
    // Writes are allowed only to an explicit --out path or to docs/evidence.
    for (const match of text.matchAll(/writeFileSync\(\s*([^,]+),/g)) {
      const target = match[1]
      assert.ok(
        /resolve\(out\)|outFile|join\(out|evidence/.test(target),
        `${path} writes to ${target.trim()}, which is neither --out nor an evidence path`,
      )
    }
    // And never into the subject's own directory.
    assert.doesNotMatch(text, /writeFileSync\([^)]*subject\.dir/, `${path} writes into the subject directory`)
    assert.doesNotMatch(text, /mkdirSync\([^)]*subject\.dir/, `${path} creates directories in the subject`)
  }
})

test("the command surface is exactly the submission scope", () => {
  const cli = readFileSync(join(REPO_ROOT, "tools/marketplace/cli.mjs"), "utf8")
  const commands = [...cli.matchAll(/command === "(-{0,2}[a-z][a-z-]*)"/g)].map((match) => match[1])
  assert.deepEqual(
    new Set(commands),
    new Set(["pin", "marketplace-pin", "submit", "watch", "verify", "parity", "help", "--help", "-h"]),
  )
  for (const forbidden of ["scaffold", "new", "init", "vendor", "template", "generate", "install"]) {
    assert.ok(!commands.includes(forbidden), `the CLI offers a ${forbidden} command`)
  }
})

test("no lab or conformance scope came along with the harvest", () => {
  for (const path of files) {
    assert.ok(!/^tools\/lab\//.test(path), `${path} is out of scope`)
    assert.ok(!/^tests\/lab\//.test(path), `${path} is out of scope`)
  }
})

test("there is no build step and no runtime dependency", () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"))
  assert.equal(pkg.dependencies, undefined)
  assert.equal(pkg.devDependencies, undefined)
  assert.equal(pkg.scripts.build, undefined)
  assert.equal(pkg.type, "module")
  assert.ok(statSync(join(REPO_ROOT, "bin/omakit")).mode & 0o111, "bin/omakit must be executable")
  assert.ok(!files.includes("package-lock.json"))
})
