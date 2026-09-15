import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { compareVersions, registryLatest } from "../../tools/marketplace/upgrade.mjs"
import { updateCheckEnabled, updateNotice, UPDATE_CHECK_INTERVAL_MS, UPDATE_RETRY_INTERVAL_MS } from "../../tools/marketplace/update-check.mjs"

test("semantic precedence compares numeric components and prereleases without accepting invalid versions", () => {
  const ordered = ["0.4.0-alpha", "0.4.0-alpha.1", "0.4.0-alpha.beta", "0.4.0-beta", "0.4.0-beta.2", "0.4.0-beta.11", "0.4.0-rc.1", "0.4.0", "0.10.0", "1.0.0"]
  for (let i = 1; i < ordered.length; i += 1) {
    assert.equal(compareVersions(ordered[i], ordered[i - 1]), 1)
    assert.equal(compareVersions(ordered[i - 1], ordered[i]), -1)
  }
  assert.equal(compareVersions("0.4.0+one", "0.4.0+two"), 0)
  assert.equal(compareVersions("100000000000000000000.0.0", "99999999999999999999.0.0"), 1)
  for (const invalid of [null, "latest", "v0.4.0", "0.04.0", "0.4.0-01", "0.4.0\u001b[31m", "0.4", "0.4.0;echo x"]) {
    assert.equal(compareVersions(invalid, "0.4.0"), null)
    assert.equal(compareVersions("0.4.0", invalid), null)
  }
})

test("passive checks run only in normal terminals, never pipes, JSON, offline, help, setup or opt-out", () => {
  const terminal = { command: "watch", stdinTTY: true, stdoutTTY: true, stderrTTY: true, env: {} }
  assert.equal(updateCheckEnabled(terminal), true)
  assert.equal(updateCheckEnabled({ ...terminal, command: undefined }), true)
  for (const property of ["stdinTTY", "stdoutTTY", "stderrTTY"]) assert.equal(updateCheckEnabled({ ...terminal, [property]: false }), false)
  for (const command of ["doctor", "upgrade", "setup", "pin", "parity", "help", "--help", "typo"]) assert.equal(updateCheckEnabled({ ...terminal, command }), false)
  for (const args of [["--json"], ["--offline"], ["--out", "report"], ["--out=report"], ["--agent"], ["--help"], ["-h"]]) assert.equal(updateCheckEnabled({ ...terminal, args }), false)
  assert.equal(updateCheckEnabled({ ...terminal, env: { DISABLE_UPDATE_NOTIFIER: "1" } }), false)
  assert.equal(updateCheckEnabled({ ...terminal, env: { CI: "true" } }), false)
})

test("a newer release produces one daily notice and stores only version metadata", async () => {
  const root = mkdtempSync(join(tmpdir(), "omakit-update-"))
  try {
    const options = { repoRoot: join(root, "node_modules/omakit"), version: "0.3.0", env: { XDG_STATE_HOME: root }, now: 100000000 }
    let reads = 0
    const latest = async (name, { signal }) => { reads++; assert.equal(name, "omakit"); assert.ok(signal instanceof AbortSignal); return { version: "0.4.0", error: null } }
    assert.match(await updateNotice({ ...options, latest }), /0\.4\.0 is available.*installed 0\.3\.0.*omakit upgrade/)
    assert.deepEqual(JSON.parse(readFileSync(join(root, "omakit/update-check.json"), "utf8")), { name: "omakit", installed: "0.3.0", latest: "0.4.0", checkedAt: options.now })
    assert.equal(await updateNotice({ ...options, latest, now: options.now + UPDATE_CHECK_INTERVAL_MS - 1 }), null)
    assert.equal(reads, 1)
    assert.match(await updateNotice({ ...options, latest, now: options.now + UPDATE_CHECK_INTERVAL_MS }), /0\.4\.0 is available/)
    assert.equal(reads, 2)
    assert.equal(await updateNotice({ ...options, latest, version: "0.4.0", now: options.now + UPDATE_CHECK_INTERVAL_MS + 1 }), null)
    assert.equal(reads, 3, "a changed install bypasses the old installed-version stamp")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("current, development and invalid published versions never trigger upgrade notices", async () => {
  const root = mkdtempSync(join(tmpdir(), "omakit-update-"))
  try {
    let now = 100000000
    for (const version of ["0.4.0", "0.3.0", "bad\u001b[31m", null]) {
      assert.equal(await updateNotice({ repoRoot: root, version: "0.4.0", env: { XDG_STATE_HOME: root }, now: now += UPDATE_CHECK_INTERVAL_MS, latest: async () => ({ version }) }), null)
    }
    assert.match(await updateNotice({ repoRoot: "/usr/lib/omakit", version: "0.4.0-rc.1", env: { XDG_STATE_HOME: root }, now: now += UPDATE_CHECK_INTERVAL_MS, latest: async () => ({ version: "0.4.0" }) }), /sudo pacman -Syu omakit/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("offline and slow registries stay quiet, abort within the budget and retry after an hour", async () => {
  const root = mkdtempSync(join(tmpdir(), "omakit-update-"))
  try {
    const options = { repoRoot: root, version: "0.3.0", env: { XDG_STATE_HOME: root }, now: 100000000 }
    let reads = 0
    let signal
    const latest = async (_name, options) => { reads++; signal = options.signal; return new Promise(() => {}) }
    const start = performance.now()
    assert.equal(await updateNotice({ ...options, latest, timeoutMs: 20 }), null)
    assert.ok(performance.now() - start < 500)
    assert.equal(signal.aborted, true)
    assert.equal(await updateNotice({ ...options, latest, now: options.now + UPDATE_RETRY_INTERVAL_MS - 1 }), null)
    assert.equal(reads, 1)
    assert.equal(await updateNotice({ ...options, latest: async () => { reads++; throw new Error("offline") }, now: options.now + UPDATE_RETRY_INTERVAL_MS }), null)
    assert.equal(reads, 2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("malformed, future and unwritable state cannot break a command or become executable data", async () => {
  const root = mkdtempSync(join(tmpdir(), "omakit-update-"))
  try {
    const options = { repoRoot: root, version: "0.3.0", env: { XDG_STATE_HOME: root }, now: 100000000, latest: async () => ({ version: "0.4.0" }) }
    mkdirSync(join(root, "omakit"))
    for (const data of ["{", JSON.stringify({ name: "omakit", installed: "0.3.0", latest: "0.4.0", checkedAt: options.now + 1 }), JSON.stringify({ name: "omakit", installed: "0.3.0", latest: "0.4.0\u001b[31m", checkedAt: options.now })]) {
      writeFileSync(join(root, "omakit/update-check.json"), data)
      assert.match(await updateNotice(options), /0\.4\.0 is available/)
    }
    const file = join(root, "not-a-directory")
    writeFileSync(file, "x")
    assert.match(await updateNotice({ ...options, env: { XDG_STATE_HOME: file } }), /0\.4\.0 is available/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("the shared registry read validates update targets, forwards cancellation and sends no GitHub credential", async () => {
  const original = globalThis.fetch
  const controller = new AbortController()
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://registry.npmjs.org/omakit/latest")
      assert.equal(options.signal, controller.signal)
      assert.equal(options.headers.authorization, undefined)
      return new Response(JSON.stringify({ version: "bad\u001b[31m" }), { status: 200 })
    }
    assert.equal((await registryLatest("omakit", { signal: controller.signal })).error.code, "invalid-version")
  } finally { globalThis.fetch = original }
})
