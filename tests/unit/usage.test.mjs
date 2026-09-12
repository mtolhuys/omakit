// The help text is data, so it can be coloured without pattern-matching prose,
// and so a terminal and a pipe get the same words.
import test from "node:test"
import assert from "node:assert/strict"
import { renderUsage, COMMANDS, ENVIRONMENT, TAGLINE, paintSignature } from "../../tools/marketplace/usage.mjs"
import { plain, styler } from "../../tools/marketplace/style.mjs"

test("colour changes nothing about the words", () => {
  const off = renderUsage({ colour: false })
  const on = renderUsage({ colour: true })
  assert.notEqual(on, off)
  assert.equal(plain(on), off)
  assert.equal(//.test(off), false)
})

test("every command is listed, with its own description", () => {
  const off = renderUsage({ colour: false })
  assert.ok(off.startsWith(`omakit: ${TAGLINE}`))
  for (const command of COMMANDS) {
    for (const line of [].concat(command.signature)) assert.ok(off.includes(line), `missing: ${line}`)
    for (const line of command.lines) assert.ok(off.includes(line), `missing: ${line}`)
  }
  for (const [name, description] of ENVIRONMENT) {
    assert.ok(off.includes(name) && off.includes(description))
  }
})

test("a signature is coloured by token: typed cyan, replaceable yellow", () => {
  const c = styler(true)
  const painted = paintSignature("omakit submit <target> --category <c> [--json]", c)
  assert.match(painted, /\[36;1momakit\[0m/, "the command name")
  assert.match(painted, /\[33m<target>\[0m/, "a placeholder")
  assert.match(painted, /\[36m--category\[0m/, "a flag")
  assert.match(painted, /\[90m\[\[0m/, "grouping brackets stay out of the way")
  assert.equal(plain(painted), "omakit submit <target> --category <c> [--json]")
})

test("the usage carries no pinned colour", () => {
  assert.doesNotMatch(renderUsage({ colour: true }), /38;[25];|48;/)
})
