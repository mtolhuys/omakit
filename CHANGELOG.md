# Changelog

## 0.5.1 (unreleased)

Four kinds of noise in `inspect`'s function extraction are gone, each
measured on a listed plugin and each with a fixture under
`tests/fixtures/inspect/`, a fifth found in review, and M12 is
re-measured over the same 50 trees (6041 functions).

- A Python line that starts while a bracket is open, inside a
  triple-quoted string, or after a line ending in a backslash is a
  continuation of the statement above it: it counts toward the length
  and the branches, never toward nesting, and never sets the
  indentation unit; a def's parameter list spanning lines is a
  continuation of the def. A `for` with a `try` and a multi-line call
  read as nesting 3 before, over the p90 of 2 (`python-continuation`).
  A continuation cannot run past a statement at the def's indent, so a
  miscounted bracket ends the function early rather than swallowing
  the next one. Reading a def with a multi-line parameter list through
  to its body, where before only the signature was read, is what moved
  the thresholds: 178 Python functions in the sample grew, most in one
  vendored library, none shrank, and the p90s are now 25 lines, 7
  branches, nesting 2, from 22, 6 and 2.
- A shell heredoc body, up to its delimiter alone on a line, and a
  quoted string that spans lines (an awk or Python program in single
  quotes, a remote command in double quotes) count toward the length and
  toward nothing else, from the opening quote on. A 36-line function
  wrapping a Python heredoc read as 9 branches and nesting 4 before, now
  0 and 0 (`shell-heredoc`). The line scanner tracks single, double and
  `$'...'` quotes, a comment start and the heredoc operator together, so
  `"Okomart's"`, `*'#'*`, a here-string `<<< word`, a `<<EOF` inside a
  string and a delimiter like `END-HELP` do not open a string or a
  heredoc that swallows the rest of the file. A case arm is a `)` with
  text after it on a line with no `(` before it, so a `$(...)` in a
  guard's test is not a branch either.
- A shell guard, `||` or `&&` followed by one flow word (`return`,
  `exit`, `continue`, `break`, `true`, `false`, `:`) with an optional
  status (a number, `$?` or a variable) and nothing else on the line but
  a `;` or `;;`, is not a branch; every other `||` and `&&` still is. A 233-line function of guards read as 131 branches
  before, 19 now (`shell-guards`). The M12 method text states the rule.
- A listed tree with no function carries `heavyShare: null` in the
  record and is out of the sample the score ranks against, so it no
  longer lifts every other tree's rank; `size.sample.heavyShares` has 49
  entries and the report says "less than N of 49 listed trees". The seven
  listed trees whose share is 0 with functions in them stay, as they
  measured light. The 0.5.0 record is named in the new record's notes
  and in `docs/MEASUREMENTS.md`.

On omarchy-theme-manager, `read_entry` reads 0 branches, the acceptance
script drops from 131 to 19, publish-wallpaper.py has no function over the
thresholds after its refactor, and the refactor branch still ranks above
main. A unit test now holds the record generator's null share and the
method text whole (its first cut was silently truncated by a backtick
inside a template literal), and the scanner's corners are tested
one by one.

## 0.5.0

The `inspect` size score no longer punishes honest refactoring, and M12 is
re-measured with a reproducible script. See `docs/releases/0.5.0.md`.
