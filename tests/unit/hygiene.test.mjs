// Clean by construction, and checked.
//
// The archive this tool was harvested from recorded a defect worth carrying
// forward (D-25): a 352 KB demo GIF was committed under a directory named after
// an AI assistant because the hygiene check's candidate set had been filtered to
// source extensions, so nothing noticed. Two lessons, both enforced here. Every
// file is a candidate, not just the ones that look like source. And no path in
// this repository is named after anybody's tooling: a contributor who does not
// use the same assistant should not find its name in the tree or in .gitignore.
import test from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { REPO_ROOT } from "./helpers.mjs"

const SKIP = new Set([".git", ".cache", "node_modules"])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else out.push(relative(REPO_ROOT, path))
  }
  return out
}

const files = walk(REPO_ROOT)

// Assistant and editor names, plus scratch-path shapes. Kept as a list so it is
// obvious what is banned and why; the point is vendor neutrality, not a blocklist
// of products.
const VENDOR = /(?:^|[/\s._-])(?:claude|chatgpt|openai|copilot|cursor|codex|gemini|anthropic)(?:[/\s._-]|$)/i
const SCRATCH = /(?:^|\/)(?:outputs?|scratch|tmp|temp|untitled|new folder)(?:\/|$)/i

test("no path is named after anybody's tooling", () => {
  for (const path of files) {
    // The agent-control check must still be able to name the files it looks for,
    // and this repository's own agent entry point is a deliverable.
    if (path === "AGENTS.md" || path.startsWith("skills/")) continue
    assert.ok(!VENDOR.test(path), `${path} carries a vendor or assistant name`)
  }
})

test("no path contains a space or a scratch-shaped segment", () => {
  for (const path of files) {
    assert.ok(!/\s/.test(path), `${path} contains a space`)
    assert.ok(!SCRATCH.test(path), `${path} looks like scratch or export output`)
  }
})

test("no vendor name is baked into .gitignore either", () => {
  const ignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8")
  for (const line of ignore.split("\n")) {
    const rule = line.trim()
    if (!rule || rule.startsWith("#")) continue
    assert.ok(!VENDOR.test(rule), `.gitignore rule "${rule}" is named after a vendor`)
    assert.ok(!/\s/.test(rule), `.gitignore rule "${rule}" contains a space`)
  }
})

test("no binary assets are tracked", () => {
  for (const path of files) {
    assert.ok(
      !/\.(?:gif|png|jpe?g|webp|mp4|mov|zip|tar|gz|pdf|so|node|wasm)$/i.test(path),
      `${path} is a binary asset`,
    )
  }
})

test("every file is a candidate, whatever its extension", () => {
  assert.ok(files.some((path) => !/\.[a-z]+$/.test(path)), "extensionless files must be walked too")
  assert.ok(files.includes("bin/omakit"))
  assert.ok(files.includes("LICENSE"))
})

test("committed evidence publishes no findings about a named third-party plugin", () => {
  // Constraint, not taste: this repository reads other people's plugins, and a
  // per-plugin finding list would turn a parity proof into a published audit of
  // somebody else's code. Equality is evidenced by digests instead.
  const evidence = files.filter((path) => path.startsWith("docs/evidence/") && path.endsWith(".json"))
  assert.ok(evidence.length > 0, "there should be committed evidence")
  for (const path of evidence) {
    const text = readFileSync(join(REPO_ROOT, path), "utf8")
    const document = JSON.parse(text)
    for (const row of document.rows || []) {
      for (const key of ["findings", "capabilities", "localFindingsFull", "localCapabilitiesFull", "githubFindings", "githubCapabilities"]) {
        assert.equal(row[key], undefined, `${path} attaches ${key} to ${row.repo}`)
      }
    }
    // Source snippets and line-level links name a file inside somebody's plugin.
    for (const marker of ['"snippet"', "/blob/", '"line"']) {
      const offending = text.split("\n").filter((line) => line.includes(marker) && !line.includes('"reason"'))
      assert.deepEqual(offending, [], `${path} contains ${marker}`)
    }
  }
})
