---
id: 171
slug: the-activity-kind-is-derived-and-unchangeable-so-a-wrong-aut
title: The activity kind is derived and unchangeable, so a wrong auto-classification is permanent
type: feature
priority: med
status: open
size: m
capability: 10-add-workout
depends_on: []
blocked_by: []
source: operator
created: 2026-09-06T00:37:31Z
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

- [ ] The operator can change an activity's `kind` after import, from the UI.
- [ ] The change is recorded as a CORRECTION, not a mutation: the derived value and who
      overrode it both survive, so a rebuild from the archive (`02-data-model.md` §8.3) does
      not silently revert it.
- [ ] Re-syncing or re-ingesting that activity does NOT overwrite the override. This is the
      criterion the whole ticket turns on — a correction that a webhook undoes is worse than
      no correction, because it looks like it worked.
- [ ] Changing the kind re-scores the activity, and the re-score obeys D-135: XP may only be
      added. A kind change that would lower the award writes nothing and says so.
- [ ] Territory already revealed stays revealed (D-020), whatever the new kind is.
- [ ] The interaction with `0048`'s discovery classification is settled explicitly, in
      writing, before building.

## Notes

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

## Operator validation

**Device: the operator's phone, on the activity list.** Take a real activity whose Strava
sport type is wrong — or deliberately record one under the wrong type — sync it, change the
kind in the app, and confirm three things: it displays as the corrected kind, the XP moves in
the right direction (or explicitly does not move, per D-135), and it is STILL corrected after
the next sync. That last one is the whole ticket and it cannot be checked without waiting for
a second sync to happen.
