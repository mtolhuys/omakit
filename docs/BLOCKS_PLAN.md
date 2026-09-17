# Blocks: what is still open

The plan of 2026-09-17 is in [history](history/2026-09-17-blocks-plan.md)
with its measurements, phases, gates and the decisions of that day. This
page keeps what has not happened yet, as of the 0.6.0 preparation.

## Done, on `feature/blocks`

| Phase | Result |
| --- | --- |
| 1, the Run spike | [BLOCKS_SPIKE.md](BLOCKS_SPIKE.md): design (b), the supervisor, chosen by 36 runs |
| 2, Run 0.1 | `blocks/run/`, `omakit add run`, inspect recognition, the lab suite 13 of 13 on the desktop and the stock guest |
| 3, the Run proof | Theme Manager's 27 sites through Run on its `run-port` branch, process lifecycle 23 to 0 and unbounded buffering 18 to 0; the fetch blocker proven against hostile repositories ([record](evidence/blocks/2026-09-17-theme-manager-port.json)) |
| 4, Store 0.1 | `blocks/store/`, from Theme Manager's cache transaction; the lab suite 12 of 12 on both; the Sidecar port of its device state ([record](evidence/blocks/2026-09-17-sidecar-port.json)) |
| 5, the rebrand | README, package metadata, banner and GIF, this page; 0.6.0 prepared, not released |

## Open

- **The release of 0.6.0**: Maarten's, after reading the README
  ([RELEASING.md](RELEASING.md)).
- **The submissions**: Theme Manager's `run-port` and Sidecar's `store-port`
  are branches. Each is submitted only once merged to its default branch by
  Maarten, through the normal flow; the reviewer's outcome is recorded
  whatever it is, and nobody is asked to look. No reviewer has seen a
  ported plugin yet.
- **Theme Manager's Store port**: its memory file and catalog directory
  writes are not on Store; the catalog cache stays the helper's own
  transaction by design, and the memory file is the candidate.
- **What Run does not fit**: Sidecar's daemon must live as long as the
  shell, which a Run program by contract does not; its six `Process` sites
  stay bare. A block for a long-lived helper is not planned.
- **The evaluation, 2026-10-15**: three signals, two of three to continue
  with the next block, none to stop building blocks and offer Run upstream
  instead: a ported plugin reviewed without a process or state blocker;
  someone else's plugin using a block; an unprompted outside signal.
- **1.0.0**: Run and Store each through at least three real reviews with
  no process or state blocker, the lab suites green on two Omarchy
  releases, no open blocker on any of the author's plugins, and at least
  one plugin by someone else using a block in the catalog.
- **Later blocks**, in M13 order, only after the evaluation: a pinned
  artifact installer (336 comments), safe fetch (207), secrets (203),
  plain text (140).

## Words that are not used

"passes review", "approved", "safe", "secure", "certified", "official".
The marketplace says its checks are not a security audit; a block cannot
claim more. What is said is what the block does and what was measured.
