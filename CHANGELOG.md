# Changelog

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
checkout is 22 MB sparse; `omakit pin` re-fetches it on first use.

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
