// `omakit lab`: the pin, the argument lists a guest is started and reached
// with, the read-only surface, acquisition against a local server, the
// verification that fails closed, the lock, prune, and the proof that the
// guest is the only target. Nothing here boots a guest: the run itself is
// evidence under docs/evidence/lab/, and every pure part is held here.
import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { createServer as createUnixServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { REPO_ROOT } from "./helpers.mjs"
import { bytesBoth, compareVersions, durationWords, guestIsRelease, labPin, LAB_DIR, releaseOf, withRelease } from "../../tools/lab/pin.mjs"
import { allocatedBytes, inLab, labLayout, writeJson } from "../../tools/lab/paths.mjs"
import { qcodesFor, qemuArgs } from "../../tools/lab/qemu.mjs"
import { BUILD_COMMANDS, kvmContext, probeCommands, probeKvm } from "../../tools/lab/host.mjs"
import { GUEST_HOST, sshArgs } from "../../tools/lab/guest.mjs"
import { judgeRelease, sha256File, signatureIssuer, verifySignature } from "../../tools/lab/verify.mjs"
import { BASE_FILES, buildGuests, inspectBase, inspectDownload, inspectLab, inspectStaging, inspectToolchain } from "../../tools/lab/inspect.mjs"
import { CONSENT_QUESTION, disclosureLines, downloadRelease, localRelease, NOT_ASKED, planSetup, setupLab, stagedBases } from "../../tools/lab/setup.mjs"
import { checkNewestRelease, findNewestRelease, sidecarDigest } from "../../tools/lab/release.mjs"
import { acquireLock, LabError, preflightRun, releaseLock } from "../../tools/lab/run.mjs"
import { planPrune, prune } from "../../tools/lab/prune.mjs"
import { SUITES, suiteNames, suitePreflight } from "../../tools/lab/suites.mjs"
import { labDoctorChecks, releaseCheck, renderLab, renderSetupPlan } from "../../tools/lab/report.mjs"
import { ACCEPTED } from "../../tools/marketplace/options.mjs"
import { LAB_ACTIONS, subcommandsOf } from "../../tools/marketplace/completion.mjs"
import { COMMANDS } from "../../tools/marketplace/usage.mjs"

const pin = labPin()

/** Omarchy 4.0.3 as published, the release the lab was measured on (M14). */
const RELEASE_403 = releaseOf(pin, { name: "4.0.3", bytes: 6260654080, sha256: "03d60bc74306dca51f96e1a84b690871d8d606826b260edd0208962da8507d14" })

/** What release.mjs answers when it found `release` as the newest. */
const found = (release, extra = {}) => ({ checked: true, release, tag: `v${release.name}`, publishedAt: "2026-09-08T19:50:46Z", checkedAt: "2026-09-23T00:00:00.000Z", list: pin.releases.list, skipped: [], ...extra })

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "omakit-lab-"))
  const env = { ...process.env, HOME: join(dir, "home"), XDG_CACHE_HOME: join(dir, "cache"), XDG_STATE_HOME: join(dir, "state") }
  mkdirSync(env.HOME, { recursive: true })
  return { dir, env, layout: labLayout(env), rm: () => rmSync(dir, { recursive: true, force: true }) }
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex")

/** A small release standing in for a real one: a few KiB, its own digest, the real signer fields. */
function smallPin(body, overrides = {}) {
  return { ...pin, release: { ...RELEASE_403, bytes: body.length, sha256: sha256(body), fileName: "small.iso", ...overrides } }
}

test("the pin names where releases are listed and published, the oldest it takes, the one signer, and never a release of its own", () => {
  assert.equal(pin.release, undefined, "which release is the newest is looked up, never written down")
  assert.equal(pin.releases.list, "https://api.github.com/repos/omacom/omarchy/releases?per_page=30")
  assert.equal(pin.releases.iso, "https://iso.omarchy.org/omarchy-{version}.iso")
  assert.doesNotMatch(pin.releases.iso, /latest/i)
  assert.equal(pin.releases.floor, "4.0.3")
  assert.ok(Number.isInteger(pin.releases.candidates) && pin.releases.candidates >= 2, "a tagged release without its ISO yet is passed over, not the end of the search")
  assert.match(pin.releases.signingFingerprint, /^[0-9A-F]{40}$/)
  assert.equal(sha256File(join(LAB_DIR, pin.releases.signingKey)).sha256, pin.releases.signingKeySha256)
  const key = readFileSync(join(LAB_DIR, pin.releases.signingKey), "utf8")
  assert.match(key, /^-----BEGIN PGP PUBLIC KEY BLOCK-----/, "the packaged key is armoured text, never a binary blob")
  assert.deepEqual(RELEASE_403, {
    name: "4.0.3", fileName: "omarchy-4.0.3.iso", isoUrl: "https://iso.omarchy.org/omarchy-4.0.3.iso",
    checksumUrl: "https://iso.omarchy.org/omarchy-4.0.3.iso.sha256", signatureUrl: "https://iso.omarchy.org/omarchy-4.0.3.iso.sig",
    bytes: 6260654080, sha256: "03d60bc74306dca51f96e1a84b690871d8d606826b260edd0208962da8507d14",
    signingFingerprint: pin.releases.signingFingerprint, signingKey: pin.releases.signingKey, signingKeySha256: pin.releases.signingKeySha256,
    expectedGuestVersion: "4.0.3-<pkgrel>",
  })
  assert.throws(() => releaseOf(pin, { name: "latest", bytes: 1, sha256: "0".repeat(64) }), /not a release name/)
  assert.equal(pin.toolchain.commit, "268bac16d351a21d867e37565738f458b11cb06c")
  const patch = readFileSync(join(LAB_DIR, pin.toolchain.patch), "utf8")
  assert.match(patch, /Beautiful, Fun & Agentic Linux by DHH/, "the patch knows the 4.0.3 installer's greeter (inventory P12)")
  assert.match(patch, /^-omarchy-pkg-add /m, "the patch removes the host package install (inventory P10)")
  assert.match(patch, /\+ *--host-test\)/, "the patch carries the host-test extension")
  assert.equal(pin.measured.release, "4.0.3", "the measured costs say which release they were measured on")
  for (const key of ["isoBytes", "buildMilliseconds", "baseAllocatedBytes", "baseDirectoryBytes", "preparedLabBytes", "overlayAfterRunBytes"]) {
    assert.ok(Number.isInteger(pin.measured[key]) && pin.measured[key] > 0, `${key} is a measured integer`)
  }
})

test("a pin whose ISO URL names latest, or whose floor, signer or list is malformed, is refused at read time", () => {
  const { dir, rm } = scratch()
  try {
    const file = join(dir, "pin.json")
    const write = (releases) => writeFileSync(file, JSON.stringify({ ...pin, releases: { ...pin.releases, ...releases } }))
    write({ iso: "https://iso.omarchy.org/omarchy-latest-{version}.iso" })
    assert.throws(() => labPin(file), /names latest/)
    write({ iso: "https://iso.omarchy.org/omarchy.iso" })
    assert.throws(() => labPin(file), /template with \{version\}/)
    write({ floor: "4.0" })
    assert.throws(() => labPin(file), /floor/)
    write({ signingFingerprint: "abc" })
    assert.throws(() => labPin(file), /40 hex/)
    write({ list: "https://example.com/releases" })
    assert.throws(() => labPin(file), /GitHub releases URL/)
    write({})
    assert.equal(labPin(file).releases.floor, "4.0.3")
  } finally {
    rm()
  }
})

test("versions compare by their three numbers, and a guest package is its release's by name and one revision", () => {
  assert.equal(compareVersions("4.0.10", "4.0.9"), 1, "numbers, not strings")
  assert.equal(compareVersions("4.1.0", "4.0.99"), 1)
  assert.equal(compareVersions("4.0.3", "4.0.3"), 0)
  assert.equal(compareVersions("5.0.0", "4.9.9"), 1)
  assert.equal(compareVersions("not", "4.0.3"), -1, "a name that is not a release sorts below every release")
  assert.equal(guestIsRelease("4.0.3-1", RELEASE_403), true)
  assert.equal(guestIsRelease("4.0.3-2", RELEASE_403), true, "a package rebuild is the same release")
  assert.equal(guestIsRelease("4.0.30-1", RELEASE_403), false)
  assert.equal(guestIsRelease("4.0.4-1", RELEASE_403), false)
  assert.equal(guestIsRelease("4.0.3", RELEASE_403), false)
  assert.equal(guestIsRelease(null, RELEASE_403), false)
})

/** Omarchy's own 4.0.4 signature, 119 bytes as published at iso.omarchy.org: a v4 EdDSA signature packet. */
const SIG_404 = Buffer.from("iHUEABYKAB0WIQRA37Yw/0K8/7BHBGzwE07mgMrFcQUCaqm61QAKCRDwE07mgMrFcc7CAP9NZIz0GRINcs4aeiBNx9iuS/vwdFcb1klgY+5rM/vnuwEAlV07M9aud1I/Wrmbt9PGAXRaJiAoyouNOey5hv28JgA=", "base64")

test("the signer is read from the signature packet itself, and anything unreadable is unknown, never a throw", () => {
  assert.deepEqual(signatureIssuer(SIG_404), { fingerprint: "40DFB630FF42BCFFB047046CF0134EE680CAC571", keyId: "F0134EE680CAC571" })
  assert.equal(signatureIssuer(SIG_404).fingerprint, pin.releases.signingFingerprint, "4.0.4 is signed by the key omakit ships")
  const armoured = `-----BEGIN PGP SIGNATURE-----\n\n${SIG_404.toString("base64")}\n=abcd\n-----END PGP SIGNATURE-----\n`
  assert.deepEqual(signatureIssuer(Buffer.from(armoured)), signatureIssuer(SIG_404), "armoured or binary, the same packet")
  // The new header format, one-octet length: the same body behind 0xC2.
  assert.deepEqual(signatureIssuer(Buffer.concat([Buffer.from([0xc2, 0x75]), SIG_404.subarray(2)])), signatureIssuer(SIG_404))
  for (const broken of [Buffer.alloc(0), Buffer.from([0x88]), Buffer.from([0x88, 0xff, 4]), SIG_404.subarray(0, 40), Buffer.from("not a signature"), Buffer.from([0x88, 0x75, 5, ...SIG_404.subarray(3)])]) {
    assert.deepEqual(signatureIssuer(broken), { fingerprint: null, keyId: null }, `unreadable: ${broken.toString("hex").slice(0, 20)}`)
  }
})

test("a checksum sidecar is read as a digest only when it names the ISO beside it", () => {
  const digest = "a".repeat(64)
  assert.equal(sidecarDigest(`${digest}  omarchy-4.0.4.iso\n`, "omarchy-4.0.4.iso"), digest)
  assert.equal(sidecarDigest(`${"A".repeat(64)} *omarchy-4.0.4.iso`, "omarchy-4.0.4.iso"), digest, "binary mode marker, upper case")
  assert.equal(sidecarDigest(`${digest}  ./out/omarchy-4.0.4.iso`, "omarchy-4.0.4.iso"), digest)
  assert.equal(sidecarDigest(`${digest}  omarchy-4.0.3.iso`, "omarchy-4.0.4.iso"), null, "another release's checksum")
  assert.equal(sidecarDigest(`${digest}`, "omarchy-4.0.4.iso"), null)
  assert.equal(sidecarDigest("<!doctype html>", "omarchy-4.0.4.iso"), null)
})

/**
 * A release host in memory: `listing` is the GitHub answer, `objects` maps
 * a URL to a body (Buffer), to `{ image: true, announce }` for an ISO whose
 * headers announce a size (or none), to `404`, or to an Error to throw.
 * Counts what was read, and whether an ISO body was cancelled rather than read.
 */
function releaseHost(listing, objects) {
  const log = { reads: [], cancelled: [], bodiesRead: [] }
  const readJson = async (url) => {
    log.reads.push(url)
    if (listing instanceof Error) throw listing
    return listing
  }
  const fetchStream = async (url) => {
    log.reads.push(url)
    const object = objects[url]
    if (object === undefined || object === 404) throw Object.assign(new Error(`GET ${url} returned 404`), { code: "not-found", status: 404 })
    if (object instanceof Error) throw object
    const headers = new Headers(object.image ? (object.announce === undefined ? {} : { "content-length": String(object.announce) }) : { "content-length": String(object.length) })
    return {
      status: 200,
      headers,
      arrayBuffer: async () => {
        log.bodiesRead.push(url)
        return object.image ? new ArrayBuffer(0) : object.buffer.slice(object.byteOffset, object.byteOffset + object.length)
      },
      body: { cancel: async () => { log.cancelled.push(url) } },
    }
  }
  return { readJson, fetchStream, log }
}

const tagged = (name, extra = {}) => ({ tag_name: `v${name}`, published_at: "2026-09-15T21:39:29Z", draft: false, prerelease: false, ...extra })
const iso = (name) => `https://iso.omarchy.org/omarchy-${name}.iso`
/** The three objects of a release published whole, the ISO announcing `bytes`. */
function published(name, { bytes = 6185304064, digest = "d".repeat(64), sig = SIG_404 } = {}) {
  return { [`${iso(name)}.sha256`]: Buffer.from(`${digest}  omarchy-${name}.iso\n`), [`${iso(name)}.sig`]: sig, [iso(name)]: { image: true, announce: bytes } }
}

test("the newest release is the highest version published whole, drafts and pre-releases aside, and the ISO's body is never read", async () => {
  const listing = [tagged("4.0.2"), tagged("4.0.10"), tagged("4.0.4"), tagged("5.0.0-rc1"), tagged("4.1.0", { draft: true }), tagged("4.2.0", { prerelease: true }), tagged("4.0.4"), { tag_name: 7 }, null, tagged("nightly")]
  const host = releaseHost(listing, { ...published("4.0.10", { digest: "1".repeat(64) }), ...published("4.0.4") })
  const newest = await findNewestRelease({ pin, readJson: host.readJson, fetchStream: host.fetchStream, now: () => new Date("2026-09-23T00:00:00Z") })
  assert.equal(newest.release.name, "4.0.10", "by the numbers, not by the list's order or as strings")
  assert.equal(newest.release.sha256, "1".repeat(64))
  assert.equal(newest.release.bytes, 6185304064, "the size the ISO host announces")
  assert.equal(newest.release.isoUrl, iso("4.0.10"))
  assert.equal(newest.tag, "v4.0.10")
  assert.equal(newest.checkedAt, "2026-09-23T00:00:00.000Z")
  assert.deepEqual(newest.skipped, [])
  assert.deepEqual(host.log.cancelled, [iso("4.0.10")], "the ISO's headers were read and its body cancelled")
  assert.ok(!host.log.bodiesRead.includes(iso("4.0.10")), "no byte of an image is read by the search")
  assert.equal(host.log.reads[0], pin.releases.list)
})

test("a newer release not published whole is passed over and named, but a read that failed stops the search instead of falling back", async () => {
  const listing = [tagged("4.0.5"), tagged("4.0.4"), tagged("4.0.3")]
  // 4.0.5 is tagged and its ISO is not up yet: 4.0.4 is the newest available, and 4.0.5 is named.
  const waiting = releaseHost(listing, { ...published("4.0.4"), [`${iso("4.0.5")}.sha256`]: Buffer.from(`${"5".repeat(64)}  omarchy-4.0.5.iso`), [`${iso("4.0.5")}.sig`]: SIG_404 })
  const newest = await findNewestRelease({ pin, readJson: waiting.readJson, fetchStream: waiting.fetchStream })
  assert.equal(newest.release.name, "4.0.4")
  assert.deepEqual(newest.skipped, [{ name: "4.0.5", reason: "omarchy-4.0.5.iso is not published" }])
  // A checksum that names another file is not a publication of this release.
  const misnamed = releaseHost(listing, { ...published("4.0.4"), [`${iso("4.0.5")}.sha256`]: Buffer.from(`${"5".repeat(64)}  omarchy-4.0.4.iso`) })
  assert.deepEqual((await findNewestRelease({ pin, readJson: misnamed.readJson, fetchStream: misnamed.fetchStream })).skipped, [{ name: "4.0.5", reason: "omarchy-4.0.5.iso.sha256 does not name omarchy-4.0.5.iso with a SHA-256" }])
  // No size announced: the download could not be held to one.
  const sizeless = releaseHost(listing, { ...published("4.0.4"), ...published("4.0.5"), [iso("4.0.5")]: { image: true } })
  const noSize = await findNewestRelease({ pin, readJson: sizeless.readJson, fetchStream: sizeless.fetchStream })
  assert.equal(noSize.release.name, "4.0.4")
  assert.match(noSize.skipped[0].reason, /did not announce its size/)
  // A timeout on the newest is not "not published": the search stops, and nothing older is offered.
  const flaky = releaseHost(listing, { ...published("4.0.4"), [`${iso("4.0.5")}.sha256`]: Object.assign(new Error("iso.omarchy.org did not answer (no answer within 20 s)"), { code: "network-unavailable" }) })
  await assert.rejects(findNewestRelease({ pin, readJson: flaky.readJson, fetchStream: flaky.fetchStream }), (error) => error.code === "network-unavailable")
  // None of the newest `candidates` published whole: refused, each reason named.
  const none = releaseHost([tagged("4.0.7"), tagged("4.0.6"), tagged("4.0.5"), tagged("4.0.4")], published("4.0.4"))
  await assert.rejects(findNewestRelease({ pin, readJson: none.readJson, fetchStream: none.fetchStream }), (error) => error.code === "release-unavailable" && /none of the newest 3 releases is published whole: 4\.0\.7 \(.*\); 4\.0\.6 .*; 4\.0\.5/.test(error.message))
  // A sidecar that is not a few dozen bytes is not a sidecar.
  const huge = releaseHost(listing, { ...published("4.0.5"), [`${iso("4.0.5")}.sha256`]: Buffer.alloc(5000, 97) })
  await assert.rejects(findNewestRelease({ pin, readJson: huge.readJson, fetchStream: huge.fetchStream }), (error) => error.code === "release-unavailable" && /a sidecar is a few dozen/.test(error.message))
})

test("the floor holds whatever the list says, a changed signer stops the search before any download, and the check never throws", async () => {
  const old = releaseHost([tagged("4.0.2"), tagged("3.9.9")], {})
  await assert.rejects(findNewestRelease({ pin, readJson: old.readJson, fetchStream: old.fetchStream }), (error) => error.code === "release-unavailable" && /no release at or above 4\.0\.3; the newest listed is 4\.0\.2/.test(error.message))
  assert.equal(old.log.reads.length, 1, "nothing below the floor is probed")
  // 4.0.5 signed by another key: refused, and 4.0.4 (the old key's) is not offered in its place.
  const other = Buffer.from(SIG_404)
  other[11] ^= 0xff
  const rotated = releaseHost([tagged("4.0.5"), tagged("4.0.4")], { ...published("4.0.5", { sig: other }), ...published("4.0.4") })
  await assert.rejects(findNewestRelease({ pin, readJson: rotated.readJson, fetchStream: rotated.fetchStream }), (error) => error.code === "signer-changed" && /not the key omakit ships/.test(error.message) && /will not fall back/.test(error.message))
  assert.ok(!rotated.log.reads.includes(iso("4.0.5")), "the ISO of a release signed by another key is not even asked for")
  assert.ok(!rotated.log.reads.some((url) => url.includes("4.0.4")), "and the older release is not probed as a fallback")
  // A signature packet omakit cannot read defers to gpg over the whole file, which runs before anything boots.
  const unreadable = releaseHost([tagged("4.0.4")], published("4.0.4", { sig: Buffer.from("opaque") }))
  assert.equal((await findNewestRelease({ pin, readJson: unreadable.readJson, fetchStream: unreadable.fetchStream })).release.name, "4.0.4")
  // The value form, for inspect, doctor and a run.
  const down = releaseHost(Object.assign(new Error("api.github.com did not answer (ENETUNREACH)"), { code: "network-unavailable" }), {})
  assert.deepEqual(await checkNewestRelease({ pin, readJson: down.readJson, fetchStream: down.fetchStream }), { checked: false, code: "network-unavailable", reason: "api.github.com did not answer (ENETUNREACH)" })
  const odd = releaseHost({ message: "Not Found" }, {})
  assert.equal((await checkNewestRelease({ pin, readJson: odd.readJson, fetchStream: odd.fetchStream })).code, "release-unavailable")
})

test("bytes are printed in both units, every time, and a duration in minutes and seconds", () => {
  assert.equal(bytesBoth(6260654080), "6,260,654,080 B (6.261 GB / 5.831 GiB)")
  assert.equal(bytesBoth(0), "0 B (0.000 GB / 0.000 GiB)")
  assert.equal(durationWords(289513), "4m 49.5s")
  assert.equal(durationWords(357800), "5m 57.8s")
  assert.equal(durationWords(5215), "5.2s")
})

test("QEMU gets the overlay, the run's own firmware variables, no display, no host directory or socket, and SSH on 127.0.0.1 alone", () => {
  const args = qemuArgs({ overlay: "/lab/staging/run-1/run.qcow2", vars: "/lab/staging/run-1/vars.fd", memoryMiB: 5120, cpus: 4, sshPort: 2222, qmpSocket: "/lab/staging/run-1/qmp.sock", serialLog: "/lab/staging/run-1/serial.log", pidFile: "/lab/staging/run-1/qemu.pid" })
  const text = args.join(" ")
  assert.match(text, /-drive file=\/lab\/staging\/run-1\/run\.qcow2,format=qcow2,if=none,id=drive0/)
  assert.match(text, /-drive if=pflash,format=raw,file=\/lab\/staging\/run-1\/vars\.fd/, "the variables are the run's copy, never the base's template")
  assert.match(text, /-drive if=pflash,format=raw,readonly=on,file=\/usr\/share\/edk2/)
  assert.match(text, /-display none/)
  assert.match(text, /hostfwd=tcp:127\.0\.0\.1:2222-:22/)
  assert.equal((text.match(/hostfwd=/g) || []).length, 1, "one forward, SSH")
  for (const forbidden of ["-virtfs", "-fsdev", "virtio-9p", "virtiofs", "vhost-user-fs", "-chardev", "-spice", "-vnc", "-daemonize", "-snapshot", "base.qcow2", "/home/", "wayland", "WAYLAND"]) {
    assert.ok(!text.includes(forbidden), `QEMU's arguments contain ${forbidden}`)
  }
  assert.throws(() => qemuArgs({ overlay: "o", vars: "v", memoryMiB: 1, cpus: 1, sshPort: 22, qmpSocket: "q", serialLog: "s", pidFile: "p" }), /unprivileged port/)
})

test("SSH reaches the guest at the loopback address with the lab's key, no agent and no forwarding, and never writes the user's known_hosts", () => {
  const args = sshArgs({ key: "/lab/base/id_ed25519", port: 2222, user: "omarchy" })
  assert.equal(GUEST_HOST, "127.0.0.1")
  assert.equal(args.at(-1), "omarchy@127.0.0.1")
  assert.deepEqual(args.slice(0, 2), ["-i", "/lab/base/id_ed25519"])
  for (const option of ["BatchMode=yes", "IdentitiesOnly=yes", "IdentityAgent=none", "ForwardAgent=no", "ForwardX11=no", "UserKnownHostsFile=/dev/null"]) {
    assert.ok(args.includes(option), option)
  }
})

test("an absent /dev/kvm is told apart by where the process runs: a container, a loaded module without its node, or no module at all", () => {
  // Finding 11 of the first-user test: doctor said /dev/kvm was absent on
  // the machine whose lab suites had run hours earlier, because the
  // product ran inside a sandbox; the message blamed the kernel and the firmware.
  const gone = join(tmpdir(), "omakit-no-such-kvm")
  const inContainer = probeKvm(gone, () => ({ container: true, marks: ["/.dockerenv"], moduleLoaded: true }))
  assert.equal(inContainer.state, "missing")
  assert.match(inContainer.reason, /is a container \(\/\.dockerenv\); the host's device is not mapped in/)
  assert.match(inContainer.remedy, /--device \/dev\/kvm/)
  const noNode = probeKvm(gone, () => ({ container: false, marks: [], moduleLoaded: true }))
  assert.match(noNode.reason, /the kvm module is loaded .* the device node is missing/)
  const noModule = probeKvm(gone, () => ({ container: false, marks: [], moduleLoaded: false }))
  assert.match(noModule.reason, /no kvm module is loaded: virtualisation may be off in firmware/)
  // The context reader itself, over files that exist and files that do not.
  const { dir, rm } = scratch()
  try {
    writeFileSync(join(dir, "cgroup"), "0::/system.slice/docker-abc.scope\n")
    const marked = kvmContext({ files: { dockerenv: join(dir, "none"), containerenv: join(dir, "none"), cgroup: join(dir, "cgroup"), module: join(dir, "none") } })
    assert.deepEqual(marked, { container: true, marks: [`${join(dir, "cgroup")} names docker`], moduleLoaded: false })
    const clean = kvmContext({ files: { dockerenv: join(dir, "none"), containerenv: join(dir, "none"), cgroup: join(dir, "nowhere"), module: dir } })
    assert.deepEqual(clean, { container: false, marks: [], moduleLoaded: true })
  } finally {
    rm()
  }
})

test("the greeter password is typed as qcodes the way the toolchain typed it", () => {
  assert.deepEqual(qcodesFor("omarchy"), [["o"], ["m"], ["a"], ["r"], ["c"], ["h"], ["y"]])
  assert.deepEqual(qcodesFor("A-1 _"), [["shift", "a"], ["minus"], ["1"], ["spc"], ["shift", "minus"]])
  assert.throws(() => qcodesFor("é"), /no qcode/)
})

test("the guest is the only target: nothing under tools/lab reaches the host's session, and every spawned binary is on a list", () => {
  const files = readdirSync(join(REPO_ROOT, "tools/lab")).filter((name) => name.endsWith(".mjs"))
  const HOST_WORDS = /omarchy-shell|hyprctl|shell\.json|\.config\/omarchy|omarchy-plugin-|systemctl --user|quickshell|omarchy-restart-shell/
  const SPAWNED = new Set()
  for (const name of files) {
    const text = readFileSync(join(REPO_ROOT, "tools/lab", name), "utf8")
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    for (const [index, line] of code.split("\n").entries()) {
      if (!HOST_WORDS.test(line)) continue
      // A host word may appear only in a command sent into the guest over
      // SSH, or in the preamble that command runs under.
      assert.ok(/sshSession\(|sshGuest\(|SESSION_PREAMBLE|read\(/.test(line) || name === "guest.mjs" && /export const SESSION_PREAMBLE|^\s*"/.test(line),
        `tools/lab/${name}:${index + 1} names the host's session outside an ssh command: ${line.trim()}`)
    }
    for (const match of code.matchAll(/\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|run)\s*\(\s*(?:["'`]([^"'`]+)["'`]|(\w+))/g)) {
      SPAWNED.add(match[1] || `<${match[2]}>`)
    }
  }
  assert.deepEqual([...SPAWNED].sort(), ["<binary>", "<entry>", "bash", "git", "gpg", "qemu-img", "qemu-system-x86_64", "ssh", "uname"].sort())
  // The harness and the suites, in bash: a host word only in a command
  // sent through ssh_guest, ssh_session or guest_job, in a message, or in a
  // comment; never run on the host.
  for (const file of ["tools/lab/harness.sh", ...readdirSync(join(REPO_ROOT, "tools/lab/suites")).map((name) => `tools/lab/suites/${name}`)]) {
    const text = readFileSync(join(REPO_ROOT, file), "utf8")
    // A command continued with a trailing backslash is one line to bash and one line here.
    for (const [index, line] of text.replace(/\\\n\s*/g, " ").split("\n").entries()) {
      if (!HOST_WORDS.test(line) || /^\s*#/.test(line)) continue
      // A message about the guest's shell.json (an echo, a printf, a log
      // line) names it without reaching it; so does a grep over a log the
      // guest wrote and the harness copied into the run directory.
      assert.ok(/ssh_guest|ssh_session|guest_job|\b(?:echo|printf|log) |"\$RUN_DIR\//.test(line), `${file}:${index + 1} reaches the host's session: ${line.trim()}`)
    }
    assert.equal(spawnSync("bash", ["-n", join(REPO_ROOT, file)], { timeout: 120_000 }).status, 0, `${file} parses`)
    for (const [index, line] of text.split("\n").entries()) {
      if (/\bsudo\b/.test(line) && !/^\s*#/.test(line)) assert.ok(/ssh_guest|ssh_session/.test(line), `${file}:${index + 1} runs sudo on the host: ${line.trim()}`)
    }
  }
  const harness = readFileSync(join(REPO_ROOT, "tools/lab/harness.sh"), "utf8")
  assert.match(harness, /"\$GUEST_USER@127\.0\.0\.1"/, "the harness's ssh goes to the loopback address")
  // Every LAB_*, RUN_DIR, OMAKIT_DIR and GUEST_* value is assigned from a positional argument, never read from the environment.
  assert.doesNotMatch(harness, /\$\{(?:LAB_|OMAKIT_|GUEST_|RUN_DIR)[A-Z_]*:-|\b(?:LAB_|OMAKIT_|GUEST_)[A-Z_]*=\$\{?[A-Z_]+[:}]/, "the harness reads no environment variable of its own; every value is an argument")
  assert.match(harness, /^LAB_SUITE_FILE=\$1; RUN_DIR=\$2; /m)
})

test("inspect on an empty home reports everything missing with its cost and command, creates nothing, and doctor gets advice lines", async () => {
  const { env, layout, rm } = scratch()
  try {
    const lab = await inspectLab({ env, run: () => "", newest: found(RELEASE_403) })
    assert.equal(lab.download.present, false)
    assert.equal(lab.base.state, "missing")
    assert.equal(lab.toolchain.state, "missing")
    assert.ok(lab.missing.some((item) => item.what === "the verified ISO" && /6,260,654,080 B \(6\.261 GB \/ 5\.831 GiB\)/.test(item.cost) && item.command === "omakit lab setup"))
    assert.ok(lab.missing.some((item) => item.what === "the toolchain" && /git clone https:\/\/github\.com\/omacom-io\/omarchy-iso/.test(item.command) && item.command.includes(pin.toolchain.commit)))
    assert.ok(lab.missing.some((item) => item.what === "a prepared base" && /5m 57\.8s/.test(item.cost)))
    // Every path in every remedy is the resolved cache root, never ~/.cache (finding 6 of the first-user test).
    for (const item of lab.missing) {
      assert.ok(!/~\/\.cache|\/home\/[^/]+\/\.cache/.test(item.command || ""), `${item.what}: ${item.command}`)
      if (/toolchain/.test(item.what)) assert.ok(item.command.includes(join(layout.cache, "toolchain/omarchy-iso")), item.command)
    }
    assert.equal(existsSync(layout.cache), false, "inspect created no cache directory")
    assert.equal(existsSync(layout.state), false)
    const text = renderLab(lab, { colour: false, env })
    assert.match(text, /NOT PREPARED/)
    assert.doesNotMatch(text, //)
    const checks = labDoctorChecks(lab)
    assert.ok(checks.every((check) => ["ok", "advice", "info"].includes(check.state)), "the lab is optional: advice or information, never a problem")
    assert.ok(checks.some((check) => check.id === "lab.base" && check.state === "advice" && check.action === "omakit lab setup"))
    assert.ok(checks.some((check) => check.id === "lab.iso" && check.evidence.sha256 === RELEASE_403.sha256))
    assert.deepEqual(checks.find((check) => check.id === "lab.release").state, "info", "no base yet: the newest release is named, nothing to do about it here")
    // The release list unread and nothing on disk: nothing to hold an ISO to, and that is said.
    const unread = await inspectLab({ env, run: () => "", newest: { checked: false, code: "network-unavailable", reason: "api.github.com did not answer" } })
    assert.equal(unread.pin.release, null)
    assert.ok(unread.missing.some((item) => item.what === "the verified ISO" && /could not be looked up \(api\.github\.com did not answer\)/.test(item.cost)))
    assert.match(renderLab(unread, { colour: false, env }), /not looked up: api\.github\.com did not answer/)
    assert.equal(labDoctorChecks(unread).find((check) => check.id === "lab.release").state, "unknown")
    assert.equal(existsSync(layout.cache), false, "still nothing created")
  } finally {
    rm()
  }
})

test("a base is ready for its own release, outdated when a newer one or a republished ISO is out, a mismatch when newer than the newest or not its release's package, invalid when its files disagree", () => {
  const { env, layout, rm } = scratch()
  try {
    mkdirSync(layout.base, { recursive: true })
    assert.equal(inspectBase(layout).state, "invalid")
    writeFileSync(join(layout.base, BASE_FILES.disk), "qcow")
    writeFileSync(join(layout.base, BASE_FILES.vars), "vars")
    writeFileSync(join(layout.base, BASE_FILES.key), "key")
    const manifest = { state: "ready", release: { name: "4.0.3", sha256: RELEASE_403.sha256, bytes: RELEASE_403.bytes }, guest: { version: "4.0.3-1" }, disk: { bytes: 4, sha256: "x" }, vars: { sha256: "y" }, createdAt: "2026-09-18T00:00:00Z" }
    writeJson(layout.cache, "base/manifest.json", manifest)
    const at = (release) => inspectBase(layout, withRelease(pin, release))
    assert.equal(at(RELEASE_403).state, "ready")
    assert.equal(inspectBase(layout).state, "ready", "with no release to compare, a good base is usable")
    const release404 = releaseOf(pin, { name: "4.0.4", bytes: 6185304064, sha256: "d".repeat(64) })
    const outdated = at(release404)
    assert.equal(outdated.state, "outdated")
    assert.match(outdated.reason, /Omarchy 4\.0\.3 .*Omarchy 4\.0\.4 is the newest release\. A run still uses this base; `omakit lab setup` builds 4\.0\.4/)
    const republished = at(releaseOf(pin, { name: "4.0.3", bytes: RELEASE_403.bytes, sha256: "e".repeat(64) }))
    assert.equal(republished.state, "outdated")
    assert.match(republished.reason, /republished it/)
    const withdrawn = at(releaseOf(pin, { name: "4.0.2", bytes: 1, sha256: "f".repeat(64) }))
    assert.equal(withdrawn.state, "mismatch")
    assert.match(withdrawn.reason, /newer than 4\.0\.2, the newest release published now/)
    writeJson(layout.cache, "base/manifest.json", { ...manifest, guest: { version: "4.0.2-1" } })
    const wrongGuest = at(RELEASE_403)
    assert.equal(wrongGuest.state, "mismatch")
    assert.match(wrongGuest.reason, /another release's package/)
    writeJson(layout.cache, "base/manifest.json", { ...manifest, disk: { bytes: 5, sha256: "x" } })
    const invalid = inspectBase(layout)
    assert.equal(invalid.state, "invalid")
    assert.match(invalid.reason, /will not be booted/)
    const notReady = () => preflightRun({ suiteName: "run", env, repoRoot: REPO_ROOT })
    assert.throws(notReady, (error) => error instanceof LabError && error.code === "lab-not-ready" && error.missing.some((item) => /a ready base \(invalid\)/.test(item.what)))
    // An outdated base is one a run uses: the run holds the base to its own release.
    writeJson(layout.cache, "base/manifest.json", manifest)
    try {
      preflightRun({ suiteName: "run", env, repoRoot: REPO_ROOT })
    } catch (error) {
      assert.ok(!error.missing?.some((item) => /base/.test(item.what)), `a good base of an older release is not what stops a run: ${error.message}`)
    }
    assert.throws(() => preflightRun({ suiteName: "nosuch", env, repoRoot: REPO_ROOT }), (error) => error.code === "usage" && /run, store, weigh, weigh-evidence/.test(error.message))
  } finally {
    rm()
  }
})

test("the toolchain is judged by the harness's hash against the pin, even without the host's lab commands", () => {
  const { env, layout, dir, rm } = scratch()
  try {
    assert.equal(inspectToolchain(layout).state, "missing")
    const checkout = join(dir, "omarchy-iso")
    mkdirSync(join(checkout, "bin"), { recursive: true })
    writeFileSync(join(checkout, "bin/omarchy-iso-test"), "#!/bin/bash\necho not the harness\n")
    mkdirSync(layout.cache, { recursive: true })
    writeJson(layout.cache, "toolchain.json", { dir: checkout })
    const unknown = inspectToolchain(layout)
    assert.equal(unknown.state, "unknown")
    assert.match(unknown.reason, /neither the pinned patched harness nor the upstream one/)
    // Exercise the minimal GitHub runner from every development host: the
    // toolchain check must coexist with honest host-capability blockers.
    env.PATH = join(dir, "commands-not-installed")
    // Before the network: what no release changes, so a host that cannot
    // build hears so without a read of the release list.
    const early = planSetup({ env, repoRoot: REPO_ROOT })
    assert.equal(early.asked, false)
    assert.deepEqual(early.steps, [])
    assert.ok(early.blockers.some((item) => item.what === "gpg"), "the simulated runner lacks lab commands")
    assert.equal(early.blockers.filter((item) => item.what === "the toolchain").length, 1)
    const plan = planSetup({ env, newest: found(RELEASE_403), repoRoot: REPO_ROOT })
    assert.equal(plan.blockers.filter((item) => item.what === "the toolchain").length, 1)
    assert.ok(plan.steps.some((step) => step.kind === "download" && step.bytes === RELEASE_403.bytes && step.url === RELEASE_403.isoUrl))
    assert.ok(plan.steps.some((step) => step.kind === "build"))
    const lines = disclosureLines(plan)
    assert.deepEqual(lines[0], ["Omarchy", "release 4.0.3, the newest published (v4.0.3, 2026-09-08, found now in github.com/omacom/omarchy); the guest will run omarchy 4.0.3"])
    assert.equal(lines.find(([key]) => key === "download")[1], "6,260,654,080 B (6.261 GB / 5.831 GiB)")
    assert.equal(lines.find(([key]) => key === "from")[1], RELEASE_403.isoUrl)
    assert.match(lines.find(([key]) => key === "verify")[1], new RegExp(`${RELEASE_403.sha256} as published beside it, and the Omarchy signature ${RELEASE_403.signingFingerprint}, the key omakit ships`))
    assert.equal(lines.find(([key]) => key === "store")[1], layout.cache)
    assert.match(lines.find(([key]) => key === "build")[1], /5m 57\.8s measured with Omarchy 4\.0\.3 on the reference host \(M14\)/)
    assert.match(lines.find(([key]) => key === "on disk")[1], /^about 12,442,918,912 B \(12\.443 GB \/ 11\.588 GiB\): this ISO and a base the size Omarchy 4\.0\.3's measured \(M14\)/)
    // A newer tag passed over is named in the disclosure.
    const passed = disclosureLines(planSetup({ env, newest: found(RELEASE_403, { skipped: [{ name: "4.0.4", reason: "omarchy-4.0.4.iso is not published" }] }), repoRoot: REPO_ROOT }))
    assert.deepEqual(passed.find(([key]) => key === "newer"), ["newer", "4.0.4 is tagged and passed over: omarchy-4.0.4.iso is not published"])
    assert.equal(CONSENT_QUESTION, "Acquire and build this verified base now?")
    assert.match(renderSetupPlan(plan, { colour: false, env }), new RegExp(`cannot start: ${plan.blockers.length} missing`))
    assert.ok(plan.blockers.every((item) => item.cost && item.command), "every host-specific blocker says why it blocks setup and what to do")
  } finally {
    rm()
  }
})

/** A local origin serving one object with byte ranges, counting requests and what they carried. */
function origin(body, { ignoreRange = false, announce = null } = {}) {
  const requests = []
  const server = createServer((request, response) => {
    requests.push({ method: request.method, range: request.headers.range || null, authorization: request.headers.authorization || null })
    const range = !ignoreRange && request.headers.range?.match(/^bytes=(\d+)-$/)
    const from = range ? Number(range[1]) : 0
    const slice = body.subarray(from)
    response.writeHead(range ? 206 : 200, { "content-length": announce ?? slice.length, "content-type": "application/octet-stream" })
    response.end(slice)
  })
  return new Promise((resolvePromise) => server.listen(0, "127.0.0.1", () => resolvePromise({ url: `http://127.0.0.1:${server.address().port}/small.iso`, requests, close: () => server.close() })))
}

test("the download is a literal GET to a .part file, resumed by byte range, held to the pinned byte count, and never carries a credential", async () => {
  const body = Buffer.alloc(300000, 7)
  const { env, layout, rm } = scratch()
  const served = await origin(body)
  try {
    mkdirSync(join(layout.downloads, "x"), { recursive: true })
    const to = join(layout.downloads, "x", "small.iso")
    writeFileSync(`${to}.part`, body.subarray(0, 100000))
    const got = await downloadRelease({ url: served.url, to, bytes: body.length })
    assert.equal(got.bytes, body.length)
    assert.equal(sha256(readFileSync(`${to}.part`)), sha256(body), "the resumed file is the whole object")
    assert.equal(served.requests.length, 1)
    assert.equal(served.requests[0].method, "GET")
    assert.equal(served.requests[0].range, "bytes=100000-")
    assert.equal(served.requests[0].authorization, null, "no credential leaves for the ISO origin")
    // A server that ignores the range answers 200: the file starts over.
    const plain = await origin(body, { ignoreRange: true })
    try {
      writeFileSync(`${to}.part`, Buffer.alloc(50000, 1))
      await downloadRelease({ url: plain.url, to, bytes: body.length })
      assert.equal(sha256(readFileSync(`${to}.part`)), sha256(body))
    } finally {
      plain.close()
    }
    // A wrong announced size fails before a byte is written.
    const wrong = await origin(body, { announce: body.length + 1 })
    try {
      rmSync(`${to}.part`)
      await assert.rejects(downloadRelease({ url: wrong.url, to, bytes: body.length }), (error) => error.code === "size-mismatch" && /announces 300,001 B/.test(error.message))
      assert.equal(existsSync(`${to}.part`), false)
    } finally {
      wrong.close()
    }
  } finally {
    served.close()
    rm()
  }
})

/** A throwaway signing key: gpg quick-generates one in the scratch home, and its fingerprint stands in for the pinned signer. */
function testSigner(dir) {
  const home = join(dir, "gnupg")
  mkdirSync(home, { recursive: true, mode: 0o700 })
  const env = { ...process.env, GNUPGHOME: home }
  const made = spawnSync("gpg", ["--batch", "--quiet", "--pinentry-mode", "loopback", "--passphrase", "", "--quick-generate-key", "Lab Test <lab@example.invalid>", "ed25519", "sign", "0"], { timeout: 120_000, env, encoding: "utf8" })
  if (made.status !== 0) return null
  const fingerprint = spawnSync("gpg", ["--batch", "--with-colons", "--list-keys"], { timeout: 120_000, env, encoding: "utf8" }).stdout.match(/^fpr:+([0-9A-F]{40}):/m)[1]
  const keyFile = join(dir, "test.gpg")
  writeFileSync(keyFile, spawnSync("gpg", ["--batch", "--armor", "--export", fingerprint], { timeout: 120_000, env, encoding: "utf8" }).stdout)
  const sign = (file) => spawnSync("gpg", ["--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase", "", "--detach-sign", "--output", `${file}.sig`, file], { timeout: 120_000, env }).status === 0
  return { fingerprint, keyFile, sign }
}

test("verification fails closed: the byte count, the digest, the sidecar, the signature and the signer are each held to the pin, in a throwaway keyring", { skip: spawnSync("gpg", ["--version"], { timeout: 120_000 }).status !== 0 ? "no gpg" : false }, () => {
  const { dir, layout, rm } = scratch()
  try {
    const signer = testSigner(dir)
    if (!signer) return
    const body = Buffer.from("a small release standing in for the ISO\n".repeat(1000))
    const file = join(dir, "small.iso")
    writeFileSync(file, body)
    assert.ok(signer.sign(file))
    writeFileSync(`${file}.sha256`, `${sha256(body)}  small.iso\n`)
    mkdirSync(layout.staging, { recursive: true })
    const good = smallPin(body, { signingFingerprint: signer.fingerprint })
    const ok = judgeRelease({ file, signature: `${file}.sig`, checksum: `${file}.sha256`, pin: good, stagingRoot: layout.staging, keyFile: signer.keyFile })
    assert.equal(ok.ok, true)
    assert.equal(ok.signature.fingerprint, signer.fingerprint)
    assert.equal(ok.sidecarMatch, true)
    assert.equal(readdirSync(layout.staging).length, 0, "the throwaway keyring is gone")
    const wrongSigner = judgeRelease({ file, signature: `${file}.sig`, pin: smallPin(body, { signingFingerprint: pin.releases.signingFingerprint }), stagingRoot: layout.staging, keyFile: signer.keyFile })
    assert.equal(wrongSigner.ok, false)
    assert.match(wrongSigner.reason, /the signature is by .*, not the key omakit ships \(40DFB630/)
    const wrongDigest = judgeRelease({ file, signature: `${file}.sig`, pin: smallPin(body, { sha256: "0".repeat(64), signingFingerprint: signer.fingerprint }), stagingRoot: layout.staging, keyFile: signer.keyFile })
    assert.equal(wrongDigest.ok, false)
    assert.equal(wrongDigest.bytesMatch, true)
    assert.equal(wrongDigest.sha256Match, false)
    const wrongSize = judgeRelease({ file, signature: `${file}.sig`, pin: smallPin(Buffer.alloc(1), { signingFingerprint: signer.fingerprint }), stagingRoot: layout.staging, keyFile: signer.keyFile })
    assert.equal(wrongSize.bytesMatch, false)
    assert.equal(wrongSize.sha256, null, "the hash is not even computed for a wrong size")
    writeFileSync(file, Buffer.concat([body.subarray(0, body.length - 1), Buffer.from("X")]))
    const tampered = judgeRelease({ file, signature: `${file}.sig`, pin: good, stagingRoot: layout.staging, keyFile: signer.keyFile })
    assert.equal(tampered.ok, false)
    assert.equal(tampered.sha256Match, false)
    writeFileSync(file, body)
    const unsigned = judgeRelease({ file, signature: null, pin: good, stagingRoot: layout.staging, keyFile: signer.keyFile })
    assert.equal(unsigned.ok, false)
    assert.match(unsigned.reason, /no detached signature/)
    const badSig = verifySignature({ file, signature: `${file}.sha256`, keyFile: signer.keyFile, stagingRoot: layout.staging })
    assert.notEqual(badSig.state, "valid")
  } finally {
    rm()
  }
})

test("setup with steps and no consent refuses before a byte moves; an import is copied, verified and recorded, and a mismatching import is refused and never promoted", { skip: spawnSync("gpg", ["--version"], { timeout: 120_000 }).status !== 0 ? "no gpg" : false }, async () => {
  const { dir, env, layout, rm } = scratch()
  try {
    const signer = testSigner(dir)
    if (!signer) return
    const body = Buffer.from("release\n".repeat(5000))
    const file = join(dir, "local.iso")
    writeFileSync(file, body)
    signer.sign(file)
    writeFileSync(`${file}.sha256`, `${sha256(body)}  local.iso\n`)
    const small = smallPin(body, { signingFingerprint: signer.fingerprint, signingKey: "test.gpg", signingKeySha256: sha256File(signer.keyFile).sha256 })
    // The packaged key is read from LAB_DIR; for this pin it is the test key, so copy it beside the real one under a name the pin names.
    const packaged = join(LAB_DIR, "test.gpg")
    writeFileSync(packaged, readFileSync(signer.keyFile))
    try {
      const withToolchainDone = { ...small, measured: { ...small.measured } }
      const plan = planSetup({ env, pin: withToolchainDone, from: file, repoRoot: REPO_ROOT })
      // The build is blocked (no toolchain), so setup refuses on the blockers, not on consent.
      assert.ok(plan.blockers.some((item) => item.what === "the toolchain"))
      await assert.rejects(setupLab({ plan, consented: true, repoRoot: REPO_ROOT }), (error) => error.code === "lab-not-ready")
      assert.equal(existsSync(layout.downloads), false, "nothing was created on a blocked plan")
      // With a base already ready, only the import remains; without consent it refuses and creates nothing.
      mkdirSync(layout.base, { recursive: true })
      for (const name of [BASE_FILES.disk, BASE_FILES.vars, BASE_FILES.key]) writeFileSync(join(layout.base, name), "x")
      writeJson(layout.cache, "base/manifest.json", { state: "ready", release: { name: "4.0.3", sha256: small.release.sha256 }, guest: { version: "4.0.3-1" }, disk: { bytes: 1, sha256: "d" }, vars: { sha256: "v" }, createdAt: "now" })
      const importPlan = planSetup({ env, pin: small, newest: found(small.release), from: file, repoRoot: REPO_ROOT })
      assert.deepEqual(importPlan.blockers, [])
      assert.deepEqual(importPlan.steps.map((step) => step.kind), ["import", "sidecars"])
      await assert.rejects(setupLab({ plan: importPlan, consented: false, repoRoot: REPO_ROOT }), (error) => error.code === "not-confirmed" && error.remedy === "omakit lab setup --yes")
      assert.equal(existsSync(layout.downloads), false, "a refusal creates nothing")
      const result = await setupLab({ plan: importPlan, consented: true, repoRoot: REPO_ROOT, fetchStream: () => { throw new Error("no fetch for an import with sidecars beside it") } })
      assert.deepEqual(result.done.map((step) => step.kind), ["import", "verify"])
      const stored = join(layout.downloads, small.release.sha256, "small.iso")
      assert.equal(sha256(readFileSync(stored)), small.release.sha256)
      assert.equal(statSync(stored).mode & 0o777, 0o444, "the verified ISO is read-only")
      const record = JSON.parse(readFileSync(join(layout.downloads, small.release.sha256, "verified.json"), "utf8"))
      assert.equal(record.fingerprint, signer.fingerprint)
      assert.equal(record.name, "4.0.3", "the record names its release, so prune and a later setup can read it without the network")
      assert.equal(record.fileName, "small.iso")
      assert.equal(inspectDownload(layout, small).verified, true)
      assert.equal(existsSync(layout.lock), false, "the lock is released")
      // A file that is not the release: refused, left as .part, nothing recorded.
      const bad = join(dir, "bad.iso")
      writeFileSync(bad, Buffer.from("not the release\n".repeat(5000)))
      signer.sign(bad)
      const badPin = smallPin(Buffer.from("not the release\n".repeat(5000)), { sha256: small.release.sha256, signingFingerprint: signer.fingerprint, signingKey: "test.gpg", signingKeySha256: small.release.signingKeySha256, fileName: "bad.iso" })
      const badPlan = planSetup({ env: { ...env, XDG_CACHE_HOME: join(dir, "cache2") }, pin: badPin, newest: found(badPin.release), from: bad, repoRoot: REPO_ROOT })
      mkdirSync(join(dir, "cache2/omakit/lab/base"), { recursive: true })
      for (const name of [BASE_FILES.disk, BASE_FILES.vars, BASE_FILES.key]) writeFileSync(join(dir, "cache2/omakit/lab/base", name), "x")
      writeJson(join(dir, "cache2/omakit/lab"), "base/manifest.json", { state: "ready", release: { name: "4.0.3", sha256: badPin.release.sha256 }, guest: { version: "4.0.3-1" }, disk: { bytes: 1, sha256: "d" }, vars: { sha256: "v" }, createdAt: "now" })
      const badPlan2 = planSetup({ env: { ...env, XDG_CACHE_HOME: join(dir, "cache2") }, pin: badPin, newest: found(badPin.release), from: bad, repoRoot: REPO_ROOT })
      assert.deepEqual(badPlan2.blockers, [])
      await assert.rejects(setupLab({ plan: badPlan2, consented: true, repoRoot: REPO_ROOT }), (error) => error.code === "iso-mismatch" && /has digest/.test(error.message))
      const badDir = join(dir, "cache2/omakit/lab/downloads", badPin.release.sha256)
      assert.equal(existsSync(join(badDir, "bad.iso")), false, "never promoted")
      assert.equal(existsSync(join(badDir, "verified.json")), false, "never recorded")
      assert.ok(existsSync(join(badDir, "bad.iso.part")), "left where it is, named")
      void badPlan
    } finally {
      rmSync(packaged, { force: true })
    }
  } finally {
    rm()
  }
})

/** A base directory whose manifest names `release` with `guest`, the files a base holds beside it. */
function writeBase(layout, release, guest = `${release.name}-1`) {
  mkdirSync(layout.base, { recursive: true })
  for (const name of [BASE_FILES.disk, BASE_FILES.vars, BASE_FILES.key]) writeFileSync(join(layout.base, name), "x")
  writeJson(layout.cache, "base/manifest.json", { state: "ready", release: { name: release.name, sha256: release.sha256, bytes: release.bytes }, guest: { version: guest }, disk: { bytes: 1, sha256: "d" }, vars: { sha256: "v" }, createdAt: "2026-09-18T00:00:00Z" })
}

test("setup prepares the newest release: an outdated base is rebuilt and replaced after, older downloads go with it, and a lookup that failed leaves a usable base alone", () => {
  const { dir, env, layout, rm } = scratch()
  try {
    const release404 = releaseOf(pin, { name: "4.0.4", bytes: 6185304064, sha256: "d".repeat(64) })
    writeBase(layout, RELEASE_403)
    // The 4.0.3 ISO verified beside it, as a 0.6.8 setup left it (a record without a name).
    mkdirSync(join(layout.downloads, RELEASE_403.sha256), { recursive: true })
    writeFileSync(join(layout.downloads, RELEASE_403.sha256, RELEASE_403.fileName), Buffer.alloc(4096, 3))
    writeJson(layout.cache, `downloads/${RELEASE_403.sha256}/verified.json`, { schema: 1, sha256: RELEASE_403.sha256, bytes: 4096 })
    const plan = planSetup({ env, newest: found(release404), repoRoot: REPO_ROOT })
    assert.equal(plan.base.state, "outdated")
    assert.deepEqual(plan.steps.map((step) => step.kind), ["download", "sidecars", "build"])
    const build = plan.steps.find((step) => step.kind === "build")
    assert.equal(build.replacing.state, "outdated")
    assert.deepEqual(build.superseded.map((entry) => entry.digest), [RELEASE_403.sha256])
    const lines = disclosureLines(plan)
    assert.match(lines.find(([key]) => key === "replacing")[1], /^the outdated base there \(Omarchy 4\.0\.3, [\d,]+ B .*\), and one older download \(4\.0\.3\), [\d,]+ B .*, removed after the new base verifies; until then a run uses what is there$/, "a record from before 0.6.9 names no release; the ISO in its directory does")
    assert.equal(plan.steps.find((step) => step.kind === "download").url, "https://iso.omarchy.org/omarchy-4.0.4.iso")
    // The lookup failed: the 4.0.3 base stays, nothing is planned, and the plan says what was not checked.
    const stale = planSetup({ env, newest: { checked: false, code: "network-unavailable", reason: "api.github.com did not answer" }, repoRoot: REPO_ROOT })
    assert.deepEqual(stale.steps, [])
    assert.equal(stale.blockers.filter((item) => /newest/.test(item.what)).length, 0)
    assert.deepEqual(stale.stale, { base: "4.0.3", reason: "api.github.com did not answer", code: "network-unavailable" })
    assert.match(renderSetupPlan(stale, { colour: false, env }).replace(/\n\s+/g, " "), /PREPARED\s+the base on disk is Omarchy 4\.0\.3, left as it is: the newest release could not be looked up \(api\.github\.com did not answer\)/)
    // Current: nothing to acquire, and the release is named.
    writeBase(layout, release404)
    mkdirSync(join(layout.downloads, release404.sha256), { recursive: true })
    writeFileSync(join(layout.downloads, release404.sha256, release404.fileName), Buffer.alloc(16, 4))
    const st = statSync(join(layout.downloads, release404.sha256, release404.fileName))
    writeJson(layout.cache, `downloads/${release404.sha256}/verified.json`, { schema: 1, name: "4.0.4", fileName: release404.fileName, sha256: release404.sha256, bytes: 16, mtimeMs: st.mtimeMs })
    const current = planSetup({ env, pin: withRelease(pin, null), newest: found({ ...release404, bytes: 16 }), repoRoot: REPO_ROOT })
    assert.deepEqual(current.steps, [])
    assert.match(renderSetupPlan(current, { colour: false, env }).replace(/\n\s+/g, " "), /PREPARED\s+Omarchy 4\.0\.4, the newest release: the verified ISO and a ready base are there; nothing to acquire\./)
    // No base and no release: that is the blocker, with both ways out.
    rmSync(layout.base, { recursive: true })
    const nothing = planSetup({ env, newest: { checked: false, code: "network-unavailable", reason: "api.github.com did not answer" }, repoRoot: REPO_ROOT })
    const blocker = nothing.blockers.find((item) => item.what === "the newest Omarchy release")
    assert.ok(blocker)
    assert.match(blocker.cost, /could not be looked up: api\.github\.com did not answer/)
    assert.match(blocker.command, /--from <omarchy-X\.Y\.Z\.iso> with its \.sha256 and \.sig beside it/)
    void dir
  } finally {
    rm()
  }
})

test("--from is the newest release when the list can be read, and offline a file is taken only with its checksum and signature beside it, at or above the floor, by the key omakit ships", () => {
  const { dir, env, rm } = scratch()
  try {
    const release404 = releaseOf(pin, { name: "4.0.4", bytes: 16, sha256: "d".repeat(64) })
    const old = join(dir, "omarchy-4.0.3.iso")
    writeFileSync(old, Buffer.alloc(16))
    const online = planSetup({ env, newest: found(release404), from: old, repoRoot: REPO_ROOT })
    assert.ok(online.blockers.some((item) => item.what === "the file named by --from" && /is Omarchy 4\.0\.3; the newest release is 4\.0\.4, and setup prepares the newest/.test(item.cost)))
    // Offline: the file names its release, and its sidecars say the rest.
    const file = join(dir, "omarchy-4.0.4.iso")
    writeFileSync(file, Buffer.alloc(16, 9))
    assert.match(localRelease(pin, file).blocker.cost, /\.sha256 is missing/)
    writeFileSync(`${file}.sha256`, `${sha256(Buffer.alloc(16, 9))}  omarchy-4.0.4.iso\n`)
    assert.match(localRelease(pin, file).blocker.cost, /\.sig is not there/)
    writeFileSync(`${file}.sig`, SIG_404)
    const local = localRelease(pin, file)
    assert.equal(local.release.name, "4.0.4")
    assert.equal(local.release.sha256, sha256(Buffer.alloc(16, 9)))
    assert.equal(local.release.bytes, 16)
    const offline = planSetup({ env, newest: { checked: false, code: "offline", reason: "--offline" }, from: file, repoRoot: REPO_ROOT })
    assert.ok(offline.steps.some((step) => step.kind === "import" && step.from === file))
    assert.match(disclosureLines(offline)[0][1], /release 4\.0\.4, from the file named by --from; the newest could not be looked up \(--offline\)/)
    const rotated = Buffer.from(SIG_404)
    rotated[11] ^= 0xff
    writeFileSync(`${file}.sig`, rotated)
    assert.match(localRelease(pin, file).blocker.cost, /not the key omakit ships/)
    const below = join(dir, "omarchy-4.0.2.iso")
    writeFileSync(below, "x")
    assert.match(localRelease(pin, below).blocker.cost, /older than 4\.0\.3, the oldest release the lab takes/)
    const renamed = join(dir, "downloaded.iso")
    writeFileSync(renamed, "x")
    assert.match(localRelease(pin, renamed).blocker.cost, /names no release/)
  } finally {
    rm()
  }
})

test("a staged base is promoted only for the release it was built from, and a build's QEMU left running keeps prune off its directory", async () => {
  const { env, layout, rm } = scratch()
  try {
    const release404 = releaseOf(pin, { name: "4.0.4", bytes: 1, sha256: "d".repeat(64) })
    const staged = join(layout.staging, "base-20260923-094524")
    mkdirSync(join(staged, "build"), { recursive: true })
    for (const name of [BASE_FILES.disk, BASE_FILES.vars, BASE_FILES.key, BASE_FILES.publicKey]) writeFileSync(join(staged, name), "x")
    // A 0.6.8 build record names only the ISO path, and that path names the digest.
    writeJson(layout.cache, "staging/base-20260923-094524/build/lab-build.json", { iso: join(layout.downloads, RELEASE_403.sha256, RELEASE_403.fileName) })
    assert.deepEqual(stagedBases(layout, RELEASE_403), [staged])
    assert.deepEqual(stagedBases(layout, release404), [], "a 4.0.3 build is never promoted as 4.0.4")
    writeJson(layout.cache, "staging/base-20260923-094524/build/lab-build.json", { release: { name: "4.0.4", sha256: release404.sha256 } })
    assert.deepEqual(stagedBases(layout, release404), [staged])
    // A daemonized build QEMU: its pidfile under the build's directory, its command line naming it.
    const build = join(layout.staging, "build-20260923-094524")
    const runDir = join(build, "test-runs", "omarchy-4.0.3", "runs", "20260923-094524")
    mkdirSync(runDir, { recursive: true })
    const { spawn } = await import("node:child_process")
    // A process that holds still with the build's disk on its command line, as the toolchain's QEMU has it.
    const guest = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)", `${build}/test-runs/omarchy-4.0.3/base.qcow2`], { stdio: "ignore" })
    try {
      await new Promise((resolvePromise) => guest.once("spawn", resolvePromise))
      writeFileSync(join(runDir, "qemu.pid"), `${guest.pid}\n`)
      assert.deepEqual(buildGuests(build).map((entry) => entry.pid), [guest.pid])
      const staging = await inspectStaging(layout)
      assert.equal(staging.find((entry) => entry.name === "build-20260923-094524").alive, true)
      const busy = await planPrune({ env })
      assert.ok(busy.blockers.length >= 1, "prune will not remove a directory a QEMU is writing to")
      // A pidfile whose pid is another process (reused) is not taken for the guest.
      writeFileSync(join(runDir, "qemu.pid"), `${process.pid}\n`)
      assert.deepEqual(buildGuests(build), [])
    } finally {
      guest.kill("SIGKILL")
    }
  } finally {
    rm()
  }
})

test("inspect says when the base is behind, without calling it missing, and doctor carries it as one piece of advice", async () => {
  const { env, layout, rm } = scratch()
  try {
    writeBase(layout, RELEASE_403)
    const release404 = releaseOf(pin, { name: "4.0.4", bytes: 6185304064, sha256: "d".repeat(64) })
    const lab = await inspectLab({ env, run: () => "", newest: found(release404, { tag: "v4.0.4", publishedAt: "2026-09-15T21:39:29Z" }) })
    assert.equal(lab.base.state, "outdated")
    assert.ok(!lab.missing.some((item) => /base|ISO/.test(item.what)), "a run uses an outdated base: it is not missing")
    assert.equal(lab.behind.base, "4.0.3")
    assert.equal(lab.behind.newest, "4.0.4")
    const text = renderLab(lab, { colour: false, env }).replace(/\n\s+/g, " ")
    assert.match(text, /behind\s+Omarchy 4\.0\.4 is out and the base is 4\.0\.3: a download of 6,185,304,064 B .*the base there stays until the new one verifies → omakit lab setup/, "said even while the host lacks what a run needs")
    const ready = renderLab({ ...lab, missing: [] }, { colour: false, env }).replace(/\n\s+/g, " ")
    assert.match(ready, /PREPARED\s+on Omarchy 4\.0\.3, which a run uses; Omarchy 4\.0\.4 is the newest, and `?omakit lab setup`? builds it/)
    assert.match(text, /Omarchy 4\.0\.4 \(v4\.0\.4, published 2026-09-15\), the newest in github\.com\/omacom\/omarchy/)
    const checks = labDoctorChecks(lab)
    const release = checks.find((check) => check.id === "lab.release")
    assert.equal(release.state, "advice")
    assert.equal(release.action, "omakit lab setup")
    assert.match(release.detail, /Omarchy 4\.0\.4 is the newest release; the lab's base is 4\.0\.3, and a run still uses it/)
    assert.equal(checks.find((check) => check.id === "lab.base").state, "ok", "the base itself is fine; the release check carries the advice once")
    assert.equal(checks.find((check) => check.id === "lab.iso").state, "info")
    assert.equal(releaseCheck({ ...lab, newest: { checked: false, code: "offline", reason: "--offline" } }).state, "info")
    assert.equal(releaseCheck({ ...lab, base: { ...lab.base, state: "ready" }, newest: found(RELEASE_403) }).state, "ok")
  } finally {
    rm()
  }
})

test("the lock is one directory: a second taker is refused while the holder lives, and a stale one is taken over", async () => {
  const { env, layout, rm } = scratch()
  try {
    const first = await acquireLock(layout, { runId: "one", pid: process.pid, qmpSocket: null })
    assert.equal(first.taken, true)
    await assert.rejects(acquireLock(layout, { runId: "two", pid: process.pid, qmpSocket: null }), (error) => error.code === "lab-busy" && /in use by run one/.test(error.message))
    assert.equal(releaseLock(layout, "two"), false, "another run cannot release it")
    assert.equal(releaseLock(layout, "one"), true)
    mkdirSync(layout.lock, { recursive: true })
    writeJson(layout.cache, "lab.lock/holder.json", { runId: "dead", pid: 2 ** 22 - 1, qmpSocket: join(layout.staging, "nowhere.sock") })
    const taken = await acquireLock(layout, { runId: "three", pid: process.pid, qmpSocket: null })
    assert.equal(taken.stale?.runId, "dead")
    releaseLock(layout, "three")
    void env
  } finally {
    rm()
  }
})

test("prune lists what the lab owns with its bytes, refuses while a QEMU answers on a staged socket, removes only its targets, and reports recovered and remaining bytes", async () => {
  const { env, layout, rm } = scratch()
  try {
    mkdirSync(join(layout.staging, "run-old"), { recursive: true })
    writeFileSync(join(layout.staging, "run-old/run.qcow2"), Buffer.alloc(65536, 1))
    mkdirSync(join(layout.downloads, RELEASE_403.sha256), { recursive: true })
    writeFileSync(join(layout.downloads, RELEASE_403.sha256, `${RELEASE_403.fileName}.part`), Buffer.alloc(8192, 2))
    mkdirSync(layout.runs, { recursive: true })
    writeFileSync(join(layout.runs, "record.json"), "{}")
    const plan = await planPrune({ env })
    assert.deepEqual(plan.blockers, [])
    assert.deepEqual(plan.targets.map((target) => target.relative).sort(), [`downloads/${RELEASE_403.sha256}`, "staging/run-old"])
    assert.ok(plan.total >= 65536 + 8192)
    assert.ok(!plan.targets.some((target) => target.relative === "runs"), "run records stay unless --records")
    const withRecords = await planPrune({ env, runs: true })
    assert.ok(withRecords.targets.some((target) => target.relative === "runs"))
    // A staged QEMU that answers: a socket speaking the QMP greeting.
    const socket = join(layout.staging, "run-live", "qmp.sock")
    mkdirSync(join(layout.staging, "run-live"), { recursive: true })
    const server = createUnixServer((connection) => {
      connection.write(`${JSON.stringify({ QMP: { version: {}, capabilities: [] } })}\n`)
      connection.on("data", () => connection.write(`${JSON.stringify({ return: { status: "running", running: true } })}\n`))
    })
    await new Promise((resolvePromise) => server.listen(socket, resolvePromise))
    try {
      const busy = await planPrune({ env })
      assert.ok(busy.blockers.some((line) => line.includes(socket)))
      assert.throws(() => prune(busy), (error) => error.code === "lab-busy")
      assert.ok(existsSync(join(layout.staging, "run-old/run.qcow2")), "nothing removed under a refusal")
    } finally {
      await new Promise((resolvePromise) => server.close(resolvePromise))
    }
    rmSync(join(layout.staging, "run-live"), { recursive: true, force: true })
    const result = prune(await planPrune({ env }))
    assert.equal(result.removed.length, 2)
    assert.equal(existsSync(join(layout.staging, "run-old")), false)
    assert.equal(existsSync(join(layout.downloads, RELEASE_403.sha256)), false)
    assert.ok(existsSync(join(layout.runs, "record.json")), "records untouched")
    assert.match(result.words, /^recovered [\d,]+ B .* remain in the lab cache and [\d,]+ B .* in run records$/)
  } finally {
    rm()
  }
})

test("every write under tools/lab goes through the lab root guard, and the guard refuses a path outside it", () => {
  assert.throws(() => inLab("/tmp/lab", "../etc/passwd"), /outside/)
  assert.equal(inLab("/tmp/lab", "base", "manifest.json"), "/tmp/lab/base/manifest.json")
  const { dir, rm } = scratch()
  try {
    mkdirSync(join(dir, "a/b"), { recursive: true })
    writeFileSync(join(dir, "a/b/c"), Buffer.alloc(4096))
    assert.ok(allocatedBytes(join(dir, "a")) >= 4096)
  } finally {
    rm()
  }
})

test("the suites are data: each names its host file, its document, its files, and an assertion that reads the document's shape", () => {
  assert.deepEqual(suiteNames(), ["run", "store", "weigh", "weigh-evidence"])
  for (const suite of Object.values(SUITES)) {
    assert.ok(existsSync(suite.host), `${suite.host} exists`)
    assert.ok(suite.needs.length > 0)
    assert.match(suite.document, /\.json$/)
    assert.ok(suite.timeoutSeconds > 0)
  }
  assert.equal(SUITES.run.assert({ ok: true, summary: new Array(19).fill({}) }).ok, true)
  assert.equal(SUITES.run.assert({ ok: true, summary: Object.fromEntries(new Array(19).fill(0).map((_, index) => [`scenario-${index}`, {}])) }).ok, true, "the reader keys the summary by scenario")
  assert.equal(SUITES.run.assert({ ok: true, summary: new Array(18).fill({}) }).ok, false)
  assert.equal(SUITES.store.assert({ ok: true, scenarios: [...new Array(14).fill({ scenario: "x" }), { scenario: "foreign-owner", skipped: null }] }).ok, true)
  assert.equal(SUITES.store.assert({ ok: true, scenarios: [...new Array(14).fill({ scenario: "x" }), { scenario: "foreign-owner", skipped: "no sudo" }] }).ok, false)
  assert.equal(SUITES.weigh.assert({ config: { restored: true } }).ok, true)
  assert.equal(SUITES.weigh.assert({ config: { restored: false } }).ok, false)
  const { env, layout, rm } = scratch()
  try {
    assert.deepEqual(suitePreflight(SUITES.run, { repoRoot: REPO_ROOT, layout }), [], "the Run suite's files are in this checkout")
    const missing = suitePreflight(SUITES.run, { repoRoot: join(env.HOME, "nowhere"), layout })
    assert.ok(missing.length === SUITES.run.needs.length && missing.every((item) => /the tree is incomplete/.test(item.cost) && item.command === "npm i -g omakit, then run it again"))
    // A checkout's remedy names the checkout's own entry point, never a global package (finding 5).
    const checkoutMissing = suitePreflight({ ...SUITES.run, needs: ["tests/lab/run/nothing-here"] }, { repoRoot: REPO_ROOT, layout })
    assert.equal(checkoutMissing.length, 1)
    const remedy = existsSync(join(REPO_ROOT, ".git"))
      ? `git -C ${REPO_ROOT} checkout -- tests/lab/run/nothing-here && ${join(REPO_ROOT, "bin/omakit")} lab prove run`
      : "npm i -g omakit, then run it again"
    assert.equal(checkoutMissing[0].command, remedy)
    const evidence = suitePreflight(SUITES["weigh-evidence"], { repoRoot: REPO_ROOT, layout, pinDir: join(env.HOME, "nopin") })
    assert.ok(evidence.some((item) => /in the pinned catalog/.test(item.what) && item.command === "omakit pin"))
  } finally {
    rm()
  }
})

test("the command surface: one `lab` entry with four actions in the help, the option table, and tab completion, and the suites offered after run", () => {
  const entry = COMMANDS.find((command) => [].concat(command.signature)[0].startsWith("omakit lab"))
  assert.ok(entry)
  assert.deepEqual([].concat(entry.signature).map((line) => line.split(" ")[2]), ["prove", "inspect", "setup", "prune"])
  assert.deepEqual(ACCEPTED.lab.positionals, 2)
  const sub = subcommandsOf(COMMANDS).find((command) => command.name === "lab")
  assert.equal(sub.target, "lab")
  assert.deepEqual(sub.actions, [...LAB_ACTIONS])
  assert.deepEqual(sub.suites, suiteNames())
})

test("the entry point: an unknown suite is a usage error, a bare lab is one, run on an empty home refuses with what is missing and no escape byte, twice the same bytes", () => {
  const { env, rm } = scratch()
  try {
    const run = (args) => spawnSync(process.execPath, [join(REPO_ROOT, "bin/omakit"), "lab", ...args], { timeout: 120_000, encoding: "utf8", env: { ...env, NODE_NO_WARNINGS: "1" } })
    assert.equal(run([]).status, 2)
    assert.equal(run(["prove"]).status, 2)
    const unknown = run(["prove", "nosuch"])
    assert.equal(unknown.status, 2)
    assert.match(unknown.stderr, /no suite named "nosuch"/)
    const first = run(["prove", "run"])
    assert.equal(first.status, 1)
    assert.match(first.stderr, /lab-not-ready/)
    assert.match(first.stderr, /a ready base \(missing\)/)
    assert.match(first.stderr, /omakit lab setup/)
    assert.doesNotMatch(first.stderr + first.stdout, //)
    const second = run(["prove", "run"])
    assert.equal(second.stderr, first.stderr, "byte-identical on a pipe")
    const inspect = run(["inspect", "--offline", "--json"])
    assert.equal(inspect.status, 1)
    const document = JSON.parse(inspect.stdout)
    assert.equal(document.base.state, "missing")
    assert.ok(document.missing.length >= 3)
    const setup = run(["setup"])
    assert.equal(setup.status, 1, "no toolchain: blocked before consent")
    assert.equal(setup.stdout, "", "a blocked plan is a failure, on stderr")
    assert.match(setup.stderr, /cannot start/)
    const setupJson = run(["setup", "--json"])
    assert.equal(setupJson.status, 1)
    assert.equal(JSON.parse(setupJson.stdout).error.code, "lab-blocked")
    assert.ok(Array.isArray(JSON.parse(setupJson.stdout).blockers), "the plan rides in the document")
    const pruneNothing = run(["prune"])
    assert.equal(pruneNothing.status, 0)
    assert.match(pruneNothing.stdout, /NOTHING TO PRUNE/)
    assert.match(pruneNothing.stdout, /--records removes them/, "the remedy names the option that exists")
    assert.doesNotMatch(pruneNothing.stdout, /--runs/)
    const pruneJson = run(["prune", "--json"])
    assert.equal(pruneJson.status, 0)
    assert.deepEqual(Object.keys(JSON.parse(pruneJson.stdout)).slice(0, 3), ["command", "ok", "error"], "nothing to prune is a document too")
    assert.equal(existsSync(join(env.XDG_CACHE_HOME, "omakit/lab")), false, "none of these created the lab cache")
  } finally {
    rm()
  }
})

test("a presence-only probe says the command is there, never the error line its probe printed", () => {
  // Measured on 2026-09-19: doctor showed "ok  ssh-keygen  /dev/null is not
  // a public key file." because the probe that avoids generating a key is
  // a read that fails, and its first output line was taken for a version.
  const keygen = BUILD_COMMANDS.find((entry) => entry.command === "ssh-keygen")
  assert.equal(keygen.presenceOnly, true)
  const [line] = probeCommands([keygen], { run: () => ({ status: 255, stdout: "", stderr: "/dev/null is not a public key file.\n" }) })
  assert.equal(line.state, "ok")
  assert.equal(line.reason, "ssh-keygen is on PATH (openssh)")
  const [missing] = probeCommands([keygen], { run: () => ({ error: { code: "ENOENT" } }) })
  assert.equal(missing.state, "missing")
  assert.match(missing.remedy, /pacman -S --needed openssh/)
  const [versioned] = probeCommands([BUILD_COMMANDS.find((entry) => entry.command === "socat")], { run: () => ({ status: 0, stdout: "socat version 1.8.0.0 on Jan 1\n" }) })
  assert.equal(versioned.reason, "socat version 1.8.0.0 on Jan 1", "a command with a version keeps its version line")
})

test("an absent /dev/kvm in a mount namespace without the host's /dev is said to be that, through the real entry point", (t) => {
  // The acceptance tester of 2026-09-19 could not reach this wording on a
  // host whose /dev/kvm works. `unshare -rm` gives the process a mount
  // namespace of its own; a directory with only null, zero, urandom and tty
  // bound in is mounted over /dev, and omakit runs in it. Skipped where user
  // namespaces are unavailable, never faked.
  if (process.platform !== "linux") return t.skip("Linux-only: mount namespaces")
  if (spawnSync("unshare", ["-rm", "true"], { timeout: 60_000 }).status !== 0) return t.skip("unshare -rm is not available here")
  if (!existsSync("/sys/module/kvm")) return t.skip("no kvm module is loaded here, so the wording under test is another one")
  const dir = mkdtempSync(join(tmpdir(), "omakit-no-kvm-"))
  try {
    const script = join(dir, "probe.sh")
    writeFileSync(script, ["set -e", `D=${JSON.stringify(join(dir, "dev"))}`, "mkdir -p \"$D/shm\" \"$D/pts\"", "for f in null zero urandom tty; do : > \"$D/$f\"; mount --bind /dev/$f \"$D/$f\"; done", "mount --bind \"$D\" /dev", 'exec "$@"'].join("\n"))
    chmodSync(script, 0o755)
    const result = spawnSync("unshare", ["-rm", "bash", script, process.execPath, join(REPO_ROOT, "bin/omakit"), "lab", "inspect", "--json"], { timeout: 120_000, encoding: "utf8", env: { ...process.env, HOME: dir, XDG_CACHE_HOME: join(dir, "cache"), XDG_STATE_HOME: join(dir, "state"), TERM: "dumb" } })
    assert.equal(result.status, 1, result.stderr)
    const document = JSON.parse(result.stdout)
    const kvm = document.host.run.find((line) => line.name === "kvm")
    assert.equal(kvm.state, "missing")
    assert.match(kvm.reason, /the kvm module is loaded \(\/sys\/module\/kvm exists\): the device node is missing, or this process runs in a mount namespace without the host's \/dev/)
    assert.match(kvm.remedy, /run omakit outside the sandbox/)
    assert.ok(document.error.missing.some((item) => item.what === "kvm"), "and the refusal lists it")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
