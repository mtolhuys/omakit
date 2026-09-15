<p align="center">
  <img src="docs/media/banner.gif" alt="omakit" width="440">
</p>

The safe place to find out: everything knowable about an Omarchy Quattro plugin submission before you post it, on your own machine. Agent-first, read-only against the marketplace, posts nothing, zero dependencies.

[![Built for Omarchy: App](https://raw.githubusercontent.com/tcballard/omarchy-badges/75975e5b5bf75e7ede3764bcd2950046f7abfe2c/badges/v1/omarchy-app.svg)](https://github.com/tcballard/omarchy-badges) [![npm version](https://img.shields.io/npm/v/omakit)](https://www.npmjs.com/package/omakit) [![CI status](https://img.shields.io/github/actions/workflow/status/mtolhuys/omakit/ci.yml?branch=main)](https://github.com/mtolhuys/omakit/actions/workflows/ci.yml) [![Socket](https://socket.dev/api/badge/npm/package/omakit)](https://socket.dev/npm/package/omakit)

`omakit` is a zero-dependency Node CLI that checks an Omarchy Quattro plugin submission on your machine.
It is for a coding agent or a person submitting a plugin.
It never posts to the marketplace or writes into a plugin tree.

## Install

```bash
npm install --global omakit
omakit setup
```

See [docs/INSTALL.md](docs/INSTALL.md) for the clone route, PATH, requirements and upgrading.

## Commands

| Command | What it does |
| --- | --- |
| [`omakit setup`](docs/COMMANDS.md) | The environment, the pin, tab completion, and what to try first. |
| [`omakit submit <plugin-repo>`](docs/SUBMIT.md) | Every check, the issue title and body; asks for a category and tags at a terminal. |
| [`omakit watch <issue-url>`](docs/VALIDATION_WATCH.md) | The commit the marketplace validated, against the plugin's current HEAD. |
| [`omakit verify <plugin-repo>`](docs/COMMANDS.md) | The official security baseline over the local transport; `--json` for the document. |
| [`omakit parity`](docs/COMMANDS.md) | The baseline over GitHub versus the local transport, on real listings; writes the evidence. |
| [`omakit audit [<plugin>]`](docs/AUDIT.md) | Installed third-party commits against the exact commits the marketplace validated. |
| [`omakit weigh <plugin>`](docs/WEIGH.md) | What a plugin weighs on the shell, measured by restarting it without and with the plugin; asks first. |
| [`omakit doctor`](docs/COMMANDS.md) | What is installed, what is pinned, and what has moved. |
| [`omakit pin`](docs/COMMANDS.md) | What setup does for the pin, on its own. |
| [`omakit upgrade`](docs/COMMANDS.md) | Updates omakit through its own installer: npm, or a fast-forward. |
| [`omakit help --agent`](docs/COMMANDS.md) | The operating instructions, for the agent running this. |

### `submit`

```bash
omakit submit <plugin-repo> --category Widgets --tags bar,quickshell
```

It decides whether the plugin is ready, refused, or already listed; [103 issues mention agent-control files that no automated check reports](docs/MEASUREMENTS.md).

![omakit submit refusing a plugin with no license, a README that never says how to uninstall, and a reserved plugin id](docs/media/submit.gif)

Read more: [docs/SUBMIT.md](docs/SUBMIT.md).

### `watch`

```bash
omakit watch <submission-issue-url>
```

It decides whether the marketplace validated the plugin's current commit; [73% of parked submissions have a HEAD the marketplace never saw](docs/MEASUREMENTS.md).

![omakit watch reporting that a validated commit has fallen behind](docs/media/watch.gif)

Read more: [docs/VALIDATION_WATCH.md](docs/VALIDATION_WATCH.md).

### `weigh`

```bash
omakit weigh <plugin-id-or-dir>
```

It measures what a plugin weighs on the shell, CPU and child processes, against a baseline taken the same minute; [in the lab, a 180 ms timer fixture measured 2.73% CPU above a 0.13% floor](docs/MEASUREMENTS.md).

```text
Weighs no CPU above the floor (0.13%) and runs 2 child processes using 8.2 MB and 0.1% CPU, on Omarchy 4.0.0.alpha, measured with omakit weigh on 2026-09-14
```

It restarts your shell and asks first. Memory is a shell fact; CPU and child processes are the weight.

Read more: [docs/WEIGH.md](docs/WEIGH.md).

## Evidence, not claims

| Claim | Proof |
| --- | --- |
| The local transport produces the marketplace's own result | 30 of 30 identical, [docs/evidence/parity/](docs/evidence/parity/) |
| A local run touches no network | run inside `unshare -rn`, [docs/evidence/offline/](docs/evidence/offline/) |
| The generated body is well formed | the marketplace's own parser, `tests/unit/issue.test.mjs` |
| Nothing writes to the marketplace | `tests/unit/read-only.test.mjs`, over every source file |
| No agent-control file can reach a plugin | `tests/unit/self-containment.test.mjs` |
| `weigh` restores `shell.json` on every exit path, and runs a frozen list of Omarchy commands | `tests/unit/weigh.test.mjs` against a fake `/proc` and stub commands, `tests/unit/read-only.test.mjs` |
| The GIFs above are real output | captures and renderer in [docs/media/](docs/media/) |

Committed evidence records a digest of each side rather than the results themselves, because findings about a specific third-party plugin are not this project's to publish.

## Documentation

| Document | For |
| --- | --- |
| [docs/INSTALL.md](docs/INSTALL.md) | install details, PATH, requirements, upgrading, and what Socket reports and why |
| [docs/HOW.md](docs/HOW.md) | what omakit is doing, why it uses Node, the baseline and check labels |
| [docs/COMMANDS.md](docs/COMMANDS.md) | command details, authentication and network behaviour |
| [docs/AUDIT.md](docs/AUDIT.md) | installed plugin drift against marketplace-validated commits, with JSON origins |
| [docs/SUBMIT.md](docs/SUBMIT.md) | every check and what it decides |
| [docs/WEIGH.md](docs/WEIGH.md) | what `weigh` measures, the noise floor, the `shell.json` mutation and its restore, and the JSON contract |
| [docs/VALIDATION_WATCH.md](docs/VALIDATION_WATCH.md) | the validation watch: what the marketplace validated, and what moves it |
| [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md) | every number, its method and its limits |
| [docs/UPSTREAM_CONTRACT.md](docs/UPSTREAM_CONTRACT.md) | the seam, the pin, the boundaries |
| [docs/MARKETPLACE.md](docs/MARKETPLACE.md) | who this actually helps |
| [docs/PALETTE.md](docs/PALETTE.md) | every installed Omarchy theme measured, and which palette index each role gets |
| [docs/TUI.md](docs/TUI.md) | what the terminal shows, and why it looks that way |
| [AGENTS.md](AGENTS.md) | changing this repository |

MIT. Derived work built on public data from
`omacom/omarchy-plugin-marketplace`; not affiliated with or endorsed by that
project.
