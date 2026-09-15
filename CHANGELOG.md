# Changelog

## 0.4.3 (unreleased)

- `doctor`, `pin` and `setup` read the pinned checkout's size from `du`'s total
  whatever its exit status, so a git lock file vanishing mid-walk no longer
  turns the size into "size unknown".
- CI runs on Ubuntu only, Node 22 and 24; the README says where omakit runs.
