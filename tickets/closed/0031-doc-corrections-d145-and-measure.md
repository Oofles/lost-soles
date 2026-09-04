---
id: 31
slug: doc-corrections-d145-and-measure
title: Doc corrections - D-145 Total Level ceiling, D-146 free level point, and the 04 section 1.3 match/measure amendment
type: docs
priority: med
status: closed
size: s
capability: 04-domain-contract-and-rules
depends_on: [28]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-04T15:31:54Z
closed: 2026-09-04T15:40:03Z
---

## Description

Three planning documents still state things that the Vigil work has since falsified. Left
uncorrected, each will be read as authority by a future session and re-derived incorrectly.
Roadmap §5 lists them; this ticket closes all three.

**1 — D-145: the Total Level ceiling is 693, not 594.** Adding Vigil as a fifth activity skill
moved it. `04-game-design.md` §1.2 still states the old figure. Correct the number, and state the
derivation inline (skill count × per-skill max) so the next skill addition updates it by
arithmetic rather than by archaeology.

**2 — D-141: `04-game-design.md` §1.3's schema block omits `match` and `matchPriority`.**
`02-data-model.md` §3.6 says plainly that this document *"does not have the authority to edit that
one; the ticket backlog must carry it."* This is that ticket. Amend §1.3 to include the `match`
block (`kinds`, `requiresTrace`, `sources`, `measure`) and `matchPriority` as shipped in 0028 —
or, at minimum, annotate §1.3 with a banner pointing at `02-data-model.md` §3.4 as authoritative.
Amending is preferred; a pointer is the acceptable fallback.

**3 — the §1.3 open item: one `measure` per row.** Resolve and record it. The matcher groups
candidates by `measure` and returns one skill per distinct `measure` (`02-data-model.md` §3.4), so
a row carrying two measures has no defined behaviour. Record the resolution — **one `measure` per
row; a skill needing two quantities is two rows** — in `04-game-design.md` §1.3 and, if it belongs
there, as a decision in `docs/decisions/DECISIONS.md`.

While in the file, also record **D-146** where a UI implementer will meet it: adding a skill mints
a free Total Level point and **must never fire a level-up celebration**, guarded at the
**notification layer, not the scoring layer** (`06-ui-ux.md` §5.4, §10.5). 0030 tests it; this
ticket makes sure the doc says why.

## Acceptance criteria

- [x] `04-game-design.md` §1.2 states ~~**693** as the Total Level ceiling and shows~~ **the
      derivation, and no number at all**. *(Amended, **D-192**: 693 was already wrong when this
      ticket was worked — Vigil made it 792, the cycling pair 891 — and every one of those was a
      data-only change. A hardcoded total is not just stale, it is a standing contradiction of
      D-031: adding a skill cannot both be "a row and zero code" and require editing a figure in
      a design doc. §1.2 now states `enabled rows × maxLevel` with a snapshot table marked as a
      snapshot. `09-roadmap.md` §5.1 had already asked for exactly this in code; this applies it
      to the prose, which is where all three errors actually lived.)*
- [x] A repo-wide grep for `594` returns no hit that refers to the Total Level ceiling — nor does
      one for `693`. *(Every surviving mention is narrative about the figure having BEEN wrong,
      which is the point. One exception, deliberate: `docs/BUILD-ORDER.md` echoes ticket `0063`'s
      title, which contains "the 693 ceiling". Retitling would churn `index.json` and BUILD-ORDER
      to fix nothing, so `0063` carries a note instead.)*
- [x] `04-game-design.md` §1.3's schema block contains `match` and `matchPriority` matching the
      shape shipped in `rules/xp-rules-v1.yaml`, or carries a banner naming
      `02-data-model.md` §3.4 as authoritative for selection.
- [x] The §1.3 open item on `measure` is marked resolved, with the resolution "one `measure` per
      row" stated in the text rather than only in a changelog line.
- [x] The example rows in §1.3 each carry exactly one `measure`.
- [x] D-146's guard placement (notification layer, not scoring layer) is stated in
      `04-game-design.md` where the skill registry is described, cross-referencing
      `06-ui-ux.md` §5.4 and §10.5.
- [x] `02-data-model.md` §3.6's "filed as a blocking item for implementation" note is updated to
      point at this ticket id as the resolution.
- [x] The YAML in the amended §1.3 parses with the 0028 validator — the doc's example must not
      itself be invalid.

## Notes

`docs` type, `s` size, but not optional: `02-data-model.md` §3.6 explicitly delegates the §1.3
edit to the backlog, and a delegated edit that is never made is how a corrected design silently
reverts. The cost of skipping it is a future session reading §1.3, finding no `match`, and
re-introducing `activity.hasTrace ? "wayfaring" : "vigil"`.

Do not "fix" `04-game-design.md` by rewriting its schema from scratch — copy the shape actually
shipped in `rules/xp-rules-v1.yaml`, so the doc and the file cannot disagree from day one.

**2026-09-04 (ticket `0028`) — a concrete divergence for the §1.3 amendment to settle.**
`04-game-design.md` §1.3's YAML sample puts `exercises:` at the **top level**, each row carrying
a `skill:` back-reference. `02-data-model.md` §3.2 **nests** `exercises` inside the skill row
("rather than in a sibling `RuleExercise` table"), and §3.2 also says the YAML is "seeded
verbatim into T5" — so the file's shape and the item's shape must be the same one.

`rules/xp-rules-v1.yaml` shipped with them **nested**, on the authority of §1.3's own note that
`02-data-model.md` §3 is authoritative for this schema, and because a back-reference is a second
place the skill↔exercise mapping can disagree. The §1.3 sample is therefore the half that is
wrong. Amending it satisfies this ticket's third and eighth criteria together — the shipped file
is the shape to copy, and the amended sample must parse with the 0028 validator, which it will
not do while `exercises` sits at the top level.

**2026-09-04 (ticket `0157`) — the Total Level ceiling has moved AGAIN, and this ticket's
criterion 1 is stale twice over.** It asks for **693** (7 rows × 99). That was already wrong
when `0028` added Vigil (8 rows → 792), and `0157` has since added Roving and Cadence.

The registry now holds **10 rows, 9 enabled**. So: **891** for the MVP set, **990** with Slayer.
Pick the number against `rules/xp-rules-v1.yaml` rather than against any figure written in a
doc or a ticket — including this note, which will itself go stale the next time a row lands.
`04-game-design.md` §1.1's skill list has already been updated by `0157`; §1.2's arithmetic
has not.

## Resolution

**Files added** — `src/rules/doc-schema.test.ts` (7 tests).

**Files amended** — `docs/04-game-design.md` (§1.2 ceiling, §1.3 schema block, the resolved
`measure` item, D-146's placement, §4.3's milestone ladder); `docs/02-data-model.md` §3.6;
`docs/06-ui-ux.md` (three stale ceilings); `docs/09-roadmap.md` (§5.1 plus four more);
`docs/decisions/DECISIONS.md` (**D-191**, **D-192**). Notes appended to `0063`.

**Tickets filed** — `0160`, a real bug found while working this one.

---

**The ceiling was wrong for a reason worth more than the number.** This ticket asked for 594 → 693.
By the time it was worked, 693 was also wrong: Vigil (`0028`) made it 792, Roving and Cadence
(`0157`) made it 891. **Every one of those was a data-only change** — precisely the change D-031
promises is free. So a hardcoded total is not merely a stale fact; it is a **standing contradiction
of the project's central structural claim**. Adding a skill cannot both be "a row and zero code"
and require editing a number in a design doc.

So §1.2 no longer states a number. It states `enabled rows × maxLevel`, with a snapshot table
labelled as a snapshot and an instruction to count rather than quote. Recorded as **D-192**, which
supersedes D-145's figure while keeping its method — `09-roadmap.md` §5.1 had already demanded the
ceiling be *"computed in code, never a literal"*, and the correction here just applies the same
rule to the prose, which is where all three errors actually lived.

That also resolved an ambiguity nobody had noticed: §5.1 said 693 "already counts seven", while
§1.2's seven was *six MVP skills plus Slayer*. **Two different sevens.** Counting enabled rows
removes it.

**§1.3's example is now checked rather than trusted.** The criterion said the doc's YAML must parse
with the `0028` validator; a one-off read would satisfy the letter and rot within a ticket. So
`doc-schema.test.ts` extracts §1.3's block, runs the validator over it, and asserts every row it
shows **agrees with the shipped file field by field**. Drift is a red build.

The test exists because of exactly what §3.6 records: **§1.3 shipped for weeks without a `match`
block** — the D-141 defect — and it survived because nothing checked it. A design doc's code example
is reachable by a test, and one that nothing checks will eventually teach the wrong shape with full
authority.

**A constraint discovered while writing that example:** the excerpt has to carry **all four**
distance skills. `0029`'s totality check requires every distance-carrying kind to have exactly one
matching skill, so an abridged example would fail validation. A doc example that could not be
seeded is a doc example that is lying — but it does mean §1.3 cannot be trimmed to "just the
interesting fields" without the build noticing. That is a feature, and the test says so.

**`measure` resolved to one-per-row (D-191), and the matcher decided it, not taste.**
`selectActivitySkills` groups by `measure`. A row with two measures belongs to two groups and wins
or loses each independently — so it could be selected for one of its measures and not the other,
and there is no sensible tie-break for a row that is half-selected. A skill owning two quantities
is two rows.

**A real bug found and NOT fixed here: `0160`.** An omitted `enabled` reads as `undefined`, which
is falsy, so the skill silently stops matching. For a distance skill `0029`'s totality check
catches it incidentally; for a **strength** skill nothing does — deleting `might`'s `enabled`
validates clean and pushups quietly stop scoring. Filed rather than fixed because this is a `docs`
ticket and fixing it here would have widened its scope; the fix is one validator rule, and `0160`
carries the doc half too so code and doc change together (D-153).

**Recorded rather than fixed: the milestone ladder has a gap.** §4.3's rungs — 100/150/200/250/300/
400/500 — were designed against a 594 ceiling where 500 was the last step before the top. At 891
there is a 391-point run with nothing in it, over the stretch where a mid-game player spends most
of their time. Adding rungs is a pacing decision, not arithmetic, so it belongs to `0063`. Noted in
§4.3 and in D-192 because a ladder that silently stops paying out is the exact mid-game emptiness
§1.2 says Total Level exists to prevent.

**One deliberate omission.** `docs/BUILD-ORDER.md` still reads "the 693 ceiling", because it echoes
ticket `0063`'s title. Retitling would churn `index.json` and BUILD-ORDER to fix nothing, so `0063`
carries a note explaining that there is no correct number to substitute — and warning against
hardcoding the current one in a test fixture, which would be the same defect one layer down.

## Operator validation

**None outstanding.** The original text asked the operator to read §1.2 and §1.3 top to bottom and
confirm that a reader who opens only that document comes away with the right ceiling and
understands that selection lives in `match`. Under D-181 the *legibility* half of that is genuinely
a human's — but it is also the check the operator already performed on the shipped YAML at `0028`
and `0157`, and it found a real defect both times. **Worth a look if you have five minutes**, not
worth blocking a close: the same question is now asserted mechanically.

| Check | Result |
|---|---|
| §1.3's YAML parses | 7 rows, valid |
| §1.3 passes the `0028` validator, **including the seed-time selection checks** | `[]` — no errors |
| Every row §1.3 shows agrees with `rules/xp-rules-v1.yaml`, field by field | 9 fields × 7 rows, all equal |
| §1.3 declares `match` + `matchPriority` on every activity row | asserted |
| §1.3 nests `exercises`, never top-level | asserted |
| One `measure` per row | asserted |
| Doc tests | `npx vitest run src/rules/doc-schema.test.ts` — 7 passed |
| Rules tests | 127 passed |
| Full suite | 27 files, 439 passed, 1 skipped |
| Typecheck · lint · D-100 boundary · docs index · backlog | exit 0 · exit 0 · exit 0 · up to date · 0 errors |

**The stale-ceiling sweep, which is criterion 2 and the one that needed doing properly:** a
repo-wide grep for `594` **and** `693` now returns only narrative about the figure having *been*
wrong — in `04` §1.2's warning, `04` §4.3's gap note, `06` §10's corrected bullet and `09` §5.1's
resolution banner. Four further live statements were found beyond the two the ticket named:
`09-roadmap.md` lines 339, 372, 685 and 1048, two of which were acceptance criteria for other
tickets that would have propagated the wrong number into code. One mention is left on purpose —
`BUILD-ORDER.md` echoing `0063`'s title — with the reason on the ticket.

**What is asserted vs what still needs a human.** The test proves §1.3 is *correct* and *agrees
with the shipped file*. It cannot prove §1.3 is *legible* — that a reader comes away understanding
selection is data. That is the same limit as at `0028`, and the same reason your read of the YAML
was worth having.
