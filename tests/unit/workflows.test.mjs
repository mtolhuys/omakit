import test from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO_ROOT } from "./helpers.mjs"

const workflowDir = join(REPO_ROOT, ".github/workflows")
const workflowNames = readdirSync(workflowDir).sort()
const workflows = Object.fromEntries(workflowNames.map((name) => [name, readFileSync(join(workflowDir, name), "utf8")]))
const all = Object.values(workflows).join("\n")

const actionPins = Object.freeze({
  "actions/checkout": ["3d3c42e5aac5ba805825da76410c181273ba90b1", "v7.0.1"],
  "actions/setup-node": ["820762786026740c76f36085b0efc47a31fe5020", "v7.0.0"],
  "actions/cache": ["55cc8345863c7cc4c66a329aec7e433d2d1c52a9", "v6.1.0"],
  "actions/upload-artifact": ["043fb46d1a93c77aae656e7c1c64a875d1fc6a0a", "v7.0.1"],
  "actions/download-artifact": ["3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c", "v8.0.1"],
})

test("the workflow surface is exactly CI, release and pin freshness", () => {
  assert.deepEqual(workflowNames, ["ci.yml", "pin-freshness.yml", "release.yml"])
})

test("every workflow defaults to read-only and no privileged PR trigger exists", () => {
  for (const [name, source] of Object.entries(workflows)) {
    const preamble = source.slice(0, source.indexOf("\njobs:"))
    assert.match(preamble, /\npermissions:\n  contents: read\n/, `${name} does not default to contents: read`)
    assert.doesNotMatch(source, /pull_request_target/, `${name} uses a privileged fork trigger`)
  }
})

test("every external action is an audited full-SHA pin with its version beside it", () => {
  const lines = all.split("\n").filter((line) => /^\s*uses:/.test(line))
  assert.ok(lines.length >= 10, "expected the workflows to use the audited action set")
  for (const line of lines) {
    const match = line.match(/^\s*uses:\s*([^@\s]+)@([0-9a-f]{40})\s+#\s+(v\d+\.\d+\.\d+)\s*$/)
    assert.ok(match, `action is not pinned with a full SHA and trailing version: ${line.trim()}`)
    const expected = actionPins[match[1]]
    assert.ok(expected, `${match[1]} was not part of the audited action set`)
    assert.deepEqual([match[2], match[3]], expected, `${match[1]} moved without an explicit audit`)
  }
})

test("CI proves both supported Nodes on the platform omakit runs on, pin and package", () => {
  // Ubuntu only: omakit is an Omarchy tool, and a job for a platform nobody
  // asked for is maintenance with no owner. Node 22 is the engines minimum
  // in package.json; Node 24 is the release workflow's runtime.
  const source = workflows["ci.yml"]
  assert.match(source, /\n  push:\n/)
  assert.match(source, /\n  pull_request:\n/)
  assert.match(source, /os: ubuntu-latest\n\s+node: 22/)
  assert.match(source, /os: ubuntu-latest\n\s+node: 24/)
  assert.doesNotMatch(source, /os: macos-latest/, "no job exists for a platform omakit does not run on")
  assert.match(source, /sudo apt-get install --yes zsh fish/)
  assert.match(source, /\.\/bin\/omakit pin/)
  assert.match(source, /npm test/)
  const record = source.indexOf("node tools/blocks/record-commit.mjs\n")
  const archive = source.indexOf("git archive HEAD")
  assert.ok(record > 0 && archive > record, "CI records the source commit before it exercises a no-.git tree")
  assert.match(source, /cp tools\/blocks\/commit\.json "\$archive\/tools\/blocks\/commit\.json"/)
  assert.match(source, /npm pack --dry-run --json/)
  assert.match(source, /tests\/package-assert\.mjs/)
  assert.match(source, /GITHUB_STEP_SUMMARY/)
  assert.match(source, /Skipped: no network is a failure state, not a stack trace, Linux-only \(unshare -rn\)/)
  assert.match(source, /key: omakit-marketplace-\$\{\{ runner\.os \}\}-\$\{\{ steps\.pin\.outputs\.commit \}\}/i)
  assert.doesNotMatch(source, /restore-keys:/)
  assert.doesNotMatch(source, /find tests\/unit/, "test-file counting stays inside the selected Node runtime")
})

test("release is tag-only, provenance-carrying, reviewable and replay-safe", () => {
  const source = workflows["release.yml"]
  assert.match(source, /tags:\n\s+- "v\*"/)
  assert.match(source, /git merge-base --is-ancestor/)
  assert.match(source, /npm publish .*--provenance --access public/)
  assert.doesNotMatch(source, /NODE_AUTH_TOKEN|NPM_TOKEN/)
  assert.match(source, /npm publish .*--registry https:\/\/registry\.npmjs\.org/)
  assert.match(source, /for attempt in \{1\.\.30\}/, "npm gets 30 integrity probes across 290 seconds after accepting a publish")
  assert.match(source, /if \[\[ "\$attempt" -lt 30 \]\]; then sleep 10; fi/)
  assert.match(source, /id-token: write/)
  assert.match(source, /git archive --format=tar/)
  assert.match(source, /sha256sum/)
  assert.match(source, /gh\s+release\s+create/)
  assert.match(source, /--json isDraft/)
  assert.doesNotMatch(source, /--clobber/)
  assert.doesNotMatch(source, /aur/i, "the AUR route was dropped: npm is the package, the clone is the fallback")
  assert.doesNotMatch(source, /StrictHostKeyChecking=no|force-with-lease|force push|--force/)
})

test("freshness separates the GET-only inspection from this-repository issue writes", () => {
  const source = workflows["pin-freshness.yml"]
  assert.match(source, /\n  schedule:\n/)
  assert.match(source, /\n  workflow_dispatch:\n/)
  assert.match(source, /\.\/bin\/omakit doctor --json/)
  assert.match(source, /\.evidence\.pinCommit/)
  assert.match(source, /\.evidence\.marketplaceHead/)
  assert.match(source, /reconcile-issue:[\s\S]*issues: write/)
  assert.match(source, /\[automation\] Marketplace pin differs from HEAD/)
  assert.match(source, /gh\s+issue\s+create/)
  assert.match(source, /gh\s+issue\s+edit/)
  assert.match(source, /gh\s+issue\s+reopen/)
  assert.match(source, /gh\s+issue\s+close/)
  assert.match(source, /cancel-in-progress: false/)
})

test("workflow GitHub commands can address only this repository", () => {
  for (const [name, source] of Object.entries(workflows)) {
    for (const line of source.split("\n")) {
      if (!/\bgh (?:api|issue|pr|release)\b/.test(line)) continue
      assert.doesNotMatch(line, /omacom\/omarchy-plugin-marketplace/, `${name} directs gh at the marketplace`)
      assert.ok(
        line.includes('--repo "$GITHUB_REPOSITORY"') || line.includes('"repos/${GITHUB_REPOSITORY}/'),
        `${name} has a gh command without an explicit current-repository target: ${line.trim()}`,
      )
    }
  }
  assert.doesNotMatch(workflows["release.yml"], /git push/, "release.yml pushes nothing: it publishes a Release and a package")
})

test("all workflows run without stored secrets", () => {
  assert.doesNotMatch(all, /secrets\./)
  assert.doesNotMatch(workflows["release.yml"], /HAS_NPM_TOKEN|by hand/)
})

test("contributors meet the invariants before a red structural check", () => {
  const contributing = readFileSync(join(REPO_ROOT, "CONTRIBUTING.md"), "utf8")
  const pullRequest = readFileSync(join(REPO_ROOT, ".github/pull_request_template.md"), "utf8")
  const dependabot = readFileSync(join(REPO_ROOT, ".github/dependabot.yml"), "utf8")
  const issueTemplates = readdirSync(join(REPO_ROOT, ".github/ISSUE_TEMPLATE")).sort()
  assert.match(contributing, /trunk-based/)
  assert.match(contributing, /`main` is always releasable/)
  assert.match(contributing, /there is no `develop` branch/)
  assert.match(contributing, /Every behavioural change lands with a test that fails without it/)
  assert.match(contributing, /measured reason/)
  assert.match(pullRequest, /Marketplace access remains read-only/)
  assert.match(pullRequest, /zero runtime dependencies and no build step/)
  assert.deepEqual(issueTemplates, ["bug.yml", "config.yml", "false-verdict.yml"])
  assert.equal((dependabot.match(/package-ecosystem:/g) || []).length, 1)
  assert.match(dependabot, /package-ecosystem: github-actions/)
  assert.equal(readFileSync(join(REPO_ROOT, ".github/CODEOWNERS"), "utf8"), "* @mtolhuys\n")
})
