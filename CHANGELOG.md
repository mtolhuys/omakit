# Changelog

## 0.4.3 (unreleased)

- `omakit inspect <plugin-dir>`: what a plugin's tree does and what needs
  attention, read statically from QML and shell, never run. The report
  opens with a size score, 10 minus the mean rank of the tree's functions
  among functions in listed plugins (M12), then the functions over what 90
  of 100 listed functions stay under, longest first, then one block per
  review class the tree shows, ordered by the class's measured share of
  review findings (M11), with up to five sites under each. `--full` is every
  process with its argv, host, write, timer and function with every
  qualifier; `--json` is the document of `docs/INSPECT.md`, held by an
  executable contract. The marketplace baseline runs through `verify` over
  the plugin's own tree, also when the plugin sits below the root of a
  larger repository. No verdict: the score is a position, the shares are
  the review sample's, and a tree that shows nothing is "observed nothing
  of this kind", never clean.
- `doctor`, `pin` and `setup` read the pinned checkout's size from `du`'s total
  whatever its exit status, so a git lock file vanishing mid-walk no longer
  turns the size into "size unknown".
- CI runs on Ubuntu only, Node 22 and 24; the README says where omakit runs.
