#!/usr/bin/env python3
"""Render the WHY.md diagrams as SVG, once per theme.

Documentation tooling, not part of the tool. It exists because the diagrams in
docs/WHY.md are drawn, not captured: a drawing nobody can regenerate is a file
that quietly stops matching the text beside it. The geometry lives here once;
the two files per diagram are output.

Two files per diagram because a diagram is read on a white page and on a black
one. An SVG loaded through an <img> element, which is how a forge renders a
picture in Markdown, has no page around it to inherit a colour from, so every
stroke and every glyph carries its own. WHY.md picks the file with <picture>
and the reader's own preference decides.

Usage:
    python3 docs/media/diagrams.py            # writes docs/media/why-*.svg
    python3 docs/media/diagrams.py --check    # exit 1 if any file is stale
"""

import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent

# Page colours, not the tool's: docs/PALETTE.md decides which ANSI index a role
# gets in a terminal, and nothing here ever reaches one. Four roles: ink and
# muted carry the words, accent is the thing being explained, warn is the
# failure.
THEMES = {
    "light": {"ink": "#16202b", "muted": "#5b6875", "accent": "#2f6fb0", "warn": "#a9541c"},
    "dark": {"ink": "#e5ecf3", "muted": "#94a2b1", "accent": "#72a9dd", "warn": "#d68a4b"},
}

MONO = "ui-monospace, SFMono-Regular, Menlo, DejaVu Sans Mono, monospace"
SANS = "system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"

FRAME = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" \
role="img" aria-labelledby="t"><title id="t">{title}</title>
<defs>
<marker id="ink" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" \
orient="auto-start-reverse"><polygon points="0,0 10,5 0,10" fill="{ink}"/></marker>
<marker id="acc" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" \
orient="auto-start-reverse"><polygon points="0,0 10,5 0,10" fill="{accent}"/></marker>
</defs>
<g font-family="{sans}" font-size="12">
{body}
</g>
</svg>
"""

SHELL = """
<rect x="150" y="60" width="340" height="110" rx="6" fill="none" stroke="{ink}" stroke-width="1.5"/>
<text x="320" y="48" text-anchor="middle" font-family="{mono}" font-size="13" fill="{ink}">omarchy-shell, one process, your rights</text>

<rect x="168" y="86" width="90" height="58" rx="4" fill="none" stroke="{accent}" stroke-width="2"/>
<text x="213" y="113" text-anchor="middle" fill="{accent}">your</text>
<text x="213" y="130" text-anchor="middle" fill="{accent}">plugin</text>

<rect x="275" y="86" width="90" height="58" rx="4" fill="none" stroke="{muted}" stroke-width="1"/>
<text x="320" y="119" text-anchor="middle" fill="{muted}">a bar widget</text>

<rect x="382" y="86" width="90" height="58" rx="4" fill="none" stroke="{muted}" stroke-width="1"/>
<text x="427" y="119" text-anchor="middle" fill="{muted}">a panel</text>

<text x="10" y="96" fill="{ink}">Wi-Fi names</text>
<text x="10" y="116" fill="{ink}">window titles</text>
<text x="10" y="136" fill="{ink}">file names</text>
<text x="10" y="156" fill="{ink}">command output</text>
<text x="10" y="178" fill="{muted}">input you do not control</text>
<line x1="112" y1="115" x2="165" y2="115" stroke="{ink}" stroke-width="1.5" marker-end="url(#ink)"/>

<line x1="213" y1="146" x2="213" y2="206" stroke="{accent}" stroke-width="1.5" marker-end="url(#acc)"/>
<text x="225" y="180" fill="{accent}">starts programs, reads files</text>
<rect x="123" y="208" width="180" height="34" rx="4" fill="none" stroke="{ink}" stroke-width="1.5"/>
<text x="213" y="230" text-anchor="middle" font-family="{mono}" fill="{ink}">the operating system</text>
"""

FAILURES = """
<rect x="8" y="126" width="120" height="48" rx="4" fill="none" stroke="{accent}" stroke-width="2"/>
<text x="68" y="155" text-anchor="middle" fill="{accent}">your plugin</text>

<line x1="128" y1="150" x2="196" y2="150" stroke="{ink}" stroke-width="1.5" marker-end="url(#ink)"/>
<text x="162" y="140" text-anchor="middle" font-family="{mono}" font-size="11" fill="{ink}">git</text>

<rect x="198" y="126" width="118" height="48" rx="4" fill="none" stroke="{ink}" stroke-width="1.5"/>
<text x="257" y="155" text-anchor="middle" fill="{ink}">child process</text>

<line x1="316" y1="140" x2="386" y2="46" stroke="{muted}" stroke-width="1.2" marker-end="url(#ink)"/>
<line x1="316" y1="146" x2="386" y2="116" stroke="{muted}" stroke-width="1.2" marker-end="url(#ink)"/>
<line x1="316" y1="156" x2="386" y2="186" stroke="{muted}" stroke-width="1.2" marker-end="url(#ink)"/>
<line x1="316" y1="162" x2="386" y2="256" stroke="{muted}" stroke-width="1.2" marker-end="url(#ink)"/>

<text x="394" y="34" font-family="{mono}" fill="{warn}">never returns</text>
<text x="394" y="52" fill="{ink}">the widget is frozen, for good</text>

<text x="394" y="104" font-family="{mono}" fill="{warn}">prints 10 MB</text>
<text x="394" y="122" fill="{ink}">the whole desktop slows down</text>

<text x="394" y="174" font-family="{mono}" fill="{warn}">panel closes</text>
<text x="394" y="192" fill="{ink}">the child keeps running, unwatched</text>

<text x="394" y="244" font-family="{mono}" fill="{warn}">PATH decides</text>
<text x="394" y="262" fill="{ink}">another process can answer to the name</text>
"""

RUN = """
<rect x="8" y="96" width="112" height="52" rx="4" fill="none" stroke="{ink}" stroke-width="1.5"/>
<text x="64" y="127" text-anchor="middle" fill="{ink}">your plugin</text>

<line x1="120" y1="122" x2="178" y2="122" stroke="{accent}" stroke-width="1.5" marker-end="url(#acc)"/>

<rect x="180" y="86" width="112" height="72" rx="4" fill="none" stroke="{accent}" stroke-width="2"/>
<text x="236" y="112" text-anchor="middle" font-family="{mono}" fill="{accent}">Run</text>
<text x="236" y="132" text-anchor="middle" font-size="11" fill="{accent}">the block</text>

<line x1="292" y1="122" x2="350" y2="122" stroke="{ink}" stroke-width="1.5" marker-end="url(#ink)"/>
<text x="321" y="112" text-anchor="middle" font-size="11" fill="{ink}">argv</text>

<rect x="352" y="70" width="270" height="104" rx="6" fill="none" stroke="{ink}" stroke-width="1.5" stroke-dasharray="4 3"/>
<text x="487" y="60" text-anchor="middle" font-family="{mono}" font-size="11" fill="{ink}">its own process group</text>
<rect x="372" y="90" width="106" height="44" rx="4" fill="none" stroke="{muted}" stroke-width="1"/>
<text x="425" y="117" text-anchor="middle" fill="{ink}">supervisor</text>
<line x1="478" y1="112" x2="512" y2="112" stroke="{muted}" stroke-width="1.2" marker-end="url(#ink)"/>
<rect x="514" y="90" width="92" height="44" rx="4" fill="none" stroke="{muted}" stroke-width="1"/>
<text x="560" y="117" text-anchor="middle" font-family="{mono}" fill="{ink}">/usr/bin/git</text>
<text x="487" y="156" text-anchor="middle" font-size="11" fill="{muted}">and anything it starts</text>

<text x="8" y="196" font-family="{mono}" fill="{accent}">on the way out</text>
<text x="8" y="214" fill="{ink}">full path, closed environment, argv only</text>
<text x="8" y="236" font-family="{mono}" fill="{accent}">on the way back</text>
<text x="8" y="254" fill="{ink}">bytes counted while reading, capped</text>

<text x="352" y="196" font-family="{mono}" fill="{accent}">when time is up</text>
<text x="352" y="214" fill="{ink}">stop, wait, kill, the whole group</text>
<text x="352" y="236" font-family="{mono}" fill="{accent}">when the panel closes</text>
<text x="352" y="254" fill="{ink}">the same ending, nothing survives</text>
"""

STORE = """
<text x="8" y="26" font-family="{mono}" fill="{accent}">reading</text>
<rect x="8" y="38" width="96" height="40" rx="4" fill="none" stroke="{ink}" stroke-width="1.2"/>
<text x="56" y="63" text-anchor="middle" font-family="{mono}" fill="{ink}">home</text>
<line x1="104" y1="58" x2="140" y2="58" stroke="{ink}" stroke-width="1.2" marker-end="url(#ink)"/>
<rect x="142" y="38" width="120" height="40" rx="4" fill="none" stroke="{ink}" stroke-width="1.2"/>
<text x="202" y="63" text-anchor="middle" font-family="{mono}" fill="{ink}">.local/state</text>
<line x1="262" y1="58" x2="298" y2="58" stroke="{ink}" stroke-width="1.2" marker-end="url(#ink)"/>
<rect x="300" y="38" width="120" height="40" rx="4" fill="none" stroke="{ink}" stroke-width="1.2"/>
<text x="360" y="63" text-anchor="middle" font-family="{mono}" fill="{ink}">your plugin</text>
<line x1="420" y1="58" x2="456" y2="58" stroke="{ink}" stroke-width="1.2" marker-end="url(#ink)"/>
<rect x="458" y="38" width="120" height="40" rx="4" fill="none" stroke="{accent}" stroke-width="2"/>
<text x="518" y="63" text-anchor="middle" font-family="{mono}" fill="{accent}">state.json</text>
<text x="8" y="100" fill="{muted}">each step opened as a descriptor, never by name a second time,</text>
<text x="8" y="118" fill="{muted}">so nothing can be swapped in between the check and the open</text>

<text x="8" y="146" font-family="{mono}" fill="{accent}">writing</text>
<rect x="8" y="158" width="150" height="40" rx="4" fill="none" stroke="{ink}" stroke-width="1.2"/>
<text x="83" y="183" text-anchor="middle" font-family="{mono}" fill="{ink}">.store-a1b2 (0600)</text>
<line x1="158" y1="178" x2="206" y2="178" stroke="{ink}" stroke-width="1.2" marker-end="url(#ink)"/>
<text x="182" y="168" text-anchor="middle" font-size="11" fill="{muted}">fsync</text>
<rect x="208" y="158" width="130" height="40" rx="4" fill="none" stroke="{ink}" stroke-width="1.2"/>
<text x="273" y="183" text-anchor="middle" font-family="{mono}" fill="{ink}">rename</text>
<line x1="338" y1="178" x2="386" y2="178" stroke="{ink}" stroke-width="1.2" marker-end="url(#ink)"/>
<rect x="388" y="158" width="130" height="40" rx="4" fill="none" stroke="{accent}" stroke-width="2"/>
<text x="453" y="183" text-anchor="middle" font-family="{mono}" fill="{accent}">state.json</text>
<text x="8" y="220" fill="{muted}">a reader never sees half a file, and a crash never leaves one</text>
"""

DIAGRAMS = [
    ("why-shell", 640, 260, SHELL,
     "One shell process hosts every widget; values a plugin does not control flow in, "
     "and what it starts runs with the person's rights"),
    ("why-failures", 640, 300, FAILURES,
     "An unguarded child process has four ordinary endings: a frozen widget, a slowed "
     "desktop, a surviving orphan, and whichever program PATH picked"),
    ("why-run", 640, 260, RUN,
     "Run starts the program by absolute path in its own process group, counts the bytes "
     "while reading them, and ends the whole group at the deadline or when the panel closes"),
    ("why-store", 640, 250, STORE,
     "Store walks the directory chain by descriptor and writes through an exclusive "
     "temporary file that is renamed into place"),
]


def render(name, w, h, body, title, theme):
    palette = THEMES[theme]
    return FRAME.format(w=w, h=h, title=title, sans=SANS,
                        body=body.format(mono=MONO, **palette).strip(), **palette)


def main(argv):
    check = "--check" in argv
    stale = []
    for name, w, h, body, title in DIAGRAMS:
        for theme in THEMES:
            path = OUT / f"{name}-{theme}.svg"
            svg = render(name, w, h, body, title, theme)
            if check:
                if not path.exists() or path.read_text() != svg:
                    stale.append(path.name)
            else:
                path.write_text(svg)
                print(path.name)
    if check:
        for name in stale:
            print(f"stale: {name}", file=sys.stderr)
        return 1 if stale else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
