// `omakit verify`: a human report by default, the JSON document behind --json
// and --out, byte for byte what it always printed, so the skills and the
// offline evidence (tests/parity/offline.mjs reads marketplaceBaseline.pin,
// .official.outcome and .official.checkedAt) lose nothing.
import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { renderVerify } from "../../tools/marketplace/report.mjs"
import { marketplaceBaselineSection } from "../../tools/marketplace/verify.mjs"
import { consequence } from "../../tools/marketplace/preflight.mjs"
import { resolveSubject } from "../../tools/subject/resolve.mjs"
import { MARKETPLACE_PIN } from "../../tools/marketplace/pin.mjs"
import { overflows, plain } from "../../tools/marketplace/style.mjs"
import { materialise, GOOD, BAD } from "../fixtures/plugins.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

const pinDir = requirePinForTests()
const ESCAPE = /\u001b/

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [join(REPO_ROOT, "bin/omakit"), ...args], {
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1", FORCE_COLOR: undefined, NO_COLOR: undefined, ...env },
  })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

async function documentFor(tree, origin) {
  const fixture = materialise(tree, origin ? { origin } : {})
  const subject = resolveSubject(fixture.dir, { cacheRoot: mkdtempSync(join(tmpdir(), "omakit-verify-")) })
  const section = await marketplaceBaselineSection({ repoRoot: REPO_ROOT, subject })
  return {
    dir: fixture.dir,
    document: {
      subject: { repository: subject.repository, commit: subject.commit, cleanTree: { clean: subject.clean, proof: "git-status-porcelain-empty" }, mode: subject.mode },
      marketplaceBaseline: section,
    },
  }
}

const { "nested/manifest.json": _skip, ...bad } = BAD
const passed = await documentFor(GOOD, "https://github.com/example/omarchy-plugin-fixture-good")
const findings = await documentFor(bad, "https://github.com/example/omarchy-plugin-clockwork")
const none = await documentFor(GOOD)
const blockingRules = (await consequence(pinDir, findings.document.marketplaceBaseline.official)).selectivelyBlockingRules

test("--json prints the document verify always printed, byte for byte, and --out writes the same", () => {
  const { code, out, err } = run(["verify", passed.dir, "--json"])
  assert.equal(code, 0)
  assert.equal(err, "")
  assert.equal(out, `${JSON.stringify(passed.document, null, 2)}\n`, "the JSON is the document itself")
  const parsed = JSON.parse(out)
  assert.deepEqual(Object.keys(parsed), ["subject", "marketplaceBaseline"])
  assert.deepEqual(Object.keys(parsed.subject), ["repository", "commit", "cleanTree", "mode"])
  assert.deepEqual(parsed.subject.cleanTree, { clean: true, proof: "git-status-porcelain-empty" })
  assert.deepEqual(Object.keys(parsed.marketplaceBaseline), ["pin", "transport", "assumedByAdapter", "invoked", "skipReason", "official", "statement"])
  assert.equal(parsed.marketplaceBaseline.pin.commit, MARKETPLACE_PIN.commit)
  assert.equal(parsed.marketplaceBaseline.official.outcome, "passed")
  assert.equal(parsed.marketplaceBaseline.official.checkedAt, "1970-01-01T00:00:00.000Z")

  const file = join(mkdtempSync(join(tmpdir(), "omakit-verify-out-")), "verify.json")
  const written = run(["verify", passed.dir, "--out", file])
  assert.equal(written.code, 0)
  assert.equal(readFileSync(file, "utf8"), out, "--out keeps writing the JSON")
  assert.match(written.out, /wrote /)
})

test("the human report: passed on one line, then the statement", () => {
  const text = renderVerify(passed.document, { colour: false, blockingRules })
  const lines = text.split("\n")
  assert.equal(lines[0], "subject       https://github.com/example/omarchy-plugin-fixture-good")
  assert.equal(lines[1], `commit        ${passed.document.subject.commit}`)
  assert.equal(lines[2], "              clean tree, proof git-status-porcelain-empty, author mode")
  assert.equal(lines[3], `marketplace   ${MARKETPLACE_PIN.commit}, baseline 3, selective`)
  assert.equal(lines[4], "transport     local-git")
  assert.match(lines[5], /^assumed       repository\.private=false, repository\.disabled=false,$/)
  assert.match(text, /^\S ok    passed\s+\[marketplace-pin\]\n        no findings and no capabilities\n/m)
  assert.ok(text.endsWith("audit."), "the statement is last")
  assert.equal(text.split("\n").filter((line) => line.startsWith("Official baseline preview")).length, 1)
})

test("the human report: one block per finding with its tag, id, path and the official text verbatim; capabilities after", () => {
  const official = findings.document.marketplaceBaseline.official
  const text = renderVerify(findings.document, { colour: false, blockingRules })
  assert.match(text, /^\S note  needs-fixes\s+\[marketplace-pin\]\n        disposition review-required, enforcement selective, blocksApproval false$/m)
  const finding = official.findings[0]
  assert.match(text, new RegExp(`^\\S note  ${finding.ruleId}\\s+\\[review-required\\]$`, "m"))
  assert.ok(!blockingRules.includes(finding.ruleId), "curl-pipe-shell is not selectively blocking at the pin")
  const flat = text.replace(/\n\s+/g, " ")
  assert.ok(flat.includes(`${finding.title}. ${finding.why}`), "title and reason verbatim")
  assert.match(text, /^        - install\.sh:2$/m)
  for (const remedy of finding.actions) assert.ok(flat.includes(`${remedy}`), remedy)
  const capability = official.capabilities[0]
  assert.match(text, new RegExp(`^\\S info  ${capability.id}\\s+\\[capability\\]$`, "m"))
  assert.match(text, /^        - install\.sh:1$/m)
  assert.ok(text.indexOf(finding.ruleId) < text.indexOf(`info  ${capability.id}`), "findings before capabilities")
  assert.ok(text.endsWith("audit."))

  // A selectively blocking rule is drawn as a failure and tagged so.
  const blocking = { ...findings.document, marketplaceBaseline: { ...findings.document.marketplaceBaseline, official: { ...official, blocksApproval: true, findings: [{ ...finding, ruleId: blockingRules[0] }] } } }
  const severe = renderVerify(blocking, { colour: false, blockingRules })
  assert.match(severe, /^\S FAIL  needs-fixes/m)
  assert.match(severe, new RegExp(`^\\S FAIL  ${blockingRules[0]}\\s+\\[blocks publication\\]$`, "m"))
})

test("the human report: an official refusal is the result, verbatim; transport none says why it did not run", () => {
  const refused = {
    ...findings.document,
    marketplaceBaseline: {
      ...findings.document.marketplaceBaseline,
      official: { error: { code: "security-baseline-snapshot-too-large", message: "The repository snapshot exceeds the 8 MiB scan limit.", limitBytes: 8388608 } },
    },
  }
  const text = renderVerify(refused, { colour: false, blockingRules })
  assert.match(text, /^\S FAIL  security-baseline-snapshot-too-large\s+\[marketplace-pin\]\n        The repository snapshot exceeds the 8 MiB scan limit\.\n        - limitBytes: 8388608$/m)
  assert.ok(text.endsWith("audit."))

  const skipped = renderVerify(none.document, { colour: false, blockingRules })
  assert.match(skipped, /^subject       no declared GitHub repository URL$/m)
  assert.match(skipped, /^transport     none$/m)
  assert.ok(!skipped.includes("assumed"), "no adapter assumptions when nothing ran")
  assert.match(skipped, /^\S \?     not run\s+\[marketplace-pin\]\n        no declared GitHub repository URL$/m)
})

test("the three-way output contract holds for verify, and nothing is wider than eighty columns", () => {
  for (const document of [passed.document, findings.document, none.document]) {
    const off = renderVerify(document, { colour: false, blockingRules })
    const on = renderVerify(document, { colour: true, blockingRules })
    assert.notEqual(on, off, "colour is applied")
    assert.equal(plain(on), off, "colour changes no word")
    for (const line of off.split("\n")) assert.ok(!overflows(line), `${line.length} columns: ${line}`)
  }
  const piped = run(["verify", findings.dir])
  const dark = run(["verify", findings.dir], { NO_COLOR: "1" })
  const lit = run(["verify", findings.dir], { FORCE_COLOR: "1" })
  assert.equal(piped.code, 0)
  assert.equal(dark.out, piped.out, "NO_COLOR changed the words")
  assert.equal(plain(lit.out), piped.out, "colour changed the words")
  assert.notEqual(lit.out, piped.out)
  assert.doesNotMatch(piped.out, ESCAPE, "a piped run carries no escape")
  assert.equal(piped.err, "")
  assert.ok(piped.out.startsWith("subject       https://github.com/example/omarchy-plugin-clockwork\n"))
})
