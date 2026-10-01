---
id: 218
slug: soft-cap-and-min-units-for-credit-unapplied
title: softCapUnits and minUnitsForCredit are declared on every skill row and applied nowhere
type: design
priority: med
status: closed
size: s
capability: 09-xp-engine-and-ledger
depends_on: [60, 62]
blocked_by: []
source: agent
created: 2026-09-29T02:19:08Z
started: 2026-10-01T20:28:53Z
closed: 2026-10-01T20:33:07Z
---
## Description

Found while building `0062`. Every skill row in `rules/xp-rules-v1.yaml` carries `softCapUnits`
and `minUnitsForCredit`, and nothing in `src/scoring` reads either. `02` §4.1 says
`unitsEffective` is taken *"after the D-120 ground split and any `softCapUnits`"*, and `04` §3.5
gives Might a cap of 100 reps "per session". Neither document gives the **formula**. Is it a hard
clamp, diminishing returns past the cap, or something else? And does `minUnitsForCredit` drop the
row, or pay nothing below the line and full rate above it?

`0062` did not invent one. A guessed curve written into an append-only ledger could never be taken
back (D-135). This ticket makes that decision first and then applies it.

Today's cost is small. Through Strava, strength activities carry no sets, so no reps reach the
scorer. The one live effect is that a run under 0.25 km earns XP that `minUnitsForCredit` says it
should not.

## Acceptance criteria

- [x] The soft-cap formula and the `minUnitsForCredit` semantics are decided by the operator and
      recorded as a `D-xxx`, with `04` §3.5 amended to state them. — **D-269**. The operator kept
      §3.5's existing curve, per activity.
- [x] ~~Both are applied~~ **The soft cap is applied** in `src/scoring`, between `scoreUnits` and
      the ground split, read only from the skill row. No skill id and no literal cap appears in
      code (D-031). *Amended:* D-269 settles that `minUnitsForCredit` gates the **reveal**, not
      scoring. Applying it in `src/scoring` would spend cells' discovery value for nothing, so it
      moved to `0232`.
- [x] Tests cover a session at, under and over each skill's cap. ~~, and an activity just under and
      just over `minUnitsForCredit`~~ *Amended:* moved to `0232` with the gate itself.
- [x] `unitsEffective` on a ledger row reflects the cap; `units` stays the raw measurement.

## Options considered

- **Hard clamp at `softCapUnits`.** Simple, and legible (D-051): "reps past 100 earn nothing".
- **Diminishing returns past the cap**, e.g. half rate. Closer to the word "soft", but a second
  number the row does not carry.
- **`minUnitsForCredit` as a floor that zeroes the row** vs **as a threshold subtracted from the
  units.** The first is what the name suggests.

## Open questions

- Which of the above, for each field?
- Does the cap apply per activity or per game day? `04` §3.5 says "per session".

## Notes

Not implemented in `0062`, because that would have widened its scope (D-152) and the formula is
not in the plan.

## Resolution

**The premise was wrong.** The ticket says neither doc gives the formula. `04` §3.5 gives both:
the soft cap as a piecewise curve with a worked table (lines ~815–831), and `minUnitsForCredit` as
a gate on **discovery** that explicitly is *not* an XP floor (*"a 400 m shakeout run earns 40
Wayfaring XP and that is correct"*). The ticket's "one live effect" was therefore also wrong: short
runs are meant to earn XP. What is actually missing is the discovery gate. The operator confirmed
§3.5's reading on all four open questions, and **D-269** records it.

**Built:**
- `src/scoring/soft-cap.ts`, new: `softCap(units, S)`, the §3.5 formula verbatim, with `null` as
  the identity. It throws on a non-positive or non-finite `S` rather than guess.
- `src/scoring/ground.ts`: `scoreGround` applies `softCap(units, row.softCapUnits)` to each skill's
  whole activity units and passes the result to `rateGround` as a new optional `capped` argument.
  Ungrounded rows get `unitsEffective = capped`. Grounded rows scale every bucket by `capped/units`,
  so the cap is taken once per activity and then apportioned. `units` stays raw. The cap sits in
  `scoreGround` rather than in a new step in the chain because that is where each row is already
  looked up, and every caller (ingest, replay, the test helpers) goes through it, so none can skip
  it. With `paid = 1`, `bucket * 1 * m` is bit-identical to before, so no existing test moved.
- `src/scoring/index.ts` exports `softCap`. `ledger.ts`'s `unitsEffective` comment now mentions
  the cap.
- `src/scoring/soft-cap.test.ts`, 23 tests: §3.5's table reproduced exactly, the 2.5S plateau at 6S,
  monotonicity, null as the identity, and bad caps refused. Every capped v1 row is found by iterating
  the registry, not by naming it, and tested under (S/2), at (S), over (2S → 1.5S) and at a typo
  (50S → 2.5S) through `scoreUnits → scoreGround`. Also: uncapped distance paid in full at 300 km,
  the ledger row's `units`/`unitsEffective`/`xpAwarded` through `scoreActivity`, per-activity
  scope, a hand-built capped *grounded* row apportioning correctly, and a source grep showing no
  v1 cap value in `soft-cap.ts` or `ground.ts`.

**Changed from the plan agreed at session start:** I had proposed zeroing Cartography below
`minUnitsForCredit` here and filing the reveal gate separately. Reading `process-activity.ts`
showed that would be worse than doing nothing: the fog would still reveal the cells, they would
stop being `new`, and their Cartography would be gone permanently (D-020/D-135). The gate belongs
in `revealsGround()`, where ingest and replay both already ask it, and Cartography then follows
automatically. All of it is in **`0232`**.

**Docs:** `04` §3.5 now says the cap is per activity, that `units` stays raw and `unitsEffective`
carries the cap, and that the discovery gate is on the reveal and inert on non-revealing rows. In
`02` §4.1, the `unitsEffective` row now reads "after softCap and the ground split", in the order the
code applies them, and the `minUnitsForCredit` row of the J3 table now carries its meaning.
`docs/INDEX.md` was regenerated.

**Not touched:** `sanityCeilingUnits` is also declared and unread. §3.5 makes it a chronicle flag,
not a clamp, which is UI work outside this ticket.

**Lint:** `npm run lint` reports two `no-explicit-any` errors in `tmp/0198/verify.ts`, a
gitignored scratch file left by `0198`. They are not from this change. The files touched here are
clean.

## Operator validation

No screen. This is scoring arithmetic, so the tests are the evidence (`npx vitest run`: 2509
passed, 1 skipped; `tsc --noEmit` clean).

**Smoke test (agent, AWS `devault`, 2026-10-01):** scanned
`XpLedgerEntry-nog4xy2l7baqlhghpndh2565qe-NONE`. 62 rows: `wayfaring` `new_ground` 12 /
`recent_ground` 17, `cartography` `cells_new` 14, `constitution_share` 18, one `replay_run`.
There are **no `reps` or `duration` rows**, so the cap changes no live row, and a v1 → v1 replay
after this deploy will neither lower an award nor write a D-135 floor.
