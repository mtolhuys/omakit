# Changelog

## 0.4.3 (unreleased)

- `omakit inspect <plugin-dir>`: what a plugin tree does, as observations.
  Every process with its argv, whether a deadline is observed and what
  collects its output; every host with its timeout and size-cap flags; every
  write with whether it falls under a directory the plugin controls; every
  timer with its interval; the baseline's capabilities through `verify`; and
  below the facts, one row per review class the marketplace's human review
  raised, printed only where the tree shows the class's precondition, with
  its measured share (M11). Regular expressions over QML and shell, every
  row labelled observed, no score, no verdict, runs nothing from the tree.
  `docs/INSPECT.md` is the contract; `--json` is the document.
- `doctor`, `pin` and `setup` read the pinned checkout's size from `du`'s total
  whatever its exit status, so a git lock file vanishing mid-walk no longer
  turns the size into "size unknown".
- CI runs on Ubuntu only, Node 22 and 24; the README says where omakit runs.
