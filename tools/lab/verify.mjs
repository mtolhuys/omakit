// The two checks that make a file the pinned release: its SHA-256 against
// the pin, and its detached signature against the packaged Omarchy key at
// the pinned fingerprint.
//
// The digest is the identity the package reviewed; the signature is the
// independent Omarchy authenticity check. Both, every time, and a mismatch
// in either fails closed (packaging/LAB_PLAN.md, the acquisition boundary).
// The key is imported into a throwaway GNUPGHOME under the lab, never into
// the user's keyring: a lab that added keys to ~/.gnupg would be changing
// the host, and the only host change the lab makes is the lab.

import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs"
import { join } from "node:path"
import { LAB_DIR, labPin } from "./pin.mjs"
import { labDir, removeFromLab } from "./paths.mjs"

/**
 * SHA-256 of a file, streamed in 4 MiB reads. Measured on the 6.26 GB
 * 4.0.3 ISO on the reference host, page-cached: 5.2 s in Node, 5.1 s in
 * `sha256sum` (docs/MEASUREMENTS.md M14), so there is no reason to shell
 * out. `onProgress(read, total)` at most once per read.
 */
export function sha256File(file, { onProgress } = {}) {
  const total = statSync(file).size
  const hash = createHash("sha256")
  const buffer = Buffer.alloc(4 * 1024 * 1024)
  const fd = openSync(file, "r")
  let read = 0
  try {
    for (;;) {
      const n = readSync(fd, buffer, 0, buffer.length, null)
      if (n <= 0) break
      hash.update(buffer.subarray(0, n))
      read += n
      if (onProgress) onProgress(read, total)
    }
  } finally {
    closeSync(fd)
  }
  return { sha256: hash.digest("hex"), bytes: read }
}

/** The packaged key, checked against its pinned digest before it is trusted with anything. */
export function packagedKey(pin = labPin(), dir = LAB_DIR) {
  const file = join(dir, pin.release.signingKey)
  const { sha256 } = sha256File(file)
  if (sha256 !== pin.release.signingKeySha256) {
    throw Object.assign(new Error(`the packaged signing key at ${file} has digest ${sha256}, not the pinned ${pin.release.signingKeySha256}`), { code: "key-mismatch" })
  }
  return file
}

/**
 * Verify a detached signature with gpg in a throwaway keyring under
 * `stagingRoot`. The answer is the fingerprint gpg reports as VALIDSIG, or
 * null; the caller compares it with the pin. `run` is injectable.
 */
export function verifySignature({ file, signature, keyFile, stagingRoot, run = spawnSync }) {
  const home = labDir(stagingRoot, `gnupg-${process.pid}`)
  const env = { ...process.env, GNUPGHOME: home }
  try {
    const imported = run("gpg", ["--batch", "--quiet", "--import", keyFile], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    if (imported.error || imported.status !== 0) {
      return { state: "gpg-failed", fingerprint: null, detail: String(imported.stderr || imported.error?.message || "").trim().split("\n")[0] || "gpg could not import the packaged key" }
    }
    const verified = run("gpg", ["--batch", "--status-fd", "1", "--verify", signature, file], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    const status = String(verified.stdout || "")
    const valid = status.match(/^\[GNUPG:\] VALIDSIG ([0-9A-F]{40}) /m)
    if (valid && verified.status === 0) return { state: "valid", fingerprint: valid[1], detail: status.match(/^\[GNUPG:\] GOODSIG \S+ (.+)$/m)?.[1] || null }
    const bad = status.match(/^\[GNUPG:\] (BADSIG|NO_PUBKEY|ERRSIG|NODATA)\b.*$/m)
    return { state: bad ? bad[1].toLowerCase() : "invalid", fingerprint: null, detail: (bad?.[0] || String(verified.stderr || "").trim().split("\n")[0] || "gpg did not report a valid signature").trim() }
  } finally {
    removeFromLab(stagingRoot, `gnupg-${process.pid}`)
  }
}

/**
 * The whole judgement over a file on disk against the pin: byte count,
 * digest, signature. Every field is reported even after the first failure,
 * so a report can say "the size matches, the digest does not" rather than
 * only the first thing wrong. The sidecar's digest is compared too, so a
 * published checksum that disagrees with the pin is named (it would mean
 * the object at the versioned URL was replaced).
 */
export function judgeRelease({ file, signature, checksum, pin = labPin(), stagingRoot, keyFile = packagedKey(pin), onProgress, run }) {
  const verdict = { file, bytes: null, bytesMatch: false, sha256: null, sha256Match: false, sidecarSha256: null, sidecarMatch: null, signature: null, ok: false }
  let st
  try {
    st = statSync(file)
  } catch {
    verdict.reason = `${file} is not there`
    return verdict
  }
  verdict.bytes = st.size
  verdict.bytesMatch = st.size === pin.release.bytes
  if (!verdict.bytesMatch) {
    verdict.reason = `${file} is ${st.size.toLocaleString("en-US")} B, the pin says ${pin.release.bytes.toLocaleString("en-US")} B`
    return verdict
  }
  verdict.sha256 = sha256File(file, { onProgress }).sha256
  verdict.sha256Match = verdict.sha256 === pin.release.sha256
  if (checksum) {
    try {
      verdict.sidecarSha256 = readFileSync(checksum, "utf8").trim().split(/\s+/)[0].toLowerCase()
      verdict.sidecarMatch = verdict.sidecarSha256 === pin.release.sha256
    } catch {
      verdict.sidecarSha256 = null
      verdict.sidecarMatch = null
    }
  }
  if (!verdict.sha256Match) {
    verdict.reason = `${file} has digest ${verdict.sha256}, the pin says ${pin.release.sha256}`
    return verdict
  }
  if (!signature) {
    verdict.reason = "no detached signature beside the file"
    return verdict
  }
  const signed = verifySignature({ file, signature, keyFile, stagingRoot, run })
  verdict.signature = signed
  if (signed.state !== "valid") {
    verdict.reason = `the signature did not verify: ${signed.detail}`
    return verdict
  }
  if (signed.fingerprint !== pin.release.signingFingerprint) {
    verdict.reason = `the signature is by ${signed.fingerprint}, the pin says ${pin.release.signingFingerprint}`
    return verdict
  }
  verdict.ok = true
  verdict.reason = `${st.size.toLocaleString("en-US")} B, sha256 ${verdict.sha256}, signed by ${signed.fingerprint}`
  return verdict
}
