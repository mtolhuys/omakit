# Changelog

## 0.5.1 (unreleased)

Four kinds of noise in `inspect`'s function extraction are gone, each
measured on a listed plugin and each with a fixture under
`tests/fixtures/inspect/`, and M12 is re-measured over the same 50 trees
(6041 functions; no p90 moved).

- A Python line that starts while a bracket is open is a continuation
  of the statement above it: it counts toward the length, never toward
  nesting, and never sets the indentation unit. A `for` with a `try`
  and a multi-line call read as nesting 3 before, over the p90 of 2
  (`python-continuation`).
- A shell heredoc body, up to its delimiter alone on a line, and a
  quoted string that spans lines (an awk or Python program in single
  quotes) count toward the length and toward nothing else. A 36-line
  function wrapping a Python heredoc read as 9 branches and nesting 4
  before, now 0 and 0 (`shell-heredoc`). The line scanner tracks single
  and double quotes and a comment start together, so `"Okomart's"` and
  `*'#'*` do not open a string that swallows the rest of the file.
- A shell guard, `||` or `&&` followed by one flow word (`return`,
  `exit`, `continue`, `break`, `true`, `false`, `:`) with an optional
  status and nothing else on the line, is not a branch; every other `||`
  and `&&` still is. A 233-line function of guards read as 131 branches
  before, 19 now (`shell-guards`). The M12 method text states the rule.
- A listed tree with no function carries `heavyShare: null` in the
  record and is out of the sample the score ranks against, so it no
  longer lifts every other tree's rank; `size.sample.heavyShares` has 49
  entries and the report says "less than N of 49 listed trees". The five
  listed trees whose share is 0 with functions in them stay, as they
  measured light. The 0.5.0 record is named in the new record's notes
  and in `docs/MEASUREMENTS.md`.

On omarchy-theme-manager, `read_entry` reads 0 branches, the acceptance
script drops from 131 to 19, publish-wallpaper.py has no function over the
thresholds after its refactor, and the refactor branch still ranks above
main.

## 0.5.0

The `inspect` size score no longer punishes honest refactoring, and M12 is
re-measured with a reproducible script. See `docs/releases/0.5.0.md`.
