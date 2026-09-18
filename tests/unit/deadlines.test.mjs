// Nothing waits forever. Measured on 2026-09-19 by a first user of the
// packaged product on a host whose network dropped packets: a GET with no
// signal waited on the kernel's timeout, and `npm test` hung with it until
// an interrupt (docs/evidence/ux/2026-09-19-first-user-test.json, finding 1).
// Three things hold it: every GET carries a deadline, every spawned child
// in tools/ and tests/ carries a `timeout`, and the runner itself is
// bounded per test, so a hang is a failure with a name instead of a wait.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import { GET_DEADLINE_MS, getJson } from "../../tools/marketplace/github.mjs"
import { REPO_ROOT, repositoryFiles } from "./helpers.mjs"

test("a GET to a host that accepts and never answers fails with network-unavailable inside the deadline, not on the kernel's clock", async () => {
  // A server that accepts the connection and says nothing: the shape of a
  // network that drops packets, as far as the caller can tell.
  const server = createServer(() => {})
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const url = `http://127.0.0.1:${server.address().port}/never`
  const started = Date.now()
  try {
    await assert.rejects(getJson(url, { signal: AbortSignal.timeout(300) }), (error) => error.code === "network-unavailable" && /did not answer/.test(error.message))
    assert.ok(Date.now() - started < 5000, "the caller's own deadline was honoured")
  } finally {
    server.close()
  }
  assert.ok(GET_DEADLINE_MS >= 5000 && GET_DEADLINE_MS <= 60000, `the default deadline is seconds, not minutes: ${GET_DEADLINE_MS}`)
  const github = readFileSync(join(REPO_ROOT, "tools/marketplace/github.mjs"), "utf8")
  assert.match(github, /signal: signal \|\| AbortSignal\.timeout\(GET_DEADLINE_MS\)/, "the one fetch call site always carries a signal")
})

test("every spawned child in tools/ and tests/ carries a timeout", () => {
  const files = repositoryFiles().filter((path) => path.endsWith(".mjs") && (path.startsWith("tools/") || path.startsWith("tests/")))
  const offenders = []
  for (const path of files) {
    const text = readFileSync(join(REPO_ROOT, path), "utf8")
    // `run(` is an injectable spawnSync in tools/lab (verify.mjs, host.mjs);
    // in tools/weigh it is the command table's runner, which carries its own.
    const pattern = path.startsWith("tools/lab/") ? /\b(spawnSync|execFileSync|run)\((?=\s*["'`])/g : /\b(spawnSync|execFileSync)\(/g
    for (const match of text.matchAll(pattern)) {
      // The call's text up to its closing parenthesis, by bracket depth.
      let depth = 1
      let index = match.index + match[0].length
      let quote = null
      while (index < text.length && depth > 0) {
        const char = text[index]
        if (quote) {
          if (char === "\\") index += 1
          else if (char === quote) quote = null
        } else if (char === '"' || char === "'" || char === "`") quote = char
        else if ("([{".includes(char)) depth += 1
        else if (")]}".includes(char)) depth -= 1
        index += 1
      }
      const call = text.slice(match.index, index)
      if (!/\btimeout(?:Ms)?\b|\.\.\.options|timeout: timeoutMs/.test(call)) offenders.push(`${path}: ${call.split("\n")[0].slice(0, 80)}`)
    }
  }
  assert.deepEqual(offenders, [])
})

test("the test runner bounds every test, so a hang fails instead of waiting", () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"))
  assert.match(pkg.scripts.test, /--test-timeout=\d+/)
  const ms = Number(pkg.scripts.test.match(/--test-timeout=(\d+)/)[1])
  assert.ok(ms >= 60000 && ms <= 600000, `per-test bound in minutes, not hours: ${ms}`)
})
