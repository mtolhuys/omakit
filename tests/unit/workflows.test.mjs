import test from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { REPO_ROOT } from "./helpers.mjs"

const workflowDir = join(REPO_ROOT, ".github/workflows")
const workflowNames = readdirSync(workflowDir).sort()
const workflows = Object.fromEntries(workflowNames.map((name) => [name, readFileSync(join(workflowDir, name), "utf8")]))
const all = Object.values(workflows).join("\n")

// Setup/download changes reviewed in docs/evidence/workflow-actions/2026-10-26.md.
const actionPins = Object.freeze({
  "actions/checkout": ["3d3c42e5aac5ba805825da76410c181273ba90b1", "v7.0.1"],
  "actions/setup-node": ["949feb2413d6458794dcd2491c4babbbce0c15c1", "v7.1.0"],
  "actions/cache": ["55cc8345863c7cc4c66a329aec7e433d2d1c52a9", "v6.1.0"],
  "actions/upload-artifact": ["043fb46d1a93c77aae656e7c1c64a875d1fc6a0a", "v7.0.1"],
  "actions/download-artifact": ["9000827ccba6bdab643e8b6fd33ac0654aef8333", "v8.0.2"],
})

test("the workflow surface is exactly CI, release, pin freshness and the pin bump", () => {
  assert.deepEqual(workflowNames, ["ci.yml", "pin-bump.yml", "pin-freshness.yml", "release.yml"])
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
  // The three graded states doctor gives (docs/UPSTREAM_CONTRACT.md, "What
  // moved since the pin"): an issue on advice or info, closed on ok, and
  // anything else refused before an issue is touched. The body names the
  // files omakit reads that moved, the ones gone, the form, and the two
  // policy constants at both ends.
  assert.match(source, /\.evidence\.moved/)
  assert.match(source, /\.evidence\.missing/)
  assert.match(source, /\.evidence\.policy\.pin/)
  assert.match(source, /\.evidence\.policy\.head/)
  assert.match(source, /"\$state" != "ok" && "\$state" != "info" && "\$state" != "advice"/)
  assert.match(source, /"\$STATE" == "advice" \|\| "\$STATE" == "info"/)
  assert.match(source, /elif \[\[ "\$STATE" == "ok" \]\]/)
  assert.match(source, /Files omakit reads under \\`scripts\/\\` that moved/)
  assert.match(source, /Policy constants: \$\{POLICY_PIN\} at the pin, \$\{POLICY_HEAD\} at HEAD/)
  // Graded on `effective`, the moved files less the text-read ones whose
  // every value is unchanged (measured 2026-10-01, M7: three moves of
  // build-catalog.mjs that changed neither value read out of it). The
  // refusal for ok keys on it, a value that differs is never ok or info,
  // and the body names the text-read files the grade set aside.
  assert.match(source, /\.evidence\.effective/)
  assert.match(source, /\.evidence\.textReads/)
  assert.match(source, /"\$state" == "ok" && -n "\$effective\$missing\$forms\$text_differs"/)
  assert.match(source, /doctor called the pin current while something it reads moved: \$effective/)
  assert.match(source, /doctor counted a text-read file whose values are unchanged as moved/)
  assert.match(source, /"\$state" == "info" && \( -z "\$effective" \|\| -n "\$verdict_effective\$missing\$forms\$text_differs"/)
  assert.match(source, /Text-read files that moved with every value unchanged: \\`\$\{TEXT_UNCHANGED:-none\}\\`/)
  assert.doesNotMatch(source, /"\$state" == "ok" && -n "\$moved/, "the ok refusal no longer keys on the blob")
  assert.match(source, /reconcile-issue:[\s\S]*issues: write/)
  assert.match(source, /\[automation\] Marketplace pin differs from HEAD/)
  assert.match(source, /gh\s+issue\s+create/)
  assert.match(source, /gh\s+issue\s+edit/)
  assert.match(source, /gh\s+issue\s+reopen/)
  assert.match(source, /gh\s+issue\s+close/)
  assert.match(source, /cancel-in-progress: false/)
})

test("the pin bump prepares without write access and proposes a draft pull request here, which no workflow merges", () => {
  // Measured (M7, 2026-10-01): the 0.6.6 and 0.6.10 bumps did the same
  // mechanical edits by hand. The workflow does them, and leaves what needs
  // judgement, the version, the tag and the release to a person.
  const source = workflows["pin-bump.yml"]
  assert.match(source, /\n  schedule:\n/)
  assert.match(source, /\n  workflow_dispatch:\n/)
  assert.match(source, /cancel-in-progress: false/)
  const prepare = source.slice(source.indexOf("\n  prepare:\n"), source.indexOf("\n  propose:\n"))
  const propose = source.slice(source.indexOf("\n  propose:\n"))
  // The prepare job runs the candidate pin's code (the suite, parity), so
  // it inherits the read-only default and asks for nothing more.
  assert.doesNotMatch(prepare, /\n    permissions:/, "prepare inherits contents: read")
  assert.match(prepare, /persist-credentials: false/)
  assert.match(prepare, /\.\/bin\/omakit doctor --json/)
  assert.match(prepare, /proposed=\$\(\[\[ "\$state" == "advice" \]\]/, "only advice proposes a bump")
  assert.match(prepare, /node tools\/marketplace\/measure-registry-figures\.mjs --write/)
  assert.match(prepare, /node tools\/marketplace\/measure-pin-grades\.mjs --clone/)
  assert.match(prepare, /\.\/bin\/omakit parity --count 30/)
  assert.match(prepare, /npm test/)
  assert.match(prepare, /diff -u --label/, "the diff of each file that counted is quoted")
  assert.match(prepare, /users\.noreply\.github\.com/, "signed by the person whose action ran it, never a [bot] identity")
  assert.doesNotMatch(source.replace(/^\s*#.*$/gm, ""), /\[bot\]/, "outside the comments")
  // The propose job holds the write permissions, exactly these two, and
  // runs nothing from the checkout or the pin.
  assert.match(propose, /\n    permissions:\n      contents: write\n      pull-requests: write\n\n/)
  assert.doesNotMatch(propose, /\.\/bin\/omakit|\bnode\b|\bnpm\b/, "propose runs no omakit, node or npm")
  assert.match(propose, /outside=\$\(git diff --name-only HEAD~1 HEAD \| grep -vE/, "the prepared commit is held to a bump's paths before anything is pushed")
  assert.match(propose, /\^automation\/pin-\[0-9a-f\]\{8\}\$/)
  assert.match(propose, /gh\s+pr\s+create --repo "\$GITHUB_REPOSITORY" --base main --head "\$BRANCH" --draft/)
  // Never merged, tagged, released or published by a workflow, and nothing
  // is addressed at the marketplace: its address is read from pin.mjs.
  assert.doesNotMatch(source, /gh\s+pr\s+merge|--auto\b|gh\s+pr\s+review|git\s+tag|gh\s+release|npm\s+publish|--force|force-with-lease/)
  assert.doesNotMatch(source, /omacom|omarchy-plugin-marketplace/)
  assert.match(prepare, /MARKETPLACE_PIN\.repository/)
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
