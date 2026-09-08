---
id: 182
slug: wire-profile-exploredgeneration-once-t1-exists-env-var-grant
title: Wire Profile.exploredGeneration once T1 exists — env var, grant, and the mirror repair
type: feature
priority: med
status: open
size: s
capability: 09-xp-engine-and-ledger
depends_on: []
blocked_by: []
source: agent
created: 2026-09-08T14:33:29Z
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

- [ ] `PROFILE_TABLE` is set on the worker from the generated table name, never hard-coded.
- [ ] The worker's role gains `dynamodb:UpdateItem` on T1 and **no read action**; a synth test
      asserts the absence, in the shape `explored-cells-table.test.ts` already uses.
- [ ] An ingest that publishes a generation returns `mirrored: "mirrored"`, and
      `Profile.exploredGeneration` equals `manifest.generation` afterwards.
- [ ] A mirror write that fails still does not fail the publish — the existing behaviour, re-checked
      against a real table rather than a fake.
- [ ] `repairGenerationMirror` is exercised against a live row that has drifted, and the manifest
      wins.
- [ ] The `"no-table"` branch is kept, not deleted: it is still the correct answer for a sandbox or
      a partial deploy, and a mirror that throws on a missing table would fail cold starts.
- [ ] `docs/capabilities/07-fog-projection-and-cells.md`'s closing line — *"the mirror that feeds
      the subscription is built and wired to nothing"* — is updated.

## Notes

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

1. After the first real sync following this change, the map still updates on the phone. The mirror
   is not on the read path, so it should be invisible — and that is the thing worth confirming with
   a human eye: that wiring it changed nothing the user can see.
