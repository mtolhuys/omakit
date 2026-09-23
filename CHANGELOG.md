# Changelog

## 0.6.9 (unreleased)

`omakit lab` prepares the newest Omarchy release instead of the one it
was pinned to. 4.0.4 was published on 2026-09-15; on 2026-09-23 `lab
setup` still offered 4.0.3, because the lab was pinned to it on
2026-09-18 and nothing looked. `tools/lab/release.mjs` now reads
Omarchy's release list each time, sorts by version, and takes the newest
at or above the floor (4.0.3) whose ISO, `.sha256` and `.sig` are all
published; a newer tag whose ISO is not up yet (404) is passed over and
named, and anything else (a timeout, a checksum that does not read, a size
not announced) stops the search rather than falling back to an older
release. The search reads one byte of each ISO, for its size, and no more. The trust is the signature:
a file is the release only when its `.sig` verifies against the packaged
Omarchy key at the pinned fingerprint, and the signer is read from the
`.sig` packet before the ISO is even asked for, so a release signed by
another key stops the search (`signer-changed`) instead of being replaced
by an older one. `setup` builds the newest release and removes the old
base and older downloads only after the new base verifies; a base of an
older release is `outdated`, which a run still uses and `inspect`,
`doctor` (`lab.release`) and `prove` say out loud, and a good base newer
than the release found (a checksum being republished, an older `--from`)
is `ahead` and kept: the lab never goes back a release on its own. `--offline` skips the
lookup; `--from` names its release by its file name when offline. Fixed on
the way: an interrupted setup left the toolchain's daemonized QEMU
running with nothing to stop it and invisible to `prune`; setup now stops
it and `prune` refuses while it runs. The package ceiling is raised to
409,600 bytes (372,500 measured).

## 0.6.8

`omakit inspect`'s file and state boundary class cites a copy to a
variable destination. Theme Manager was blocked twice in one review thread
for `cp "$src" "$dest"` onto a destination the script is handed
(`install-wallpaper.sh`, 2026-09-11; `install-hook.sh`, 2026-09-22), and
the class cited neither copy: the extraction gave `$dest` as `unknown`,
the word for a path it cannot place, and the class admits only
`not-observed`. A write's `controlledDirectory` now has a fourth value,
`variable`, for a canonical path that is one variable and nothing else
(`$dest`, `$2`, `$target/`) and not `$HOME` or an XDG name; any other
path it cannot place, `$dir/name` included, stays `unknown`. The class
admits a `variable` row written by `cp`, `mv`, `install` or `ln`, the
four whose file a planted link redirects (measured on coreutils 9.11:
`cp` writes through a link to a file, all four write into a linked
directory), and says it as "N writes by cp to a variable destination, not
resolvable to a controlled directory", nothing about who set the
variable. Redirects and `tee` onto a variable are left out, measured
(`docs/MEASUREMENTS.md` M11, with a record): over 15 plugin trees, 28
writes by the four verbs against 61 redirects and tees, 24 of them log
appends; the class's count goes from 96 to 124. At `e05f78f` Theme
Manager's goes from 7 to 9 with `install-hook.sh:24` among them, and at
the wallpaper blocker's tree from 4 to 6 with `install-wallpaper.sh:83`.
On a line with two writes (`printf ... > "$f.tmp" && mv "$f.tmp" "$f"`)
the default view shows the write the class cited, not the first one. For
the four verbs, `-t` and `--target-directory` now read that directory as
the destination; before, the last source was taken for it. `--json`
consumers that switch on `controlledDirectory` see the new value; the
contract in `tools/inspect/contract.mjs` holds it to a path of that shape.
The share and every other figure are unchanged.

## 0.6.7

`pin.freshness` in `omakit doctor` compares what omakit reads, and grades
what it finds. Before this it compared `scripts/` between the pin and the
marketplace's HEAD by tree id, so any change under that directory was a
note, a user read "run `omakit upgrade`", and the maintainer moved the pin.
Measured on 2026-09-21 (`docs/MEASUREMENTS.md` M7): of the three
marketplace commits that touched `scripts/` since the first pin `38060f89`,
one (5e401552, `repository-identity.mjs`) changed a file nothing omakit
reads reaches, and the pin moved for it with no verdict changed. omakit
opens ten files under `scripts/` (`PIN_READS` in `pin.mjs`, seven
imported and three read as text); with what the imported ones import,
followed by regex over the pinned text and never by loading a module,
`pinnedReadSet()` names 16 of the 34 files there, and
`tests/unit/pin.test.mjs` derives the ten from the sources and pins the
sixteen, so a new read is a visible diff. `doctor` now compares those 16
by blob id (the `scripts/` tree is read only when its id moved; the form
directory is still compared by tree id), and when the policy module's blob
moved it reads that module's text at HEAD once, through the raw file host
at the exact commit like the registry files, takes
`securityBaselineVersion` and `securityBaselineEnforcementMode` out of it
the way the pin's identity does, and drops it. Three verdicts: `ok` when
no read file moved (a `scripts/` change elsewhere is said as "in none of
the 16 files omakit reads"); `info` when the only moved files are ones
omakit takes wording or a label out of (`WORDING_READS`: the baseline's
rendered details, the failure table, one label from each approval script;
4 of the 16), the files named as wording only, what omakit prints may
differ and what it decides cannot; `advice` when a file omakit executes
or reads a rule from moved, whether or not the two constants still read
the same (a rule can change without its version), a read file is gone at
HEAD, or the form moved, with `omakit upgrade` as the action when a newer
omakit is published and otherwise that the maintainer is notified, and in
both cases that every verdict is the pin's until then and the
marketplace's own run on the issue is the one that counts. The constants
are printed beside every grade and never soften it. The closure's
completeness is held by the suite: a dynamic `import()`, side-effect
import, `require()` or `import.meta.resolve()` in an executed read file
fails `tests/unit/pin.test.mjs` by file and line (0 of 13 at `b7b29654`),
so the one way the read set could miss a file is a test failure at the
next pin bump, never a quiet `ok`. The "open an
issue" instruction is gone: the weekly pin-freshness workflow opens the
one there is, on `advice` or `info`, and its body names the files, the
constants at both ends and doctor's line. Offline stays `unknown`. The
`--json` evidence keeps `changedPaths`, `readLive` and `pinned` and adds
`reads`, `moved`, `verdictMoved`, `missing` and `policy.{pin,head}`. Measured with
`b7b29654` as the pin: `70dcc454` taken as HEAD grades `ok` in 4 GETs,
`38060f89` grades `advice` for the forms in 5, and today's HEAD `ok` in
the same 3 as before.

## 0.6.6

The marketplace pin moves from `70dcc454` (2026-09-21 05:35 UTC) to
`b7b29654` (2026-09-21 18:18 UTC, "Add OmaStudio plugin (#6843)"), the
same day as 0.6.5. `omakit doctor` reported `pin.freshness` as a note that
evening: of the 14 marketplace commits since, one touched `scripts/`.
5e401552 lets `validateRegistryRepositoryMigrations` in
`scripts/repository-identity.mjs` accept a migration chain that ends at
fully retired plugins, and delists `multi-monitor.workspaces`. Omakit does
not import that module; it is the marketplace's validation of its own
registry. Policy constants, catalogs, limits, the feedback table, the labels
and the form are byte-identical, so no verdict changes. The figures follow
the pin: 3,664 listed sources, 3,619 with a recorded baseline (2,031 passed,
1,562 review-required, 26 needs-fixes), 3,702 catalog ids, 23 retired; 854
sources (23.3%) revalidated at least once. Parity is re-proved at the new
pin over the 30-repository corpus, 30 of 30 at offset 0
(`docs/evidence/parity/2026-09-21-local-vs-github-3.json`).

The weekly pin-freshness workflow reads `doctor`'s verdict as `doctor` gives
it: `ok` with unequal commits when only the live-read data files moved, and
`advice` naming the pinned paths that did. It had failed on every scheduled
run since 2026-09-14 by demanding equal commits for `ok`. The 0.6.5 notes
said the pinned checkout is 22 MB; a fresh `omakit pin` measures 19 MB, the
22 MB was a cache that still held the previous pin's objects.

## 0.6.5

The marketplace pin moves from `38060f89` (2026-09-11) to `70dcc454`
(2026-09-21, "Add LookAway plugin (#7750)"). `omakit doctor` had reported
`pin.freshness` as a note since 2026-09-20: of the 863 marketplace commits
since the old pin, two touched the paths omakit reads code and rules from.
7dd6e56 adds the tag `vpn` to `allowedTags` and to the form's Tags list, so
`omakit submit --tags vpn` is now accepted, and the form's list is fourteen
tags. 40315f2 lets a standard-installation verification reuse a valid
installer-only maintainer review; that is the maintainer's flow after
listing, and nothing the preflight reads. `securityBaselineVersion` 3,
`selective` enforcement, the rule and capability catalogs, the limits, the
feedback table and the label set are byte-identical at both commits, so no
verdict changes.

The figures the tool prints and the docs cite are the new pin's, recomputed
by `tests/unit/registry-figures.test.mjs`: 3,653 listed sources, 3,608 with a
recorded baseline (2,025 passed, 1,557 review-required, 26 needs-fixes),
3,691 catalog ids; 854 sources (23.4%) revalidated at least once. Parity is
re-proved at the new pin over the 30-repository corpus: 30 of 30 identical
at offset 1 (`docs/evidence/parity/2026-09-21-local-vs-github-2.json`); at
offset 0, 29 of 30 with 0 mismatches and one listing that no longer exists
on github.com (modoterra/omabench, listed as passed at `6ef8e49`; the site
answers 404), recorded in `2026-09-21-local-vs-github.json`. The pinned
checkout is 19 MB sparse on a fresh fetch; `omakit pin` re-fetches it on
first use.

## 0.6.4

The retry edit is no longer free text. On omacom/omarchy-plugin-marketplace#7787
(2026-09-20, UTC) an agent following the validation-watch skill retyped the
issue body to retry after a push: the Repository URL became
`mtolhuijs/omacrunch` for a plugin at `mtolhuys/omacrunch`, the Maintainer
notes were wiped, and the marketplace refused the issue as
`repository-unreachable` 40 seconds after the edit event. Nothing in omakit
caught it; four things now do.

`omakit watch <issue-url> [<subject>]` takes the plugin's checkout or its
github.com URL (the current directory by default when it is such a checkout
and its `manifest.json` is the plugin the issue names; another plugin's
directory is reported as not compared, never as a mismatch)
and compares the issue's Repository URL with `origin`; a mismatch is the
verdict `wrong-repository`, over every other state, with the origin to put
back. `watch` also reads a failed marketplace validation: the last validation
comment's "Validation failed" reason is mapped to the marketplace's own code
through the pinned feedback table (37 codes; unmatched text is verbatim, code
`unrecognised`), the labels are read from the pin, and a refusal newer than
the last baseline marker is the verdict `refused` with the marketplace's own
action. Both exit 1. `--all` counts `refused` rows.

`omakit submit` finds your open submission issue for the plugin by its
Repository URL, or by the manifest's name in the title or its id in the body
when the URL does not match, and the new blocking check
`submission.issue-repository-url` holds that issue's Repository URL to
`origin`; it is skipped offline, without a credential, and with no such
issue. M15 measures the population: on 2026-09-20, 27 of the 646 open
submission issues with a readable URL named an owner other than their
author, so the comparison is with `origin`, never with the author's login.
`submit --body-out <file>` writes the rendered body, and nothing else, to a
file, byte for byte the body in `--json`, so a retry edit is made with
`gh issue edit --body-file` from that file.

The submit and validation-watch skills carry one "Retry edit protocol" under
the same heading, held to each other by the suite: re-run `submit` with the
original flags plus `--body-out`, diff against the current body with only
Maintainer notes allowed to differ, edit with the owner's explicit approval,
then `watch` with the subject. Never retype the body, never write the
Repository URL by hand. The incident is recorded on `docs/FAILURES.md` as a
measured case and in `docs/MEASUREMENTS.md` M15. See `docs/releases/0.6.4.md`.

## 0.6.3

The README's command and documentation table is restored at the top and
updated for every current command, so the package page again gives a visitor
the short route from a command to what it does and where it is documented.
The Socket image badge is removed because its endpoint serves a Cloudflare
challenge instead of an image to automated consumers such as npm.

## 0.6.2

The terminal wordmark now carries the same `tested plumbing for plugins` line
as the README banner GIF. Post-publish verification also gives npm 30 integrity
probes over 290 seconds; npm accepted 0.6.1 but kept it processing beyond the
former six probes over 50 seconds.

## 0.6.1

This is the first published release in the 0.6 line. The `v0.6.0` workflow
stopped before publishing an npm package or GitHub Release, so that tag remains
where it is and the recovery uses the next unused version. The recovery also
makes the lab host checks independent of runner-installed commands and tests the
same commit-stamped, Git-free archive shape that the release publishes.

The Run (0.2.1) and Store (0.2.0) blocks, `omakit add run`, `omakit add
store`, and `inspect` reading an unmodified block as one row; M13, the 1,001
blocker comments the contracts are counted over; the Theme Manager and Sidecar
ports, neither submitted; and the reader's four jobs in order: build, check,
track and prove. `omakit lab prove`,
`inspect`, `setup` and `prune`, the harness moved into omakit from
`omarchy-plugin-lab` and refactored to one driver, the pinned 4.0.3
release verified against its SHA-256 and the Omarchy signature, one
immutable base, every run identified by the guest's installed package,
and the M14 record of one real run. See `docs/releases/0.6.1.md`, its
limits included. The package names its version, 0.6.1, on the release
branch; the tag makes the release.

After the acceptance test of 2026-09-19
(`docs/evidence/ux/2026-09-19-acceptance.json`): nothing reaches
`shell.json` without a consented measurement running, every write there is
a whole file renamed into place, `SIGHUP` restores like `SIGINT` and
`SIGTERM`, and a backup an earlier measurement left is named and refused;
one contract every command leaves through (`tools/marketplace/outcome.mjs`):
exit 0, 1, 2 and the signal's own status, one `--json` document with the
remedy never null, the text on stderr on a nonzero exit, `--out` on every
outcome; `audit` counts a row it could not compare apart from drift;
`inspect` resolves a symbolic link; two first runs no longer race on the
pin; `parity --count` is the count; an empty argument and a repeated option
are usage errors; `omakit doctor` says where this omakit's code comes from
(`omakit.source`) and `npm run pack:release` packs the artifact the release
publishes.

## 0.5.1

Six kinds of noise in `inspect`'s function extraction are gone and M12 is
re-measured with them. See `docs/releases/0.5.1.md`.

## 0.5.0

The `inspect` size score no longer punishes honest refactoring, and M12 is
re-measured with a reproducible script. See `docs/releases/0.5.0.md`.
