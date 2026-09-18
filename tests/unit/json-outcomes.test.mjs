// Under --json, every command's every outcome is a document on stdout,
// failures included: `{ command, ok: false, error: { code, message,
// remedy } }`, the message being the sentence a person reads on stderr.
// Measured on 2026-09-19 by a first user (docs/evidence/ux/2026-09-19-
// first-user-test.json, finding 10): four commands left stdout empty on a
// failure and a parser had nothing to read. The rule is stated once in
// docs/COMMANDS.md; this file holds it per command.
import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { REPO_ROOT } from "./helpers.mjs"

function omakit(args, env = {}) {
  const result = spawnSync(process.execPath, [join(REPO_ROOT, "bin/omakit"), ...args], { timeout: 120_000, encoding: "utf8", env: { ...process.env, TERM: "dumb", ...env } })
  return { status: result.status, out: result.stdout, err: result.stderr }
}

function failure(result, command, code) {
  const document = JSON.parse(result.out)
  assert.deepEqual(Object.keys(document), ["command", "ok", "error"])
  assert.equal(document.command, command)
  assert.equal(document.ok, false)
  assert.equal(document.error.code, code)
  assert.equal(typeof document.error.message, "string")
  // The first forty characters of the sentence are on stderr too, wrapped
  // or not: one sentence, two streams.
  // or not, and with the backticks the human rendering paints away.
  const plain = (text) => text.replace(/`/g, "").replace(/\s+/g, " ")
  const head = plain(document.error.message).slice(0, 40)
  assert.ok(plain(result.err).includes(head), `stderr carries the document's sentence: ${head}`)
  return document
}

test("audit --json: a shell that does not answer is a failure document with the shell's own words", () => {
  const result = omakit(["audit", "--offline", "--json"], { PATH: "/nonexistent" })
  assert.equal(result.status, 1)
  const document = failure(result, "audit", "shell-not-running")
  assert.match(document.error.message, /omarchy is not on PATH/)
  const usage = omakit(["audit", "--wat", "--json"])
  assert.equal(usage.status, 2)
  failure(usage, "audit", "usage")
})

test("watch --json: a usage refusal is a failure document", () => {
  const result = omakit(["watch", "--all", "--list", "--json"])
  assert.equal(result.status, 2)
  failure(result, "watch", "usage")
})

test("lab prove --json: a lab that is not ready is a failure document that lists what is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "omakit-json-"))
  try {
    mkdirSync(join(dir, "home"))
    const result = omakit(["lab", "prove", "run", "--json"], { HOME: join(dir, "home"), XDG_CACHE_HOME: join(dir, "cache"), XDG_STATE_HOME: join(dir, "state") })
    assert.equal(result.status, 1)
    const document = failure(result, "lab prove", "lab-not-ready")
    assert.ok(Array.isArray(document.error.missing) && document.error.missing.length >= 1)
    assert.ok(document.error.missing.every((item) => item.what && item.cost && item.command))
    const usage = omakit(["lab", "prove", "nosuch", "--json"], { HOME: join(dir, "home") })
    assert.equal(usage.status, 2)
    failure(usage, "lab prove", "usage")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("weigh --json: an unconfirmed run is a failure document, exit 2", () => {
  const result = omakit(["weigh", "--wat", "--json"])
  assert.equal(result.status, 2)
  failure(result, "weigh", "usage")
})
