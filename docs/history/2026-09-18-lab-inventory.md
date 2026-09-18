# The lab inventory, 2026-09-18

What existed before `omakit lab`, written down before anything moved. The
source is `github.com/mtolhuys/omarchy-plugin-lab` at `259ef26` (its working
tree carried uncommitted edits to `README.md`, `TESTING.md`, `AGENTS.md`, the
lifecycle fixture and `host-tests/plugin-lifecycle.sh`), the `omarchy-iso`
checkout at `268bac16` with its harness patched, and the three gates in this
repository: `tests/lab/run/lab.sh`, `tests/lab/store/lab.sh` and
`tests/lab/weigh.sh`. Every problem below is numbered (P1 to P22); what
happened to each is in `docs/LAB.md`, either fixed or listed under what the
lab does not do with the condition it needs.

## What `bin/lab` does

463 lines of bash. It resolves three sibling checkouts (`omarchy`,
`omarchy-iso`, `omarchy-pkgs`, overridable from an untracked `.lab.env`),
finds an ISO, and wraps `omarchy-iso/bin/omarchy-iso-test`, the official
ISO test harness, with these commands:

| Command | What it runs |
| --- | --- |
| `setup [--no-iso]` | `git clone` of the three repositories; `git apply` of `patches/omarchy-iso-test.patch` onto the ISO checkout; scrapes `https://omarchy.org` for the first `iso.omarchy.org/omarchy-*.iso` link, downloads it with `curl --continue-at -`, checks it against the `.sha256` sidecar downloaded beside it. |
| `doctor` | x86_64, `/dev/kvm`, the three checkouts, the patched harness, the ISO and its sidecar, nine commands, and two lints of the lab's own tracked text. |
| `prepare [--fresh]` | `omarchy-iso-test <iso> --install-only --memory 5120 --port 2222 --no-preview`; marks the result with `.plugin-lab-ready`. |
| `plugin [host-test]` | `omarchy-iso-test <iso> --reuse-base --sync-all <omarchy> --dev-link --memory 5120 --port 2222 --no-preview --discard-overlay --host-test <file> --host-test-only`. This is what the three omakit gates call. |
| `fast`, `accept`, `accept-host`, `accept-keep`, `shell`, `latest`, `clean`, `build`, `status` | The Omarchy source suite in the guest, the broad acceptance run, a retained guest and SSH into it, the newest run directory, overlay removal, a local ISO build. None of these is a gate of this repository. |

The harness it wraps does the real work: creates the base disk and the SSH
key under `<omarchy-iso>/test-runs/<iso basename>/`, drives the installer by
QMP screendumps, OCR (`tesseract`) and `send-key`, logs in on a console TTY
to authorise the key, saves the base; for a run it creates a qcow2 overlay
backed by the base, boots it, types the SDDM password through QMP until a
`Hyprland` process owned by the user exists, then sources the host test and
calls `omarchy_host_test`. The helpers a host test gets are `log`, `press`,
`type_text`, `qmp`, `ssh_guest`, `ssh_session`, `wait_for_guest_state`,
`capture_console`, `guest_layer_present`, `RUN_DIR`.

## What each host test does

| File | Lines | What it proves |
| --- | ---: | --- |
| `host-tests/example.sh` | 14 | The guest session answers `hyprctl -j monitors`. The template for a product-owned scenario. |
| `host-tests/plugin-lifecycle.sh` | 67 | `omarchy-plugin-add`, enabled state in the shell, a same-path nested QML edit replacing the loaded runtime, `shell.json` registration, disable, re-enable, remove, no `hyprctl configerrors`. Uses `fixtures/lifecycle-plugin/`. |
| `host-tests/repository-suite.sh` | 59 | Omarchy's own `test/all` inside the guest with the packaged `omarchy-*` commands hidden from PATH. Needs the `omarchy-pkgs` and `omarchy-iso` checkouts synced in. |
| `host-tests/helpers/pointer.sh` | 76 | `qmp_pointer_move` and `qmp_pointer_tap`: absolute pointer events through QMP. |
| `host-tests/omarchy-assurance-*-private.sh` | 574 | Private adapters for another product. Not lab material. |

None of these is a gate of this repository. What this repository's gates
need from the lab is: a verified base of the pinned release, a fresh
overlay, a session, `ssh_guest`, `ssh_session`, `wait_for_guest_state`,
`capture_console`, `log`, and the run directory.

## What the three gates duplicate

Each gate is its own driver. Between `tests/lab/run/lab.sh` (79 lines),
`tests/lab/store/lab.sh` (85) and `tests/lab/weigh.sh` (356):

| Duplicated | run | store | weigh |
| --- | --- | --- | --- |
| Resolving the lab root: a sibling named `plugin-lab`, or `$OMAKIT_LAB_ROOT` | `omakit_runlab_root` | `omakit_storelab_root` | `omakit_lab_root` |
| The tool preflight (`node git jq ssh tar`) | yes | yes | yes |
| `exec $lab/bin/lab plugin <this file>` | yes | yes | yes |
| Checking the guest's `/usr/bin/python3`, `quickshell`, `setsid`, `kill` | yes | yes | no (checks node through mise) |
| Staging the suite into `/tmp/omakit-*-src` with `tar | ssh` | yes | yes | yes (`/tmp/omakit`) |
| A detached job in the session (`setsid bash -c '...; echo $? > done'`) and `wait_for_guest_state` on the done file | yes | yes | yes (`guest_weigh`) |
| Copying the log, the document and the runs back beside `host-test.log` | yes | yes | yes |
| `omarchy-shell shell ping` and `hyprctl configerrors` after the suite | yes | yes | yes |
| The in-guest suite (`suite.sh`), 106 and 109 lines: a `one()` that starts `quickshell -p <harness>` in a `systemd-run --user --scope -p MemoryMax=768M` (or `setsid`), waits for events in the log, stops the scope | `tests/lab/run/suite.sh` | `tests/lab/store/suite.sh` | not applicable |
| The reader (`report.py`): runs into one document, the gate asserted | 217 lines | 133 lines | `tools/weigh/contract.mjs` and `jq` |

The two `suite.sh` files share the scope-or-setsid start, the event wait,
the scope stop, and the shape of the loop; they differ in what they plant
and what they read afterwards. The two `report.py` files share nothing but
the document header (`id`, `measured`, `kernel`, `blocks`, `method`, `ok`).

## The problems, numbered

Duplication:

- **P1.** Three drivers for one job (the table above). A fix to the staging,
  the detached job or the copy-back has to land three times.
- **P2.** `tests/lab/store/lab.sh` says "Running the Run lab suite" and
  "the Run lab suite exited" for the Store suite: the copy was not read
  after it was pasted.
- **P3.** `host-tests/helpers/pointer.sh` and the working-tree harness both
  define `qmp_pointer_move` and `qmp_pointer_tap`, with different bodies.

Host assumptions and hardcoded paths:

- **P4.** The lab root is a sibling checkout named `plugin-lab` or
  `$OMAKIT_LAB_ROOT`; nothing in this repository documented either, and
  `tests/unit/self-containment.test.mjs` forbids an `OMAKIT_*` variable.
- **P5.** `.lab.env` on this machine holds five absolute paths under
  `/home/mtolhuijs/`; `lab.env.example` documents them as required
  configuration.
- **P6.** The base disk, the firmware variables and the SSH key live inside
  the `omarchy-iso` checkout, under `test-runs/<iso basename>/`, not under
  the user's cache; `omarchy-iso-test` derives that directory from the ISO's
  file name and nothing else, so two ISOs with one name share a base.
- **P7.** The SSH port is 2222 and the HTTP bootstrap port 2223, fixed; two
  runs at once collide on the host forward and the second QEMU fails to
  start.
- **P8.** `bin/lab plugin` passes `--sync-all <omarchy checkout> --dev-link`:
  every gate run synced the `omarchy-omakit-pin` checkout (`b5589faa`) into
  the guest, ran `omarchy-dev-link` there with `sudo`, stopped the session
  with `uwsm stop` and logged in again, so the "stock 4.0.3 guest" the
  evidence names was a session running from a synced source checkout over
  the installed `omarchy 4.0.3-1` package. Whether those two are the same
  tree was never recorded; the documents carry no guest version and no
  source identity.
- **P9.** `-smp $(nproc)`: 32 vCPUs on the reference host, whatever the host
  has elsewhere.
- **P10.** `omarchy-iso-test` upstream runs `omarchy-pkg-add qemu-full
  edk2-ovmf socat imagemagick tesseract tesseract-data-eng` at the top of
  every invocation: the stock harness installs packages on the host. The
  working tree on this machine replaced that line with a check, and that
  replacement is not in the versioned patch.

The sudo drop-in:

- **P11.** The Store gate's foreign-owner scenario needs one `chown root`.
  `tests/lab/store/lab.sh` writes `/etc/sudoers.d/storelab` in the guest
  (`omarchy ALL=(ALL) NOPASSWD: /usr/bin/chown`) by piping the guest
  password into `sudo -S`. It is written into the run's overlay and dies
  with it, so the base is untouched; but the gate says nothing about it in
  the document, and the guest password is in the driver's source.

The omarchy-iso toolchain and its patch:

- **P12.** The versioned patch (`patches/omarchy-iso-test.patch`, 122
  insertions) is not what runs. The working harness on this machine differs
  from `268bac16` by 195 insertions: the patch, plus a greeter pattern for
  the 4.0.3 installer's slogan (`Beautiful, Fun & Agentic Linux by DHH`;
  upstream waits for `Opinionated`, which 4.0.3 does not show, so the
  versioned patch alone cannot prepare a 4.0.3 base), the host package
  install replaced by a check (P10), an OVMF readability check, the pointer
  helpers (P3), and a `sleep 2` where upstream waits for `without
  encryption` (light text on light, which Tesseract loses). A fresh
  `bin/lab setup` on another machine applies the versioned patch and gets a
  harness that cannot build the pinned base.
- **P13.** `bin/lab setup` scrapes `https://omarchy.org` for the first ISO
  link, so it resolves "latest"; the checksum it verifies against is the
  sidecar downloaded next to the ISO, so a substituted ISO with a matching
  substituted sidecar passes. The signature (`.sig`) is downloaded by
  nobody and verified by nobody. `packaging/LAB_PLAN.md` M2 records the
  signer and the digest that the lab must be pinned to.
- **P14.** The harness needs `magick`, `tesseract` and `socat` for every
  run, though a run from a prepared base uses none of the OCR path (the
  session is established by typing the password until `Hyprland` is owned
  by the user) and QMP is a Unix socket.

What is measured wrong or not at all:

- **P15.** The base's firmware variables (`OVMF_VARS.4m.fd` in the base
  directory) are opened writable by every run (`-drive
  if=pflash,format=raw,file=$BASE_OVMF`): the file's mtime on this machine
  is `2026-09-18 15:09`, the base's is `2026-09-10 21:31`. The base disk is
  opened as a backing file, read-only, and stayed unchanged.
- **P16.** The overlay is a named file (`runs/<stamp>/run.qcow2`), removed
  on a clean exit by `--discard-overlay`; a harness killed with SIGKILL
  leaves it, and `bin/lab clean` decides "in use" by `fuser` and a pidfile,
  which cannot see a QEMU in another PID namespace (`packaging/LAB_PLAN.md`
  M7: 34.2 GB under `test-runs/` on 2026-09-13, one live overlay at 1.01
  GB).
- **P17.** `wait_for_guest_state ... 900` in the two block gates and
  `3600` in the weigh gate are the only time bounds; no gate records how
  long a run took, and no document records the cost of the run that
  produced it.
- **P18.** The guest evidence documents were copied into `docs/evidence/`
  by hand with a `where` field added by hand ("the stock 4.0.3 guest of the
  Omarchy plugin lab, run 20260918-150245"); `report.py` writes no
  provenance, and no test holds the copy to the run directory.

What only works on this machine:

- **P19.** The base for 4.0.3 was prepared on 2026-09-10 with the working
  tree harness of P12; the versioned patch cannot reproduce it (P12), and
  no manifest records which harness, which ISO digest and which guest
  package it holds. `omarchy-iso-test --install-only` on the same ISO name
  would `rm -f` that base and rebuild.
- **P20.** `bin/lab doctor` requires x86_64 and `/dev/kvm` and refuses
  otherwise; there is no report of what is missing and what it costs, only
  the refusal.
- **P21.** Node in the guest comes through `mise` shims
  (`$HOME/.local/share/mise/shims`), which the weigh gate hardcodes; a
  stock 4.0.3 has it, and nothing checks the version.
- **P22.** The `omarchy-plugin-lab` repository has no licence file.

## What the gates prove, which nothing here may change

- Run: 19 scenarios in their own `quickshell` instances on the stock
  guest, `runlab.json` with `ok` over 19 summary rows; the shell answers
  `omarchy-shell shell ping` afterwards; no `hyprctl configerrors`.
- Store: 15 scenarios, the foreign owner simulated with `chown root`,
  `storelab.json` with `ok` over 15 rows, `foreign-owner` not skipped; the
  same two checks afterwards.
- Weigh, smoke: a refused plan (exit 2, `shell.json` unchanged), a
  one-run weighing of two fixtures with real `/proc` samples, `shell.json`
  byte-identical with no backup left, the document under
  `tools/weigh/contract.mjs`, an interrupted measurement restored with exit
  130; evidence: five runs over seven plugins, the 180 ms timer above
  noise, the clean fixture within noise and said so in words.
