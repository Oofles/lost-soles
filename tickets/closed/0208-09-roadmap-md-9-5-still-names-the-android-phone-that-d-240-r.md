---
id: 208
slug: 09-roadmap-md-9-5-still-names-the-android-phone-that-d-240-r
title: 09-roadmap.md §9.5 still names the Android phone that D-240 removed
type: chore
priority: low
status: closed
size: s
capability: 08-map-and-fog-renderer
depends_on: []
blocked_by: []
source: agent
created: 2026-09-12T16:38:36Z
started: 2026-09-28T13:19:16Z
closed: 2026-09-28T13:21:10Z
---

## Description

`09-roadmap.md` §9.5 — *"the product, on the actual device"* — opens by requiring the checks be run
on **"the user's own Android phone (D-124), not a simulator"**. **D-240 removed the phone from this
project's validation surface entirely**, and D-227 had already made the desktop browser the viewing
surface before that.

So the doc now instructs something a decision forbids. `0059` ran §9.5's table on the desktop and
recorded the divergence on its own criterion rather than editing the roadmap mid-ticket, which is
the right call for a ticket that must not widen — but it leaves the contradiction sitting in the
design doc, where the next reader meets it with no context.

**This is a documentation correction, not a change of behaviour.** Nothing about how §9.5 is run
changes; what changes is that the doc says what is actually done.

Two of §9.5's six rows are also out of scope until later capabilities, and `0059` recorded that too:
the post-run sequence does not exist yet (capability `12`) and D-148's gold/chrome rules belong to
capability `13`. Whether §9.5 should mark those rows itself, or whether that stays a per-milestone
judgement, is the one open question here — the amendment should not quietly turn a six-row table
into a four-row one for every future milestone.

D-124 is *not* being superseded: it is about which device the operator actually carries, and it
remains true. What D-240 changed is which device this project *validates on*. The amendment must
keep that distinction rather than deleting the D-124 reference.

## Acceptance criteria

- [x] §9.5's preamble names the **desktop browser** as the validation surface, cites **D-240**, and
      no longer instructs the operator to use a phone.
- [x] The D-124 reference survives in a form that still says what it says — the operator's own
      Android phone is the target device — without implying validation happens there.
- [x] The two out-of-scope-until-later rows are handled explicitly, one way or the other, with the
      choice stated in the doc rather than left to the reader.
- [x] `docs/INDEX.md` is regenerated if §9.5's line numbers move.
- [x] No other section of `09-roadmap.md` is edited. If one is found to have the same phone
      assumption, it is listed in `## Notes` and left for a follow-up rather than folded in.

## Notes

Filed by the agent from `0059` on 2026-09-12, at the point the operator signed off §9.5's table on
the desktop. `0059`'s criterion 10 carries the same note and points here.

Related decisions, in the order they moved the line: **D-124** (the operator's device is an Android
phone) → **D-227** (the desktop browser is the viewing surface for validation) → **D-229** (operator
validation is perception only, and no constructed scenarios) → **D-240** (there is no phone run for
`0059`; the Pixel 10 Pro is not the mid-range Android §6.3's budget was written for).

Low priority deliberately: the contradiction misleads a reader but blocks nothing, and `09-roadmap.md`
will be opened anyway when capability `12` brings the post-run sequence into scope. Worth doing then
if not before.

### 2026-09-28 — other phone assumptions in `09-roadmap.md`, left for `0212`

Found by grepping for `phone|Android|device` (criterion 5). None of them was edited here:
- §3 capability `08` row 8, *"on a real mid-range Android phone"*, and its Done-when, *"met on the
  actual phone"*.
- §3 capability `12` Done-when, *"8.4 s ± 0.3 s on the real phone"*.
- §9.5's own fourth row, the `06` §9.6 reality check (*sunlight, one-handed reach, sweaty thumbs*).
  It is phone-premised, but changing what the row checks is a decision, not a correction, and this
  ticket's criteria cover the preamble and the two out-of-scope rows only.

Capture-side mentions (§9.4's *"a run finished on the phone"*, the quick-capture tile, GPSLogger)
are correct under D-124/D-227 and are not listed.

## Operator validation

None — a design-doc correction with no runtime behaviour. The check is that §9.5 reads correctly and
agrees with D-240, which is a review of the diff rather than something to observe on a screen.

## Resolution

**`docs/09-roadmap.md` §9.5 only** (preamble plus two row tags), plus the regenerated
`docs/INDEX.md` and one summary line in `docs/.index-summaries.json`.

- **Preamble (criteria 1–2).** It now reads: evaluated in the desktop browser, on the real deployed
  app with real data, not a simulator (D-240, following D-227). D-124 survives with its actual
  meaning: the operator's Android phone is where runs are **recorded** and stays the capture
  target, but nothing in the table runs on it. D-240's "raise it from ordinary use" is carried as
  the one sentence about phone problems.
- **Out-of-scope rows (criterion 3), as the operator chose this session.** Tag plus one rule. The
  post-run row is tagged *(from capability `12`)* and the D-148 gold/chrome row *(from capability
  `13`)*. A paragraph above the list says all six rows apply at the MVP gate, and that an earlier
  milestone marks a tagged row n/a **in its own ticket's record**, as `0059` did, never by
  editing the list. So the table stays six rows for every future reader.
- **INDEX (criterion 4).** §9.5 grew from 14 to 23 lines, so `build-index.mjs` was rerun.
  `.index-summaries.json` still held *"Evaluated on the user's own Android phone (D-124), not a
  simulator."* as §9.5's summary, preserved across regeneration by design. Left alone, the index
  would have kept advertising the very sentence this ticket removes, so that summary is rewritten.
  The ticket did not anticipate this.
- **Criterion 5.** No other section edited. Three phone assumptions elsewhere, plus §9.5's own
  `06` §9.6 row, are listed in `## Notes` and filed as **`0212`** (capability `12`, low).

No `D-xxx`: this applies D-240 to a doc and decides nothing new. The tag-and-rule convention is
written in §9.5 itself.

## Operator validation

None needed from the operator: a design-doc correction with no runtime behaviour. Verified by the
agent, 2026-09-28:

- `git diff docs/09-roadmap.md` has a single hunk, at §9.5 (`@@ -1091,15 +1091,24 @@`).
- `node scripts/build-index.mjs --check` → up to date; INDEX row: *"9.5 … `1092-1114` … Evaluated
  in the desktop browser on the real deployed app (D-240)…"*.
- `vitest run`: 117 files, 2116 passed, 1 skipped.
- `tickets.mjs validate`: 0 errors, 0 warnings, with `0212` filed.
