# Omakit Lab: acquisition, provenance, and lifecycle plan

## Status

This is the design and acceptance contract `omakit lab` was built to, on
2026-09-18, in 0.6.0 (`docs/LAB.md` is what shipped; `docs/history/2026-09-18-lab-inventory.md`
is what it replaced). The scope decision this plan asked for landed in
one change: `tests/unit/self-containment.test.mjs` now asserts no image
instead of no lab, `AGENTS.md` names the lab as the fourth exception, the
completion contract knows `lab` and its suites, and the package assertion
carries a newly measured ceiling. Where 0.6.0 departs from the text
below, `docs/LAB.md` says so under what the lab does not do: the
overlay is a named file removed on every exit path rather than a
descriptor QEMU holds; the tier planner (static, namespace, compositor)
is not built, because every suite this repository has needs the
compositor and `run` names a missing base without booting; `lab.lock` is
a directory with the holder's pid and QMP socket, and liveness is a QMP
answer rather than an inherited descriptor; there is no `omakit lab
plan`. The measured facts M1 to M8 below stand as measured on their
dates; M14 in `docs/MEASUREMENTS.md` is the 2026-09-18 re-measurement.

`omakit-lab` names the capability below. The public entry point remains the one
`omakit` executable:

```text
omakit lab prove
omakit lab setup
omakit lab prune
```

The central boundary is absolute:

> Omakit Lab ships the ability to acquire a lab. It never ships an ISO, image,
> base disk, firmware-vars image, overlay, or archive containing one.

There is no install-time or post-install acquisition. An npm or distro install
contains code, the exact release pin, and the Omarchy public signing key. The
first byte of an ISO may be requested only after the lab has selected a tier,
proved that the tier needs a compositor, disclosed the complete operation, and
received one explicit consent.

The existing product constraints remain intact: plain ESM, no build step, no
Node runtime dependencies, `node --test`, one executable, ANSI palette indices
only, and byte-identical escape-free stdout when piped. Lab-only host
capabilities such as KVM, QEMU, OVMF and GPG are preflighted and reported; the
tool never installs them. Marketplace access remains read-only, `gh` remains
limited to `auth token --hostname github.com`, and all HTTP traffic continues
through one source call site whose method is the literal `GET`.

## Measured facts behind the plan

All sizes below are allocated bytes unless labelled virtual. Decimal GB and
binary GiB are both shown so the consent screen cannot make the download or
storage cost look smaller by changing units.

| ID | Measured fact | Evidence and method |
| --- | --- | --- |
| M1 | On 2026-09-13, `omarchy.org` advertised release `4.0.3` at `https://iso.omarchy.org/omarchy-4.0.3.iso`, with adjacent `.sha256` and `.sig` objects. The ISO is `6,260,654,080` bytes: `6.261 GB` / `5.831 GiB`. | The three official URLs returned HTTP 200. The publication contract is also stated in `omarchy-iso/README.md:5-15`. |
| M2 | The pinned ISO SHA-256 is `03d60bc74306dca51f96e1a84b690871d8d606826b260edd0208962da8507d14`. Its detached EdDSA signature verifies against `Omarchy <pkgs@omarchy.org>`, fingerprint `40DFB630FF42BCFFB047046CF0134EE680CAC571`. | Verified locally against `omarchy-iso/builder/omarchy.gpg`. `omarchy-iso@268bac16d351a21d867e37565738f458b11cb06c` creates both sidecars in `bin/omarchy-iso-release:43-72` and uploads them from `bin/omarchy-iso-upload:18-30`. |
| M3 | The published name is `4.0.3`; the ISO embeds build date `2026.09.08` and volume `OMARCHY_202609`; the installed guest package is `omarchy 4.0.3-1`. | The first two values were read from the ISO. The installed package is recorded at `../omarchy-iso/test-runs/omarchy-4.0.3/runs/20260910-212615/pacman.log:655`. The repository has no release manifest that binds these three identities. |
| M4 | One successful unattended base preparation took `289.513` seconds (`4m 49.5s`): the run directory was born at `2026-09-10 21:26:15.300936064 +0200` and the ready marker at `2026-09-10 21:31:04.813440823 +0200`. The guest installer's narrower 14-phase interval was `95.640` seconds and must not be presented as the user-visible build time. | `stat` on `../omarchy-iso/test-runs/omarchy-4.0.3/runs/20260910-212615` and `../omarchy-iso/test-runs/omarchy-4.0.3/.plugin-lab-ready`; `omarchy-install-timing.json` in that run. The harness configured 32 QEMU vCPUs and `5120 MiB` guest memory. On 2026-09-13 the same AMD Ryzen AI MAX+ 395 host reported QEMU `11.1.1`, KVM, and Btrfs; the legacy run did not record those host-tool identities, so they are context rather than historical proof. Download and checksum preflight are excluded. This is one observed reference build, not a duration guarantee. |
| M5 | The base qcow2 has a `42,949,672,960`-byte (`40.000 GiB`) virtual capacity and `6,456,152,064` allocated bytes (`6.456 GB` / `6.013 GiB`). The complete persistent base directory without runs occupies `6,456,705,024` bytes (`6.457 GB` / `6.013 GiB`). | `qemu-img info --output=json` and `du -B1 -s --exclude=runs` on `../omarchy-iso/test-runs/omarchy-4.0.3`. |
| M6 | A freshly prepared lab retaining the verified ISO and complete base occupies `12,717,359,104` bytes: `12.717 GB` / `11.844 GiB`, before run evidence. | M1 ISO allocation plus M5 complete base-directory allocation. A transactional pin replacement retaining the old base until the new one verifies has a measured steady-artifact lower bound of `19,174,064,128` bytes (`19.174 GB` / `17.857 GiB`); build-time peak allocation still needs a fresh sampled measurement before implementation ships. |
| M7 | At the 2026-09-13 observation, the legacy test tree occupied `34,201,636,864` bytes (`34.202 GB` / `31.853 GiB`), and one live retained overlay alone occupied `1,010,110,464` bytes (`1.010 GB` / `0.941 GiB`) and was still changing. Its write lock was visible to `qemu-img` even where PID-based checks could not see its QEMU process. | `du -B1` over `../omarchy-iso/test-runs` and the retained 4.0.3 overlay; a normal `qemu-img info` refused its active write lock while `--force-share` could inspect it. This is the measured reason for ephemeral overlays, a cross-namespace lock, and `prune`. |
| M8 | The current npm package proof contains `38` files and is `81,351` packed bytes under a `102,400`-byte ceiling. | `packaging/NOTES.md` and the green `tests/package-assert.mjs` run on the `packaging` branch. The lab implementation must establish a new measured ceiling rather than silently relaxing this one. |

The public release chain is therefore:

1. `omarchy.org` is the human discovery page.
2. Versioned ISO, checksum, and signature objects are served from the
   Cloudflare R2 bucket behind `iso.omarchy.org`.
3. `omarchy-iso-release` signs and hashes the selected build.
4. `omarchy-iso-upload` uploads the ISO and whichever sidecars exist.

The current official objects are the
[4.0.3 ISO](https://iso.omarchy.org/omarchy-4.0.3.iso), its
[SHA-256 sidecar](https://iso.omarchy.org/omarchy-4.0.3.iso.sha256), and its
[detached signature](https://iso.omarchy.org/omarchy-4.0.3.iso.sig).

The versioned URL is not itself an immutable identity: the upload path can
overwrite an object, the upload script treats the sidecars as optional, and the
semantic release is applied by renaming a date-built ISO. Consequently the
runtime must never scrape "latest". The package-reviewed digest and signer
fingerprint are the trust anchors.

## What ships, and what cannot ship

The lab addition may add only:

- orchestration and reporting code;
- a reviewed Omarchy release pin;
- the Omarchy public signing key used by that pin;
- text fixtures and tests.

The existing package allowlist, including its executable, marketplace code,
agent skills, licence and npm metadata, remains explicit and measured.

It may never contain:

- `.iso`, `.qcow2`, `.img`, `.raw`, `.vmdk`, `.vdi`, `.ova`, `.ovf`, or `.fd`
  payloads;
- a compressed or renamed form of those payloads;
- a prepared guest filesystem, writable firmware variables, or an overlay;
- a lifecycle hook that acquires any of them during package installation.

The npm pack assertion must continue to compare the complete file list and
packed-byte ceiling, and must inspect the packed files rather than trusting
extensions. The AUR package test must perform the equivalent assertion over the
installed file manifest and prove that its build sources include only the
versioned Omakit source release. A change that adds an image to either artifact
is a structural test failure.

## Tier first, acquisition second

Tier selection is a deterministic, side-effect-free planning phase. It runs
before resolving the lab cache, checking for a base, creating a directory,
calling the network, or probing QEMU.

The initial tiers are:

| Tier | Answers | Base interaction |
| --- | --- | --- |
| static | Repository shape, manifest inspection, parsing, and policy checks that need no process isolation. | None. A missing base is never mentioned. |
| namespace | Hook execution, filesystem and service effects, and other checks that can be proved in an isolated user/mount/network namespace without a compositor. | None. A missing base is never mentioned. |
| compositor | Hyprland, Quickshell, D-Bus session, global shortcut, pointer, screenshot, lifecycle, or other real-desktop behaviour. | A usable verified base is required. |

Classification comes from the requested checks and their declared capabilities,
not from free-form agent prose. Every plan and run prints `tier`,
`requiresBase`, and the reason code. An unknown capability refuses without
acquiring anything; it does not conservatively turn into a multi-gigabyte
download.

The ordering is a release invariant:

```text
classify request
  -> static/namespace answer available: run it and return
  -> compositor genuinely required: inspect local base
       -> usable exact-pin base: report identity and run
       -> no usable base: disclose; ask once or refuse non-interactively
```

The regression proof runs a namespace-only request with an empty home, no KVM,
and a network function that fails the test if called. It must complete without
creating the lab cache and without printing `ISO`, `base`, `setup`, or an
acquisition prompt.

## The release pin and provenance records

The release pin is source-controlled in the installable code, analogous to the
marketplace commit pin. For the currently measured candidate it contains these
facts:

```json
{
  "release": "4.0.3",
  "embeddedBuild": "2026.09.08",
  "volume": "OMARCHY_202609",
  "isoUrl": "https://iso.omarchy.org/omarchy-4.0.3.iso",
  "checksumUrl": "https://iso.omarchy.org/omarchy-4.0.3.iso.sha256",
  "signatureUrl": "https://iso.omarchy.org/omarchy-4.0.3.iso.sig",
  "bytes": 6260654080,
  "sha256": "03d60bc74306dca51f96e1a84b690871d8d606826b260edd0208962da8507d14",
  "signingFingerprint": "40DFB630FF42BCFFB047046CF0134EE680CAC571",
  "expectedGuestVersion": "4.0.3-1",
  "measuredBuildMilliseconds": 289513,
  "measuredPersistentBytes": 12717359104
}
```

The actual file gains a schema version and records the measurement evidence,
but it must not gain a mutable `latest` URL. Updating the pin is one reviewed
change: verify the official sidecars, measure the exact download, perform an
unattended build, probe the installed version, measure its allocated bytes and
duration, and update the tests and consent snapshot together.

After a build succeeds, `base/manifest.json` records at least:

- pin schema and published release;
- ISO URL, exact byte count, SHA-256, embedded build date, and volume;
- signature fingerprint and verification result;
- installed `omarchy` package version read inside the guest;
- base virtual bytes, allocated bytes, SHA-256, and creation time;
- measured preparation duration;
- lab harness revision and Omakit revision that created it;
- the immutable firmware template identity;
- a completed state written only by atomic promotion.

Every run writes a compact `run.json` with the selected tier and reason, the
complete base identity, the actual guest version, the plugin/source commit under
test, whether a development source was linked, and the exact version skew. A
normal installed-package run says there is no source override. A development
run may intentionally test source commit
`b5589faaf80c6f87c07d4560fca37c4a81722f28` over the measured `4.0.3-1` base,
but it must print both identities and `skew: true`; it may never collapse them
into "Omarchy 4.0.3".

There are two different mismatch rules:

- If the cached base manifest does not match the package's release pin, it is
  not usable. `run` states the cached and required identities, then follows the
  missing-base consent path.
- If an explicitly selected development checkout differs from the installed
  guest package, the run is allowed, but the banner, JSON, evidence, and final
  result all state the skew.

## First compositor run

`omakit lab prove` performs local prerequisite and free-space preflight before it
asks. Those checks may read the machine but may not create cache state or use the
network. If a required host capability is absent, the command refuses with the
missing executable/device and a remedy; it does not ask consent for an operation
that cannot start.

With the current pin, an interactive missing-base disclosure has this content:

```text
This check needs a real Omarchy compositor. No usable lab base exists.

Omarchy       release 4.0.3; installed guest expected 4.0.3-1
download      6,260,654,080 B (6.261 GB / 5.831 GiB)
from          https://iso.omarchy.org/omarchy-4.0.3.iso
verify        pinned SHA-256 and Omarchy signature 40DFB630...80CAC571
store         $XDG_CACHE_HOME/omakit/lab, or ~/.cache/omakit/lab
build         4m 49.5s on the measured reference host; download excluded
afterwards    verified ISO, one immutable base, and manifests
on disk       12,717,359,104 B (12.717 GB / 11.844 GiB), before evidence

Acquire and build this verified base now? [y/N]
```

The rendered command expands the actual cache path rather than printing an
unresolved variable. If the exact verified ISO is already cached, the disclosure
says `download 0 B` and recalculates both additional and final allocated bytes.
If an old exact base must remain during transactional replacement, the
disclosure separately reports the measured replacement lower bound from M6 and
the implementation's sampled peak. The prompt is still asked exactly once.

A decline returns without a network call, cache creation, partial file, or base
mutation. Consent authorizes this one acquisition/build operation; it is not
remembered for a future version pin.

When stdin or stdout is not a TTY, `omakit lab prove` never prompts and never
downloads. It exits non-zero with an escape-free refusal that names one action:

```text
Lab base missing. Run `omakit lab setup` interactively before `omakit lab prove`.
```

Automation may use `omakit lab setup --yes`, where `--yes` is the explicit
consent in the command itself. A non-interactive `setup` without `--yes` refuses;
`run` has no flag that silently turns acquisition on.

## Acquisition and verification boundary

After consent, setup performs these steps in order:

1. Create the XDG lab root and an operation-specific staging directory.
2. Stream only literal-GET responses to `.part` files. GitHub credentials are
   never attached to the `iso.omarchy.org` origin.
3. Require the received ISO byte count to match the source-controlled pin.
4. Hash the ISO and require both the source-controlled SHA-256 and the published
   checksum sidecar to name the same digest.
5. Verify the detached signature with the packaged public key and require the
   exact source-controlled fingerprint.
6. Rename the ISO into the verified cache only after all checks pass.
7. Immediately before the only QEMU invocation that can boot the ISO, recheck
   the verified file against the pin. A failure deletes the stage and stops.
8. Build into a staging base, boot that base without the ISO, read the actual
   guest version, and require the expected guest version before promotion.
9. Write and fsync the manifest, then atomically promote exactly one ready base.

An absent sidecar, changed content length, digest mismatch, unknown signer,
wrong fingerprint, guest-version mismatch, interrupted download, or failed base
boot is a refusal. No unchecked ISO path is ever passed to QEMU. A partial or
failed base never receives the ready manifest and is never eligible for `run`.

The checksum is the package-reviewed immutable identity; the signature provides
the independent Omarchy authenticity check. A signing-key rotation is therefore
a reviewed pin change, not a key fetched and trusted at runtime.

## Cache layout and the one-base rule

The default root is `$XDG_CACHE_HOME/omakit/lab`, falling back to
`~/.cache/omakit/lab`. All heavy files stay below that resolved per-user root:

```text
lab/
  downloads/
    <sha256>/omarchy-4.0.3.iso
    <sha256>/omarchy-4.0.3.iso.sha256
    <sha256>/omarchy-4.0.3.iso.sig
  base/
    base.qcow2
    firmware-vars.template
    manifest.json
  staging/
  lab.lock
```

Compact run records go under `$XDG_STATE_HOME/omakit/lab/runs`, falling back to
`~/.local/state/omakit/lab/runs`. They contain evidence, not a disk image.

There is one ready base, not one per version. A pin update may build a staged
replacement while preserving the current base for rollback, but it cannot
expose both as runnable. Promotion removes the superseded lab-owned base after
the new guest and manifest verify. The temporary two-base cost must be shown in
the consent disclosure. If space is insufficient, setup refuses and suggests
`omakit lab prune`; it never deletes the current base merely to make a build fit.

The base disk and firmware template are immutable:

- record their digests at promotion and make them non-writable;
- open the qcow base explicitly read-only as the backing file;
- copy firmware variables into the per-run lifetime rather than opening the
  template writable;
- never start QEMU with `base.qcow2` as a writable drive.

The last requirement closes a measured hole in the existing harness: its base
qcow stayed unchanged, but the shared `OVMF_VARS.4m.fd` modification time moved
after later runs.

## Per-run overlays that cannot survive a run

Omakit exposes no `--keep-overlay`, detached mode, or retained-VM mode. A run is
foreground-owned and its qcow overlay is ephemeral by construction:

1. Acquire a cross-namespace lab lock and keep its file descriptor inherited by
   QEMU for the entire QEMU lifetime.
2. Create the qcow overlay and writable firmware-vars copy in a private staging
   directory, open both, and unlink both pathnames.
3. Pass the already-open descriptors to QEMU with its fd-set interface, and only
   then declare the run started. The kernel releases each allocation when QEMU
   closes the last descriptor, including after a supervisor failure.
4. On normal return, test failure, `SIGINT`, or `SIGTERM`, ask QMP to stop,
   confirm QEMU exited, remove firmware variables and remaining staging state,
   and release the lock.
5. On the next invocation, reap only pre-run staging that is proved inactive.

The lock is authoritative across PID and mount namespaces. PID files and
`fuser` are diagnostic only. Before base replacement or prune, the command must
obtain the exclusive lab lock and must also open every named qcow without
`--force-share`; inability to acquire either lock means "in use" and a refusal.
It must never delete or move a path merely because the current namespace cannot
see its QEMU PID.

This also prevents the current legacy failure mode in which a retained overlay
stores an absolute backing path and a fresh preparation moves a different base
into that same pathname.

## Run identity: the line that makes the result useful

Before a compositor starts, every human and JSON run report states:

```text
tier           compositor: <stable reason>
release        4.0.3
guest          omarchy 4.0.3-1
iso sha256     03d60bc74306dca51f96e1a84b690871d8d606826b260edd0208962da8507d14
base created   <timestamp>; <allocated bytes>
tested source  <installed package or exact Git commit>
version skew   <false, or true with both differing identities>
```

The same identity is attached to the final verdict and `run.json`. A result that
omits it is not a successful lab result. This makes "it worked in the lab"
auditable: the sentence always has an Omarchy release, installed guest version,
ISO digest, harness revision, source revision, and tier behind it.

## `omakit doctor`

Doctor remains read-only and network-free for the lab section. It reports one
base line in all states:

```text
lab base       missing: 0 B; run `omakit lab setup`
lab base       ready: Omarchy 4.0.3-1; 6,456,705,024 B (6.457 GB / 6.013 GiB)
lab base       mismatch: cached <identity>; required <identity>; setup required
lab base       invalid: <measured local reason>; it will not be booted
```

It also reports the measured total of the lab cache and retained text evidence.
`doctor --json` exposes the same fields as stable data: existence, state,
release, guest version, ISO digest, base allocated bytes, total allocated bytes,
and active-lock state. It never creates the cache, verifies freshness online,
repairs a manifest, or starts acquisition.

## `omakit lab prune`

`prune` is the explicit owner of lab-cache deletion. It never touches the
marketplace pin, a source checkout, files outside the resolved XDG lab roots, or
run evidence unless the user separately names evidence removal.

It first obtains the exclusive cross-namespace lab lock and validates every
target without following symlinks. If QEMU or a stage owns a lock, it refuses and
names the active run. Otherwise it inventories the verified ISO, immutable base,
failed staging, and any provably inactive legacy overlays; prints each path and
its allocated bytes; prints the exact total recoverable bytes; and asks once.
Only confirmed lab-owned targets are removed.

Interactive `prune` asks once. Non-interactive `prune` refuses and names
`omakit lab prune --yes`. After removal it reports recovered and remaining
allocated bytes. A subsequent compositor run follows the normal missing-base
consent flow; a namespace-tier run remains unaffected.

## Agent and stdout contract

The agent-facing behaviour is deliberately boring:

- planning is local and side-effect-free;
- a non-interactive missing-base result is a refusal with one exact remedy;
- agents cannot answer a prompt by accident because piped execution never
  prompts;
- `setup --yes` is the only automation form that authorizes acquisition;
- `--json` reports tier, reason, required bytes, current bytes, pin, base state,
  and remedy without beginning setup;
- progress and human output use the existing palette-index roles only;
- piped stdout contains no cursor control, animation, or ANSI escape byte;
- stdout schemas and human lines change only with explicit snapshot updates.

No lab path can post, comment, label, open a pull request, or otherwise mutate
the marketplace. ISO requests use the shared literal-GET transport without a
GitHub token. Guest networking is disabled unless a named acceptance case
requires it; the normal base build uses the ISO's offline package mirror.
Host home directories, agent credentials, SSH agents, Wayland sockets, and
desktop session buses are never mounted or forwarded into the guest.

## Implementation sequence

Each phase lands with the test that fails without it, and the suite stays green
at every commit.

1. **Governance and package boundary.** Record lab as approved scope, replace
   the old no-lab structural assertion with the no-image assertion, add command
   completion snapshots, and preserve the measured package allowlist.
2. **Pure planner.** Add the deterministic tier classifier and JSON plan. Prove
   namespace answers never inspect the lab cache or call the network/QEMU.
3. **Pin and trust.** Add the reviewed release manifest and public key. Refactor
   outbound reads through the single literal-GET call site without sending the
   GitHub token to the ISO origin.
4. **Consent and acquisition.** Implement the one-prompt state machine,
   non-interactive refusal, resumable staged GET, byte count, digest, signature,
   atomic promotion, and cleanup.
5. **Base preparation.** Build in the disposable Omarchy VM lab, probe the guest
   version, create the provenance manifest, and promote one immutable base.
6. **Run lifecycle.** Add the inherited lock, read-only backing file, per-run
   firmware variables, descriptor-bound overlay, traps, version banner, and run
   evidence.
7. **Doctor and prune.** Add the read-only status line, measured totals,
   cross-namespace refusal, and confirmed lab-root cleanup.
8. **Release proof.** Re-measure package contents, first-use allocated bytes,
   build duration, sampled build-time peak, and all terminal snapshots on the
   release candidate.

## Acceptance matrix

The feature does not ship until all of these are automated or recorded VM
acceptance evidence:

| Case | Required proof |
| --- | --- |
| Namespace request, empty cache | Succeeds with no cache directory, network call, QEMU probe, ISO wording, or prompt. |
| Unknown tier | Refuses without choosing the compositor tier or touching acquisition state. |
| Interactive compositor request, no base, decline | Exactly one prompt; zero downloaded bytes and zero created lab state. |
| Non-interactive compositor request, no base | Escape-free refusal naming `omakit lab setup`; zero downloaded bytes. |
| Explicit non-interactive setup | Refuses without `--yes`; proceeds with one authorization when `--yes` is present. |
| Corrupt, truncated, substituted, unsigned, or wrongly signed ISO | Fails before any QEMU process receives the ISO path. |
| Interrupted GET or build | Leaves no usable ISO/base and no ready manifest; the next run reports the measured residue. |
| Wrong installed guest version | Staged base is rejected and the observed version is printed. |
| Exact ready base | Performs no network request and reports the complete identity before boot. |
| Deliberate source/base skew | Human output, JSON, and evidence name both identities and `skew: true`. |
| Successful, failed, interrupted, and supervisor-killed run | Base and firmware-template digests remain unchanged; no named overlay survives; the QEMU-held lock prevents concurrent replacement. |
| Prune during a run hidden by a PID namespace | Refuses on the inherited/qcow lock and removes zero bytes. |
| Prune while idle | Reports the exact targets and total, asks once, removes only confirmed lab-owned cache, and reports recovered/remaining bytes. |
| Doctor in missing, ready, mismatch, invalid, and active states | Performs no write/network/start action and reports base version and allocated bytes. |
| Piped output | Repeated runs are byte-identical and contain zero escape bytes. |
| npm and AUR artifacts | Exact allowlists contain no ISO, base, firmware image, overlay, or disguised archive; the package ceilings are measured and enforced. |

The graphical cases run only in the disposable `omarchy-plugin-lab` VM workflow,
never against the operator's real desktop. A pin update is incomplete until the
unattended preparation is measured again on the reference machine and the new
guest version, build duration, steady allocation, temporary peak, and package
size are recorded. No estimate is promoted into user output.
