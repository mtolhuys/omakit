// What the lab holds fixed: where Omarchy's releases are listed and where
// their ISOs are published, the signer every release must carry, the
// oldest release it will take, the toolchain that builds a base, and the
// costs measured on the reference host.
//
// Which release the lab prepares is not in this file: `release.mjs` finds
// the newest one that is published whole (ISO, checksum, signature) each
// time `setup` runs, so the lab never stays on an old release unnoticed.
// The trust is the signature, not the list: a file is the release only
// when its detached signature verifies against the packaged key at the
// pinned fingerprint (verify.mjs). The inventory's objection to "latest"
// (docs/history/2026-09-18-lab-inventory.md P13) was a checksum trusted
// from the same host as the file with no signature checked at all; that
// is what the pinned signer answers.

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const LAB_DIR = dirname(fileURLToPath(import.meta.url))

/** A release name the lab takes: three numbers, as Omarchy tags them without the v. */
export const VERSION = /^(\d+)\.(\d+)\.(\d+)$/

let cached = null

/** The pin, parsed once. `file` is injectable for tests that need their own. */
export function labPin(file = join(LAB_DIR, "pin.json")) {
  if (file === join(LAB_DIR, "pin.json") && cached) return cached
  const pin = JSON.parse(readFileSync(file, "utf8"))
  for (const key of ["releases", "toolchain", "guest", "measured"]) {
    if (!pin[key] || typeof pin[key] !== "object") throw new Error(`lab pin: no ${key} section in ${file}`)
  }
  const { releases } = pin
  if (!/^https:\/\/api\.github\.com\/repos\/[\w.-]+\/[\w.-]+\/releases(?:\?[\w=&]*)?$/.test(releases.list)) throw new Error("lab pin: the release list is not a GitHub releases URL")
  if (!/^https:\/\/[\w.-]+\/[\w./-]*\{version\}[\w./-]*\.iso$/.test(releases.iso)) throw new Error("lab pin: the ISO URL is not an https template with {version}")
  if (/latest/i.test(releases.iso)) throw new Error("lab pin: the ISO URL names latest; a release is found by its version")
  if (!VERSION.test(releases.floor)) throw new Error("lab pin: the floor is not a release name")
  if (!Number.isInteger(releases.candidates) || releases.candidates < 1) throw new Error("lab pin: candidates is not a positive integer")
  if (!/^[0-9A-F]{40}$/.test(releases.signingFingerprint)) throw new Error("lab pin: the signing fingerprint is not 40 hex characters")
  if (!/^[0-9a-f]{64}$/.test(releases.signingKeySha256)) throw new Error("lab pin: the signing key digest is not 64 hex characters")
  if (file === join(LAB_DIR, "pin.json")) cached = pin
  return pin
}

/** -1, 0 or 1, by the three numbers; a name that is not a release sorts below every one that is. */
export function compareVersions(a, b) {
  const left = String(a).match(VERSION)
  const right = String(b).match(VERSION)
  if (!left || !right) return left ? 1 : right ? -1 : 0
  for (const index of [1, 2, 3]) {
    const difference = Number(left[index]) - Number(right[index])
    if (difference) return difference < 0 ? -1 : 1
  }
  return 0
}

/**
 * One release in the shape the lab reads everywhere: its name, where its
 * ISO and the two sidecars are, its byte count and digest as published,
 * and the pinned signer it must carry. `bytes` and `sha256` come from the
 * host that publishes the release; the signature is what makes them
 * trusted, and verify.mjs checks it before anything boots the file.
 */
export function releaseOf(pin, { name, bytes, sha256 }) {
  if (!VERSION.test(String(name))) throw new Error(`lab: ${JSON.stringify(name)} is not a release name`)
  const isoUrl = pin.releases.iso.replace("{version}", name)
  return {
    name,
    fileName: isoUrl.split("/").at(-1),
    isoUrl,
    checksumUrl: `${isoUrl}.sha256`,
    signatureUrl: `${isoUrl}.sig`,
    bytes,
    sha256,
    signingFingerprint: pin.releases.signingFingerprint,
    signingKey: pin.releases.signingKey,
    signingKeySha256: pin.releases.signingKeySha256,
  }
}

/** The pin with one release in it: what setup, inspect and a run read as `pin.release`. */
export function withRelease(pin, release) {
  return { ...pin, release }
}

/**
 * Whether an installed `omarchy` package version is this release's: the
 * release name and one package revision (`4.0.3-1`). The ISO installs the
 * package it carries, so any other version is a mislabelled release.
 */
export function guestIsRelease(version, release) {
  if (!release || typeof version !== "string") return false
  const match = version.match(/^(\d+\.\d+\.\d+)-(\d+)$/)
  return Boolean(match) && match[1] === release.name
}

/**
 * Bytes for a person, in both units, so a size cannot be made to look
 * smaller by choosing one: `6,260,654,080 B (6.261 GB / 5.831 GiB)`.
 * Decimal GB is what the download page and the disk vendor say, binary
 * GiB is what `df` and `du -h` say; both are printed every time.
 */
export function bytesBoth(bytes) {
  const n = Number(bytes)
  const gb = (n / 1e9).toFixed(3)
  const gib = (n / 2 ** 30).toFixed(3)
  return `${n.toLocaleString("en-US")} B (${gb} GB / ${gib} GiB)`
}

/** The two units without the byte count, for a breakdown whose total already printed it: `6.261 GB / 5.831 GiB`. */
export function gbBoth(bytes) {
  const n = Number(bytes)
  return `${(n / 1e9).toFixed(3)} GB / ${(n / 2 ** 30).toFixed(3)} GiB`
}

/** `4m 49.5s` from milliseconds, the way a person reads a build time. */
export function durationWords(ms) {
  const seconds = Math.round(ms / 100) / 10
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${(seconds - minutes * 60).toFixed(1)}s`
}

/** The first eight and last eight characters of a digest or fingerprint, for a line that names it without being it. */
export function shortId(value) {
  const s = String(value)
  return s.length > 20 ? `${s.slice(0, 8)}...${s.slice(-8)}` : s
}
