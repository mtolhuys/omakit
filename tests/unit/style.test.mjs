// Colour is for people, not for the agent reading piped output.
import test from "node:test"
import assert from "node:assert/strict"
import { colourEnabled, styler, plain } from "../../tools/marketplace/style.mjs"
import { renderSubmit, renderWatch } from "../../tools/marketplace/report.mjs"

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
