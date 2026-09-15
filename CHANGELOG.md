# Changelog

## 0.4.2 (unreleased)

- `submit` reports `review.cost` immediately after the baseline: automated,
  manual queue, or manual queue again with an open-issue count and batching
  advice. It is always advisory and adds `reviewCost` to JSON.
- `watch --all` counts update issues carrying the manual-review label and
  documentation-only changes between validated commits. Missing comparisons
  carry reasons rather than counting as runtime changes.
- M9 records a dated, complete open-update population measurement with a
  reproducible read-only command and explicit comparison limits.

The package remains at 0.4.1. No release or publication was performed.
