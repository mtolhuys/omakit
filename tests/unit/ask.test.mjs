// The two questions submit asks a person at a terminal, driven with a
// scripted stdin: a PassThrough with isTTY set, the way a pty would look to
// the tool, and no pty. Measured before this existed: an unlisted plugin with
// no --category and no --tags got exit 2 from a person who could have been
// asked, and a listed plugin was asked for a choice that did not matter.
import test from "node:test"
import assert from "node:assert/strict"
import { PassThrough } from "node:stream"
import { askChoices } from "../../tools/marketplace/ask.mjs"
import { submissionContract } from "../../tools/marketplace/form.mjs"
import { plain } from "../../tools/marketplace/style.mjs"
import { requirePinForTests } from "./helpers.mjs"

const pinDir = requirePinForTests()
const contract = await submissionContract({ pinDir })
const ESCAPE = /\u001b/

/** A terminal on both ends, scripted: the answers are typed before the questions are asked. */
function terminal(answers) {
  const input = new PassThrough()
  input.isTTY = true
  const written = []
  const output = { isTTY: true, write: (text) => { written.push(text); return true } }
  for (const answer of answers) input.write(`${answer}\n`)
  input.end()
  return { input, output, text: () => written.join("") }
}

const defaults = { category: "Widgets", tags: ["bar", "quickshell", "bar-widget"] }

test("Enter takes the marketplace's own default; a number picks; the answers are the form's labels", async () => {
  const tty = terminal(["", ""])
  const answers = await askChoices({ contract, defaults, missing: ["--category", "--tags"], ...tty, colour: false })
  assert.deepEqual(answers, { category: "Widgets", tags: ["Bar", "Quickshell"] })
  const text = tty.text()
  const flat = text.replace(/\n\s*/g, " ")
  assert.match(flat, /category: one of the form's 9; the marketplace's own choice for this manifest's kinds is Widgets/)
  assert.match(text, /^\s+8  Widgets$/m)
  assert.match(text, /category \[8\]: /)
  assert.match(flat, /tags: 1 to 3 of the form's 14, comma-separated; the marketplace's own choice for this manifest's kinds is Bar, Quickshell/)
  assert.match(text, /tags \[2,10\]: /)
  assert.ok(!text.includes("bar-widget"), "a kind that is not on the form's list is not offered")
  assert.ok(!ESCAPE.test(text), "no escapes without colour")

  const numbered = terminal(["3", "9, 1"])
  assert.deepEqual(await askChoices({ contract, defaults, missing: ["--category", "--tags"], ...numbered, colour: false }), { category: "Developer Tools", tags: ["Power management", "AI"] })

  const named = terminal(["widgets", "Bar"])
  assert.deepEqual(await askChoices({ contract, defaults, missing: ["--category", "--tags"], ...named, colour: false }), { category: "Widgets", tags: ["Bar"] })
})

test("an invalid answer is asked again with the reason; no default means Enter is asked again too", async () => {
  const tty = terminal(["x", "42", "2", "1,2,3,4", "0", "2,2,10"])
  const answers = await askChoices({ contract, defaults: { category: null, tags: null }, missing: ["--category", "--tags"], ...tty, colour: false })
  assert.deepEqual(answers, { category: "Desktop", tags: ["Bar", "Quickshell"] })
  const text = tty.text()
  assert.match(text, /"x" is not a number from 1 to 9, nor one of the names\./)
  assert.match(text, /"42" is not a number from 1 to 9/)
  assert.match(text, /the form takes 1 to 3 tags, got 4\./)
  assert.match(text, /"0" is not a number from 1 to 14/)
  assert.equal((text.match(/category: one of/g) || []).length, 1, "the list is shown once")
  assert.equal((text.match(/^\S category: /gm) || []).length, 3, "asked three times")
  assert.equal((text.match(/^\S tags: /gm) || []).length, 3)
  assert.ok(!text.includes("["), "no default is offered when the manifest gives none")

  const empty = terminal(["", "7"])
  await askChoices({ contract, defaults: { category: null, tags: null }, missing: ["--category"], ...empty, colour: false })
  assert.match(empty.text(), /There is no default for this manifest; answer with a number from 1 to 9\./)
})

test("only what is missing is asked, and colour changes no word", async () => {
  const tags = terminal(["5"])
  assert.deepEqual(await askChoices({ contract, defaults, missing: ["--tags"], ...tags, colour: false }), { tags: ["Hyprland"] })
  assert.ok(!tags.text().includes("category"))

  const lit = terminal(["", ""])
  await askChoices({ contract, defaults, missing: ["--category", "--tags"], ...lit, colour: true })
  const dark = terminal(["", ""])
  await askChoices({ contract, defaults, missing: ["--category", "--tags"], ...dark, colour: false })
  assert.ok(ESCAPE.test(lit.text()), "colour was applied")
  assert.equal(plain(lit.text()), dark.text())
})
