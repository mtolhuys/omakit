## Measured reason

<!-- What measured defect, risk or missing proof makes this change necessary? -->

## Proof

<!-- Name the test that fails without this change and the commands run afterwards. -->

## Invariants

- [ ] The change has a regression test that fails without it.
- [ ] `./bin/omakit pin`, `npm test` and `npm pack --dry-run` pass.
- [ ] stdout remains byte-stable when piped and carries no escape sequence.
- [ ] Colour uses ANSI palette indices only.
- [ ] The tool remains plain ESM with zero runtime dependencies and no build step.
- [ ] Marketplace access remains read-only through the one literal-GET call site.
- [ ] The tool invokes `gh` only as `gh auth token --hostname github.com`.
- [ ] New verdict or documentation claims cite a measured number and its method.
- [ ] A pin change followed every step in `docs/UPSTREAM_CONTRACT.md`, or the pin did not move.
- [ ] Every third-party workflow action is pinned to a full commit SHA.
- [ ] The commits contain no assistant attribution or co-author trailer.
