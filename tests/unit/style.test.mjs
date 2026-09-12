// Colour is for people, not for the agent reading piped output.
import test from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { colourEnabled, styler, plain } from "../../tools/marketplace/style.mjs"
import { REPO_ROOT } from "./helpers.mjs"
import { renderSubmit, renderWatch } from "../../tools/marketplace/report.mjs"

const SKIP = new Set([".git", ".cache", "node_modules"])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (entry.name.endsWith(".mjs")) out.push(path)
  }
  return out
}

test("colour follows the terminal, NO_COLOR and FORCE_COLOR", () => {
  assert.equal(colourEnabled({ isTTY: true }, {}), true)
  assert.equal(colourEnabled({ isTTY: false }, {}), false)
  assert.equal(colourEnabled({ isTTY: true }, { NO_COLOR: "1" }), false)
  assert.equal(colourEnabled({ isTTY: true }, { TERM: "dumb" }), false)
  assert.equal(colourEnabled({ isTTY: false }, { FORCE_COLOR: "1" }), true)
  assert.equal(colourEnabled({ isTTY: false }, { FORCE_COLOR: "0" }), false)
})

test("a disabled styler is the identity function", () => {
  const off = styler(false)
  assert.equal(off("red.bold", "text"), "text")
  const on = styler(true)
  assert.equal(on("red.bold", "text"), "[31;1mtext[0m")
  assert.equal(on("nonsense", "text"), "text")
  assert.equal(plain(on("green", "text")), "text")
})

// The words are the contract; colour must never change them.
const result = {
  subject: { repository: "https://github.com/example/p", directory: "/tmp/p", commit: "a".repeat(40), cleanTree: true },
  pin: { commit: "b".repeat(40), baselineVersion: "3", enforcementMode: "selective" },
  pinnedCommit: { local: "a".repeat(40), defaultBranchHead: null, branch: null, matches: null, note: "n" },
  checks: [
    { id: "one", source: "marketplace-pin", severity: "blocking", verdict: "pass", detail: "fine", paths: [], remedy: null, why: "because 1" },
    { id: "two", source: "omakit", severity: "blocking", verdict: "fail", detail: "broken", paths: ["a/b: reason"], remedy: "fix it", why: "because 2" },
  ],
  ready: false,
  blocking: ["two"],
  advisory: [],
  issue: null,
  baseline: { invoked: false, skipReason: "none", statement: "s" },
  afterSubmitting: "edit the issue body",
}

const watch = {
  read: { issue: "https://github.com/o/r/issues/1", state: "open", title: "t", author: "a", labels: ["x"], comments: 1, authorComments: 1, maintainerComments: 0 },
  plugin: { repository: "https://github.com/o/p", repositoryError: null },
  validated: { commit: "c".repeat(40), outcome: "passed", findings: [], capabilities: [], checkedAt: "2026-09-01T00:00:00Z" },
  validationCommentFallback: null,
  head: { commit: "d".repeat(40), branch: "main", source: "api", committedAt: "2026-09-02T00:00:00Z" },
  headError: null,
  verdict: { state: "stale", summary: "it is stale", action: "edit the issue body" },
}

test("the coloured and uncoloured renderings say exactly the same thing", () => {
  for (const [render, input] of [[renderSubmit, result], [renderWatch, watch]]) {
    const off = render(input, { colour: false })
    const on = render(input, { colour: true })
    assert.notEqual(on, off, "colour should actually be applied")
    assert.equal(plain(on), off, "stripping colour must give the uncoloured rendering back")
    assert.match(off, //.test(off) ? /$^/ : /./, "the uncoloured rendering carries no escapes")
    assert.equal(//.test(off), false)
  }
})

test("a failing check and a stale pin are marked, not merely printed", () => {
  const on = renderSubmit(result, { colour: true })
  assert.match(on, /\[31;1mFAIL/)
  assert.match(on, /\[32mok/)
  assert.match(renderWatch(watch, { colour: true }), /\[31;1mPIN STALE/)
})

test("nothing anywhere pins an actual colour", () => {
  // The Omarchy theme sets the terminal palette, so every colour this tool emits
  // is an ANSI palette index and the theme decides what it looks like. A
  // truecolor or 256-colour escape would look identical on every theme, which
  // means looking wrong on most of them.
  for (const path of walk(REPO_ROOT)) {
    const text = readFileSync(path, "utf8")
    assert.doesNotMatch(text, /\[38;[25];|\\u001b\[38;[25];|\[38;[25];/, `${path} uses a truecolor or 256-colour escape`)
    assert.doesNotMatch(text, /\\u001b\[48;|\[48;/, `${path} sets a background colour`)
  }
})

test("no sentence is dimmed anywhere in the tool", () => {
  // Omarchy ships deliberately low-contrast themes. On Matte Black, grey text
  // on near-black is a line the reader's eye slides off, so the rule in
  // style.mjs is that grey carries punctuation and labels and never prose. A
  // sentence is taken to be a literal of four words or more ending in a full
  // stop; the `--- section ---` separators are framing, not prose, and pass.
  const sources = walk(join(REPO_ROOT, "tools"))
  assert.ok(sources.length >= 10)
  for (const path of sources) {
    const text = readFileSync(path, "utf8")
    for (const match of text.matchAll(/c\("(?:grey|dim)[^"]*",\s*(`[^`]*`|"[^"]*")/g)) {
      const literal = match[1].slice(1, -1)
      const words = literal.trim().split(/\s+/).length
      assert.ok(!(words >= 4 && /\.$/.test(literal.trim())),
        `${path} dims a sentence: ${literal}`)
    }
  }
})
