# Changelog

## 0.6.0 (unreleased)

The first block: Run, `blocks/run/`, a `Run.qml` and the supervisor it
starts through `/usr/bin/python3 -I -S -B`, copied into a plugin with
`omakit add run`; its contract in `docs/BLOCKS.md` cites, line by line,
how many review comments in one week asked for it (M13). `omakit inspect`
recognises an unmodified copy as one row and reads a modified one like any
other file. The lab suite under `tests/lab/run/` proves it on the desktop
and on the stock 4.0.3 guest. The sixth skill, `omarchy-plugin-build`.
Not released; the README still describes 0.5.

## 0.5.1

Six kinds of noise in `inspect`'s function extraction are gone and M12 is
re-measured with them. See `docs/releases/0.5.1.md`.

## 0.5.0

The `inspect` size score no longer punishes honest refactoring, and M12 is
re-measured with a reproducible script. See `docs/releases/0.5.0.md`.
