---
id: 171
slug: the-activity-kind-is-derived-and-unchangeable-so-a-wrong-aut
title: The activity kind is derived and unchangeable, so a wrong auto-classification is permanent
type: feature
priority: med
status: closed
size: m
capability: 10-add-workout
depends_on: []
blocked_by: []
source: operator
created: 2026-09-06T00:37:31Z
started: 2026-10-07T14:55:48Z
closed: 2026-10-07T14:56:18Z
---

## Description

`Activity.kind` is derived from the source's own type string and can never be changed
afterwards. `normalize()` maps Strava's `sport_type` through a fixed table (`0036`,
`0037`), the value is written once, and nothing in the system can correct it.

**Requested directly by the operator** (2026-09-05, during `0037`):

> The activity should be manually classified, or have the ability to change after import.
> I am often taking walk breaks during a run, but I still want the whole activity to count
> as a run, not a walk. You can implement auto-detection classifiers at certain speeds, but
> ultimately it needs to be editable by me if the auto-classification is different.

**The walk-break half of that concern is already safe** and is worth writing down so it is
not re-litigated: nothing in the pipeline classifies by pace. One Strava activity becomes one
`Activity` with one `kind`, taken from `sport_type`, and the outlier gate in `sanitize.ts`
only ever discards individual GPS fixes that are physically impossible — it never touches
`kind`, and walking makes you slower rather than faster. A run with walk breaks is a run.

**The real request is the editable half, and it has no home today.** Two ways the stored kind
can be wrong:

- The operator started the activity on their watch under the wrong sport type. Strava's own
  value is then wrong at the source, and re-syncing re-derives the same wrong answer.
- Strava adds a sport type this table has never seen. `0037` maps it to `other` and preserves
  the raw string in `sourceTypeRaw` — deliberately, so it can be re-mapped later — but
  "later" currently means editing code and re-normalizing from the archive.

**Why it matters more than a label.** `kind` is what `rules/xp-rules-v1.yaml` matches on, so
it decides which skill an activity trains and therefore how much XP it earns. A wrong kind is
wrong XP. And XP never decreases (D-135), so a correction can only ever ADD — which means the
correction path has to be designed rather than assumed.

## Acceptance criteria

- [x] The operator can change an activity's `kind` after import, from the UI.
- [x] The change is recorded as a CORRECTION, not a mutation: the derived value and who
      overrode it both survive, so a rebuild from the archive (`02-data-model.md` §8.3) does
      not silently revert it.
- [x] Re-syncing or re-ingesting that activity does NOT overwrite the override. This is the
      criterion the whole ticket turns on — a correction that a webhook undoes is worse than
      no correction, because it looks like it worked.
- [x] Changing the kind re-scores the activity, and the re-score obeys D-135: XP may only be
      added. A kind change that would lower the award writes nothing and says so.
      *Refined by D-284 (2026-10-07), before building.* A change in which no skill gains writes no XP
      and says so ("no skill would gain"). In a MIXED change, the gaining skill gains in full and
      each losing skill keeps its old sum as a `retained_floor`, so nothing goes down. The
      operator accepted the double count.
- [x] Territory already revealed stays revealed (D-020), whatever the new kind is.
- [x] The interaction with `0048`'s discovery classification is settled explicitly, in
      writing, before building.

## Notes



**Blocked 2026-10-07 on 0244:** split per D-284: UI half

**Blocked 2026-10-07 on 0243:** split per D-284: storage and scoring half

**This is not a small ticket, and `size: m` may be optimistic.** It touches the data model (a
correction needs somewhere to live), the scorer (D-135's add-only rule), the ingest path
(re-ingest must not clobber it), and the UI. Splitting it is likely — probably "store and
honour an override" first, "edit it from the UI" second.

**Auto-detection is explicitly OUT of this ticket.** The operator raised it as acceptable
(*"you can implement auto-detection classifiers at certain speeds"*), but a pace-based
classifier that can be overridden is two features, and the override is the one that was
actually asked for. A classifier without an override is strictly worse than the current fixed
table, because it is wrong in ways nobody can predict. File it separately if it is still
wanted once the override exists.

**Capability placement is a guess.** `10-add-workout` is where manual entry lives, which is
the nearest existing home for "the operator asserts something about an activity". If the
override turns out to belong with the ledger correction machinery, it should move to `09`.

**Split 2026-10-07 (D-284)** into `0243` (store and honour the override, re-score) and `0244`
(edit it from the run page). This ticket stays blocked on both and closes as the umbrella once
the operator has validated `0244`. The surface is the single-run page, not an activity list:
there is no activity list yet.

## Resolution

**Closed as the umbrella.** Split on 2026-10-07 (D-284) into `0243` (storage, ingest, scoring) and
`0244` (UI). No code lands in this commit; each criterion is met as follows:

1. **Change it from the UI.** `0244`: a "Change" control on `/run/[activityId]`, backed by the
   owner-only `setActivityKind` mutation. The operator used it on 2026-10-07.
2. **A correction, not a mutation.** `0243`: an immutable object under
   `raw/<uid>/<source>/<externalId>.kind-override/`, where the newest wins. T3 keeps
   `derivedKind` next to the effective `kind`, and `kindOverride` records who set it and when.
   The §8.3 rebuild and `replay.ts` read `raw/`, so they apply it.
3. **A re-sync does not undo it.** Ingest applies the override after `normalize()`. This was
   proven live twice by replaying the archived activity through SQS and the real worker: in
   `0243` via the tool, and in `0244` via the deployed mutation. Both times the row still read
   `kind: walk`, `derivedKind: run`.
4. **Re-score obeys D-135.** `rescoreKind` follows D-142 for one activity, as amended above.
   No-gain is live-proven (run ↔ walk under v2, ledger identical). The mixed and floor paths are
   proven by `kind-rescore.test.ts`, because the operator declined to move real XP to show them.
5. **Territory stays revealed.** Nothing in the path deletes a cell (I-7). The new role has no
   delete on T6, as the synth test in `0244` asserts. A newly ground-revealing kind adds cells with
   `firstRunAt = startedAt` (D-284 c).
6. **`0048`'s discovery classification**, settled in writing before building: D-284 (a)–(c).
   The trace uses the derived kind, cells stay, and new cells award no discovery. D-285 adds that
   the re-score rates ground as recent.

**The walk-break concern** in the description needed nothing: one Strava activity is one kind,
and nothing classifies by pace. **Auto-detection** stays out of scope, as the Notes say. No
ticket was filed, because the operator has not asked again now that the override exists.

**Capability placement** stayed `10-add-workout`. The ledger work reused `09`'s machinery
(`reconcile`, D-142) without needing to move there.

## Operator validation

**Surface: the desktop browser, on the activity list.** Take a real activity whose Strava
sport type is wrong — or change an existing activity's sport type in Strava — sync it, change the
kind in the app, and confirm three things: it displays as the corrected kind, the XP moves in
the right direction (or explicitly does not move, per D-135), and it is STILL corrected after
the next sync. That last one is the whole ticket and it cannot be checked without waiting for
a second sync to happen.

### Result: verified 2026-10-07

The planned check, with the activity list replaced by the single-run page (D-284: there is no
list yet) and the second sync replaced by an archived replay (D-229):

- **Displays as the corrected kind.** The operator changed `ab00f078…` (Strava 20076758956) from
  run to walk on the desktop browser: *"I just changed the run to walk - looks good from my end."*
  T3: `kind: walk`, `derivedKind: run`, set by `setActivityKind` at 14:54:46Z.
- **XP direction.** Under v2, run and walk both train Wayfaring at the recent-ground rate (D-285).
  So the change correctly moved nothing and said so; the ledger stayed at constitution 17,
  wayfaring 52.
- **Still corrected after the next sync.** Shown by the agent's replays in `0243` and `0244`
  (SQS → real worker → `kind` unchanged), not by waiting for a real sync.

