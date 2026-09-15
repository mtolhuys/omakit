# Recovered M6 research-note excerpt

The author's local research document is dated 2026-09-12. Its detailed
staleness table, lines 264–269, gives a sample, not 464 measured pairs:

```text
vergelijken met de HEAD uit `https://github.com/<repo>/commits.atom`:

| | steekproef | verouderde pin |
|---|---|---|
| open `needs-fixes` | 93 meetbaar van 100 | **68 (73,1%)** |
| wachtend op de onderhouder | 60 | 13 (21,7%) |
```

The queue definition in line 78 was `needs-fixes` or
`security-needs-fixes`, with 464 open submissions. Lines 604–606 proposed
measuring all 464 as a future experiment. The detailed table therefore
supports 68/93 (73.1%) readable comparisons from a 100-issue sample, not
73% observed across all 464. Seven sampled issues were not readable.

Source: the author's local `omarchy-reviewlast-onderzoek.md`, SHA-256
`1c9e989b859585f5147f9cbc07705a735ccdfdef160893fe7fc0aee823e78361`.
The original per-issue commit pairs and sample-number list were not found.
This excerpt preserves the recovered aggregate provenance; it cannot
reconstruct historical HEADs from current network reads. No historical
per-issue JSON has been fabricated. The new dated JSON records current
reads across the complete label-defined queue, with unknowns explicit.
