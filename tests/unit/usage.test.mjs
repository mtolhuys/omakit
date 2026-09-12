// The help text is data, so it can be coloured without pattern-matching prose,
// and so a terminal and a pipe get the same words.
import test from "node:test"
import assert from "node:assert/strict"
import { renderSummary, renderUsage, AUTHENTICATION, COMMANDS, ENVIRONMENT, TAGLINE, paintSignature } from "../../tools/marketplace/usage.mjs"
import { paintProse, plain, styler } from "../../tools/marketplace/style.mjs"

test("colour changes nothing about the words", () => {
  const off = renderUsage({ colour: false })
  const on = renderUsage({ colour: true })
  assert.notEqual(on, off)
  assert.equal(plain(on), off)
  assert.equal(/\u001b/.test(off), false)
})

test("every command is listed, with its own description", () => {
  const off = renderUsage({ colour: false })
  assert.ok(off.startsWith(`omakit: ${TAGLINE}`))
  for (const command of COMMANDS) {
    for (const line of [].concat(command.signature)) assert.ok(off.includes(line), `missing: ${line}`)
    for (const line of command.lines) assert.ok(off.includes(line), `missing: ${line}`)
  }
  for (const [name, description] of ENVIRONMENT) {
    assert.ok(off.includes(name), `missing: ${name}`)
    assert.ok(off.includes(description.replace(/`/g, "")), `missing: ${description}`)
  }
})

test("what a person has to set up is answered before the variables are listed", () => {
  // The measured complaint this fixes: a bare list of two environment variables
  // under the heading "Environment" reads as two things you must configure. The
  // answer is that you configure neither: a `gh` login is enough, and most of
  // this audience already has one.
  const off = renderUsage({ colour: false })
  const access = off.indexOf("GitHub access:")
  const environment = off.indexOf("Environment:")
  assert.ok(access > 0 && environment > access, "the sentence comes before the list")
  assert.ok(AUTHENTICATION.join(" ").includes("`gh` login"), "it names the thing they already have")
  assert.ok(AUTHENTICATION.join(" ").includes("optional"), "and says it is optional")
})

test("prose keeps the terminal's foreground; only what you could type is tinted", () => {
  // Grey prose on a low-contrast theme is a sentence nobody reads. Backticks are
  // markup for a reader of the source, so they do not reach the terminal.
  const painted = paintProse("uses your `gh` login", (name, text) => `<${name}>${text}</${name}>`)
  assert.equal(painted, "<default>uses your </default><cyan>gh</cyan><default> login</default>")
  const off = renderUsage({ colour: false })
  assert.ok(!off.includes("`"), "no backtick survives into the output")
  const on = renderUsage({ colour: true })
  for (const line of on.split("\n")) {
    if (!line.includes("Read-only, and optional")) continue
    assert.match(line, /\u001b\[39m/, "the sentence is drawn in the terminal's own foreground")
    assert.doesNotMatch(line, /\u001b\[90m|\u001b\[2m/, "and never dimmed")
  }
})

test("a signature is coloured by token: typed cyan, replaceable yellow", () => {
  const c = styler(true)
  const painted = paintSignature("omakit submit <target> --category <c> [--json]", c)
  assert.match(painted, /\u001b\[36;1momakit\u001b\[0m/, "the command name")
  assert.match(painted, /\u001b\[33m<target>\u001b\[0m/, "a placeholder")
  assert.match(painted, /\u001b\[36m--category\u001b\[0m/, "a flag")
  assert.match(painted, /\u001b\[90m\[\u001b\[0m/, "grouping brackets stay out of the way")
  assert.equal(plain(painted), "omakit submit <target> --category <c> [--json]")
})

test("the usage carries no pinned colour", () => {
  assert.doesNotMatch(renderUsage({ colour: true }), /38;[25];|48;/)
})

test("the front door fits on a screen, and names every command once", () => {
  // The measured reason for a second, shorter rendering: the reference is over
  // 50 lines and a wordmark is 7 more, so a bare `omakit` used to print a
  // banner that the rest of the output scrolled off the top of the screen
  // before anyone could read it.
  const summary = renderSummary({ colour: false })
  const lines = summary.split("\n").length
  assert.ok(lines <= 20, `the front door is ${lines} lines; it has to fit`)
  assert.ok(renderUsage({ colour: false }).split("\n").length > lines * 2)
  for (const command of COMMANDS) {
    const first = [].concat(command.signature)[0]
    assert.ok(summary.includes(first), `missing: ${first}`)
    // Only the signature: the descriptions are what `omakit help` is for.
    assert.ok(!summary.includes(command.lines[0]), `${first} brought its description along`)
  }
  // And it says where the rest is.
  assert.match(summary, /omakit help/)
  assert.equal(plain(renderSummary({ colour: true })), summary)
})
