// The help text is data, so it can be coloured without pattern-matching prose,
// and so a terminal and a pipe get the same words.
import test from "node:test"
import assert from "node:assert/strict"
import { renderSummary, renderUsage, AUTHENTICATION, COMMANDS, TAGLINE, paintSignature } from "../../tools/marketplace/usage.mjs"
import { code, paintProse, plain, styler } from "../../tools/marketplace/style.mjs"

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
    for (const line of command.lines) assert.ok(off.includes(line.replace(/`/g, "")), `missing: ${line}`)
  }
})

test("what a person has to set up is answered in a sentence, and there is no variable to list", () => {
  // The measured complaint this fixes: a bare list of environment variables
  // under the heading "Environment" read as things you must configure. The
  // answer is that you configure nothing: a `gh` login is enough, most of this
  // audience already has one, and omakit reads no variable of its own, so the
  // list is gone rather than explained.
  const off = renderUsage({ colour: false })
  assert.ok(off.includes("GitHub access:"))
  assert.ok(!off.includes("Environment:"), "no environment section")
  assert.doesNotMatch(off, /\b(?:GITHUB_TOKEN|GH_TOKEN|OMAKIT_[A-Z_]+)\b/, "no variable named anywhere in the help")
  assert.ok(AUTHENTICATION.join(" ").includes("`gh` login"), "it names the thing they already have")
  assert.ok(AUTHENTICATION.join(" ").includes("optional"), "and says it is optional")
})

test("prose keeps the terminal's foreground; only what you could type is tinted", () => {
  // Grey prose on a low-contrast theme is a sentence nobody reads. Backticks are
  // markup for a reader of the source, so they do not reach the terminal.
  const painted = paintProse("uses your `gh` login", (name, text) => `<${name}>${text}</${name}>`)
  assert.equal(painted, "<prose>uses your </prose><typeable>gh</typeable><prose> login</prose>")
  const off = renderUsage({ colour: false })
  assert.ok(!off.includes("`"), "no backtick survives into the output")
  const on = renderUsage({ colour: true })
  for (const line of on.split("\n")) {
    if (!line.includes("Read-only, and optional")) continue
    assert.match(line, /\u001b\[39m/, "the sentence is drawn in the terminal's own foreground")
    assert.doesNotMatch(line, /\u001b\[90m|\u001b\[2m/, "and never dimmed")
  }
})

test("a signature is coloured by token: typeable, placeholder, punctuation", () => {
  const c = styler(true)
  const painted = paintSignature("omakit submit <target> --category <c> [--json]", c)
  const sgr = (role, text) => `\u001b[${code(role)}m${text}\u001b[0m`
  assert.ok(painted.includes(sgr("typeable.bold", "omakit")), "the command name")
  assert.ok(painted.includes(sgr("placeholder", "<target>")), "a placeholder")
  assert.ok(painted.includes(sgr("typeable", "--category")), "a flag")
  assert.ok(painted.includes(sgr("punctuation", "[")), "grouping brackets stay out of the way")
  const choice = paintSignature("omakit completion bash|zsh|fish", c)
  assert.ok(choice.includes(`${sgr("typeable", "bash")}${sgr("punctuation", "|")}${sgr("typeable", "zsh")}`), "a choice is words you could type, grouped by bars")
  assert.equal(plain(choice), "omakit completion bash|zsh|fish")
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
