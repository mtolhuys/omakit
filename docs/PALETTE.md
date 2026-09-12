# The palette, measured

Every colour omakit emits is an ANSI palette index, and the Omarchy theme
decides what that index looks like. So which index a role gets is not a matter
of taste: it is a question about the installed themes, and this document is
the answer, measured. The decision it produced is at the end; the numbers come
first, because the decision is only as good as they are.

Nothing measured here reaches the terminal. No hex value from a theme is ever
emitted; the measurement decides which index each role gets, and the terminal
keeps deciding what that index looks like, so the tool follows the theme when
the user switches it. `tests/unit/style.test.mjs` fails on a truecolor or
256-colour escape anywhere in the sources.

## Method

`docs/evidence/palette/measure.mjs` reads every theme installed on an Omarchy
machine, in `~/.config/omarchy/themes` and `/usr/share/omarchy/themes`, and
resolves each one's palette the way Omarchy itself does at theme-set time:
`omarchy-theme-color --file <colors.toml> --all` applies the alias and
fallback cascade the terminal templates are filled from, so `color0` to
`color15`, `background` and `foreground` are exactly what `alacritty.toml`,
`foot.ini`, `ghostty.conf` and `kitty.conf` receive (a theme without a
`colors.toml` gets one derived from its `alacritty.toml`, which is what
`omarchy-theme-set` does for it). The SGR indices map onto those slots:
30 to 37 are `color0` to `color7`, 90 to 97 are `color8` to `color15`, and
39 is the foreground.

Two numbers per theme. Against the background, the WCAG contrast ratio of
every slot: below 3:1 a run is not readable (WCAG's floor for large text and
interface parts), below 4.5:1 it is not body text. Between every pair of
slots, the CIELAB distance (CIE76): below 10 two runs are the same colour to a
glance, and 20 is where they read as different colours. CIE76 overstates
differences among saturated blues and understates them among greys; both
errors are on the safe side for this question.

`dim` (SGR 2) is not a slot. The terminal derives it from the foreground, so
it was measured by screenshotting a dim run beside a plain one in all four
terminals on this machine: Alacritty, foot and kitty scale the foreground by
0.66 in sRGB, Ghostty by 0.74. The lower factor is used to predict it for
every theme. On Matte Black that measured as 4.5:1 (Ghostty 5.4:1), against
1.5:1 for grey (90) and 9.9:1 for the foreground; cyan (36) measured
pixel-identical to the foreground there.

The raw numbers are in `docs/evidence/palette/2026-09-12-themes.json`, and
`node docs/evidence/palette/measure.mjs` regenerates everything below.

## The table

Measured 32 installed themes (27 dark, 5 light) on 2026-09-12.

### Contrast against the theme's background (WCAG ratio)

Below 3:1 a run is not readable and is marked `!`; below 4.5:1 it is not body text and is marked `~`.

| theme | mode | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | fg | 90 | 91 | 92 | 93 | 94 | 95 | 96 | 97 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| aether | dark | 1.0 ! | 5.1 | 5.1 | 6.2 | 7.8 | 5.0 | 7.0 | 11.8 | 11.8 | 3.4 ~ | 8.0 | 8.1 | 9.7 | 12.0 | 8.0 | 10.8 | 13.5 |
| aetheria | dark | 1.0 ! | 14.2 | 4.0 ~ | 11.1 | 3.7 ~ | 3.4 ~ | 7.8 | 8.0 | 8.0 | 3.7 ~ | 4.5 | 5.3 | 5.7 | 9.5 | 1.6 ! | 12.0 | 7.2 |
| batman | dark | 1.0 ! | 11.8 | 8.8 | 15.2 | 3.5 ~ | 3.5 ~ | 2.7 ! | 7.1 | 7.1 | 3.3 ~ | 15.2 | 14.7 | 14.1 | 5.5 | 6.0 | 6.7 | 12.1 |
| batou | dark | 1.0 ! | 8.3 | 7.3 | 10.6 | 2.9 ! | 5.1 | 9.8 | 7.5 | 7.5 | 1.6 ! | 3.0 ~ | 3.8 ~ | 2.8 ! | 8.0 | 8.5 | 6.0 | 7.5 |
| felix | dark | 1.0 ! | 6.1 | 17.2 | 7.8 | 3.4 ~ | 6.1 | 4.6 | 17.2 | 17.2 | 3.4 ~ | 7.8 | 4.6 | 9.9 | 3.4 ~ | 6.1 | 7.8 | 17.2 |
| fireside | dark | 1.0 ! | 5.7 | 6.2 | 9.1 | 9.4 | 7.4 | 11.6 | 16.7 | 16.7 | 2.8 ! | 5.7 | 7.9 | 10.7 | 11.6 | 9.2 | 13.9 | 16.7 |
| flexoki-dark | dark | 1.0 ! | 3.0 ! | 4.2 ~ | 5.5 | 2.9 ! | 2.9 ! | 4.2 ~ | 12.0 | 12.0 | 3.8 ~ | 4.4 ~ | 6.1 | 8.1 | 4.9 | 5.1 | 6.7 | 12.0 |
| manga | dark | 1.0 ! | 6.5 | 7.3 | 8.0 | 8.7 | 7.1 | 8.6 | 13.4 | 13.4 | 8.7 | 11.4 | 12.4 | 13.4 | 14.4 | 9.7 | 11.6 | 13.4 |
| midnight | dark | 1.0 ! | 5.6 | 7.0 | 12.9 | 7.8 | 9.1 | 8.5 | 18.3 | 18.3 | 1.3 ! | 3.3 ~ | 9.8 | 9.8 | 10.7 | 11.9 | 11.4 | 21.0 |
| one-dark-pro | dark | 1.0 ! | 4.4 ~ | 6.9 | 8.1 | 5.9 | 4.8 | 5.9 | 6.6 | 6.6 | 2.3 ! | 4.4 ~ | 6.9 | 8.1 | 5.9 | 4.8 | 5.9 | 8.7 |
| catppuccin | dark | 1.0 ! | 7.1 | 11.0 | 12.9 | 7.8 | 10.7 | 11.0 | 11.3 | 11.3 | 2.5 ! | 7.1 | 11.0 | 12.9 | 7.8 | 10.7 | 11.0 | 11.3 |
| catppuccin-latte | light | 1.0 ! | 4.8 | 3.0 ! | 2.3 ! | 4.3 ~ | 2.3 ! | 3.3 ~ | 7.1 | 7.1 | 1.9 ! | 4.8 | 3.0 ! | 2.3 ! | 4.3 ~ | 2.3 ! | 3.3 ~ | 7.1 |
| ethereal | dark | 1.0 ! | 5.8 | 7.5 | 10.9 | 5.7 | 8.4 | 10.2 | 13.7 | 13.7 | 4.9 | 10.6 | 12.2 | 14.6 | 11.6 | 14.3 | 16.0 | 13.7 |
| everforest | dark | 1.0 ! | 4.5 | 6.2 | 6.8 | 5.7 | 5.4 | 5.9 | 7.4 | 7.4 | 1.6 ! | 4.5 | 6.2 | 6.8 | 5.7 | 5.4 | 5.9 | 7.4 |
| flexoki-light | light | 1.0 ! | 4.2 ~ | 3.0 ~ | 2.3 ! | 6.4 | 3.6 ~ | 2.8 ! | 18.6 | 18.6 | 2.0 ! | 4.2 ~ | 3.0 ~ | 2.3 ! | 3.8 ~ | 3.6 ~ | 2.8 ! | 18.6 |
| gruvbox | dark | 1.0 ! | 4.7 | 6.7 | 6.7 | 5.9 | 5.4 | 6.3 | 8.2 | 8.2 | 2.3 ! | 4.7 | 6.7 | 6.7 | 5.9 | 5.4 | 6.3 | 8.2 |
| hackerman | dark | 1.0 ! | 13.9 | 12.3 | 14.5 | 7.2 | 8.0 | 15.4 | 17.4 | 17.4 | 1.6 ! | 15.6 | 15.3 | 16.8 | 12.8 | 13.9 | 18.0 | 17.4 |
| kanagawa | dark | 1.0 ! | 3.2 ~ | 4.8 | 6.8 | 5.9 | 4.7 | 4.9 | 11.3 | 11.3 | 2.2 ! | 3.7 ~ | 7.5 | 9.7 | 7.2 | 5.0 | 6.2 | 11.3 |
| last-horizon | dark | 1.0 ! | 6.8 | 7.8 | 3.3 ~ | 7.3 | 13.3 | 7.8 | 19.1 | 19.1 | 2.5 ! | 6.8 | 7.8 | 3.3 ~ | 7.3 | 13.3 | 7.8 | 14.6 |
| lumon | dark | 1.0 ! | 4.0 ~ | 4.9 | 5.9 | 7.3 | 8.8 | 11.6 | 12.1 | 12.1 | 1.7 ! | 6.1 | 7.4 | 9.1 | 15.2 | 10.5 | 13.1 | 15.2 |
| lupine | light | 1.0 ! | 4.7 | 7.7 | 4.7 | 4.8 | 5.0 | 5.0 | 15.4 | 15.4 | 2.6 ! | 2.9 ! | 2.9 ! | 3.1 ~ | 3.4 ~ | 3.3 ~ | 3.3 ~ | 20.1 |
| matte-black | dark | 1.0 ! | 5.0 | 11.5 | 2.9 ! | 7.3 | 5.0 | 10.1 | 10.1 | 10.1 | 1.5 ! | 2.9 ! | 11.5 | 2.8 ! | 8.7 | 2.9 ! | 15.6 | 10.1 |
| miasma | dark | 1.0 ! | 2.3 ! | 3.9 ~ | 3.9 ~ | 3.9 ~ | 4.4 ~ | 6.8 | 8.8 | 8.8 | 2.8 ! | 2.3 ! | 3.9 ~ | 3.9 ~ | 3.9 ~ | 4.4 ~ | 6.8 | 8.8 |
| nord | dark | 1.0 ! | 3.0 ~ | 6.1 | 8.0 | 4.6 | 4.4 ~ | 6.2 | 9.3 | 9.3 | 1.7 ! | 3.0 ~ | 6.1 | 8.0 | 4.6 | 4.4 ~ | 6.0 | 9.3 |
| osaka-jade | dark | 1.0 ! | 5.5 | 5.4 | 4.7 | 4.8 | 5.2 | 9.4 | 9.7 | 9.7 | 2.9 ! | 7.9 | 6.7 | 10.4 | 10.9 | 7.9 | 10.2 | 14.3 |
| retro-82 | dark | 1.0 ! | 5.4 | 4.0 ~ | 6.3 | 4.7 | 4.7 | 8.7 | 13.4 | 13.4 | 3.0 ! | 5.4 | 4.0 ~ | 6.3 | 9.3 | 4.7 | 8.7 | 13.4 |
| ristretto | dark | 1.0 ! | 5.3 | 9.3 | 9.9 | 6.3 | 6.8 | 9.2 | 10.9 | 10.9 | 2.8 ! | 6.4 | 10.6 | 10.7 | 7.8 | 8.6 | 11.5 | 10.9 |
| rose-pine | light | 1.0 ! | 3.8 ~ | 5.6 | 2.0 ! | 3.1 ~ | 3.5 ~ | 2.6 ! | 6.7 | 6.7 | 1.5 ! | 3.8 ~ | 5.6 | 2.0 ! | 3.1 ~ | 3.5 ~ | 2.6 ! | 6.7 |
| solitude | dark | 1.0 ! | 2.8 ! | 7.5 | 13.4 | 4.7 | 8.4 | 3.8 ~ | 11.6 | 11.6 | 2.2 ! | 5.2 | 1.7 ! | 10.5 | 3.1 ~ | 6.6 | 3.8 ~ | 8.3 |
| tokyo-night | dark | 1.0 ! | 6.5 | 9.3 | 8.6 | 6.8 | 6.3 | 5.4 | 8.1 | 8.1 | 1.9 ! | 6.9 | 13.1 | 8.4 | 7.1 | 7.4 | 7.3 | 10.6 |
| vantablack | dark | 1.0 ! | 8.4 | 10.4 | 13.3 | 6.3 | 7.6 | 9.7 | 21.0 | 21.0 | 4.9 | 8.4 | 10.4 | 13.3 | 6.3 | 7.6 | 9.7 | 21.0 |
| white | light | 1.0 ! | 14.3 | 11.4 | 8.9 | 17.4 | 13.6 | 10.7 | 21.0 | 21.0 | 4.0 ~ | 14.3 | 11.4 | 8.9 | 17.4 | 13.6 | 10.7 | 21.0 |

Readable (3:1) in every theme: 37, fg, 94, 97.
Body text (4.5:1) in every theme: 37, fg, 97.

`dim` (the foreground scaled by 0.66, the factor Alacritty, foot and kitty use; Ghostty uses 0.74) against the background: worst 3.0:1 in one-dark-pro; readable in 32 of 32 themes, body text in 22. Distinct from the foreground (20+) in 27 of 32; not in catppuccin-latte (13), flexoki-light (2), lupine (6), rose-pine (15), white (0), where a label reads as plain text and its column is what marks it.

- 30 is unreadable in aether (1.0), aetheria (1.0), batman (1.0), batou (1.0), felix (1.0), fireside (1.0), flexoki-dark (1.0), manga (1.0), midnight (1.0), one-dark-pro (1.0), catppuccin (1.0), catppuccin-latte (1.0), ethereal (1.0), everforest (1.0), flexoki-light (1.0), gruvbox (1.0), hackerman (1.0), kanagawa (1.0), last-horizon (1.0), lumon (1.0), lupine (1.0), matte-black (1.0), miasma (1.0), nord (1.0), osaka-jade (1.0), retro-82 (1.0), ristretto (1.0), rose-pine (1.0), solitude (1.0), tokyo-night (1.0), vantablack (1.0), white (1.0).
- 31 is unreadable in flexoki-dark (3.0), miasma (2.3), solitude (2.8).
- 32 is unreadable in catppuccin-latte (3.0).
- 33 is unreadable in catppuccin-latte (2.3), flexoki-light (2.3), matte-black (2.9), rose-pine (2.0).
- 34 is unreadable in batou (2.9), flexoki-dark (2.9).
- 35 is unreadable in flexoki-dark (2.9), catppuccin-latte (2.3).
- 36 is unreadable in batman (2.7), flexoki-light (2.8), rose-pine (2.6).
- 90 is unreadable in batou (1.6), fireside (2.8), midnight (1.3), one-dark-pro (2.3), catppuccin (2.5), catppuccin-latte (1.9), everforest (1.6), flexoki-light (2.0), gruvbox (2.3), hackerman (1.6), kanagawa (2.2), last-horizon (2.5), lumon (1.7), lupine (2.6), matte-black (1.5), miasma (2.8), nord (1.7), osaka-jade (2.9), retro-82 (3.0), ristretto (2.8), rose-pine (1.5), solitude (2.2), tokyo-night (1.9).
- 91 is unreadable in lupine (2.9), matte-black (2.9), miasma (2.3).
- 92 is unreadable in catppuccin-latte (3.0), lupine (2.9), solitude (1.7).
- 93 is unreadable in batou (2.8), catppuccin-latte (2.3), flexoki-light (2.3), matte-black (2.8), rose-pine (2.0).
- 95 is unreadable in aetheria (1.6), catppuccin-latte (2.3), matte-black (2.9).
- 96 is unreadable in flexoki-light (2.8), rose-pine (2.6).

### Themes that are monochrome by design

A theme in which fewer than half of the fifteen pairs among its six hues (31 to 36) are 20 CIELAB units apart says little by hue, whatever index a role gets: felix, manga, lumon, vantablack, white. They are measured above and left out of the pairwise question below, which they would answer "nothing" for; on them the tool's second carriers (glyph density, case, column, air) are the whole message.

### Distance between slots (CIELAB, worst chromatic theme)

For each pair, the smallest distance over the 27 chromatic themes. Under 10 the two are the same colour there (`!`); under 20 they are hard to tell apart (`~`).

| | 31 | 32 | 33 | 34 | 35 | 36 | 37 | fg | 90 | 91 | 92 | 93 | 94 | 95 | 96 | 97 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **31** | · | 7 ! | 9 ! | 13 ~ | 0 ! | 9 ! | 28 | 28 | 7 ! | 0 ! | 14 ~ | 12 ~ | 3 ! | 16 ~ | 9 ! | 32 |
| **32** | 7 ! | · | 7 ! | 12 ~ | 5 ! | 10 ! | 6 ! | 6 ! | 12 ~ | 11 ~ | 0 ! | 14 ~ | 6 ! | 5 ! | 11 ~ | 4 ! |
| **33** | 9 ! | 7 ! | · | 9 ! | 6 ! | 6 ! | 5 ! | 5 ! | 13 ~ | 0 ! | 9 ! | 0 ! | 11 ~ | 0 ! | 10 ~ | 16 ~ |
| **34** | 13 ~ | 12 ~ | 9 ! | · | 0 ! | 3 ! | 21 | 21 | 4 ! | 13 ~ | 9 ! | 7 ! | 0 ! | 0 ! | 8 ! | 17 ~ |
| **35** | 0 ! | 5 ! | 6 ! | 0 ! | · | 8 ! | 11 ~ | 11 ~ | 2 ! | 14 ~ | 12 ~ | 6 ! | 13 ~ | 0 ! | 8 ! | 5 ! |
| **36** | 9 ! | 10 ! | 6 ! | 3 ! | 8 ! | · | 0 ! | 0 ! | 6 ! | 19 ~ | 15 ~ | 5 ! | 2 ! | 8 ! | 0 ! | 0 ! |
| **37** | 28 | 6 ! | 5 ! | 21 | 11 ~ | 0 ! | · | 0 ! | 22 | 16 ~ | 15 ~ | 8 ! | 8 ! | 5 ! | 5 ! | 0 ! |
| **fg** | 28 | 6 ! | 5 ! | 21 | 11 ~ | 0 ! | 0 ! | · | 22 | 16 ~ | 15 ~ | 8 ! | 8 ! | 5 ! | 5 ! | 0 ! |
| **90** | 7 ! | 12 ~ | 13 ~ | 4 ! | 2 ! | 6 ! | 22 | 22 | · | 16 ~ | 9 ! | 13 ~ | 9 ! | 17 ~ | 15 ~ | 36 |
| **91** | 0 ! | 11 ~ | 0 ! | 13 ~ | 14 ~ | 19 ~ | 16 ~ | 16 ~ | 16 ~ | · | 7 ! | 8 ! | 13 ~ | 0 ! | 19 ~ | 22 |
| **92** | 14 ~ | 0 ! | 9 ! | 9 ! | 12 ~ | 15 ~ | 15 ~ | 15 ~ | 9 ! | 7 ! | · | 6 ! | 15 ~ | 10 ! | 13 ~ | 21 |
| **93** | 12 ~ | 14 ~ | 0 ! | 7 ! | 6 ! | 5 ! | 8 ! | 8 ! | 13 ~ | 8 ! | 6 ! | · | 6 ! | 6 ! | 7 ! | 14 ~ |
| **94** | 3 ! | 6 ! | 11 ~ | 0 ! | 13 ~ | 2 ! | 8 ! | 8 ! | 9 ! | 13 ~ | 15 ~ | 6 ! | · | 3 ! | 4 ! | 11 ~ |
| **95** | 16 ~ | 5 ! | 0 ! | 0 ! | 0 ! | 8 ! | 5 ! | 5 ! | 17 ~ | 0 ! | 10 ! | 6 ! | 3 ! | · | 3 ! | 5 ! |
| **96** | 9 ! | 11 ~ | 10 ~ | 8 ! | 8 ! | 0 ! | 5 ! | 5 ! | 15 ~ | 19 ~ | 13 ~ | 7 ! | 4 ! | 3 ! | · | 8 ! |
| **97** | 32 | 4 ! | 16 ~ | 17 ~ | 5 ! | 0 ! | 0 ! | 0 ! | 36 | 22 | 21 | 14 ~ | 11 ~ | 5 ! | 8 ! | · |

### Which pairs hold in every chromatic theme

Distinct (20+) in every chromatic theme: 31/37, 31/fg, 31/97, 34/37, 34/fg, 37/90, fg/90, 90/97, 91/97, 92/97.

Pairs that collapse, and where:

- 37/fg: 27 themes, aether (0), aetheria (0), batman (0), batou (0), fireside (0), flexoki-dark (0), midnight (0), one-dark-pro (0), catppuccin (0), catppuccin-latte (0), ethereal (0), everforest (0), flexoki-light (0), gruvbox (0), hackerman (0), kanagawa (0), last-horizon (0), lupine (0), matte-black (0), miasma (0), nord (0), osaka-jade (0), retro-82 (0), ristretto (0), rose-pine (0), solitude (0), tokyo-night (0)
- 37/97: 27 themes, aether (6), aetheria (7), batman (18), batou (0), fireside (0), flexoki-dark (0), midnight (6), one-dark-pro (10), catppuccin (0), catppuccin-latte (0), ethereal (0), everforest (0), flexoki-light (0), gruvbox (0), hackerman (0), kanagawa (0), last-horizon (11), lupine (13), matte-black (0), miasma (0), nord (0), osaka-jade (16), retro-82 (0), ristretto (0), rose-pine (0), solitude (12), tokyo-night (10)
- fg/97: 27 themes, aether (6), aetheria (7), batman (18), batou (0), fireside (0), flexoki-dark (0), midnight (6), one-dark-pro (10), catppuccin (0), catppuccin-latte (0), ethereal (0), everforest (0), flexoki-light (0), gruvbox (0), hackerman (0), kanagawa (0), last-horizon (11), lupine (13), matte-black (0), miasma (0), nord (0), osaka-jade (16), retro-82 (0), ristretto (0), rose-pine (0), solitude (12), tokyo-night (10)
- 36/96: 23 themes, aether (14), batou (19), fireside (7), flexoki-dark (14), midnight (10), one-dark-pro (0), catppuccin (0), catppuccin-latte (0), ethereal (18), everforest (0), flexoki-light (0), gruvbox (0), kanagawa (7), last-horizon (0), lupine (12), matte-black (16), miasma (0), nord (10), retro-82 (0), ristretto (8), rose-pine (0), solitude (0), tokyo-night (15)
- 32/92: 22 themes, aether (15), aetheria (17), batman (19), fireside (8), flexoki-dark (12), midnight (11), one-dark-pro (0), catppuccin (0), catppuccin-latte (0), ethereal (17), everforest (0), flexoki-light (0), gruvbox (0), last-horizon (0), matte-black (0), miasma (0), nord (0), osaka-jade (7), retro-82 (0), ristretto (13), rose-pine (0), tokyo-night (14)
- 35/95: 22 themes, aether (15), batman (16), batou (18), fireside (11), flexoki-dark (16), midnight (9), one-dark-pro (0), catppuccin (0), catppuccin-latte (0), everforest (0), flexoki-light (0), gruvbox (0), kanagawa (16), last-horizon (0), lupine (14), miasma (0), nord (0), retro-82 (0), ristretto (8), rose-pine (0), solitude (8), tokyo-night (5)
- 33/93: 20 themes, aether (15), fireside (7), flexoki-dark (14), midnight (19), one-dark-pro (0), catppuccin (0), catppuccin-latte (0), everforest (0), flexoki-light (0), gruvbox (0), kanagawa (13), last-horizon (0), lupine (13), matte-black (8), miasma (0), nord (0), retro-82 (0), ristretto (4), rose-pine (0), solitude (12)
- 34/94: 20 themes, aether (14), batman (14), fireside (7), flexoki-dark (19), midnight (10), one-dark-pro (0), catppuccin (0), catppuccin-latte (0), everforest (0), flexoki-light (19), gruvbox (0), last-horizon (0), lupine (14), matte-black (8), miasma (0), nord (0), ristretto (12), rose-pine (0), solitude (12), tokyo-night (3)
- 31/91: 17 themes, aether (14), fireside (0), flexoki-dark (11), one-dark-pro (0), catppuccin (0), catppuccin-latte (0), everforest (0), flexoki-light (0), gruvbox (0), last-horizon (0), lupine (19), miasma (0), nord (0), retro-82 (0), ristretto (12), rose-pine (0), tokyo-night (2)
- 94/96: 10 themes, aether (4), batman (6), batou (14), fireside (7), midnight (12), kanagawa (18), last-horizon (19), lupine (6), osaka-jade (10), solitude (7)
- 36/94: 9 themes, aether (18), batou (8), fireside (2), midnight (13), ethereal (18), last-horizon (19), lupine (12), nord (16), solitude (7)
- 34/36: 8 themes, aether (3), batman (8), fireside (7), midnight (10), last-horizon (19), lupine (11), nord (16), solitude (8)
- 34/35: 7 themes, batman (3), batou (18), midnight (19), hackerman (4), kanagawa (18), retro-82 (0), solitude (18)
- 34/96: 7 themes, aether (11), batman (19), fireside (14), midnight (16), last-horizon (19), lupine (18), solitude (8)
- 37/95: 7 themes, aether (20), batman (7), batou (5), hackerman (13), last-horizon (16), rose-pine (19), solitude (18)
- fg/95: 7 themes, aether (20), batman (7), batou (5), hackerman (13), last-horizon (16), rose-pine (19), solitude (18)
- 32/34: 6 themes, fireside (17), miasma (15), osaka-jade (12), retro-82 (12), rose-pine (19), solitude (14)
- 32/35: 6 themes, aether (9), batou (12), last-horizon (19), lupine (20), retro-82 (12), solitude (5)
- 34/92: 6 themes, batou (14), fireside (9), miasma (15), osaka-jade (16), retro-82 (12), rose-pine (19)
- 94/95: 6 themes, batman (4), batou (9), midnight (19), ethereal (18), hackerman (3), osaka-jade (15)
- 32/93: 5 themes, aether (20), aetheria (14), batman (18), fireside (20), solitude (16)
- 32/95: 5 themes, aether (18), batou (8), last-horizon (19), retro-82 (12), solitude (5)
- 34/90: 5 themes, aetheria (8), batman (4), batou (17), ethereal (18), retro-82 (18)
- 37/93: 5 themes, aether (8), fireside (18), ethereal (17), everforest (20), solitude (9)
- 37/96: 5 themes, batman (5), batou (16), fireside (8), hackerman (8), matte-black (16)
- fg/93: 5 themes, aether (8), fireside (18), ethereal (17), everforest (20), solitude (9)
- fg/96: 5 themes, batman (5), batou (16), fireside (8), hackerman (8), matte-black (16)
- 92/94: 5 themes, fireside (15), matte-black (19), miasma (15), rose-pine (19), solitude (17)
- 93/97: 5 themes, aether (14), fireside (18), ethereal (17), everforest (20), solitude (15)
- 95/96: 5 themes, batman (3), batou (19), ethereal (13), osaka-jade (9), solitude (16)
- 95/97: 5 themes, batou (5), hackerman (13), last-horizon (11), rose-pine (19), solitude (8)
- 32/33: 4 themes, aether (7), batou (13), fireside (14), osaka-jade (10)
- 32/36: 4 themes, batou (10), everforest (16), kanagawa (17), last-horizon (16)
- 32/94: 4 themes, batou (6), matte-black (19), miasma (15), rose-pine (19)
- 33/92: 4 themes, aether (11), fireside (9), hackerman (18), osaka-jade (14)
- 33/95: 4 themes, aether (16), batou (13), matte-black (0), miasma (6)
- 35/37: 4 themes, batou (15), last-horizon (16), rose-pine (19), solitude (11)
- 35/fg: 4 themes, batou (15), last-horizon (16), rose-pine (19), solitude (11)
- 35/97: 4 themes, batou (15), last-horizon (11), rose-pine (19), solitude (5)
- 36/92: 4 themes, fireside (15), ethereal (18), everforest (16), last-horizon (16)
- 37/94: 4 themes, batman (8), batou (11), fireside (14), hackerman (16)
- fg/94: 4 themes, batman (8), batou (11), fireside (14), hackerman (16)
- 92/93: 4 themes, aether (7), batman (6), fireside (12), hackerman (18)
- 92/95: 4 themes, aether (10), ethereal (19), last-horizon (19), retro-82 (12)
- 93/95: 4 themes, aether (13), matte-black (8), miasma (6), solitude (17)
- 96/97: 4 themes, batou (16), fireside (8), hackerman (8), matte-black (16)
- 31/35: 3 themes, aether (4), fireside (17), matte-black (0)
- 31/92: 3 themes, aether (17), batman (17), solitude (14)
- 32/96: 3 themes, batou (11), everforest (16), last-horizon (16)
- 33/35: 3 themes, aether (12), miasma (6), solitude (16)
- 33/36: 3 themes, batou (6), fireside (12), lupine (7)
- 33/37: 3 themes, batou (16), everforest (20), solitude (5)
- 33/fg: 3 themes, batou (16), everforest (20), solitude (5)
- 33/94: 3 themes, batou (11), fireside (12), lupine (12)
- 33/96: 3 themes, batou (19), fireside (17), lupine (10)
- 33/97: 3 themes, batou (16), everforest (20), solitude (17)
- 34/95: 3 themes, batman (16), retro-82 (0), solitude (11)
- 35/92: 3 themes, aether (17), last-horizon (19), retro-82 (12)
- 35/94: 3 themes, batman (13), batou (15), ethereal (20)
- 36/37: 3 themes, batou (11), fireside (14), matte-black (0)
- 36/fg: 3 themes, batou (11), fireside (14), matte-black (0)
- 36/93: 3 themes, fireside (5), hackerman (12), lupine (17)
- 36/97: 3 themes, batou (11), fireside (14), matte-black (0)
- 91/93: 3 themes, aether (10), batman (12), matte-black (8)
- 92/96: 3 themes, ethereal (13), everforest (16), last-horizon (16)
- 93/96: 3 themes, fireside (11), hackerman (18), lupine (7)
- 94/97: 3 themes, batou (11), fireside (14), hackerman (16)
- 31/32: 2 themes, aether (7), batman (16)
- 31/34: 2 themes, last-horizon (13), solitude (15)
- 31/36: 2 themes, rose-pine (19), solitude (9)
- 31/90: 2 themes, miasma (16), solitude (7)
- 31/94: 2 themes, last-horizon (13), solitude (3)
- 31/96: 2 themes, rose-pine (19), solitude (9)
- 32/37: 2 themes, batou (6), solitude (15)
- 32/fg: 2 themes, batou (6), solitude (15)
- 32/91: 2 themes, aether (16), hackerman (11)
- 32/97: 2 themes, batou (6), solitude (4)
- 33/34: 2 themes, fireside (9), lupine (17)
- 33/91: 2 themes, aether (12), matte-black (0)
- 34/91: 2 themes, aetheria (13), last-horizon (13)
- 35/90: 2 themes, batman (2), retro-82 (18)
- 35/91: 2 themes, aether (14), fireside (17)
- 35/93: 2 themes, miasma (6), solitude (11)
- 35/96: 2 themes, batman (19), batou (8)
- 36/90: 2 themes, batman (6), solitude (15)
- 36/95: 2 themes, batou (8), solitude (16)
- 90/91: 2 themes, aetheria (18), miasma (16)
- 90/92: 2 themes, retro-82 (12), solitude (9)
- 90/93: 2 themes, aetheria (19), last-horizon (13)
- 90/94: 2 themes, batman (15), solitude (9)
- 90/95: 2 themes, batman (17), retro-82 (18)
- 91/92: 2 themes, aether (8), batman (7)
- 91/95: 2 themes, aether (5), matte-black (0)
- 93/94: 2 themes, fireside (6), lupine (13)
- 31/33: 1 theme, aether (9)
- 31/93: 1 theme, batman (12)
- 31/95: 1 theme, aether (16)
- 32/90: 1 theme, retro-82 (12)
- 33/90: 1 theme, last-horizon (13)
- 34/93: 1 theme, fireside (7)
- 34/97: 1 theme, solitude (17)
- 35/36: 1 theme, batman (8)
- 36/91: 1 theme, rose-pine (19)
- 37/91: 1 theme, aether (16)
- 37/92: 1 theme, aether (15)
- fg/91: 1 theme, aether (16)
- fg/92: 1 theme, aether (15)
- 90/96: 1 theme, solitude (15)
- 91/94: 1 theme, last-horizon (13)
- 91/96: 1 theme, rose-pine (19)

## The decision

Four hues, and the terminal's own bold and dim. The roles, the index each one
gets, and the number that chose it:

| role | index | why, in the numbers |
| --- | --- | --- |
| what you could type: a command, a flag, the remedy arrow, the `omakit` word | blue, 34 | The one role a reader most needs to spot. Cyan (36) was pixel-identical to the foreground on Matte Black (distance 0) and unreadable in batman, flexoki-light and rose-pine. Blue is unreadable in two themes and both are borderline (batou and flexoki-dark at 2.9:1), and it is at least 21 CIELAB units from the foreground in every chromatic theme, which no other slot is. Bright blue (94) is the only chromatic slot readable in all 32 themes, but it sits within 20 of the foreground in batman, batou, fireside and hackerman, and a command the same colour as prose is the flatness this work exists to remove. On Matte Black, blue is the theme's own amber accent. |
| a placeholder you replace; an advisory; an unknown | yellow, 33 | Unreadable in four themes (catppuccin-latte, flexoki-light, rose-pine, matte-black), which is the second worst slot. Every alternative is worse: magenta (35) and bright cyan (96) collapse into blue in seven themes each, bright yellow (93) is unreadable in five, bright magenta (95) in three and collapses into blue in three, and green is taken. The carrier that survives is the shape: a placeholder sits in `<angle brackets>`, an advisory behind `▓ note`. |
| a pass, and an environment variable | green, 32 | Readable in 31 of 32 (catppuccin-latte at 3.0:1); within 20 of red only in aether and batman, and `▁ ok` is lower case beside `█ FAIL`. |
| a blocking failure | red, 31, bold | At least 28 from the foreground in every chromatic theme. Unreadable in flexoki-dark, miasma and solitude (all between 2.3 and 3.0:1); there the full block, the bold and the capitals carry it. |
| a label, punctuation, grouping, the info mark | dim, 2 | Grey (90) is under 3:1 in 23 of 32 themes, 1.5:1 on Matte Black: the labels beside every key in `watch`, and the `why` under every failure, were not readable on most of Omarchy. Dim is readable in all 32 (worst 3.0:1, one-dark-pro), body text in 22, and at least 20 from the foreground in 27; in the five where it is not (catppuccin-latte, flexoki-light, lupine, rose-pine, white) a label reads as plain text and its column is what marks it. The rule that no sentence is ever dimmed stands: a label is one word. |
| a heading, a name (a check id, a commit) | bold | Unchanged. Bold is a weight, not a colour, and every theme honours it. |
| a sentence | the foreground, 39 | Unchanged: prose keeps the terminal's own foreground, and nothing is said by colour alone. |

Five themes are monochrome by design (felix, lumon, manga, vantablack, white)
and say little by hue whatever the mapping; on them the second carriers are the
message, and they were already the rule.
