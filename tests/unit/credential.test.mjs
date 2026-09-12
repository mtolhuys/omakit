// Where the read-only credential comes from, and what it refuses to be.
//
// The measured reason this exists: the audience for this tool submits plugins
// to a GitHub-hosted marketplace by opening an issue, so `gh auth login` is
// already done on most of their machines, while a personal access token minted
// for a read-only preflight is friction in the honest case and a new long-lived
// secret on disk in every case. So `gh` is the only source: it honours
// GH_TOKEN and GITHUB_TOKEN itself, so omakit reads no variable of its own,
// and the absence of a login is not an error.
import test from "node:test"
import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import {
  GH_ARGS, UNAUTHENTICATED_LIMIT, credential, ghCredential, resolveCredential,
} from "../../tools/marketplace/github.mjs"
import { REPO_ROOT } from "./helpers.mjs"

const TOKEN = "ghp_0123456789abcdefghijABCDEF"

test("gh is the only source: a token in the environment is gh's to honour, not omakit's to read", () => {
  // Measured: `GH_TOKEN=x gh auth token` prints x, and so does GITHUB_TOKEN.
  // So the environment reaches omakit through the one frozen gh call, and no
  // source file reads either variable itself.
  const resolved = resolveCredential({ gh: () => TOKEN })
  assert.equal(resolved.source, "gh")
  const sources = readdirSync(join(REPO_ROOT, "tools/marketplace")).filter((name) => name.endsWith(".mjs"))
  for (const name of sources) {
    const text = readFileSync(join(REPO_ROOT, "tools/marketplace", name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    assert.doesNotMatch(text, /env\.(?:GITHUB_TOKEN|GH_TOKEN)|\["GITHUB_TOKEN"|"GH_TOKEN"\]/, `${name} reads a token from the environment`)
  }
})

test("the gh login is used, and named as the source", () => {
  const resolved = resolveCredential({ gh: () => TOKEN })
  assert.equal(resolved.value, TOKEN)
  assert.equal(resolved.source, "gh")
  assert.match(resolved.detail, /gh/)
})

test("no login at all is a fact to report, not a failure", () => {
  const resolved = resolveCredential({ gh: () => null })
  assert.equal(resolved.value, null)
  assert.equal(resolved.source, null)
  // The number is the reason the command is limited, so it is in the sentence.
  assert.match(resolved.detail, new RegExp(String(UNAUTHENTICATED_LIMIT)))
})

test("gh is asked for a token and nothing else, and is only ever read", () => {
  const dir = mkdtempSync(join(tmpdir(), "omakit-gh-"))
  const log = join(dir, "argv")
  const fake = join(dir, "gh")
  writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > ${log}\necho ${TOKEN}\n`)
  chmodSync(fake, 0o755)
  const PATH = process.env.PATH
  try {
    process.env.PATH = `${dir}${delimiter}${PATH}`
    assert.equal(ghCredential(), TOKEN)
    // The arguments the real spawn used, read back off disk: a read of local
    // configuration, on one host, with no side effect available to it.
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), [...GH_ARGS])
  } finally {
    process.env.PATH = PATH
  }
})

test("gh that is absent, signed out, or chatty yields no credential", () => {
  const dir = mkdtempSync(join(tmpdir(), "omakit-gh-"))
  const PATH = process.env.PATH
  try {
    // Absent: nothing named gh anywhere on PATH.
    process.env.PATH = dir
    assert.equal(ghCredential(), null)

    // Signed out: gh exits non-zero and says so on stderr.
    const fake = join(dir, "gh")
    writeFileSync(fake, "#!/bin/sh\necho 'not logged in' >&2\nexit 1\n")
    chmodSync(fake, 0o755)
    assert.equal(ghCredential(), null)

    // Chatty: something that is not a credential must not be sent as one.
    writeFileSync(fake, "#!/bin/sh\necho 'gh version 2.0.0 (2026-01-01)'\n")
    chmodSync(fake, 0o755)
    assert.equal(ghCredential(), null)
  } finally {
    process.env.PATH = PATH
  }
})

test("resolution happens once per process, and refresh is explicit", () => {
  let calls = 0
  const first = credential({ refresh: true })
  const second = credential()
  assert.equal(first, second, "the same resolution is reused")
  const counted = resolveCredential({ gh: () => { calls += 1; return null } })
  assert.equal(calls, 1)
  assert.equal(counted.value, null)
})
