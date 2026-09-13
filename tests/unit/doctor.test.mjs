import test from "node:test"
import assert from "node:assert/strict"
import { pinFreshness } from "../../tools/marketplace/doctor.mjs"

const pinned = { commit: "1".repeat(40) }

test("freshness JSON carries both full commits without changing the human detail", () => {
  const head = { commit: "2".repeat(40), branch: "main" }
  const check = pinFreshness(pinned, head)

  assert.equal(check.state, "advice")
  assert.match(check.detail, /the pin is 1111111;.*main branch is now at 2222222/)
  assert.deepEqual(check.evidence, {
    pinCommit: "1".repeat(40),
    marketplaceHead: "2".repeat(40),
    branch: "main",
  })
  assert.doesNotMatch(check.detail, /1{40}|2{40}/)
})

test("a current pin is explicit machine evidence", () => {
  const check = pinFreshness(pinned, { commit: pinned.commit, branch: null })

  assert.equal(check.state, "ok")
  assert.equal(check.action, null)
  assert.deepEqual(check.evidence, {
    pinCommit: pinned.commit,
    marketplaceHead: pinned.commit,
    branch: "default",
  })
})
