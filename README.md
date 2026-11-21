# csv-reader-fast

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/aboylabs/csv-reader-fast/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/aboylabs/csv-reader-fast/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in replacement for make.fun's csv-reader 1.0.0 reference program, written for the [csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121) competition ("Read broken CSV files faster").

`run(input)` returns the reference's answer for every input — the same `{columns, rows, errors}` for each `{text, header}` — but faster.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=artjzq1w&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>

## How it is faster

The reference reads one character at a time, building each field a character at a time. This reader reads the same way in meaning, but in bulk:

- each field's end is found with one regex scan (a C++ scan that stops at the first comma, CR or LF) and the field is cut out with one slice;
- whole clean records (no quote opens before the line break, no stray CR) are taken in a single `split(',')`;
- no character is ever appended one at a time, and no value is ever re-scanned;
- field results travel in closure slots instead of a fresh object per field.

`main.ts` is the baseline's driver, unchanged; only `solve.js` is replaced.

## Verified exact

- **6/6 practice cases** match the oracle's `expected.json` exactly (canonical JSON comparison, the scorer's method).
- **90/90 fresh cases** drawn from 15 random seeds with the kit's own generator + oracle match exactly.
- **88/88 hand-crafted edge cases** match the reference exactly (empty text, BOM-only, lone CRs, unterminated quotes, quote junk, empty lines, header/no-header, no trailing EOL, empty fields, multiline quoted fields, CRLF/LF mixes, unicode, and more).

## Benchmark (6 practice cases, full program, 5 runs each)

| | mean CPU | min CPU | mean wall |
|---|---|---|---|
| csv-reader 1.0.0 (baseline) | 2.725 s | 2.581 s | 2.237 s |
| csv-reader-fast | 1.357 s | 1.292 s | 1.161 s |

**~2.0× faster overall; the parse itself (`run()`) is ~2.4× faster.** The rest is fixed cost shared by every entry (JSON parse/stringify of the 11 MB cases + 12 MB answers, Node startup and `.ts` type-stripping).

## Files

- `solve.js` — the fast reader (ES module, `run(input)`).
- `main.ts` — the harness driver, unchanged from the baseline.
- `package.json` — unchanged from the baseline.
