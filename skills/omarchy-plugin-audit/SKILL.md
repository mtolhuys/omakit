---
name: omarchy-plugin-audit
description: Compare installed Omarchy Quattro plugin commits with the exact commits the marketplace validated. Use before touching an installed third-party plugin, before enabling or updating one, or when asked whether installed plugins match marketplace review. Read-only.
---

# Track installed plugin commits

This is the other half of the track job: compare what the shell is running with
the exact commits the marketplace records, without changing either checkout.

Run `omakit audit` before touching an installed third-party plugin. Run
`omakit audit <plugin-id-or-dir>` when only one installed plugin is in scope.
The command reads the shell's installed list, the marketplace catalog and local
Git facts. It changes nothing.

Read the primary state first:

- `validated` means installed HEAD is one of the commits the marketplace
  records as validated.
- `ahead` means a validated commit is an ancestor, but HEAD contains later
  commits the marketplace did not validate.
- `diverged` means installed history does not descend from a validated commit,
  or its origin is not the listed repository. A validated object missing from
  local history is diverged, with the clone's shallow status stated.
- `unverified` means the listing records no validated commit. Its status is stated.
- `unlisted` means neither plugin id nor origin identifies a listing.
- `unknown` means Git or the source directory could not answer. Keep the error.

Then report every stacking flag: `modified`, `disabled`, and `upstream moved`.
Do not collapse a flag into the primary state. First-party plugins are counted
and excluded because they ship with the shell.

Use `--json` when another tool needs the document. Every figure carries its
origin. Use `--offline` when the live catalog must not be read; the header will
name the pin. `--drift` is a view filter, not a different measurement.

An `ahead` or `diverged` report prints the exact checkout command for the
validated commit and names the marketplace form for validating a newer one.
Never run that checkout command without the person's explicit request. Never
replace it with `omarchy plugin update`; update moves to mutable HEAD and does
not establish marketplace validation.

`AUDITED`, exit 0, means every audited row is validated, or there was nothing
third-party to audit. `DRIFT`, exit 1, means drift or an unknown answer.
Exit 2 means the invocation was refused. `NOT AUDITED` because the shell or
catalog did not answer is a
result to report, not a reason to substitute a directory scan.
