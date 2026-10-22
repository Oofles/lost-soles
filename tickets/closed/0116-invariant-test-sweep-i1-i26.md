---
id: 116
slug: invariant-test-sweep-i1-i26
title: Invariant test sweep — 02-data-model.md §9 I-1 through I-26
type: chore
priority: high
status: closed
size: m
capability: 18-mvp-hardening
depends_on: [51, 59, 67, 103]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-22T05:00:54Z
closed: 2026-10-22T20:09:50Z
---

## Description

Walk `02-data-model.md` §9 invariants **I-1 … I-26** and give each one of exactly two things: a
test, or a written reason it cannot have one. No third option. An invariant with neither is an
invariant that is not enforced, and the §9.2 definition-of-done box requires this list to be
complete.

Alongside them, the mechanically-checked invariants §9.2 of the roadmap names explicitly, several
of which will already have tests from earlier capabilities — this sweep confirms they exist, are
in CI, and actually fail when violated:

- [x] `grep` for Strava identifiers outside `src/adapters/strava/` returns nothing, and that grep
      **fails the build** (D-100, D-121.1). This is the boundary that makes D-121 reversible;
      0105 proved the recovery, this keeps the boundary that recovery depends on.
- [x] The four boundary tests T1–T4 pass in CI.
- [x] Adding a skill to `xp-rules-v1.yaml` produces a working skill with **zero** diff outside
      `rules/` — the permanent Vigil test (D-031, D-132, D-141).
- [x] The matcher returns **exactly one** skill per `measure` across the full `ActivityKind` ×
      `hasTrace` grid; ambiguity is a **seed-time hard error** (I-26).
- [x] `displayedXp == SUM(ledger)` after a full replay (D-142).
- [x] A replay against a **lower** ruleset produces `retained_floor` rows and **no** visible
      decrease (D-135).
- [x] ~~Total Level ceiling is computed as `skillCount × 99` = **693**, never a literal (D-145).~~
      *Amended by `0116` per D-192:* the ceiling is enabled rows × `maxLevel`, never a literal, and
      no figure is asserted. 693 was falsified by data-only changes three times.
- [x] Adding a skill fires **zero** level-up cards (D-146).
- [x] Re-processing an already-ingested activity changes zero cells, zero timestamps, zero ledger
      rows (idempotency, T8).
- [x] Every explored cell carries `lastRunAt`, and **no code path writes a presence bit** (D-120).
- [x] The map has never re-fogged. Revealed ground is still revealed (D-020).

For each invariant, record: the invariant id, the test file and test name, or — where a test is
genuinely impossible — the reason, in a sentence, in
`docs/capabilities/18-mvp-hardening.md`. "Hard to test" is not a reason; "this asserts a property
of history that only the operator's own six months can establish" is.

Each test must be proven to **fail** when its invariant is violated. A test that passes whether or
not the property holds is a decoration, and a sweep of decorations is the most dangerous artifact
this ticket could produce — it would make the §9.2 checklist read green on evidence that is worth
nothing.

## Acceptance criteria

- [x] A table in `docs/capabilities/18-mvp-hardening.md` lists I-1…I-26, each with a test
      reference or a written reason; there are no blanks and no "TODO".
- [x] Every listed test is in the default CI run, not a manual or nightly suite.
- [x] Every listed test has been shown to fail under a deliberate violation — recorded as the
      mutation used, per invariant, for at least the eleven roadmap §9.2 items above.
- [x] The Strava-identifier grep is a build failure and is proven by a scratch commit that adds
      `strava` outside the adapter directory and goes red.
      *Amended by `0116`:* proven with a scratch working-tree FILE, not a commit.
      `check-boundaries.mjs` reads the tree, so a commit would prove nothing more, and the wave
      allows one commit per ticket. A `stravaId` in `lib/` gave exit 1, `s === "strava"` in
      `src/domain/` gave exit 1, and both were removed, giving exit 0. A bare `strava` in a
      COMMENT passes by design (D-167).
- [x] ~~The D-145 ceiling test asserts the value is **derived** from `skillCount`, by adding an
      eighth skill in a fixture and expecting 792 — not by asserting 693.~~
      *Amended by `0116` per D-192:* the test asserts the ARITHMETIC. The ceiling equals Σ `maxLevel`
      over enabled rows. A fixture that gains an enabled row moves it by exactly `maxLevel`, and a
      disabled one moves it by 0 (`src/scoring/levels.test.ts`, already present). No figure is asserted.
- [x] The D-146 test asserts **zero** level-up cards fire when a skill is added, including no
      queued card that fires on next open.
- [x] The idempotency test re-processes a real ingested activity and asserts zero writes across
      cells, timestamps and ledger rows — a write count of zero, not an unchanged final state.
      *Amended by `0116`:* zero holds literally inside the receipt TTL. After the TTL, or on
      `reingest`, zero ExploredCell writes APPLY, against a stateful T6. Zero ledger, SkillState
      and Profile writes are sent. Four value-idempotent writes still go out, and the test names
      each one: the aggregate `ADD 0`, the blob regeneration, the T3 re-put, and the receipt's DONE.
      See the Resolution.
- [x] The D-120 test asserts no code path writes a presence bit — by grep and by schema, so the
      absence is structural.

## Notes

I-26's seed-time hard error is worth checking behaves as *seed-time*: an ambiguity that surfaces
as a runtime error during a run is the failure this invariant exists to prevent, because the
runtime moment is the post-run moment and the user is standing outside.

Where an earlier capability already wrote the test, this sweep's job is verification, not
duplication — link to the existing test rather than writing a second one that can drift.

**2026-09-08, ticket `0161` — this ticket's remit is UNCHANGED.** `0161` fixed the *timing* of the
AUDIT.md §1 invariant row, which `0133` had armed all-or-nothing on the first citation and which
therefore went red in capability `04` and would have stayed red until this ticket ran in `18`. It
is now a ratchet: it fails on a lost citation and otherwise reports progress. **It did not do any
part of the sweep and it reduced nothing you must still deliver** — all thirty invariants still
need a test or a written reason they cannot have one.

Two things `0161` added that change *how* you finish, not *what*:

- **A citation is an `I-n` in the NAME of a `describe`/`it`/`test`** (D-224), not an `I-n` in a
  comment. Where you link to an existing test rather than writing a new one, check its name carries
  the `I-n` — several already do, some carry it only in the file's header prose and will not count.
- **Closing this ticket means setting `"complete": true` in
  `docs/capabilities/invariant-citations.json`** (D-225). That is the switch that makes the row
  all-or-nothing over the full set, and it is this ticket's to throw. Until it is thrown the audit
  cannot tell "not due yet" from "quietly never done", which is the whole reason the flag is
  explicit rather than inferred from a count.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

On the laptop, open the completed table and pick three invariants at random. For each, open the
named test, break the code it guards in a scratch branch, and watch CI go red. If any of the three
stays green, the sweep is not trustworthy and every row needs re-checking. Then in the desktop
browser, check the two invariants only the rendered app can show: open `/skills` and confirm Total Level's
ceiling reads 693 with seven skills, and open `/` and confirm territory you revealed months ago is
still revealed — the D-020 check that no test can perform for you.

**Result, 2026-10-22 (orchestrator, after Amplify job 426 deployed `88a6798`). No perceptual check (D-229):**

- `tickets.mjs audit 18-mvp-hardening` on `main`: `ok invariant-sweep — all 30 invariants cited by a test name, and the set is declared complete`.
- The full `amplify.yml` gate passed on a clean worktree of `main` (37 steps, including `drill:ci` and `npm test`) and in Amplify job 426.
- The "/skills ceiling reads 693" step is wrong under D-192 and is covered by `levels.test.ts`. "Revealed ground is still revealed" is covered by audit §4's fog-no-refog row against live data (5211 → 5211 cells).
- The two amendments the agent asked about are accepted by the orchestrator. Idempotency is value-idempotent outside the receipt TTL, and the open question is now `0310`. The Strava grep was proved with a scratch working-tree file, because the guard reads the tree.
- D-123 trigger checked? none.

## Resolution

**All thirty invariants (I-1…I-30) now have a citing test, each proven red by a mutation.** Most
were already enforced by earlier capabilities; this sweep linked to those tests rather than
duplicating them (Notes). It also wrote the five that were missing and renamed the tests whose
`I-n` sat only in prose (D-224). The table, with the mutation per invariant, is in
`docs/capabilities/18-mvp-hardening.md` § *Invariant sweep*. `"complete": true` is set in
`docs/capabilities/invariant-citations.json` (D-225). `tickets.mjs audit 18-mvp-hardening` shows
the row went from *"18/30 … ratchet only"* to *"all 30 invariants cited by a test name, and the set
is declared complete"*. The `cited` high-water list was not hand-edited; it rises at
`audit --record`.

**New tests**
- `src/rules/shipped-rulesets.test.ts` + `rules/shipped-rulesets.json` — I-6. There is no seeder
  or T5 (D-276), so a shipped `xp-rules-vN.yaml` is pinned by sha256. The pins are data under
  `rules/`, so shipping the next version stays a `rules/`-only change (D-031). Every bundled
  version except the newest must be pinned.
- `src/pipeline/no-presence-bit.test.ts` — D-120 / I-9. It works three ways: by type
  (`FoldedCell`), by running every T6 cell writer (`cellUpdate`, `firstRunBackfill`,
  `mergeFoldedCells`, `t6Items`), and by grep. The grep closes the set of modules that build a
  T6 cell key and bans a boolean "explored/visited/…" attribute or a DynamoDB `BOOL`.
- `src/pipeline/idempotency.test.ts` + `src/pipeline/__fixtures__/stateful-cell-table.ts` —
  I-21 / I-23. Within the receipt TTL, zero writes of any kind. After it, zero ExploredCell writes
  apply (counted against a T6 that evaluates the real conditions), timestamps are unchanged, and
  zero ledger, SkillState and Profile writes are sent.
- `tools/drill/ci/drill-ci.test.ts` › *I-2 — …*. `fixtureBucket` in `tools/drill/ci/drill-ci.ts`
  now records every read and **throws** `AccessDenied` (`DrillReadDenied`) for any key outside
  `raw/<uid>/`, `snapshots/skillstate/<uid>/` and the step-0 manifest. The manifest is a
  verification target, not an input. This makes §9.1's *"the drill harness denies reads outside
  that set"* true of `drill:ci`.
- `src/scoring/d146-guard.test.ts` › *no level-up card is persisted, so none can fire on a later
  open* — the criterion's "no queued card on next open". No module that builds a `LevelCard` can
  write storage, a cookie, S3, DynamoDB or an Amplify model.

**Renamed only, so the citation is in a name:** the following tests now carry their `I-n`:
- `normalize-purity.test.ts` (I-4)
- `rebuild-drill-back.test.ts` (I-1, I-2)
- `archive.test.ts` (I-3)
- `units.test.ts` (I-12)
- `registry-delta.test.ts` (I-24, I-27)
- `source-account-store.test.ts` (I-20, I-28, I-29)
- `disconnect-is-not-deletion.test.ts` (I-7, I-30)
- `deletion.test.ts` (I-30)
- `drill-ci.test.ts` (I-1)

**Rig change:** `src/pipeline/__fixtures__/process-rig.ts` has a new optional `cellsTable`. It is
inert unless passed, so every existing test is unchanged.

**Doc change:** `02-data-model.md` §9.1 I-6's "how it is checked" cell was struck and amended in
place (same line count) to name the file check. It named a seeder that D-276 had already removed.

**Findings for the orchestrator** (none changed code outside the tests and the CI-drill harness):
1. The audit's `APP_ROOTS` (`tickets.mjs`) scans only `src`, `app`, `lib` and `scripts`. The
   structural tests in `amplify/` (I-3, I-18/I-20, I-28) and `tools/` (I-1, I-2, I-30) run in
   `npm test` but are invisible to the sweep. Every invariant also has a citing test under a
   scanned root, so the row is complete today. Widening the roots is a `.claude/` edit, which
   this agent may not make.
2. Re-processing after the receipt TTL, or on `reingest`, is not literally write-free. Four
   writes still go out:
   - `writeAggregates`' unconditional `ADD exploredChildren 0` (by design: it keeps a parent
     enumerable for AP-17);
   - a full explored-blob regeneration under a new `generation` over identical cells;
   - the T3 re-put (D-254/D-260);
   - the receipt's DONE.

   None of them moves XP or the map, and the test pins the list so it cannot grow quietly.
   Whether the blob regeneration on a zero-new-cell re-process is wanted is a question, not a
   bug.
3. `rules/xp-rules-v1.yaml` was last edited by `0065` on 2026-09-28, which added `introducedIn` to
   every row. That is the same week the ledger began citing v1 (`0062`). Whether any live row
   predates the edit was not checked. Either way, v1 is now pinned and an edit cannot recur
   silently.
4. `lib/level-up/beat3.test.tsx` has a test titled *"… up to the computed ceiling (693 for seven
   skills)"*. The title is stale under D-192; the assertion is not.
