# The documentation

No reader needs every page in this directory. This one says which page
answers which question, and in what order the answers are worth reading.

Everything here is written for two readers at once: the person publishing an
Omarchy plugin, and the coding agent doing it on their behalf. Where a page
states a number, the number is measured and cited; where it states a limit,
the limit is what the tool actually refuses to do.

## Start here

| Page | What it answers |
| --- | --- |
| [WHY.md](WHY.md) | why a plugin needs plumbing it did not write, and what the review spends its words on |
| [HOW.md](HOW.md) | what the tool is built on: the numbers that made it, where its rules are read from, and what its result is not |
| [INSTALL.md](INSTALL.md) | how to install it, how it updates, and what a dependency scanner sees in it |
| [COMMANDS.md](COMMANDS.md) | every command, what it reads, what it prints, and what it will not do |

## The four jobs

The commands fall into four jobs, and the pages follow them.

| Job | Page | What it answers |
| --- | --- | --- |
| Build | [BLOCKS.md](BLOCKS.md) | the Run and Store contracts, line by line, and how a copy is added, updated and recognised |
| Check | [INSPECT.md](INSPECT.md) | what a plugin tree is observed to do, and which review patterns its shape invites |
| Check | [SUBMIT.md](SUBMIT.md) | everything knowable before a submission is posted, and the exact text that would be posted |
| Track | [VALIDATION_WATCH.md](VALIDATION_WATCH.md) | whether the commit the marketplace validated is still the commit the repository is on |
| Track | [AUDIT.md](AUDIT.md) | which installed plugins are running something other than their validated commit |
| Track | [WEIGH.md](WEIGH.md) | what a plugin costs the shell, measured from outside the process |
| Prove | [LAB.md](LAB.md) | how a suite runs in a disposable guest, what anchors its trust, and what one run costs |

## The boundaries

| Page | What it answers |
| --- | --- |
| [MARKETPLACE.md](MARKETPLACE.md) | what the marketplace already automates, and where this tool helps instead of overlapping |
| [UPSTREAM_CONTRACT.md](UPSTREAM_CONTRACT.md) | what the tool depends on upstream, and what happens when upstream changes |

## The evidence

No claim in the pages above stands on its own. These carry the numbers.

| Page | What it holds |
| --- | --- |
| [MEASUREMENTS.md](MEASUREMENTS.md) | every measurement, with its method, its date and its limits |
| [evidence/](evidence) | the machine-readable record behind each measurement |
| [PALETTE.md](PALETTE.md) | which ANSI index each role gets in a terminal, measured across the installed themes |
| [media/README.md](media/README.md) | how every GIF and diagram in the documentation was produced |

## The design notes

Written while the work was done, kept because they say why a decision went
the way it did. They are not the contract; the pages above are.

| Page | What it records |
| --- | --- |
| [BLOCKS_SPIKE.md](BLOCKS_SPIKE.md) | the reasoning and the measurements behind the two blocks |
| [BLOCKS_PLAN.md](BLOCKS_PLAN.md) | what is still open on the blocks |
| [INSPECT_DESIGN.md](INSPECT_DESIGN.md) | why inspect reports observations rather than verdicts |
| [TUI.md](TUI.md) | what the terminal output is held to, line by line |
| [RELEASING.md](RELEASING.md) | the release procedure |
| [history/](history) | plans and inventories as they stood, kept unedited |
