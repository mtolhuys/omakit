// The YAML subset reader must read the pinned issue form exactly, and must fail
// loudly on anything outside its subset rather than guess.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parseYaml, parseScalar, YamlError } from "../../tools/marketplace/yaml.mjs"
import { SUBMIT_FORM_PATH } from "../../tools/marketplace/form.mjs"
import { requirePinForTests } from "./helpers.mjs"

test("scalars keep the characters that matter", () => {
  assert.equal(parseScalar('"[Plugin]: "'), "[Plugin]: ")
  assert.equal(parseScalar("  plain text  "), "plain text")
  assert.equal(parseScalar("true"), true)
  assert.equal(parseScalar("3"), 3)
  assert.equal(parseScalar("'it''s'"), "it's")
  assert.equal(parseScalar("https://github.com/a/b"), "https://github.com/a/b")
})

test("block maps, sequences and literal blocks", () => {
  const value = parseYaml([
    "name: Example",
    "labels:",
    "  - one",
    "  - two",
    "body:",
    "  - type: markdown",
    "    attributes:",
    "      value: |",
    "        first line",
    "        second line",
    "  - type: dropdown",
    "    attributes:",
    "      label: Category",
    "      options:",
    "        - A",
    "        - B",
    "    validations:",
    "      required: true",
  ].join("\n"))
  assert.equal(value.name, "Example")
  assert.deepEqual(value.labels, ["one", "two"])
  assert.equal(value.body.length, 2)
  assert.equal(value.body[0].attributes.value, "first line\nsecond line\n")
  assert.deepEqual(value.body[1].attributes.options, ["A", "B"])
  assert.equal(value.body[1].validations.required, true)
})

test("an unsupported construct is an error, never a guess", () => {
  assert.throws(() => parseYaml("a: 1\nb: {inline: map}\n- stray"), YamlError)
  assert.throws(() => parseYaml("a: 1\na: 2"), /duplicate key/)
})

test("the pinned submission form reads as the six-field contract", () => {
  const pinDir = requirePinForTests()
  const form = parseYaml(readFileSync(join(pinDir, SUBMIT_FORM_PATH), "utf8"))
  assert.equal(typeof form.title, "string")
  assert.ok(form.title.startsWith("[Plugin]:"))
  const fields = form.body.filter((item) => item.type !== "markdown")
  assert.deepEqual(fields.map((field) => field.attributes.label), [
    "Repository URL",
    "Category",
    "Tags",
    "Suggest a missing tag",
    "Maintainer notes",
    "Submission checklist",
  ])
})
