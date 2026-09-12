// The rendered issue must be accepted by the marketplace's own parser, and the
// measured one-word failure class must be reproducible on demand.
import test from "node:test"
import assert from "node:assert/strict"
import { submissionContract } from "../../tools/marketplace/form.mjs"
import { renderIssue, verifyAgainstOfficialParser, NO_RESPONSE, IssueRenderError } from "../../tools/marketplace/issue.mjs"
import { requirePinForTests } from "./helpers.mjs"

const contract = await submissionContract({ pinDir: requirePinForTests() })

const input = {
  pluginName: "Fixture Good",
  repositoryUrl: "https://github.com/example/omarchy-plugin-fixture-good",
  category: "Widgets",
  tags: ["Bar", "Quickshell"],
  notes: "No privileges needed.",
}

test("the marketplace's own parser accepts the rendered issue", () => {
  const issue = renderIssue(contract, input)
  assert.equal(issue.title, "[Plugin]: Fixture Good")
  const parsed = verifyAgainstOfficialParser(contract, issue)
  assert.ok(parsed.ok, JSON.stringify(parsed))
  assert.equal(parsed.submission.repo, input.repositoryUrl)
  assert.equal(parsed.submission.category, "Widgets")
  assert.deepEqual(parsed.submission.tags, ["bar", "quickshell"])
})

test("the six headings are rendered in the form's order and nothing else is", () => {
  const { body } = renderIssue(contract, input)
  const headings = [...body.matchAll(/^### (.+)$/gm)].map((match) => match[1])
  assert.deepEqual(headings, contract.headings)
})

test("all five checklist items carry the form's exact text and are checked", () => {
  const { body } = renderIssue(contract, input)
  for (const item of contract.checklist) {
    assert.ok(body.includes(`- [X] ${item.label}`), `missing: ${item.label}`)
  }
})

test("an empty optional field renders the way GitHub renders it", () => {
  const { body } = renderIssue(contract, { ...input, notes: "", suggestedTag: "" })
  assert.ok(body.includes(`### Suggest a missing tag\n\n${NO_RESPONSE}`))
  assert.ok(body.includes(`### Maintainer notes\n\n${NO_RESPONSE}`))
  assert.ok(verifyAgainstOfficialParser(contract, renderIssue(contract, { ...input, notes: "" })).ok)
})

test("a title without the plugin name is refused before anything is rendered", () => {
  assert.throws(() => renderIssue(contract, { ...input, pluginName: "  " }), IssueRenderError)
})

test("the measured failure classes are reproduced by the official parser", () => {
  const issue = renderIssue(contract, input)

  // 39 submissions fell out on the title prefix alone.
  const noPrefix = verifyAgainstOfficialParser(contract, { title: "Fixture Good", body: issue.body })
  assert.equal(noPrefix.ok, false)
  assert.equal(noPrefix.code, "submission-title-invalid")

  // One open submission differs from a valid one by the single word "Suggested".
  const oneWord = verifyAgainstOfficialParser(contract, {
    title: issue.title,
    body: issue.body.replace("### Suggest a missing tag", "### Suggested a missing tag"),
  })
  assert.equal(oneWord.ok, false)

  // An unchecked checklist item.
  const unchecked = verifyAgainstOfficialParser(contract, {
    title: issue.title,
    body: issue.body.replace(`- [X] ${contract.checklist[0].label}`, `- [ ] ${contract.checklist[0].label}`),
  })
  assert.equal(unchecked.ok, false)
  assert.equal(unchecked.code, "submission-checklist-unconfirmed")

  // A category that is not on the form's list.
  const badCategory = verifyAgainstOfficialParser(contract, {
    title: issue.title,
    body: issue.body.replace("### Category\n\nWidgets", "### Category\n\nInvented"),
  })
  assert.equal(badCategory.ok, false)
  assert.equal(badCategory.code, "submission-category-invalid")
})
