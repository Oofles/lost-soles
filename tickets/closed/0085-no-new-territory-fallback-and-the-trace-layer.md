---
id: 85
slug: no-new-territory-fallback-and-the-trace-layer
title: The no-new-territory fallback — the permanent trace layer and a run that still counts
type: feature
priority: high
status: closed
size: m
capability: 12-post-run-moment
depends_on: [80, 81, 83]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-14T04:30:50Z
closed: 2026-10-14T05:05:12Z
---

## Description

`06-ui-ux.md` §3.5 opens with the sentence that justifies this ticket's priority: **"This is the case
that decides whether the app survives month four."** Local ground fills in; S2 predicts discovery
decay by month 4–6. On a Tuesday loop round the block, `newCells = 0`, and that will become the
*common* case, not the exception.

**The failure to avoid is precise.** A ledger reading `Cartography +0` over a map where nothing
visibly happened reads as *"that run did not count"* — which is the INTVL wound (I1) reopened by the
reward screen instead of by the scoring engine. **The scoring is already correct**: D-021 gives a
repeat loop half XP to the activity skill, still XP, never zero. It is the *presentation* that can
turn a correct number into a discouragement.

Rules 1 and 3 (never render a zero; sort rows by XP descending) ship in 0081. Rule 4 (the warm
no-new-ground chronicle lines) ships in 0083. **This ticket owns rule 2 and the end-to-end result.**

**Rule 2 — beat 1 changes subject and keeps its 2.9 seconds.** It is never shortened and never
skipped. Instead of fog burning back, the lantern traverses the route over already-clear ground and
the route **inks into the permanent trace layer**: every route you have ever run, drawn faintly in
sepia (`--ink-300` at 0.28), accumulating into a visible web of worn paths across your territory. On
a no-new-ground run, the beat is *this line joining the web*, and **the segments you have run most
darken perceptibly**. The subject shifts from *territory* to *the record of your passage* — still
cumulative, still permanent, still yours.

The trace layer is worth building for its own sake: it is the **second permanent artifact in the
app**, it costs one GeoJSON source, and it makes ordinary runs visible. It is **not** a repetition
reward (P6) — nothing is scored off it, there is no "10th time" badge (N4). It is just the honest
shape of where you actually go.

**And there is always something.** `04-game-design.md` §4.1's guarantee holds by construction: cells
revealed and Total XP are the two numbers that can never be zero for a real activity, and Total XP is
always on screen. Even if every skill row were somehow empty, the ledger still shows the Total XP
transition and the chronicle line — *"a small honest number that went up beats a large fake one."*

The tally on such a run reads, in full:

```
  RETURN FROM THE FOG          Tue 2 Sep · 5.1 km
  Wayfaring     +255   ▓▓▓▓▓▓▓▓░░  L47  7,748 →48
  Constitution   +85   ▓▓░░░░░░░░  L41  6,560 →42
  ──────────────────────────────────────────────
  5.1 km added to the record
  Total XP  1,885,263 → 1,885,603   (+340)

  "Old roads, run well. The map holds them still."

  ◇  Unclaimed ground 1.2 km north — Millbrook
```

Note `+255`, not `+510`. The app does not hide the discount and it never labels it as a penalty.

## Acceptance criteria

- [x] A permanent trace layer renders every past route as ~~sepia~~ `--ink-300` at 0.28 *(amended: `--ink-300` is the blue-shifted ink ramp, not a sepia; the token wins — D-299)*, from one
      GeoJSON source, beneath the run polyline and above the basemap.
- [x] Segments covered by multiple runs render perceptibly darker than single-run segments, and the
      darkening is bounded so a daily commute route does not saturate to black.
- [x] Nothing reads the trace layer for scoring: a grep proves no scoring module imports it, and no
      count, badge or "nth time" string exists anywhere in its code path.
- [x] On a run with `newCells = 0`, beat 1 still lasts 2.9 s ± 0.1 s — not shortened, not skipped.
- [x] On such a run the new route visibly inks into the trace layer during beat 1, and the layer
      still contains it after a reload.
- [x] The tally on such a run shows no Cartography row (0081's rule 1) and leads with Wayfaring
      (0081's rule 3).
- [x] The summary line reads `"5.1 km added to the record"` *(amended: `"5.10 km added to the record"` — the screen's existing two-decimal distance, matching the header; D-299)* — distance framing, not a cell count and
      not a zero.
- [x] The Total XP `old → new (+delta)` line is present and non-zero.
- [x] The chronicle line comes from the no-new-ground set (0083).
- [x] An end-to-end test replays the same route twice and asserts the second play produces: half
      Wayfaring XP, zero Cartography rows, a 2.9 s beat 1, a trace-layer write, and no string
      anywhere on screen matching `0 cells`, `No new`, or `(halved)`.

## Notes

Depends on 0080 (beat 1, whose subject this changes), 0081 (the tally rules) and 0083 (the chronicle
lines).

This is the ticket most likely to be judged "done" prematurely, because it passes its tests long
before it feels right. The tests here can only prove the absences — no zero, no penalty label, no
shortened beat. Whether the run *feels* like it counted is the operator's call and nobody else's.

The trace layer is deliberately built in `12` rather than deferred to `15`, because a no-new-ground
run with nothing to look at is the exact failure this ticket exists to prevent, and by the time `15`
ships the operator will already have had a dozen of them.

## Operator validation

**This one needs two activities on the same route** — the next ordinary runs of your usual loop, or
an imported/replayed or synthetic activity (manual adapter or through the queue, D-229). Never run for this.

Take your usual loop — the one round the block you have already covered — and import it. In the
desktop browser, watch the whole sequence without skipping. The honest question, asked immediately
afterwards and not rationalised: **did that feel like "you did the work", or did it feel like
"nothing happened"?** If it is the second, the ticket is not done, regardless of the test suite.

Look specifically at: (a) the map during beat 1 — is there something to watch, or is the lantern
sliding over dead ground; (b) whether your eye goes looking for a missing Cartography row; (c)
whether the trace layer is visible enough to notice and faint enough not to compete with the fog
edge.

Then open the map at home zoom and look at the accumulated web of your routes. After a month of
ordinary running that picture should be worth opening the app for on its own. If it is not, say so
in a new ticket rather than extending this one.

## Resolution

**Built, on the two operator choices made at the start of the session (1a, 2a), recorded as D-299.**

**Storage — one derived object.** `src/pipeline/trace-web-store.ts` keeps
`users/<uid>/traces/web.json.gz`: every traced run's `traceToSegments` geometry, Douglas-Peucker
simplified at 2 m (`src/domain/simplify-line.ts`), rounded to 5 dp, keyed by activity id with its
`startedAt`. The ingest worker upserts it in the `traces` phase, above the transaction, right after
the per-run S-7 object; `IfMatch`/`IfNoneMatch` serialise the five concurrent workers like the
explored manifest. `GET /api/runs/web` serves it (session uid, `no-store, private`, GET only).
`tools/trace-web/rebuild-trace-web.ts` rebuilds it from the per-run objects + T3 — **run with
`--confirm` on the operator's account**: 19 traced runs, 2,258 vertices, 0 missing.

**The drawn web — `lib/trace-web/web.ts`.** Not 19 overlapping lines: MapLibre alpha-blends
overlapping features in one layer, so N runs of a street at 0.28 compound towards black. Runs are
walked oldest first on a 10 m metric grid with neighbours; ground already drawn is not drawn again,
it is drawn darker. `wear` = 0.28/0.36/0.44/0.52/0.60 for 1/2/3–4/5–8/9+ runs. A run does not block
itself until 40 m past a cell, so an out-and-back draws once. Features carry `wear` only — no count.

**On the map — `lib/trace-web/layer.ts`, `components/map/use-trace-web.ts`.** One GeoJSON source,
`--trace-line` (new semantic token → `--ink-300`), 2 px, inserted before the first symbol layer:
above roads, below labels, so below the fog and the route. Refetched per explored generation through
a shared cache (`lib/trace-web/runs.ts`) that beat 1 reads too.

**Beat 1 — `run-sequence.tsx`, `ink.ts`, `beat1.ts`.** The clock is untouched (2.9 s). On a run with
no new and no re-armed cells, `installTraceInk` replaces the amber ink: the route draws behind the
lantern in `--trace-line` at 0.60, amber held hidden until the sequence ends. On every traced run,
`installWebBeat` shows the web *without* this run until the lantern lands, then `Beat1Frame.web`
cross-fades it to the web *with* it over the 300 ms settle (400 ms fade under reduced motion), while
the ink fades out. Beat 1 now also waits for the web fetch before t0 (inside the existing 8 s give-up).

**Tally — `run-ledger.tsx`.** A `record` footer, `"<distance> added to the record"`, stands where
the cells line would when there were no new or re-armed cells; absent without a distance.

**Tests.** `lib/trace-web/web.test.ts` (11: draw-once, bounded darkening over 365 commutes, parallel
street kept, out-and-back, order-independence, `exclude`, no count in properties, no chord across a
gap); `layer.test.ts` (stack position against the real Protomaps layer list, cross-fade, trace ink);
`trace-web-store.test.ts` (create/replace/race under ETags, and criterion 3's greps: no scoring/rules
module imports any trace-web module; no count/badge/nth-time string literal on its code path);
`tally.test.tsx` (+3); **`app/run/[activityId]/no-new-ground.test.tsx` — criterion 10**: the same
route through the real `processActivity` twice with the web carried between plays: Wayfaring halves,
no Cartography rows, a web write before persist, 2.9 s beat 1, the second play's screen leads with
Wayfaring, says `5.10 km added to the record`, has a non-zero Total XP line, a no-new-ground chronicle
line, and matches none of `0 cells|No new|(halved)`. Suite: 3,287 passed; the one failure is
`strava/adapter.test.ts` tripping on gitignored `tmp/0080`/`tmp/0084` seed files — it passes on a
clean copy (47/47).

**What went wrong.**
- Amplify job 368 **failed**: `layer.test.ts` used `#a9b3c2` literally and `check-design-tokens`
  refuses raw hex. My clean-copy guard run had happened before that file existed. Fixed in `98378f6`
  (the test reads `--ink-300` from `tokens.css`); job 369 succeeded. Every `amplify.yml` guard was
  then run on a clean copy before pushing.
- `/tmp` (tmpfs) was full of 424 stale `cdk.out*` directories from earlier test runs, which failed
  every `amplify/*.test.ts` with ENOSPC. Deleted; not a code problem.
- The first `web.test.ts` "branch" fixture was 11 m from the base route — the same street by the
  grid's definition. The test was wrong, not the builder.

**Divergences from the design, all in D-299:** §3.5's "sepia" vs. `--ink-300` (token wins, doc
amended); "above the basemap" read as above roads/below labels (D-051); `5.10 km` not `5.1 km`;
"darken perceptibly" made bounded per-ground steps (doc amended). `02` §5.1 gains **S-8** and §8.1
a row for the web object.

**Known limit, filed:** the client builds the web on the main thread. Real data: 17 ms. Synthetic
five years (1,000 × 8 km): ~1.7 s and ~15 MB of input. → **`0259`** (capability 18, low).

## Operator validation

**Agent smoke, deployed site (Amplify job 369, `98378f6`), 2026-10-14** (`tmp/0085/{seed.ts,
web-check.ts,drive.mjs,cleanup.ts}`). **12/12 passed.**

- **Setup.** Throwaway Cognito user; three synthetic Point Nemo runs through the production
  `processActivity` **with `traceWeb` wired** — A (09-20, km 0–3, 175 new cells), C (10-05, km 1–2,
  0 new), B (10-10, km 0–3, **0 new, 0 re-armed**).
- **Real S3 path:** the web object held all three runs (one `IfNoneMatch` create, two `IfMatch`
  updates). B's ledger: `wayfaring/recent_ground=150` (A's `new_ground` was 300 — exactly half),
  `constitution_share=50`, **no Cartography row**. Built web: without B `{0.28:2, 0.36:1}` pieces,
  with B `{0.36:2, 0.44:1}` — every stretch stepped one level darker, km 1–2 darkest.
- **Browser** (headless Chromium, 1280×900, `/run/B?play=1&fog=perf`): `/api/runs/web` 200,
  `no-store, private`, 3 runs. **Beat 1 measured 2,933 ms** wall clock (`__beat1`), beat 2 handed
  off at t0+2,900. Lantern lit 109 frames. Tally: Wayfaring +150 then Constitution +50, no
  Cartography, `3.00 km added to the record`, `Total XP 843 → 1,043 (+200)`; chronicle line
  *"These roads know your weight by now, and they were glad of it."*; no `0 cells|No new|(halved)`
  anywhere in `document.body`. After a reload, `/api/runs/web` still holds B. No console exceptions.
- **Screenshots** (`tmp/0085/shots/`): `B-0300ms … B-3300ms`. A zoomed strip of the route shows the
  faint web at 0.3 s, the ink darker behind the lantern than ahead of it at 1.7 s, and the whole line
  inked by 2.4 s. **It is visible but subtle** — `--ink-300` on the pale revealed ground is low
  contrast. That is the perception question below, not something a test can settle.
- **Cleanup:** 1 profile, 3 skill-state, 7 ledger, 3 activity, 3 receipt, 185 explored-cell rows;
  33 S3 object versions; the archive bucket; the Cognito user.
- **Operator's real account:** the web was backfilled (`rebuild-trace-web.ts --confirm`: 19 runs).
  `buildWeb` over it: 187 pieces in 17 ms, spread across all five weights.

**For the operator** (perceptual, desktop browser; no run needed — ⟲ Relive one of your loops that
covered known ground, or ask for a replayed one):
1. Watch beat 1 without skipping. Did it feel like *"you did the work"* or *"nothing happened"*?
   Specifically: is there something to watch behind the lantern, or does it slide over dead ground?
2. Does your eye go looking for a missing Cartography row?
3. Is the trace web visible enough to notice and faint enough not to compete with the fog edge?
   The smoke suggests it may be **too faint**; if so, the knob is `--trace-line` / `WEAR` — say so
   and it becomes a tuning ticket.
4. Open `/` at home zoom: is the accumulated web of your 19 routes worth looking at?

**Operator, desktop browser — verified 2026-10-15 (at the `12` audit): all perceptual checks above good.**
