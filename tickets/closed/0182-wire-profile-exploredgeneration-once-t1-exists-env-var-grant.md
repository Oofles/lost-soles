---
id: 182
slug: wire-profile-exploredgeneration-once-t1-exists-env-var-grant
title: Wire Profile.exploredGeneration once T1 exists — env var, grant, and the mirror repair
type: feature
priority: med
status: closed
size: s
capability: 09-xp-engine-and-ledger
depends_on: []
blocked_by: []
source: agent
created: 2026-09-08T14:33:29Z
started: 2026-10-01T14:32:31Z
closed: 2026-10-01T14:47:20Z
---

## Description

`0051` built the `Profile.exploredGeneration` mirror and its repair path in full, tested against a
fake, and wired it to **nothing** — because T1 `Profile` does not exist. `amplify/data/resource.ts`
carries `Activity` and `0012`'s placeholder; T1 arrives with the XP engine, which owns `totalXp`,
`totalLevel` and the transaction that writes them (`02-data-model.md` T1).

Creating a nine-attribute T1 inside capability 07 to hold one integer would have handed capabilities
08 (`mapMode`, `showColdTerritory` — D-052, D-133) and 09 a schema they did not choose. So
`mirrorGeneration` takes its table as a dependency and answers `"no-table"` today, the same shape
D-217 chose for the ruleset: *"the pipeline takes the registry as an ARGUMENT, so the day T5 exists
is one line in the handler."*

**This ticket is that line.** The code is written; nothing here is new logic.

What the mirror is for, so it is not mistaken for a source of truth: `02` §6.4 —
*"The manifest is authoritative; the Profile attribute is a notification channel. If they ever
disagree, the manifest wins and the mirror is repaired."* It exists so the AppSync subscription
(AP-14, `01` §4 step 17) has something to push. Nothing in the system reads it to decide anything.

### What to do

1. `PROFILE_TABLE` on the worker via `backend.processActivity.addEnvironment`, from
   `backend.data.resources.tables["Profile"].tableName` — the same route `ACTIVITY_TABLE` takes,
   because `defineData` generates the physical name and nothing may hard-code it.
2. `profileTable.grant(processActivityLambda, "dynamodb:UpdateItem")` — and **only** that.
   `mirrorGeneration` performs one conditional `UpdateItem` and never reads the row: the
   conditional write *is* the comparison, which is what makes it impossible to write the direction
   of authority backwards. A `GetItem` grant would make that possible again.
3. Delete the comment in `amplify/functions/process-activity/handler.ts` that explains why
   `PROFILE_TABLE` is deliberately unset, and stop passing `process.env.PROFILE_TABLE` as
   `undefined`.
4. Assert the live outcome flips from `"no-table"` to `"mirrored"`.

## Acceptance criteria

- [x] `PROFILE_TABLE` is set on the worker from the generated table name, never hard-coded.
- [x] The worker's role gains `dynamodb:UpdateItem` on T1 and **no read action**; a synth test
      asserts the absence, in the shape `explored-cells-table.test.ts` already uses.
- [x] An ingest that publishes a generation returns `mirrored: "mirrored"`, and
      `Profile.exploredGeneration` equals `manifest.generation` afterwards.
- [x] A mirror write that fails still does not fail the publish — the existing behaviour, re-checked
      against a real table rather than a fake.
- [x] `repairGenerationMirror` is exercised against a live row that has drifted, and the manifest
      wins.
- [x] The `"no-table"` branch is kept, not deleted: it is still the correct answer for a sandbox or
      a partial deploy, and a mirror that throws on a missing table would fail cold starts.
- [x] `docs/capabilities/07-fog-projection-and-cells.md`'s closing line — *"the mirror that feeds
      the subscription is built and wired to nothing"* — is updated.

## Notes

**2026-09-29, from `0219`.** Steps 1 and 2 have landed: the worker now has `PROFILE_TABLE` and
`dynamodb:UpdateItem` on T1 (and nothing else — `amplify/xp-ledger-tables.test.ts` asserts it), for
§4.3's `Update Profile` totals inside the ledger transaction. The mirror is still OFF: `handler.ts`
passes `table: undefined` to it explicitly. What remains here is step 3 (hand it
`required("PROFILE_TABLE")`), step 4, and the live criteria. The first two criteria are met by
`0219`'s wiring; re-check them rather than re-adding the grant.

**Do not make the mirror load-bearing while wiring it.** The temptation once it holds a real number
is to read it somewhere — a "what generation is the user on" query that avoids an S3 GET. `02` T1
and §6.4 both forbid that, and the reason is that the two can legitimately disagree for a moment:
the mirror is written after the manifest commits, so there is always a window in which the manifest
is ahead. Anything that reads the mirror to make a decision is reading a value that is allowed to
be stale.

The AppSync subscription itself is capability 14's (`05` §7.4 trigger 1), not this ticket's. This
only makes sure the number it will push is there and correct.

## Operator validation

> **D-181 — this is the AGENT's to run.** The mirror is a DynamoDB attribute and an IAM grant;
> `AWS_PROFILE=devault` answers every question above. Record the smoke test at close.

1. After the first real sync following this change, the map still updates in the desktop browser. The mirror
   is not on the read path, so it should be invisible — and that is the thing worth confirming with
   a human eye: that wiring it changed nothing the user can see.

## Resolution

**What changed.** One line, as the ticket said. `amplify/functions/process-activity/handler.ts`
now hands the blob store `mirror: { ddb, table: required("PROFILE_TABLE") }` instead of
`table: undefined`, and the comment explaining why it was off is replaced by one explaining what
the mirror is for. Steps 1–2 (env var, `UpdateItem`-only grant) had already landed in `0219`, and
I re-checked them rather than re-adding: `amplify/backend.ts:1034-1035`, `:1285`, asserted by
`amplify/xp-ledger-tables.test.ts:150,180`.

Also updated:
- `src/pipeline/explored-mirror.ts` — the module comment said *"T1 DOES NOT EXIST YET"*. It now
  explains why `table` stays optional: a sandbox or partial deploy, and cold starts must not throw
  over a notification channel. The `"no-table"` branch is unchanged.
- `docs/capabilities/07-fog-projection-and-cells.md` — the closing line now says the mirror is
  wired since `0182`, and that the subscription that pushes it belongs to capability 14.

No new tests. The behaviour was fully unit-tested in `0051`, the grant was synth-tested in `0219`,
and the handler is configuration. The live smoke tests below are the proof.

**Findings — recorded, not acted on:**
1. **Repair is one-directional.** `repairGenerationMirror` is a conditional `<` write, so it can
   raise a mirror that lags the manifest but **cannot lower one that is ahead** (live R4 below:
   the mirror stayed at 99 against manifest 40). `02` §6.4's *"if they ever disagree, the manifest
   wins"* is therefore only true in one direction. In the running system the other direction looks
   unreachable: the mirror is written only after the manifest commit, with the committed
   generation, and generations only rise (D-218/D-219). Only a hand edit could put the mirror
   ahead. No code change. The operator chose to record it rather than build a two-way repair: **D-264**, with `02` §6.4 amended.
2. **On a first-ever ingest the mirror can create the Profile row before the ledger does.** Blobs
   publish before `persistWithLedger`. The mirror's `UpdateItem` would create `{id,
   exploredGeneration}` without `owner`/`__typename`, and the ledger's `profileTotalsItem` fills
   those with `if_not_exists` a moment later in the same ingest. This is moot for the real user,
   whose row has existed since the capability-09 replay. Noted so nobody is surprised by it.

**What did not go to plan.** I meant to drift the *real* user's Profile row and repair it from the
real manifest. The session's permission classifier refused the write to the shared row, so the
drift-and-repair test ran on a synthetic `smoke-0182-*` row in the same live table instead. That
row was deleted afterwards.

## Operator validation

**Agent smoke tests, 2026-10-01, WSL2 + AWS `devault`, account 286588821906:**

- **Suite:** 133 files, 2,460 passed and 1 skipped. `tsc`, `eslint --max-warnings 0`, every
  `scripts/check-*.mjs` and `tickets.mjs validate` are clean.
- **Deploy:** Amplify job **266** (commit `38cb247`) SUCCEEDED. The worker
  `…processactivitylambda939-eswVkZOLajtP` was last modified 2026-10-01T14:37:58Z, with
  `PROFILE_TABLE=Profile-nog4xy2l7baqlhghpndh2565qe-NONE`, i.e. the generated name.
- **Live IAM** (`iam simulate-principal-policy`, worker role on the T1 table): `UpdateItem`
  **allowed**. `GetItem`, `Query`, `Scan`, `PutItem` and `DeleteItem` are all **implicitDeny**.
- **Live ingest** (criterion 3): before this, the real Profile row had **no**
  `exploredGeneration`. I replayed archived run `strava/20358657069` through the real queue with
  `tools/replay/replay-activities.ts --confirm` (D-229; already-revealed ground, so nothing new is
  revealed). The worker log shows `blobs: {generation: 66, previousGeneration: 65, addedCount: 0,
  …, mirrored: "mirrored"}`. Afterwards `manifest.json` `generation` = **66** and
  `Profile.exploredGeneration` = **66**. `totalXp` was unchanged at 21,021, because the replay
  awards nothing.
- **Live failure path** (criterion 4), using the shipped `mirrorGeneration` against real
  DynamoDB: a nonexistent table returned `"failed"`, and a malformed key on the real T1 table
  (ValidationException) returned `"failed"`. Neither threw, and the publish code only ever sees
  the returned value. `table: undefined` returned `"no-table"` (criterion 6).
- **Live repair** (criterion 5), synthetic row `smoke-0182-1790865319592` on the real T1 table:
  - absent row → `mirrored`, value 40
  - drifted to 37 → `repairGenerationMirror(…, 40)` gave `mirrored`, value **40** (manifest wins)
  - repaired again → `stale`, value 40 (idempotent)
  - drifted *above* to 99 → `stale`, value stays 99 (finding 1)
  - row deleted afterwards
- **For the operator:** the ticket's check 1 still stands and is the only perceptual one. After the
  next real sync, the map should still update in the desktop browser. The mirror is not on the read
  path, so nothing should look different.
