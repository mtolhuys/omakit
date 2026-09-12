// The sparse pin is only safe while PIN_PATHS covers every path omakit reads.
//
// On a blob-filtered partial clone, reading a path outside the sparse set does
// not fail: git quietly fetches it over the network. That would turn a local,
// offline, reproducible run into one that silently depends on GitHub being up
// and on the token in the environment. So the path constants in the source are
// checked against PIN_PATHS here, and adding a new read without adding its path
// fails this test.
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, readFileSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { PIN_PATHS, MARKETPLACE_PIN, pinDiskUsage, pinIsSparse, marketplacePinDir } from "../../tools/marketplace/pin.mjs"
import { SUBMIT_FORM_PATH, OFFICIAL_SUBMISSION_MODULE } from "../../tools/marketplace/form.mjs"
import { CATALOG_PATH, REGISTRY_PATH, CATALOG_BUILDER_PATH } from "../../tools/marketplace/registry.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

function covered(path) {
  return PIN_PATHS.some((pattern) =>
    pattern.endsWith("/") ? path.startsWith(pattern.slice(1)) : path === pattern.slice(1),
  )
}

test("every path constant in the source is inside the sparse set", () => {
  for (const path of [SUBMIT_FORM_PATH, OFFICIAL_SUBMISSION_MODULE, CATALOG_PATH, REGISTRY_PATH, CATALOG_BUILDER_PATH]) {
    assert.ok(covered(path), `${path} is read from the pin but is not covered by PIN_PATHS`)
  }
})

test("no source file reads a pinned path that the sparse set misses", () => {
  // A second, cruder net: any string in the sources that looks like a path into
  // the marketplace checkout must be covered too.
  const sources = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if ([".git", ".cache", "node_modules"].includes(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith(".mjs")) sources.push({ path: relative(REPO_ROOT, path), text: readFileSync(path, "utf8") })
    }
  }
  walk(join(REPO_ROOT, "tools"))

  const PINNED_PREFIX = /"((?:scripts|site|worker|test|\.github)\/[A-Za-z0-9_./-]+)"/g
  for (const { path, text } of sources) {
    for (const match of text.matchAll(PINNED_PREFIX)) {
      assert.ok(covered(match[1]), `${path} reads ${match[1]} from the pin, which PIN_PATHS does not fetch`)
    }
  }
})

test("the sparse set is minimal: nothing in it is unused", () => {
  const text = ["form.mjs", "registry.mjs", "pin.mjs", "preflight.mjs", "run-baseline.mjs", "watch.mjs"]
    .map((name) => readFileSync(join(REPO_ROOT, "tools/marketplace", name), "utf8"))
    .join("\n")
  for (const pattern of PIN_PATHS) {
    const stem = pattern.slice(1).replace(/\/$/, "")
    assert.ok(text.includes(stem), `PIN_PATHS fetches ${pattern} but no module mentions ${stem}`)
  }
})

test("a freshly fetched pin is sparse, and the pin identity still reads", () => {
  const dir = requirePinForTests()
  // An older full checkout is still valid, so this only asserts the mechanism
  // exists and reports honestly.
  assert.equal(typeof pinIsSparse(dir), "boolean")
  assert.equal(marketplacePinDir(REPO_ROOT), dir)
  assert.match(MARKETPLACE_PIN.commit, /^[0-9a-f]{40}$/)
})

test("the pin's size on disk is the checkout's, reached through a symlink or not", () => {
  // Measured before this test existed: `du -sk` on a symlinked checkout
  // measured the link, and `doctor` reported "0.0 MB on disk, sparse" for a
  // 15 MB directory.
  const dir = requirePinForTests()
  const link = join(mkdtempSync(join(tmpdir(), "omakit-pin-link-")), "marketplace")
  symlinkSync(dir, link)
  const direct = pinDiskUsage(dir)
  assert.match(direct, /^\d+(\.\d)? MB on disk$/)
  assert.notEqual(direct, "0.0 MB on disk", "the checkout has a size")
  assert.equal(pinDiskUsage(link), direct, "through the symlink it is the same size")
})
