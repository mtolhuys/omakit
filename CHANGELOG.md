# Changelog

## 0.4.2 (unreleased)

- An option written as `--name=value` is read by every command that reads
  one, the way `options.mjs` already accepted it. Before, `doctor --out=FILE`
  wrote nothing and exited 0, and `submit --category=X --tags=Y` said both
  flags were missing.
- `submit` on a subject without a github.com origin no longer lists
  `submission.validation-commit` as a second blocking cause with "could not
  read the default-branch HEAD (unknown): "; it waits on
  `submission.repository-url`, which names the one cause.
- `weigh` treats a shell pid that is not in `/proc` when the window opens, or
  gone when it closes, as a run with no sample instead of a completed run of
  zeros; and an interrupt whose restore did not verify is reported as the
  unverified restore with the backup kept, never as "shell.json was restored".
- `watch` no longer renders a bot account's comment as the discussion, counts
  it as a reviewer, or dates the last human review by it.

- README second pass explains submission actions, groups the documentation,
  counts dependencies, and holds command GIFs on informative final screens.
- M6 corrects the historical sample denominator and adds complete dated
  per-issue staleness reads with unknown comparisons kept explicit.

- Shorter README with one recorded GIF per command, refreshed account-wide
  watch, desktop audit and weighing-list captures, and numbered evidence.

- `submit` reports `review.cost` immediately after the baseline: automated,
  manual queue, or manual queue again with an open-issue count and batching
  advice. It is always advisory and adds `reviewCost` to JSON.
- `watch --all` counts update issues carrying the manual-review label and
  documentation-only changes between validated commits. Missing comparisons
  carry reasons rather than counting as runtime changes.
- M9 records a dated, complete open-update population measurement with a
  reproducible read-only command and explicit comparison limits.

The package remains at 0.4.1. No release or publication was performed.
