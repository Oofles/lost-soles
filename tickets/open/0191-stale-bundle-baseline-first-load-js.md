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

- [ ] The +67 kB is **attributed**, not guessed: name the modules, from the build's own output
      (`.next/analyze`, or `next build` with the chunk listing) rather than by reasoning about which
      ticket landed when.
- [ ] Confirm `maplibre-gl` is still absent from `/`'s First Load, explicitly — that is the property
      the baseline exists to protect and it must be asserted, not inferred from the total being
      "too small".
- [ ] The table in `docs/capabilities/08-map-and-fog-renderer.md` is updated to the measured numbers,
      dated, with a line saying which capability's work accounts for the change.
- [ ] A judgement is recorded on whether 188 kB is acceptable for this route. If it is, say so and
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
