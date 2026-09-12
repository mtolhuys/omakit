// What the installable tree must contain at the root, and the plugin identity
// the submission is about.
//
// Omakit does not re-validate the manifest. The marketplace validates schema,
// required fields, id characters, kinds, entry points and symlinks itself, and
// its validator (`scripts/build-catalog.mjs`) cannot be imported without the
// marketplace's own native dependencies. Re-implementing those rules here would
// be copied policy that silently drifts from the pin, which is the failure this
// repository is built to avoid. So this module checks only what the submission
// contract needs: that the three root files exist, that there is exactly one
// root manifest, and what id it declares.

import { isBlob, readText, rootEntries } from "./tree.mjs"

// The marketplace's own patterns for a root README and a root license
// (`validateRepositoryDocs` in scripts/build-catalog.mjs at the pin).
export const README_PATTERN = /^readme(?:\.[^/]+)?$/i
export const LICENSE_PATTERN = /^(?:licen[cs]e|copying)(?:\.[^/]+)?$/i
export const MANIFEST_PATH = "manifest.json"

// Keyword probes for the first checklist item, "The repository is public and
// contains installation and removal instructions." This is a text probe on the
// README, not a semantic reading, and the output says so.
export const INSTALL_PATTERN = /\binstall(?:ation|ing|s|ed)?\b/i
export const REMOVAL_PATTERN = /\b(?:uninstall(?:ation|ing|s|ed)?|remov(?:al|e|es|ed|ing)|delet(?:e|es|ed|ing)|purge)\b/i

/**
 * @param {{ dir: string, commit: string, entries: Array }} subject
 */
export function inspectTree({ dir, entries }) {
  const roots = rootEntries(entries).filter(isBlob)
  const readme = roots.find((entry) => README_PATTERN.test(entry.path)) || null
  const license = roots.find((entry) => LICENSE_PATTERN.test(entry.path)) || null
  const manifests = entries
    .filter((entry) => isBlob(entry) && /^(?:[^/]+\/)?manifest\.json$/i.test(entry.path))
    .map((entry) => entry.path)
    .sort()
  const rootManifest = roots.find((entry) => entry.path === MANIFEST_PATH) || null

  let manifest = null
  let manifestError = null
  if (rootManifest) {
    try {
      manifest = JSON.parse(readText(dir, rootManifest.sha))
    } catch (error) {
      manifestError = error.message
    }
  }

  const readmeText = readme ? readText(dir, readme.sha) : ""

  return {
    readme: readme?.path || null,
    license: license?.path || null,
    manifestPaths: manifests,
    rootManifestPath: rootManifest?.path || null,
    manifest,
    manifestError,
    pluginId: typeof manifest?.id === "string" ? manifest.id.trim() : "",
    pluginName: typeof manifest?.name === "string" ? manifest.name.trim() : "",
    readmeMentionsInstall: INSTALL_PATTERN.test(readmeText),
    readmeMentionsRemoval: REMOVAL_PATTERN.test(readmeText),
  }
}
