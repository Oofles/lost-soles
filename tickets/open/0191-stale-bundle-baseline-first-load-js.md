---
id: 191
slug: stale-bundle-baseline-first-load-js
title: The 0053 bundle baseline is stale — / First Load JS is 188 kB, the table says 121 kB
type: bug
priority: med
status: open
size: s
capability: 08-map-and-fog-renderer
depends_on: []
blocked_by: []
source: agent
created: 2026-09-10T02:11:00Z
started: 2026-09-28T13:12:48Z
---

## Description

**Noticed while closing `0118`, and it is not `0118`'s doing** — measured both with and without that
ticket's throwaway route in the tree, `/` First Load JS is **188 kB** either way.

`docs/capabilities/08-map-and-fog-renderer.md` → *Bundle size baseline (ticket `0053` criterion 8)*
records:

| | recorded at `0053` close | measured 2026-09-09 |
|---|---|---|
| `/` route size | 18.4 kB | 85.4 kB |
| **`/` First Load JS** | **121 kB** | **188 kB** |
| shared baseline | 102 kB | 102 kB |
| Middleware | 66.8 kB | 66.8 kB |

**+67 kB of First Load JS, unrecorded.** The table's own text names the number that matters and why:
*"The number worth watching is **First Load JS**, not the MapLibre chunk … A future change that hoists
the `maplibre-gl` import to module scope would move ~139 kB gzipped into First Load and this table is
how that gets noticed."* It did not get noticed. `0054` landed the explored-set client path
(`ExploredProvider`, `lib/fog/boot.ts`, `decode.ts`, `explored-cache.ts`, `transport.ts`) between the
two measurements and is the obvious suspect, but **that is a guess and this ticket is not allowed to
close on a guess.**

It is almost certainly NOT a hoisted `maplibre-gl`: the raw MapLibre chunk is ~560 kB, so 67 kB is the
wrong size, and `map-shell.tsx` still imports it inside the mount effect. That is the reassuring half.
The unreassuring half is that the guard the table describes is a human remembering to re-measure, and
this is the first change after the baseline was written — so it has a 0-for-1 record.

## Acceptance criteria

- [x] The +67 kB is **attributed**, not guessed: name the modules, from the build's own output
      (`.next/analyze`, or `next build` with the chunk listing) rather than by reasoning about which
      ticket landed when.
- [x] Confirm `maplibre-gl` is still absent from `/`'s First Load, explicitly — that is the property
      the baseline exists to protect and it must be asserted, not inferred from the total being
      "too small".
- [x] The table in `docs/capabilities/08-map-and-fog-renderer.md` is updated to the measured numbers,
      dated, with a line saying which capability's work accounts for the change.
- [x] A judgement is recorded on whether 188 kB is acceptable for this route. If it is, say so and
      why; if it is not, file the reduction as its own ticket rather than doing it here.

## Steps to reproduce

1. `npm run build`
2. Compare the `/` row against the *Bundle size baseline* table in the capability doc.

## Expected vs actual

**Expected:** the table matches the build, or a dated entry explains the difference.

**Actual:** `┌ ƒ /  85.4 kB  188 kB` against a table asserting 18.4 kB / 121 kB, with nothing in
between recording the change.

## Notes

**`med` rather than `low`**, for one reason: 188 kB of First Load on the route that IS the app is not
obviously wrong, and that is exactly why an unexplained +67 kB is worth a ticket. The cost of letting
it drift is not this 67 kB — it is that the next 67 kB arrives against a baseline nobody trusts, and
the table stops being read at all.

Consider, but do not do here: the real fix for "a human remembers to re-measure" is a check that
fails when First Load JS exceeds a committed budget, in the shape of the other `scripts/check-*.mjs`
guards. That is a separate ticket and a separate decision — `0053` chose a table deliberately and
overruling that is not this ticket's business.

Capability `08`'s drift audit (D-153) would catch this eventually. Filing it now is cheaper than
discovering it in the audit that gates `09`.

## Operator validation

None — a measurement and a doc correction. The close is a smoke test: the numbers in the table must
match a fresh `npm run build` on the commit that closes this, and the assertion about `maplibre-gl`
must come from the chunk listing.

## Resolution

**The growth is attributed from webpack's client stats, at three builds.** None of this project's
code was changed. I patched `next.config.ts` temporarily (never committed) with a `webpack` hook
that writes `stats.toJson()` for the client compilation. For each build I took `/`'s First Load
files from `.next/app-build-manifest.json` (`/page`, not `/layout`: the page files alone sum to
Next's reported figure), gzipped each chunk, and split each chunk's gzip size across its leaf
modules in proportion to source size. The historical builds ran in throwaway `git worktree`s,
with `node_modules` symlinked in:

| build | `/` First Load | reproduces the recorded number? |
|---|---|---|
| `0dbfaed`, `0053` close | 121 kB | yes, 18.4 / 121 exactly |
| `1f69513`, where `0191` was filed | 188 kB | yes, 85.4 / 188 exactly |
| `d4aef75`, now | **212 kB** | this is the new baseline |

**Attribution (criterion 1).** 121 → 188 is `0054`'s explored-set client path. `lib/fog/boot.ts`
imports `src/domain/fog.ts`, which imports `h3-js`: +61.8 kB gz, with `src/domain` +3.8 and
`lib/fog` +2.5. The ticket's suspect was right, and the chunk listing now proves it. The number
also grew **another 24 kB** after the ticket was filed, and that is also capability `08`: the
renderer tickets `0055`–`0059`, `0119`, `0194`, `0199` and `0201` took `lib/fog` +18.4 and
`components/map` +3.1. ~5.4 kB of that is `0059`'s `?fog=perf` harness, which ships to
production deliberately.

**MapLibre (criterion 2)**, asserted from module-to-chunk membership rather than inferred from
totals. `maplibre-gl.mjs` (568 kB raw) and `maplibre-gl-shared.mjs` are in chunks with
`initial: false`. The only `maplibre-gl` module in a First Load chunk is `dist/maplibre-gl.css`:
a 39-byte JS stub, with the CSS extracted to a stylesheet. The first pass of my script reported
`maplibre in first load: True` and was about to be misread. Webpack's default stats also hid
this project's own modules at first (`modulesSpace` limits, then "dependent modules"), and that
pass attributed the page chunk to `npm:next`. It took two more builds with those limits removed
before the listing was complete. The scratch attribution script was not committed.

**Doc (criterion 3).** `docs/capabilities/08-map-and-fog-renderer.md` → *Bundle size baseline*
is now a three-column dated table, a per-module breakdown with the ticket each part arrived
with, and the line "every kB of growth is capability `08`'s own work". The old paragraph about
~19 kB of growth is kept, now scoped "at `0053`".

**Judgement (criterion 4): acceptable, nothing filed.** The fog can't draw without h3-js or
before MapLibre's async ~139 kB gz arrives, so moving h3-js out of First Load reorders bytes on
the path to a usable map rather than removing them. The viewing surface is a desktop browser for
one user (D-227). Two levers are written in the doc for whoever reopens this: lazy-load h3-js
with MapLibre (−62 kB), and `next/dynamic` the perf harness (~−5 kB). As the Notes asked, I did
not act on the ticket's own suggestion of a First Load budget check.

## Operator validation

None needed from the operator: a measurement and a doc correction. Verified by the agent, WSL2,
2026-09-28:

- `npm run build` at HEAD (`d4aef75`) → `┌ ƒ /  110 kB  212 kB`, shared 102 kB, Middleware
  66.8 kB: the numbers in the new table.
- The same build at `0dbfaed` and `1f69513` → 121 kB and 188 kB, matching what was recorded
  against each.
- The stats-based First Load sum is 211.5 kB at HEAD against Next's 212 kB, so the attribution
  accounts for the whole figure.
- `maplibre-gl.mjs`: `initial: false`, `static/chunks/ca4dcb09.*.js`, in no `/page` file.
- `node scripts/build-index.mjs --check` → up to date (capability docs are not indexed).
