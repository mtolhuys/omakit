// The submission contract and the id universe must come from the pin, and a pin
// that disagrees with itself must be refused rather than half-used.
import test from "node:test"
import assert from "node:assert/strict"
import { submissionContract, assertContractAgrees, resolveCategory, resolveTags, tagSlug, ContractError } from "../../tools/marketplace/form.mjs"
import { idUniverse, checkIdentity, reservedNamespace } from "../../tools/marketplace/registry.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

const pinDir = requirePinForTests()
const contract = await submissionContract({ pinDir })

test("the contract is the form's, in the form's order", () => {
  assert.equal(contract.titleTemplate, "[Plugin]: ")
  assert.deepEqual(contract.headings, [
    "Repository URL",
    "Category",
    "Tags",
    "Suggest a missing tag",
    "Maintainer notes",
    "Submission checklist",
  ])
  assert.equal(contract.checklist.length, 5)
  assert.ok(contract.checklist.every((item) => item.required))
  assert.equal(contract.maximumTags, 3)
})

test("the form agrees with the marketplace's own constants", () => {
  assert.deepEqual(contract.categories, contract.official.allowedCategories)
  assert.deepEqual(contract.checklist.map((item) => item.label), contract.official.checklist)
  for (const label of contract.tagLabels) {
    assert.ok(contract.official.allowedTags.includes(tagSlug(label)), `${label} does not map onto allowedTags`)
  }
})

test("a divergent pin is refused, not half-used", () => {
  for (const mutate of [
    (draft) => { draft.titleTemplate = "[Extension]: "; draft.titlePrefix = "[Extension]:" },
    (draft) => { draft.categories = [...draft.categories, "Invented"] },
    (draft) => { draft.tagLabels = [...draft.tagLabels, "Invented tag"] },
    (draft) => { draft.checklist = draft.checklist.slice(1) },
    (draft) => { draft.maximumTags = 0 },
  ]) {
    const draft = structuredClone({
      titleTemplate: contract.titleTemplate,
      titlePrefix: contract.titlePrefix,
      categories: contract.categories,
      tagLabels: contract.tagLabels,
      checklist: contract.checklist,
      maximumTags: contract.maximumTags,
      official: contract.official,
    })
    mutate(draft)
    assert.throws(() => assertContractAgrees(draft), ContractError)
  }
})

test("categories and tags resolve to what the form would write", () => {
  assert.deepEqual(resolveCategory(contract, "widgets"), { ok: true, value: "Widgets" })
  assert.equal(resolveCategory(contract, "Nonsense").ok, false)
  assert.equal(resolveCategory(contract, "").ok, false)
  assert.deepEqual(resolveTags(contract, "bar, power-management").value, ["Bar", "Power management"])
  assert.deepEqual(resolveTags(contract, ["Bar", "bar"]).value, ["Bar"])
  assert.equal(resolveTags(contract, "bar,system,media,ai").ok, false)
  assert.equal(resolveTags(contract, "").ok, false)
  assert.deepEqual(resolveTags(contract, "nope").unknown, ["nope"])
})

test("the reserved namespace is read from the pin, not assumed", () => {
  assert.equal(reservedNamespace(pinDir), "omarchy.")
})

test("the id universe refuses listed, retired and reserved ids", () => {
  const universe = idUniverse({ pinDir })
  assert.ok(universe.counts.listedIds > 1000, "the pinned catalog should list thousands of plugins")
  assert.ok(universe.counts.retiredIds > 0)

  const reserved = checkIdentity(universe, { id: `${universe.reservedPrefix}anything` })
  assert.ok(reserved.problems.some((problem) => problem.code === "reserved-plugin-id"))

  const retired = checkIdentity(universe, { id: [...universe.retiredIds][0] })
  assert.ok(retired.problems.some((problem) => problem.code === "plugin-id-retired"))

  const listed = checkIdentity(universe, { id: [...universe.listedIds][0] })
  assert.ok(listed.problems.some((problem) => problem.code === "plugin-id-listed"))

  const listedRepo = checkIdentity(universe, {
    id: "omakit-fixture.unused",
    repositoryUrl: `https://github.com/${[...universe.listedRepositories][0]}`,
  })
  assert.ok(listedRepo.problems.some((problem) => problem.code === "submission-repository-listed"))

  assert.deepEqual(checkIdentity(universe, { id: "omakit-fixture.unused", repositoryUrl: null }), { ok: true, problems: [] })
})

test("the contract is read relative to the repository root too", async () => {
  const viaRoot = await submissionContract({ repoRoot: REPO_ROOT })
  assert.deepEqual(viaRoot.headings, contract.headings)
})
