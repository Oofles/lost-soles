---
id: 169
slug: dedupekey-buckets-straddle-boundaries-so-one-run-can-survive
title: dedupeKey buckets straddle boundaries, so one run can survive as two activities
type: bug
priority: med
status: open
size: s
capability: 06-ingest-pipeline
depends_on: []
blocked_by: []
source: agent
created: 2026-09-05T23:09:17Z
---

## Description

`03-integrations.md` §2.7's cross-source natural key rounds each component into a bucket:

```
dedupeKey = sha256([userId, floor(start/60), round(distanceM/50), round(elapsedS/30)].join('|'))
```

**These are buckets, not tolerances, and the difference is the bug.** Two recordings of the
same run collide only when every component happens to land in the same bucket. Two that
straddle a boundary do not collide *however close they are*: 3310 m and 3330 m are 20 m apart
and round to 66 and 67. A run starting at 09:00:59 and the same run starting at 09:01:01 are
two seconds apart and land in different minutes.

The worst case is the start time, because `floor` has no centring at all: a two-second
disagreement between a phone and a watch is a guaranteed miss one time in thirty.

**Why this is not urgent.** Strava is the only adapter today, and intra-source duplication is
already handled upstream by `activityId` being `sha256(userId:source:externalId)` — a webhook
replayed three times recomputes one id. `dedupeKey` only earns its keep once a §4 adapter
lands (D-112 GPSLogger, D-113 Health Connect), which is the first moment one run genuinely
arrives twice with different `externalId`s.

**Why it is worth a ticket now.** I-22 states *"At most one `ACTIVE` `Activity` per
`(userId, dedupeKey)`, across all sources"* and `02-data-model.md` §1493 names cross-source
duplication as the failure that *"silently doubles XP and doubles cell visit counts"* — on a
map that never re-fogs. A key that misses is invisible: the second activity looks completely
normal. And §8.3 forbids changing this derivation without a full rebuild, so the cheap moment
to fix it is before there is history to rebuild.

Found while building `0036`, whose test suite asserts the boundary miss explicitly rather
than hiding it (`normalize.test.ts`, "buckets the composite coarsely enough…").

## Acceptance criteria

- [ ] The bucket-boundary miss is either fixed or **accepted in writing** with its reasoning,
      as a `D-xxx`. Silently leaving §2.7 as written is not one of the outcomes.
- [ ] If fixed: a test supplies the same run through two adapters with `externalId`s that
      differ and components that straddle every boundary — start time across a minute,
      distance across a 50 m bucket, elapsed across a 30 s bucket — and asserts **one**
      activity and **one** award. This is the CI check I-22 already claims exists.
- [ ] Whatever replaces or keeps the formula is written in exactly one place and used by
      every adapter; two implementations of a dedupe key is worse than a coarse one.
- [ ] `03-integrations.md` §2.7 and `docs/contracts/ingestion-contract.md` agree with the
      code afterwards (D-153: the code changes or the doc changes, never neither).

## Steps to reproduce

1. `sha256("u|29671373|66|46")` — a 3310 m run.
2. `sha256("u|29671373|67|46")` — the same run recorded as 3330 m by a second device.
3. The keys differ. I-22 says there should be one activity; there will be two.

## Expected vs actual

**Expected:** the same physical run, recorded by two sources within a few seconds and a few
tens of metres of each other, produces one `dedupeKey`.

**Actual:** it produces one `dedupeKey` only when both recordings fall inside the same bucket.
Near a boundary, an arbitrarily small disagreement produces two.

## Notes

Three candidate shapes for whoever picks this up:

1. **Query a neighbourhood rather than a point.** Keep the key coarse but look up the
   adjacent buckets too — GSI2 is `KEYS_ONLY` and the query is 0.5 RRU (AP-10), so probing
   a handful of neighbours is close to free. Changes no stored value, which matters given
   §8.3's rebuild rule.
2. **Drop the components that straddle worst.** Start-time-to-the-minute alone is a strong
   signal for one person's activities; distance and elapsed are what disagree between
   devices. Cheapest, weakest.
3. **Re-centre the buckets** (`round` rather than `floor` on time, larger buckets). Moves
   the boundary rather than removing it — it does not fix the class of bug and should
   probably be rejected on that basis alone.

(1) looks best: it fixes the miss without changing a derivation §8.3 protects.

## Operator validation

None — no rendered surface, and the whole failure is invisible by construction. The verification
is the CI test named in criterion 2, which is what I-22 already asserts is in place. Worth noting
that the honest end-to-end check only becomes possible once a second adapter exists, so a fix
landing before then is verified by fixture and not by a real duplicate run.
