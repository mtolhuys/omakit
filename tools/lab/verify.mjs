// The two checks that make a file the release: its SHA-256 against the
// digest the release publishes, and its detached signature against the
// packaged Omarchy key at the pinned fingerprint.
//
// The signature is the trust: a substituted ISO with a substituted
// checksum beside it fails here, because only Omarchy's key signs. The
// digest names the file and catches a download that went wrong. Both,
// every time, and a mismatch in either fails closed (packaging/LAB_PLAN.md,
// the acquisition boundary).
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

/**
 * The packaged key, checked against its pinned digest before it is trusted
 * with anything. The release names it (releaseOf copies it from the pin,
 * never from the network); with no release, the pin's own.
 */
export function packagedKey(pin = labPin(), dir = LAB_DIR) {
  const name = pin.release?.signingKey || pin.releases.signingKey
  const digest = pin.release?.signingKeySha256 || pin.releases.signingKeySha256
  const file = join(dir, name)
  const { sha256 } = sha256File(file)
  if (sha256 !== digest) {
    throw Object.assign(new Error(`the packaged signing key at ${file} has digest ${sha256}, not the pinned ${digest}`), { code: "key-mismatch" })
  }
  return file
}

/**
 * Who a detached OpenPGP signature says signed it, read from the packet
 * without gpg, so the release search can refuse a changed signer before
 * a six-gigabyte download: `{ fingerprint, keyId }`, each null when the
 * packet does not carry it. A version 4 signature packet in either header
 * format, binary or armoured; the issuer fingerprint subpacket (33) and
 * the issuer key id (16). Anything it cannot read is `{ null, null }`,
 * never a throw: the verdict is gpg's, over the whole file, in
 * judgeRelease; this only lets a wrong key stop early. Measured on the
 * 4.0.3 and 4.0.4 signatures (119 B each): fingerprint
 * 40DFB630FF42BCFFB047046CF0134EE680CAC571 in a hashed subpacket.
 */
export function signatureIssuer(input) {
  return signatureIssuers(input)[0] || { fingerprint: null, keyId: null }
}

/**
 * Every signer a detached signature names, one per signature packet: a
 * `.sig` made during a key rotation can carry the new key's signature and
 * the old one's, and gpg verifies it when any of them is the trusted key,
 * so the early check must see them all. An empty list when nothing reads.
 */
export function signatureIssuers(input) {
  try {
    let bytes = Buffer.isBuffer(input) ? input : Buffer.from(input || [])
    const text = bytes.toString("latin1")
    if (text.startsWith("-----BEGIN PGP SIGNATURE-----")) {
      const body = text.split(/\r?\n\r?\n/).slice(1).join("\n").split(/\r?\n/).filter((line) => line && !line.startsWith("=") && !line.startsWith("-----")).join("")
      bytes = Buffer.from(body, "base64")
    }
    const found = []
    let at = 0
    while (at < bytes.length && found.length < 16) {
      const packet = readPacket(bytes, at)
      if (!packet) break
      const issuer = packet.tag === 2 ? readIssuer(packet.body) : null
      if (issuer && (issuer.fingerprint || issuer.keyId)) found.push(issuer)
      at = packet.next
    }
    return found
  } catch {
    return []
  }
}

/** One OpenPGP packet at `at`, either header format: its tag, body and where the next begins; null when it does not read. */
function readPacket(bytes, at) {
  const header = bytes[at]
  if (header === undefined || !(header & 0x80)) return null
  let tag
  let offset
  let length
  if (header & 0x40) {
    tag = header & 0x3f
    const first = bytes[at + 1]
    if (first < 192) [offset, length] = [at + 2, first]
    else if (first < 224 && bytes.length > at + 2) [offset, length] = [at + 3, ((first - 192) << 8) + bytes[at + 2] + 192]
    else if (first === 255 && bytes.length > at + 5) [offset, length] = [at + 6, bytes.readUInt32BE(at + 2)]
    else return null
  } else {
    tag = (header >> 2) & 0x0f
    const type = header & 3
    if (type === 0 && bytes.length > at + 1) [offset, length] = [at + 2, bytes[at + 1]]
    else if (type === 1 && bytes.length > at + 2) [offset, length] = [at + 3, bytes.readUInt16BE(at + 1)]
    else if (type === 2 && bytes.length > at + 4) [offset, length] = [at + 5, bytes.readUInt32BE(at + 1)]
    else return null
  }
  const body = bytes.subarray(offset, offset + length)
  if (body.length !== length) return null
  return { tag, body, next: offset + length }
}

/** The issuer of one version 4 signature packet's body, from its subpackets; null for any other version. */
function readIssuer(packet) {
  if (packet.length < 6 || packet[0] !== 4) return null
  const out = { fingerprint: null, keyId: null }
  const readSubpackets = (start, end) => {
    let at = start
    while (at < end) {
      let size
      const first = packet[at]
      if (first < 192) [size, at] = [first, at + 1]
      else if (first < 255) [size, at] = [((first - 192) << 8) + packet[at + 1] + 192, at + 2]
      else [size, at] = [packet.readUInt32BE(at + 1), at + 5]
      if (!size || at + size > end) return
      const type = packet[at] & 0x7f
      const data = packet.subarray(at + 1, at + size)
      if (type === 33 && data[0] === 4 && data.length === 21) out.fingerprint = data.subarray(1).toString("hex").toUpperCase()
      if (type === 16 && data.length === 8) out.keyId = data.toString("hex").toUpperCase()
      at += size
    }
  }
  const hashedLength = packet.readUInt16BE(4)
  if (6 + hashedLength + 2 > packet.length) return null
  readSubpackets(6, 6 + hashedLength)
  const unhashedStart = 6 + hashedLength + 2
  const unhashedLength = packet.readUInt16BE(6 + hashedLength)
  if (unhashedStart + unhashedLength <= packet.length) readSubpackets(unhashedStart, unhashedStart + unhashedLength)
  return out
}

/**
 * Whether the signers a signature names include the pinned one: `true`
 * when one does, `false` when every signer it names is another key,
 * `null` when it names none that can be read (the verdict is then gpg's
 * alone, over the whole file).
 */
export function signedByPinned(issuers, fingerprint) {
  const named = issuers.filter((issuer) => issuer.fingerprint || issuer.keyId)
  if (!named.length) return null
  return named.some((issuer) => issuer.fingerprint ? issuer.fingerprint === fingerprint : fingerprint.endsWith(issuer.keyId))
}

/**
 * Verify a detached signature with gpg in a throwaway keyring under
 * `stagingRoot`. The answer is the fingerprint gpg reports as VALIDSIG, or
 * null; the caller compares it with the pinned signer. `run` is injectable.
 */
export function verifySignature({ file, signature, keyFile, stagingRoot, run = spawnSync }) {
  const home = labDir(stagingRoot, `gnupg-${process.pid}`)
  const env = { ...process.env, GNUPGHOME: home }
  try {
    const imported = run("gpg", ["--batch", "--quiet", "--import", keyFile], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 })
    if (imported.error || imported.status !== 0) {
      return { state: "gpg-failed", fingerprint: null, detail: String(imported.stderr || imported.error?.message || "").trim().split("\n")[0] || "gpg could not import the packaged key" }
    }
    const verified = run("gpg", ["--batch", "--status-fd", "1", "--verify", signature, file], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600_000 })
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
 * The whole judgement over a file on disk against the release: byte count,
 * digest, signature. Every field is reported even after the first failure,
 * so a report can say "the size matches, the digest does not" rather than
 * only the first thing wrong. The sidecar's digest is compared too, so a
 * checksum on disk that disagrees with the release's digest is named (the
 * object at the versioned URL was replaced after the release was read).
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
    verdict.reason = `${file} is ${st.size.toLocaleString("en-US")} B; Omarchy ${pin.release.name} is ${pin.release.bytes.toLocaleString("en-US")} B as published`
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
    verdict.reason = `${file} has digest ${verdict.sha256}; Omarchy ${pin.release.name} publishes ${pin.release.sha256}`
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
    verdict.reason = `the signature is by ${signed.fingerprint}, not the key omakit ships (${pin.release.signingFingerprint})`
    return verdict
  }
  verdict.ok = true
  verdict.reason = `${st.size.toLocaleString("en-US")} B, sha256 ${verdict.sha256}, signed by ${signed.fingerprint}`
  return verdict
}
