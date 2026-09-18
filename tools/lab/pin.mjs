// The release pin: the one Omarchy release the lab prepares, its exact
// digest, its signer, and the toolchain that builds a base from it.
//
// Read from tools/lab/pin.json, never from the network: the lab never
// resolves "latest" (docs/history/2026-09-18-lab-inventory.md P13: the
// old setup scraped omarchy.org for the first ISO link and verified it
// against a sidecar downloaded beside it, so a substituted pair passed).
// Updating the pin is a reviewed change, docs/LAB.md says how.

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const LAB_DIR = dirname(fileURLToPath(import.meta.url))

let cached = null

/** The pin, parsed once. `file` is injectable for tests that need a small release. */
export function labPin(file = join(LAB_DIR, "pin.json")) {
  if (file === join(LAB_DIR, "pin.json") && cached) return cached
  const pin = JSON.parse(readFileSync(file, "utf8"))
  for (const key of ["release", "toolchain", "guest", "measured"]) {
    if (!pin[key] || typeof pin[key] !== "object") throw new Error(`lab pin: no ${key} section in ${file}`)
  }
  if (!/^[0-9a-f]{64}$/.test(pin.release.sha256)) throw new Error("lab pin: the release sha256 is not 64 hex characters")
  if (!/^[0-9A-F]{40}$/.test(pin.release.signingFingerprint)) throw new Error("lab pin: the signing fingerprint is not 40 hex characters")
  if (!Number.isInteger(pin.release.bytes) || pin.release.bytes <= 0) throw new Error("lab pin: the release byte count is not a positive integer")
  if (/latest/i.test(pin.release.isoUrl)) throw new Error("lab pin: the ISO URL resolves latest; the pin names one release")
  if (file === join(LAB_DIR, "pin.json")) cached = pin
  return pin
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
