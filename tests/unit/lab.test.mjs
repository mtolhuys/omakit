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
import { bytesBoth, durationWords, labPin, LAB_DIR } from "../../tools/lab/pin.mjs"
import { allocatedBytes, inLab, labLayout, writeJson } from "../../tools/lab/paths.mjs"
import { qcodesFor, qemuArgs } from "../../tools/lab/qemu.mjs"
import { BUILD_COMMANDS, kvmContext, probeCommands, probeKvm } from "../../tools/lab/host.mjs"
import { GUEST_HOST, sshArgs } from "../../tools/lab/guest.mjs"
import { judgeRelease, sha256File, verifySignature } from "../../tools/lab/verify.mjs"
import { BASE_FILES, inspectBase, inspectDownload, inspectLab, inspectToolchain } from "../../tools/lab/inspect.mjs"
import { CONSENT_QUESTION, disclosureLines, downloadRelease, planSetup, setupLab } from "../../tools/lab/setup.mjs"
import { acquireLock, LabError, preflightRun, releaseLock } from "../../tools/lab/run.mjs"
import { planPrune, prune } from "../../tools/lab/prune.mjs"
import { SUITES, suiteNames, suitePreflight } from "../../tools/lab/suites.mjs"
import { labDoctorChecks, renderLab, renderSetupPlan } from "../../tools/lab/report.mjs"
import { ACCEPTED } from "../../tools/marketplace/options.mjs"
import { LAB_ACTIONS, subcommandsOf } from "../../tools/marketplace/completion.mjs"
import { COMMANDS } from "../../tools/marketplace/usage.mjs"

const pin = labPin()

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "omakit-lab-"))
  const env = { ...process.env, HOME: join(dir, "home"), XDG_CACHE_HOME: join(dir, "cache"), XDG_STATE_HOME: join(dir, "state") }
  mkdirSync(env.HOME, { recursive: true })
  return { dir, env, layout: labLayout(env), rm: () => rmSync(dir, { recursive: true, force: true }) }
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex")

/** A small release standing in for the pinned one: a few KiB, its own digest, the real signer fields. */
function smallPin(body, overrides = {}) {
  return { ...pin, release: { ...pin.release, bytes: body.length, sha256: sha256(body), fileName: "small.iso", ...overrides } }
}

test("the pin names one release with a 64-character digest, a 40-character signer and no latest, and the packaged key hashes to the pin", () => {
  assert.equal(pin.release.name, "4.0.3")
  assert.match(pin.release.sha256, /^[0-9a-f]{64}$/)
  assert.match(pin.release.signingFingerprint, /^[0-9A-F]{40}$/)
  assert.equal(pin.release.bytes, 6260654080)
  assert.doesNotMatch(pin.release.isoUrl, /latest/i)
  assert.equal(pin.release.isoUrl, "https://iso.omarchy.org/omarchy-4.0.3.iso")
  assert.equal(sha256File(join(LAB_DIR, pin.release.signingKey)).sha256, pin.release.signingKeySha256)
  const key = readFileSync(join(LAB_DIR, pin.release.signingKey), "utf8")
  assert.match(key, /^-----BEGIN PGP PUBLIC KEY BLOCK-----/, "the packaged key is armoured text, never a binary blob")
  assert.equal(pin.release.expectedGuestVersion, "4.0.3-1")
  assert.equal(pin.toolchain.commit, "268bac16d351a21d867e37565738f458b11cb06c")
  const patch = readFileSync(join(LAB_DIR, pin.toolchain.patch), "utf8")
  assert.match(patch, /Beautiful, Fun & Agentic Linux by DHH/, "the patch knows the 4.0.3 installer's greeter (inventory P12)")
  assert.match(patch, /^-omarchy-pkg-add /m, "the patch removes the host package install (inventory P10)")
  assert.match(patch, /\+ *--host-test\)/, "the patch carries the host-test extension")
  for (const key of ["buildMilliseconds", "baseAllocatedBytes", "baseDirectoryBytes", "preparedLabBytes", "overlayAfterRunBytes"]) {
    assert.ok(Number.isInteger(pin.measured[key]) && pin.measured[key] > 0, `${key} is a measured integer`)
  }
})

test("a pin that resolves latest, or whose digest is not a digest, is refused at read time", () => {
  const { dir, rm } = scratch()
  try {
    const file = join(dir, "pin.json")
    writeFileSync(file, JSON.stringify({ ...pin, release: { ...pin.release, isoUrl: "https://iso.omarchy.org/latest.iso" } }))
    assert.throws(() => labPin(file), /resolves latest/)
    writeFileSync(file, JSON.stringify({ ...pin, release: { ...pin.release, sha256: "abc" } }))
    assert.throws(() => labPin(file), /64 hex/)
  } finally {
    rm()
  }
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
    const lab = await inspectLab({ env, run: () => "" })
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
    assert.ok(checks.every((check) => ["ok", "advice"].includes(check.state)), "the lab is optional: advice, never a problem")
    assert.ok(checks.some((check) => check.id === "lab.base" && check.state === "advice" && check.action === "omakit lab setup"))
    assert.ok(checks.some((check) => check.id === "lab.iso" && check.evidence.sha256 === pin.release.sha256))
  } finally {
    rm()
  }
})

test("a base is ready only with a complete manifest for the pinned release and guest; another release is a mismatch; a wrong size is invalid", () => {
  const { env, layout, rm } = scratch()
  try {
    mkdirSync(layout.base, { recursive: true })
    assert.equal(inspectBase(layout).state, "invalid")
    writeFileSync(join(layout.base, BASE_FILES.disk), "qcow")
    writeFileSync(join(layout.base, BASE_FILES.vars), "vars")
    writeFileSync(join(layout.base, BASE_FILES.key), "key")
    const manifest = { state: "ready", release: { name: "4.0.3", sha256: pin.release.sha256 }, guest: { version: "4.0.3-1" }, disk: { bytes: 4, sha256: "x" }, vars: { sha256: "y" }, createdAt: "2026-09-18T00:00:00Z" }
    writeJson(layout.cache, "base/manifest.json", manifest)
    assert.equal(inspectBase(layout).state, "ready")
    writeJson(layout.cache, "base/manifest.json", { ...manifest, release: { name: "4.0.4", sha256: "f".repeat(64) } })
    const mismatch = inspectBase(layout)
    assert.equal(mismatch.state, "mismatch")
    assert.match(mismatch.reason, /cached Omarchy 4\.0\.4 .*required 4\.0\.3/)
    writeJson(layout.cache, "base/manifest.json", { ...manifest, guest: { version: "4.0.2-1" } })
    assert.equal(inspectBase(layout).state, "mismatch")
    writeJson(layout.cache, "base/manifest.json", { ...manifest, disk: { bytes: 5, sha256: "x" } })
    const invalid = inspectBase(layout)
    assert.equal(invalid.state, "invalid")
    assert.match(invalid.reason, /will not be booted/)
    const notReady = () => preflightRun({ suiteName: "run", env, repoRoot: REPO_ROOT })
    assert.throws(notReady, (error) => error instanceof LabError && error.code === "lab-not-ready" && error.missing.some((item) => /a ready base \(invalid\)/.test(item.what)))
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
    const plan = planSetup({ env, repoRoot: REPO_ROOT })
    assert.ok(plan.blockers.some((item) => item.what === "gpg"), "the simulated runner lacks lab commands")
    assert.equal(plan.blockers.filter((item) => item.what === "the toolchain").length, 1)
    assert.ok(plan.steps.some((step) => step.kind === "download" && step.bytes === pin.release.bytes && step.url === pin.release.isoUrl))
    assert.ok(plan.steps.some((step) => step.kind === "build"))
    const lines = disclosureLines(plan)
    assert.deepEqual(lines[0], ["Omarchy", "release 4.0.3; installed guest expected 4.0.3-1"])
    assert.equal(lines.find(([key]) => key === "download")[1], "6,260,654,080 B (6.261 GB / 5.831 GiB)")
    assert.equal(lines.find(([key]) => key === "from")[1], pin.release.isoUrl)
    assert.match(lines.find(([key]) => key === "verify")[1], new RegExp(`${pin.release.sha256}.*${pin.release.signingFingerprint}`))
    assert.equal(lines.find(([key]) => key === "store")[1], layout.cache)
    assert.match(lines.find(([key]) => key === "on disk")[1], /12,442,931,200 B \(12\.443 GB \/ 11\.588 GiB\)/)
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
    const wrongSigner = judgeRelease({ file, signature: `${file}.sig`, pin: smallPin(body, { signingFingerprint: pin.release.signingFingerprint }), stagingRoot: layout.staging, keyFile: signer.keyFile })
    assert.equal(wrongSigner.ok, false)
    assert.match(wrongSigner.reason, /the signature is by .* the pin says 40DFB630/)
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
      const importPlan = planSetup({ env, pin: small, from: file, repoRoot: REPO_ROOT })
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
      assert.equal(inspectDownload(layout, small).verified, true)
      assert.equal(existsSync(layout.lock), false, "the lock is released")
      // A file that is not the release: refused, left as .part, nothing recorded.
      const bad = join(dir, "bad.iso")
      writeFileSync(bad, Buffer.from("not the release\n".repeat(5000)))
      signer.sign(bad)
      const badPin = smallPin(Buffer.from("not the release\n".repeat(5000)), { sha256: small.release.sha256, signingFingerprint: signer.fingerprint, signingKey: "test.gpg", signingKeySha256: small.release.signingKeySha256, fileName: "bad.iso" })
      const badPlan = planSetup({ env: { ...env, XDG_CACHE_HOME: join(dir, "cache2") }, pin: badPin, from: bad, repoRoot: REPO_ROOT })
      mkdirSync(join(dir, "cache2/omakit/lab/base"), { recursive: true })
      for (const name of [BASE_FILES.disk, BASE_FILES.vars, BASE_FILES.key]) writeFileSync(join(dir, "cache2/omakit/lab/base", name), "x")
      writeJson(join(dir, "cache2/omakit/lab"), "base/manifest.json", { state: "ready", release: { name: "4.0.3", sha256: badPin.release.sha256 }, guest: { version: "4.0.3-1" }, disk: { bytes: 1, sha256: "d" }, vars: { sha256: "v" }, createdAt: "now" })
      const badPlan2 = planSetup({ env: { ...env, XDG_CACHE_HOME: join(dir, "cache2") }, pin: badPin, from: bad, repoRoot: REPO_ROOT })
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
    mkdirSync(join(layout.downloads, pin.release.sha256), { recursive: true })
    writeFileSync(join(layout.downloads, pin.release.sha256, `${pin.release.fileName}.part`), Buffer.alloc(8192, 2))
    mkdirSync(layout.runs, { recursive: true })
    writeFileSync(join(layout.runs, "record.json"), "{}")
    const plan = await planPrune({ env })
    assert.deepEqual(plan.blockers, [])
    assert.deepEqual(plan.targets.map((target) => target.relative).sort(), [`downloads/${pin.release.sha256}`, "staging/run-old"])
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
    assert.equal(existsSync(join(layout.downloads, pin.release.sha256)), false)
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
    const inspect = run(["inspect", "--json"])
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
