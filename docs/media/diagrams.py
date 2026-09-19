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

JOBS = """
<rect x="8" y="40" width="104" height="46" rx="4" fill="none" stroke="{ink}" stroke-width="1.5"/>
<text x="60" y="68" text-anchor="middle" fill="{ink}">your plugin</text>
<line x1="112" y1="63" x2="144" y2="63" stroke="{ink}" stroke-width="1.5" marker-end="url(#ink)"/>

<rect x="148" y="40" width="104" height="46" rx="4" fill="none" stroke="{accent}" stroke-width="2"/>
<text x="200" y="68" text-anchor="middle" font-family="{mono}" fill="{accent}">build</text>
<text x="148" y="106" font-family="{mono}" font-size="11" fill="{ink}">add run</text>
<text x="148" y="122" font-family="{mono}" font-size="11" fill="{ink}">add store</text>
<line x1="252" y1="63" x2="284" y2="63" stroke="{ink}" stroke-width="1.5" marker-end="url(#ink)"/>

<rect x="288" y="40" width="104" height="46" rx="4" fill="none" stroke="{accent}" stroke-width="2"/>
<text x="340" y="68" text-anchor="middle" font-family="{mono}" fill="{accent}">check</text>
<text x="288" y="106" font-family="{mono}" font-size="11" fill="{ink}">inspect</text>
<text x="288" y="122" font-family="{mono}" font-size="11" fill="{ink}">verify</text>
<text x="288" y="138" font-family="{mono}" font-size="11" fill="{ink}">submit</text>
<line x1="392" y1="63" x2="424" y2="63" stroke="{ink}" stroke-width="1.5" marker-end="url(#ink)"/>

<text x="428" y="28" font-size="11" fill="{muted}">you post it; omakit never does</text>
<rect x="428" y="40" width="204" height="46" rx="4" fill="none" stroke="{ink}" stroke-width="1.5"/>
<text x="530" y="68" text-anchor="middle" fill="{ink}">the marketplace issue</text>

<line x1="530" y1="86" x2="530" y2="186" stroke="{ink}" stroke-width="1.5" marker-end="url(#ink)"/>
<rect x="428" y="188" width="204" height="46" rx="4" fill="none" stroke="{accent}" stroke-width="2"/>
<text x="530" y="216" text-anchor="middle" font-family="{mono}" fill="{accent}">track</text>
<text x="428" y="254" font-family="{mono}" font-size="11" fill="{ink}">watch, audit, weigh</text>

<line x1="380" y1="86" x2="380" y2="164" stroke="{ink}" stroke-width="1.5" marker-end="url(#ink)"/>
<rect x="8" y="166" width="400" height="68" rx="6" fill="none" stroke="{accent}" stroke-width="2" stroke-dasharray="4 3"/>
<text x="24" y="194" font-family="{mono}" fill="{accent}">prove</text>
<text x="24" y="218" font-family="{mono}" font-size="11" fill="{ink}">lab prove run | store | weigh</text>
<text x="230" y="190" font-size="11" fill="{muted}">a disposable Omarchy guest,</text>
<text x="230" y="206" font-size="11" fill="{muted}">never the desktop you</text>
<text x="230" y="222" font-size="11" fill="{muted}">work on</text>
<text x="8" y="254" font-size="11" fill="{muted}">optional, and the only job that boots anything</text>
"""

RULES = """
<text x="8" y="16" font-family="{mono}" font-size="11" fill="{accent}">the pin: one exact marketplace commit</text>
<rect x="8" y="24" width="240" height="104" rx="6" fill="none" stroke="{accent}" stroke-width="2" stroke-dasharray="4 3"/>
<text x="24" y="50" font-family="{mono}" font-size="11" fill="{ink}">the submission form</text>
<text x="24" y="72" font-family="{mono}" font-size="11" fill="{ink}">the body parser</text>
<text x="24" y="94" font-family="{mono}" font-size="11" fill="{ink}">the security scanner</text>
<text x="24" y="116" font-family="{mono}" font-size="11" fill="{ink}">the catalog builder</text>
<text x="8" y="146" font-size="11" fill="{muted}">every rule, read from here, and nothing restated</text>

<line x1="248" y1="74" x2="314" y2="74" stroke="{accent}" stroke-width="1.5" marker-end="url(#acc)"/>
<text x="281" y="64" text-anchor="middle" font-size="10" fill="{accent}">run verbatim</text>

<text x="300" y="16" font-size="11" fill="{warn}">[omakit] this project's own checks, from public issue data,</text>
<text x="300" y="32" font-size="11" fill="{warn}">labelled at every line, and never their policy</text>

<rect x="320" y="44" width="150" height="60" rx="4" fill="none" stroke="{ink}" stroke-width="1.5"/>
<text x="395" y="70" text-anchor="middle" font-family="{mono}" fill="{ink}">omakit</text>
<text x="395" y="90" text-anchor="middle" font-size="11" fill="{muted}">adds no rule of theirs</text>

<line x1="470" y1="74" x2="496" y2="74" stroke="{ink}" stroke-width="1.5" marker-end="url(#ink)"/>
<rect x="498" y="44" width="134" height="60" rx="4" fill="none" stroke="{ink}" stroke-width="1.5"/>
<text x="565" y="79" text-anchor="middle" fill="{ink}">what you read</text>

<rect x="8" y="162" width="240" height="40" rx="4" fill="none" stroke="{ink}" stroke-width="1.2"/>
<text x="128" y="187" text-anchor="middle" font-family="{mono}" font-size="11" fill="{ink}">the marketplace's current HEAD</text>
<line x1="248" y1="182" x2="382" y2="110" stroke="{ink}" stroke-width="1.2" marker-end="url(#ink)"/>
<text x="8" y="222" font-size="11" fill="{muted}">which ids and repositories are already listed, because the pin's copy is stale within hours</text>
"""

BLOCKS_COPY = """
<rect x="8" y="30" width="140" height="44" rx="4" fill="none" stroke="{accent}" stroke-width="2"/>
<text x="78" y="57" text-anchor="middle" font-family="{mono}" font-size="11" fill="{accent}">omakit add run</text>
<line x1="148" y1="52" x2="184" y2="52" stroke="{accent}" stroke-width="1.5" marker-end="url(#acc)"/>

<text x="188" y="14" font-family="{mono}" font-size="11" fill="{muted}">&lt;plugin-dir&gt;/omakit/</text>
<rect x="188" y="20" width="230" height="88" rx="6" fill="none" stroke="{ink}" stroke-width="1.5" stroke-dasharray="4 3"/>
<text x="204" y="46" font-family="{mono}" font-size="11" fill="{ink}">Run.qml</text>
<text x="204" y="68" font-family="{mono}" font-size="11" fill="{ink}">run-supervisor.py</text>
<text x="204" y="90" font-family="{mono}" font-size="11" fill="{ink}">NOTICE</text>

<text x="440" y="34" font-size="11" fill="{muted}">every file's header names</text>
<text x="440" y="52" font-size="11" fill="{ink}">the block and its version,</text>
<text x="440" y="68" font-size="11" fill="{ink}">the licence and the copyright,</text>
<text x="440" y="84" font-size="11" fill="{ink}">the omakit commit it came from,</text>
<text x="440" y="100" font-size="11" fill="{ink}">and the sha256 of the body</text>

<line x1="240" y1="108" x2="150" y2="146" stroke="{ink}" stroke-width="1.2" marker-end="url(#ink)"/>
<line x1="366" y1="108" x2="470" y2="146" stroke="{warn}" stroke-width="1.2" marker-end="url(#ink)"/>

<rect x="8" y="150" width="300" height="38" rx="4" fill="none" stroke="{accent}" stroke-width="2"/>
<text x="158" y="174" text-anchor="middle" fill="{accent}">a copy omakit shipped</text>
<text x="8" y="210" font-size="11" fill="{ink}">--update moves it on, header and all</text>
<text x="8" y="228" font-size="11" fill="{ink}">inspect reads it as one row, raising nothing</text>

<rect x="332" y="150" width="300" height="38" rx="4" fill="none" stroke="{warn}" stroke-width="2"/>
<text x="482" y="174" text-anchor="middle" fill="{warn}">a copy you edited</text>
<text x="332" y="210" font-size="11" fill="{ink}">--update refuses before a byte is written</text>
<text x="332" y="228" font-size="11" fill="{ink}">inspect says modified, and reads it like your own code</text>
"""

LAB_RUN = """
<rect x="8" y="40" width="150" height="42" rx="4" fill="none" stroke="{accent}" stroke-width="2"/>
<text x="83" y="66" text-anchor="middle" font-family="{mono}" font-size="11" fill="{accent}">omakit lab prove</text>
<line x1="158" y1="61" x2="194" y2="61" stroke="{accent}" stroke-width="1.5" marker-end="url(#acc)"/>

<rect x="198" y="16" width="434" height="140" rx="6" fill="none" stroke="{accent}" stroke-width="2" stroke-dasharray="4 3"/>
<text x="214" y="38" font-family="{mono}" font-size="11" fill="{accent}">a disposable Omarchy guest</text>

<rect x="214" y="48" width="150" height="46" rx="4" fill="none" stroke="{ink}" stroke-width="1.2"/>
<text x="289" y="70" text-anchor="middle" font-family="{mono}" font-size="11" fill="{ink}">base.qcow2</text>
<text x="289" y="86" text-anchor="middle" font-size="10" fill="{muted}">read-only, 0444</text>
<line x1="364" y1="71" x2="394" y2="71" stroke="{ink}" stroke-width="1.2" marker-end="url(#ink)"/>
<rect x="396" y="48" width="150" height="46" rx="4" fill="none" stroke="{ink}" stroke-width="1.2"/>
<text x="471" y="70" text-anchor="middle" font-family="{mono}" font-size="11" fill="{ink}">overlay</text>
<text x="471" y="86" text-anchor="middle" font-size="10" fill="{muted}">this run only</text>

<rect x="214" y="106" width="332" height="36" rx="4" fill="none" stroke="{ink}" stroke-width="1.2"/>
<text x="380" y="129" text-anchor="middle" font-size="11" fill="{ink}">the suite runs in a session the way a person gets one</text>

<line x1="415" y1="156" x2="415" y2="184" stroke="{ink}" stroke-width="1.5" marker-end="url(#ink)"/>
<rect x="278" y="186" width="354" height="44" rx="4" fill="none" stroke="{accent}" stroke-width="2"/>
<text x="455" y="205" text-anchor="middle" font-size="11" fill="{accent}">the document</text>
<text x="455" y="221" text-anchor="middle" font-size="10" fill="{muted}">the guest it ran on, and what the suite did</text>

<rect x="8" y="186" width="240" height="44" rx="4" fill="none" stroke="{muted}" stroke-width="1.2" stroke-dasharray="4 3"/>
<text x="128" y="205" text-anchor="middle" font-size="11" fill="{muted}">the desktop you work on</text>
<text x="128" y="221" text-anchor="middle" font-size="10" fill="{muted}">not read, not written, not restarted</text>

<text x="8" y="256" font-size="11" fill="{muted}">when the run ends the overlay is removed, and the base is the same file it was</text>
"""

SUBMIT_RUN = """
<rect x="8" y="60" width="164" height="44" rx="4" fill="none" stroke="{ink}" stroke-width="1.5"/>
<text x="90" y="80" text-anchor="middle" font-size="11" fill="{ink}">your plugin,</text>
<text x="90" y="96" text-anchor="middle" font-size="11" fill="{ink}">at one exact commit</text>
<line x1="172" y1="82" x2="204" y2="82" stroke="{ink}" stroke-width="1.5" marker-end="url(#ink)"/>

<rect x="206" y="24" width="230" height="118" rx="6" fill="none" stroke="{accent}" stroke-width="2"/>
<text x="321" y="48" text-anchor="middle" font-family="{mono}" font-size="11" fill="{accent}">sixteen checks</text>
<text x="222" y="76" font-family="{mono}" font-size="10" fill="{ink}">marketplace-pin</text>
<text x="222" y="92" font-size="10" fill="{muted}">their rule, read from the pin</text>
<text x="222" y="116" font-family="{mono}" font-size="10" fill="{warn}">omakit</text>
<text x="222" y="132" font-size="10" fill="{muted}">this project's, from public issue data</text>

<line x1="436" y1="70" x2="466" y2="46" stroke="{ink}" stroke-width="1.2" marker-end="url(#ink)"/>
<line x1="436" y1="83" x2="466" y2="96" stroke="{ink}" stroke-width="1.2" marker-end="url(#ink)"/>
<line x1="436" y1="96" x2="466" y2="146" stroke="{ink}" stroke-width="1.2" marker-end="url(#ink)"/>

<rect x="468" y="24" width="164" height="40" rx="4" fill="none" stroke="{accent}" stroke-width="2"/>
<text x="550" y="49" text-anchor="middle" font-family="{mono}" font-size="11" fill="{accent}">READY   exit 0</text>
<rect x="468" y="76" width="164" height="40" rx="4" fill="none" stroke="{ink}" stroke-width="1.5"/>
<text x="550" y="101" text-anchor="middle" font-family="{mono}" font-size="11" fill="{ink}">LISTED  exit 0</text>
<rect x="468" y="128" width="164" height="40" rx="4" fill="none" stroke="{warn}" stroke-width="2"/>
<text x="550" y="153" text-anchor="middle" font-family="{mono}" font-size="11" fill="{warn}">REFUSED exit 1</text>

<text x="8" y="196" font-size="11" fill="{accent}">ready: the exact title and body follow, for you to post</text>
<text x="8" y="214" font-size="11" fill="{ink}">listed: already listed by this repository, so the form is not the route</text>
<text x="8" y="232" font-size="11" fill="{warn}">refused: no body at all, because a refusal that still hands you the body is only a suggestion</text>
"""

INSPECT_REPORT = """
<rect x="8" y="46" width="150" height="46" rx="4" fill="none" stroke="{ink}" stroke-width="1.5"/>
<text x="83" y="66" text-anchor="middle" font-size="11" fill="{ink}">the plugin tree,</text>
<text x="83" y="82" text-anchor="middle" font-size="11" fill="{ink}">at its commit</text>
<line x1="158" y1="69" x2="190" y2="69" stroke="{ink}" stroke-width="1.5" marker-end="url(#ink)"/>

<text x="192" y="16" font-family="{mono}" font-size="11" fill="{accent}">read, never run</text>
<rect x="192" y="22" width="248" height="126" rx="6" fill="none" stroke="{ink}" stroke-width="1.5"/>
<text x="206" y="46" font-size="11" fill="{ink}">every Process, with its argv</text>
<text x="206" y="68" font-size="11" fill="{ink}">every host, with its timeout and cap</text>
<text x="206" y="90" font-size="11" fill="{ink}">every write, and where it lands</text>
<text x="206" y="112" font-size="11" fill="{ink}">every Timer, and its interval</text>
<text x="206" y="134" font-size="11" fill="{ink}">the baseline's own capabilities</text>

<line x1="440" y1="85" x2="472" y2="85" stroke="{ink}" stroke-width="1.5" marker-end="url(#ink)"/>
<rect x="474" y="22" width="158" height="126" rx="6" fill="none" stroke="{accent}" stroke-width="2"/>
<text x="488" y="46" font-family="{mono}" font-size="11" fill="{accent}">the report</text>
<text x="488" y="70" font-size="11" fill="{ink}">the size score</text>
<text x="488" y="90" font-size="11" fill="{ink}">what needs attention</text>
<text x="488" y="110" font-size="11" fill="{ink}">the review classes</text>
<text x="488" y="136" font-family="{mono}" font-size="11" fill="{accent}">INSPECTED</text>

<text x="8" y="184" font-size="11" fill="{muted}">it runs nothing from the tree, resolves no host, and writes nothing into it</text>
<text x="8" y="202" font-size="11" fill="{muted}">no verdict and no --fix: a class is listed where the tree shows its precondition, with its measured share</text>
<text x="8" y="220" font-size="11" fill="{muted}">and the report closes by naming what the method cannot see</text>
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
    ("how-jobs", 640, 268, JOBS,
     "The four jobs in the order they happen: build writes the blocks into the plugin, "
     "check reads the tree and produces the issue text, the person posts it, track follows "
     "it afterwards, and prove runs a suite in a disposable guest"),
    ("how-rules", 640, 238, RULES,
     "Every rule is read from a marketplace checkout pinned at an exact commit and run "
     "verbatim; only which ids are already listed comes from the marketplace's current HEAD, "
     "and this project's own checks are labelled at every line"),
    ("blocks-copy", 640, 236, BLOCKS_COPY,
     "omakit add writes the block's files into the plugin's own directory, each with a header "
     "naming the block, its version, the licence, the omakit commit and the sha256 of the body, "
     "which is what tells an unmodified copy from one the author has edited"),
    ("lab-run", 640, 266, LAB_RUN,
     "A run boots a disposable guest from a read-only base through an overlay of its own, runs "
     "the suite in a session like a person's, and returns a document naming the guest it ran on; "
     "the desktop is not touched and the overlay is removed"),
    ("submit-run", 640, 242, SUBMIT_RUN,
     "Sixteen checks, each naming whether its rule is the marketplace's own or this project's, "
     "ending in one of three outcomes: ready with the exact title and body, listed, or refused "
     "with no body at all"),
    ("inspect-report", 640, 230, INSPECT_REPORT,
     "inspect reads the plugin tree without running anything from it and reports what the text "
     "shows, closing on INSPECTED rather than on a verdict"),
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
