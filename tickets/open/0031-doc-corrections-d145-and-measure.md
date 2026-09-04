---
id: 31
slug: doc-corrections-d145-and-measure
title: Doc corrections - D-145 Total Level ceiling, D-146 free level point, and the 04 section 1.3 match/measure amendment
type: docs
priority: med
status: open
size: s
capability: 04-domain-contract-and-rules
depends_on: [28]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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

- [ ] `04-game-design.md` §1.2 states **693** as the Total Level ceiling and shows the derivation.
- [ ] A repo-wide grep for `594` returns no hit that refers to the Total Level ceiling.
- [ ] `04-game-design.md` §1.3's schema block contains `match` and `matchPriority` matching the
      shape shipped in `rules/xp-rules-v1.yaml`, or carries a banner naming
      `02-data-model.md` §3.4 as authoritative for selection.
- [ ] The §1.3 open item on `measure` is marked resolved, with the resolution "one `measure` per
      row" stated in the text rather than only in a changelog line.
- [ ] The example rows in §1.3 each carry exactly one `measure`.
- [ ] D-146's guard placement (notification layer, not scoring layer) is stated in
      `04-game-design.md` where the skill registry is described, cross-referencing
      `06-ui-ux.md` §5.4 and §10.5.
- [ ] `02-data-model.md` §3.6's "filed as a blocking item for implementation" note is updated to
      point at this ticket id as the resolution.
- [ ] The YAML in the amended §1.3 parses with the 0028 validator — the doc's example must not
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

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

**Desktop, reading `04-game-design.md` §1.2 and §1.3 top to bottom.** Confirm that a reader who
opens only this document — which is what a future session will do — comes away believing the
ceiling is 693 and that skill selection is declared in `match`. If §1.3 can still be read as
complete without `match`, the amendment has not done its job.
