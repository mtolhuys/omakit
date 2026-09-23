// The newest Omarchy release the lab can prepare, found each time it is
// asked: the release list on GitHub, newest first by version, and for each
// the three objects the ISO host must publish whole (the ISO, its .sha256
// and its detached .sig). Only GETs, through github.mjs's one call site;
// the ISO's size is read from its response headers and the body is
// cancelled, so no image is fetched here.
//
// What it will not do, each measured against a way the lab went wrong or
// could:
// - Stay on an old release unnoticed. 4.0.4 was published on 2026-09-15
//   and the lab, pinned to 4.0.3 on 2026-09-18, still offered 4.0.3 on
//   2026-09-23; nothing looked.
// - Fall back past a release that could not be read. A newer release is
//   skipped only when the host answers that an object is not there (404:
//   tagged, not yet published, as 4.0.0 has no .sha256); a timeout or a
//   5xx stops the search, because a fallback on a bad connection is the
//   stale lab again.
// - Take a release older than the floor, whatever the list says.
// - Accept a signer it does not ship. The .sig names its issuer; one that
//   is not the pinned fingerprint stops the search before any download,
//   and the message says so, rather than falling back to an older release
//   the old key signed.

import { getJson, getStream } from "../marketplace/github.mjs"
import { compareVersions, labPin, releaseOf, VERSION } from "./pin.mjs"
import { signatureIssuer } from "./verify.mjs"
import { LabError } from "./run.mjs"

/** A sidecar is a few dozen bytes; anything past this is not one. */
const SIDECAR_LIMIT = 4096

/** A GET that answers 404 is "not published"; every other failure is thrown as it came. */
async function read(fetchStream, url, signal) {
  try {
    return await fetchStream(url, { signal })
  } catch (error) {
    if (error?.code === "not-found" || error?.status === 404) return null
    throw error
  }
}

async function smallBody(response, url) {
  const body = Buffer.from(await response.arrayBuffer())
  if (body.length > SIDECAR_LIMIT) throw new LabError("release-unavailable", `${url} answered ${body.length.toLocaleString("en-US")} B; a sidecar is a few dozen`)
  return body
}

/**
 * The published digest from a `.sha256` sidecar: `<64 hex>  <file name>`,
 * the name the ISO's own. Null for anything else.
 */
export function sidecarDigest(text, fileName) {
  const match = String(text).trim().match(/^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$/)
  if (!match) return null
  if (match[2].split("/").at(-1) !== fileName) return null
  return match[1].toLowerCase()
}

/**
 * One release checked on the ISO host, in the order that stops earliest:
 * the checksum, the signature (whose signer is checked before the ISO is
 * asked for, so a release omakit would refuse is never requested), then
 * the ISO's announced size. `{ ok: true, release, signer }` when the three
 * are there and read as they should; `{ ok: false, reason }` when the host
 * says one is not published. A signer other than the pinned one throws
 * `signer-changed`; any other failure throws as it came.
 */
export async function probeRelease({ pin, name, fetchStream = getStream, signal }) {
  const shape = releaseOf(pin, { name, bytes: 0, sha256: "0".repeat(64) })
  const checksum = await read(fetchStream, shape.checksumUrl, signal)
  if (!checksum) return { ok: false, reason: `${shape.fileName}.sha256 is not published` }
  const sha256 = sidecarDigest((await smallBody(checksum, shape.checksumUrl)).toString("utf8"), shape.fileName)
  if (!sha256) return { ok: false, reason: `${shape.fileName}.sha256 does not name ${shape.fileName} with a SHA-256` }
  const signature = await read(fetchStream, shape.signatureUrl, signal)
  if (!signature) return { ok: false, reason: `${shape.fileName}.sig is not published` }
  const signer = signatureIssuer(await smallBody(signature, shape.signatureUrl))
  const other = signer.fingerprint ? signer.fingerprint !== pin.releases.signingFingerprint : Boolean(signer.keyId) && !pin.releases.signingFingerprint.endsWith(signer.keyId)
  if (other) {
    throw new LabError("signer-changed", `Omarchy ${name} is signed by ${signer.fingerprint || `key ${signer.keyId}`}, not the key omakit ships (${pin.releases.signingFingerprint}); omakit will not prepare it, and will not fall back to an older release the old key signed`, { remedy: "omakit upgrade: a newer omakit carries the new key once it is verified" })
  }
  const iso = await read(fetchStream, shape.isoUrl, signal)
  if (!iso) return { ok: false, reason: `${shape.fileName} is not published` }
  const bytes = Number(iso.headers.get("content-length"))
  // The headers are all this needs; the body is the image and stays unread.
  try {
    await iso.body?.cancel()
  } catch {
    // A body that is already closed has nothing left to cancel.
  }
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return { ok: false, reason: `${shape.isoUrl} did not announce its size` }
  return { ok: true, release: releaseOf(pin, { name, bytes, sha256 }), signer }
}

/**
 * The newest release at or above the floor that is published whole.
 * Returns `{ release, tag, publishedAt, checkedAt, list, skipped }`, where
 * `skipped` names each newer release passed over and why. Throws a
 * LabError: `release-unavailable` when none of the newest `candidates`
 * is published whole, `signer-changed` when the newest is signed by
 * another key; a network error comes through with its own code.
 */
export async function findNewestRelease({ pin = labPin(), readJson = getJson, fetchStream = getStream, signal, now = () => new Date() } = {}) {
  const listed = await readJson(pin.releases.list, { signal })
  if (!Array.isArray(listed)) throw new LabError("release-unavailable", `${pin.releases.list} did not answer with a list of releases`)
  const seen = new Set()
  const releases = listed
    .filter((entry) => entry && typeof entry === "object" && !entry.draft && !entry.prerelease && typeof entry.tag_name === "string")
    .map((entry) => ({ tag: entry.tag_name, name: entry.tag_name.replace(/^v/, ""), publishedAt: entry.published_at || null }))
    .filter((entry) => VERSION.test(entry.name) && !seen.has(entry.name) && seen.add(entry.name))
    .sort((a, b) => compareVersions(b.name, a.name))
  const eligible = releases.filter((entry) => compareVersions(entry.name, pin.releases.floor) >= 0)
  if (!eligible.length) {
    throw new LabError("release-unavailable", `${pin.releases.list} lists no release at or above ${pin.releases.floor}${releases.length ? `; the newest listed is ${releases[0].name}` : ""}`)
  }
  const skipped = []
  for (const entry of eligible.slice(0, pin.releases.candidates)) {
    const probed = await probeRelease({ pin, name: entry.name, fetchStream, signal })
    if (!probed.ok) {
      skipped.push({ name: entry.name, reason: probed.reason })
      continue
    }
    return { release: probed.release, tag: entry.tag, publishedAt: entry.publishedAt, checkedAt: now().toISOString(), list: pin.releases.list, skipped }
  }
  throw new LabError("release-unavailable", `none of the newest ${Math.min(eligible.length, pin.releases.candidates)} releases is published whole: ${skipped.map((entry) => `${entry.name} (${entry.reason})`).join("; ")}`)
}

/**
 * The newest-release check as a value, never a throw: what inspect, doctor
 * and a run print. `{ checked: true, ... }` with the release, or
 * `{ checked: false, code, reason }`.
 */
export async function checkNewestRelease(options = {}) {
  try {
    return { checked: true, ...(await findNewestRelease(options)) }
  } catch (error) {
    return { checked: false, code: error?.code || "error", reason: error?.message || String(error) }
  }
}
