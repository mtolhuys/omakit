# When a command stops

Every failure leaves through one shape: a code, one sentence saying what
happened, and the one thing to do about it. The sentence is written for the
run it belongs to and names the file, the commit or the port in question. The
code does not change, so the code is what a script reads and what this page
lists.

```json
{ "command": "submit", "ok": false,
  "error": { "code": "dirty-worktree", "message": "...", "remedy": "..." } }
```

`remedy` is never null. A code with no entry in the tool's own table prints
the code and the sentence and no arrow, which is the honest rendering of a
state nobody has written a fix for yet. The envelope itself, the streams and
`--out` are in [COMMANDS.md](COMMANDS.md#the-contract-every-command-keeps).

## The exit status

| Exit | What it means |
| ---: | --- |
| 0 | success |
| 1 | a refusal or a failure the tool means: every code on this page but the two below |
| 2 | `usage` and `not-confirmed`: the command line was wrong, or a question was asked where nothing could answer it |
| 128 + n | a stop asked for by a signal, whether the command handled it or not: 129 `SIGHUP`, 130 `SIGINT`, 143 `SIGTERM` |

## Any command

| Code | What happened | The one action |
| --- | --- | --- |
| `usage` | an option the command does not know, one without its value or given twice, an empty argument, one positional too many, or a question a pipe could not answer | `omakit help` |
| `not-confirmed` | consent was needed and the answer was not yes, or nothing could answer: a pipe, an agent or `--json` | Run it again and answer `y`, or pass `--yes` when the person whose shell it is has agreed. |
| `interrupted` | a signal stopped the run; what it had changed was put back first | `shell.json` was restored; run it again when the desktop is yours to restart. |
| `out-unwritable` | `--out` named a file that could not be written; the document is then on stdout | the operating system's own action for what it raised, below, or the general one |

An error the operating system raised carries the errno as the code, and its
own action: `EACCES` and `EPERM` say to make the directory writable, `EROFS`
to copy the tree somewhere writable, `ENOSPC` and `EDQUOT` to free disk,
`ENOENT` that the path is not there, `EBUSY` to wait for the process that
holds it, `ETIMEDOUT` and the other network errnos to connect and run it
again.

## Reading the plugin

Every check reads the tree at an exact commit, never the working copy.

| Code | What happened | The one action |
| --- | --- | --- |
| `subject-not-found` | no such directory | Pass a local Git repository path, or `<https url>@<40-char sha>`. |
| `not-a-directory` | the path is a file, not the repository directory | Pass the plugin's repository directory, not a file inside it. |
| `not-a-git-repository` | the path is not inside a Git repository | Pass a local Git repository path, or `<https url>@<40-char sha>`. |
| `commit-not-found` | the repository has no commit yet, or the named commit is not offered | Commit first; the checks read the tree at an exact commit, never the working copy. |
| `dirty-worktree` | the tree has uncommitted changes, and they would not be read | Commit the changes, or pass `--allow-dirty` to read `HEAD` as committed. |
| `no-origin` | `watch` was given a checkout as its subject, and it has no github.com `origin` to compare the issue with | Give the checkout a github.com origin remote, or pass the repository URL as the subject. |

## The marketplace, and the network

| Code | What happened | The one action |
| --- | --- | --- |
| `marketplace-unavailable` | the pinned marketplace checkout is missing or unreadable, so no rule could be read | `omakit pin` |
| `network-unavailable` | a host did not answer | Connect to the network, then run it again. |
| `github-unavailable` | GitHub answered, but not with what was asked for | Wait for GitHub, then run it again. `gh auth login` raises the rate limit if that is what ran out. |
| `not-found` | GitHub answered 404 for the issue | Check the issue URL: it has to be an existing issue on the marketplace repository. |
| `head-unreadable` | the plugin repository's current `HEAD` could not be read | Check that the plugin repository is public and its URL is right. |
| `login-required` | account-wide `watch` needs to know whose issues to read | `gh auth login`, or pass `--user <login>` to read a public account. |

## A verdict the tool means

These are results, not accidents. The command worked; what it found is the
refusal.

| Code | Command | What it found | The one action |
| --- | --- | --- | --- |
| `refused` | `submit` | a blocking check failed, so no body was produced | Fix what the report names, then run it again. |
| `unknown` | `watch` | there was nothing to compare, or the baseline was incomplete, or `HEAD` would not read | Read what could not be compared in the report; each row says why. |
| `refused` | `watch` | the marketplace's last validation of the issue failed, and that refusal is newer than the last baseline marker; the report carries the marketplace's own code, reason and action | The marketplace's own action for that code, printed as the arrow. |
| `wrong-repository` | `watch` | the issue's Repository URL is not the plugin's origin, so the marketplace is validating another repository, or none | Edit the issue and set the Repository URL field to the origin printed in the report. Change nothing else. |
| `drift` | `audit` | an installed plugin is running a commit the marketplace never validated | Return each plugin to its validated commit with the `git checkout` printed beside it, or validate the newer commit through the form the report names. |
| `not-compared` | `audit` | nothing could be compared at all | Run it in the desktop session whose shell runs these plugins. |
| `not-proved` | `lab prove` | the suite ran and did not prove what it asserts | Read the suite's log under the run's record directory, then run it again. |
| `problems` | `doctor` | a check found something wrong on this machine | `omakit setup` |

## Adding a block

| Code | What happened | The one action |
| --- | --- | --- |
| `exists` | a file of that name is already there | `omakit add run [<plugin-dir>] --update` |
| `modified` | the copy carries no block header, or a body omakit never shipped, so it is the plugin's own | Keep your copy, or move it aside and run `add` again; `omakit/NOTICE` lists what is modified. |
| `not-a-plugin` | the directory has no `manifest.json` | Pass the plugin's directory, the one with its `manifest.json`. |
| `plugin-dir-not-found` | the path is not a directory | Pass the plugin's directory, the one with its `manifest.json`. |
| `unknown-block` | omakit ships no block by that name | `omakit add run [<plugin-dir>]`, or `omakit add store [<plugin-dir>]` |
| `no-source-commit` | this omakit runs from neither a checkout nor a stamped package, so a header could not name the commit it came from | Install omakit from the registry, or run it from a checkout. |

## Weighing, and the shell

| Code | What happened | The one action |
| --- | --- | --- |
| `no-omarchy-shell` | there is no `omarchy-shell` on `PATH`, so there is no shell to weigh on | Weigh on an Omarchy with the Quattro shell, from a terminal in that session. |
| `shell-not-running` | the shell does not answer, and weigh measures a running shell | `omarchy-restart-shell` |
| `backup-present` | an earlier measurement left a `shell.json` backup beside the config | Compare the backup with `shell.json`, copy it over if the difference is not yours, then remove it and run weigh again. |
| `setup-incomplete` | a setup step did not finish | Read the lines above; each failed step names its fix, and `omakit doctor` re-checks. |

## The lab

Most of these are the host, not the plugin. `omakit lab inspect` names what
is missing and the one command for each.

| Code | What happened | The one action |
| --- | --- | --- |
| `lab-not-ready` | the base, the tools or the firmware are not there yet | `omakit lab inspect` |
| `lab-blocked` | `setup` cannot start at all: no toolchain, too little disk, or no base and the newest release could not be looked up | `omakit lab inspect` names what the host lacks, with the one command for each. |
| `release-unavailable` | none of the newest Omarchy releases has its ISO, `.sha256` and `.sig` all published, or the release list named nothing at or above the lab's floor | `omakit lab inspect` names the newest release and why each newer one was passed over; run it again once Omarchy has published all three. |
| `signer-changed` | the newest Omarchy release is signed by a key omakit does not ship; the lab will not prepare it and will not fall back to an older release | `omakit upgrade`: a newer omakit carries Omarchy's new key once it is verified. The base you have keeps working. |
| `lab-busy` | another run holds the lock, or something is still running | `omakit lab inspect` |
| `iso-mismatch` | the file on disk is not the release as published (size, digest or signature), and nothing will boot it | `omakit lab prune`, then `omakit lab setup` |
| `size-mismatch` | the download ended at a different byte count than the release announced when setup read it | `omakit lab setup`: Omarchy changed the object at the versioned URL, and setup reads the release again. |
| `sidecar-mismatch` | the checksum published now is not the one setup read at the start: Omarchy republished the release while it downloaded | As above: `omakit lab setup` reads the release again. |
| `key-mismatch` | the packaged signing key is not the one the pin names | Reinstall omakit from the registry (`omakit upgrade`). |
| `toolchain-missing` | the omarchy-iso checkout was not recorded | `omakit lab inspect` prints the one command that prepares the toolchain. |
| `toolchain-mismatch` | the harness changed between the check and the copy | As above. |
| `guest-mismatch` | the staged base runs a linked checkout, or another release's `omarchy` package than the ISO it was built from | `omakit lab prune` removes the staged base. |
| `build-failed` | the base build exited without producing the base | Read `build.log` under the lab's staging directory, then prune and set up again. |
| `qemu-failed` | QEMU did not start | Read `qemu.log` in the run directory; `omakit lab inspect` names what the host lacks. |
| `overlay-failed` | `qemu-img` could not create the run's overlay | The base must be ready and the disk must have room for one overlay. |
| `no-port` | no free port between 2222 and 2271 on 127.0.0.1 | Free one, or wait for the run that holds it. |
| `guest-exited` | the guest exited while the lab waited for SSH | Read `qemu.log` and `serial.log` in the run directory, then run it again. |
| `guest-timeout` | no SSH answer from the guest in time | As above. |
| `session-timeout` | no Hyprland session owned by the guest user in time | Read `qemu.log` and the screenshots beside it, then run it again. |
| `plugin-fetch-failed` | a plugin the weigh evidence suite needs could not be fetched | Connect to the network, then `omakit lab setup --plugins` again. |
| `prune-refused` | a path under the lab is a symbolic link, and the lab wrote none | Remove the symbolic link by hand; nothing under it is removed. |

## Measured cases

Incidents that a code on this page now names, with the figures they were
measured by. One row each; the measurement behind it is in
[MEASUREMENTS.md](MEASUREMENTS.md).

| Date (UTC) | Issue | Code | Seconds from edit to refusal | Cause |
| --- | --- | --- | ---: | --- |
| 2026-09-20 | omacom/omarchy-plugin-marketplace#7787 | `repository-unreachable` (the marketplace's), now `wrong-repository` and `refused` (`watch`), `submission.issue-repository-url` (`submit`) | 40 | A retry edit typed by an agent retyped the whole body: the Repository URL became `mtolhuijs/omacrunch` (another account, no such repository) for a plugin at `mtolhuys/omacrunch`, and the Maintainer notes were wiped. The `issues` workflow run started 19:18:33, `needs-fixes` was labelled 19:19:13. Nothing in omakit compared the issue with `origin`, read the failed validation, or found the issue as the author's once its URL was wrong (M15). |

Every code in the tool's own remedy table has a row here, and
`tests/unit/hygiene.test.mjs` fails when a code is added to that table and
not to this page. A few codes on this page are not in it: they carry their
own action from where they are raised, which is why the action is stated
beside them.
