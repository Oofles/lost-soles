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

- [x] The bucket-boundary miss is either fixed or **accepted in writing** with its reasoning,
      as a `D-xxx`. Silently leaving §2.7 as written is not one of the outcomes.
      — fixed; **D-211**.
- [x] **AMENDED — the original was unbuildable, see `## Resolution`.** If fixed: a test supplies
      the same run twice with components that straddle every old boundary — start time across a
      minute, distance across a 50 m bucket, elapsed across a 30 s bucket, *and* a 3% distance
      disagreement on a long run — and asserts the two **resolve to one activity** through the
      real `dedupeCandidateKeys` + `isSameActivity` pair.
      ~~a test supplies the same run through two adapters with `externalId`s that differ … and
      asserts one activity and one award. This is the CI check I-22 already claims exists.~~
      — the strikethrough half needs the dedupe LOOKUP, which does not exist; handed to `0179`.
- [x] Whatever replaces or keeps the formula is written in exactly one place and used by
      every adapter; two implementations of a dedupe key is worse than a coarse one.
      — `src/domain/dedupe-key.ts`; it was private to the Strava adapter and this was already
      violated.
- [x] `03-integrations.md` §2.7 and `docs/contracts/ingestion-contract.md` agree with the
      code afterwards (D-153: the code changes or the doc changes, never neither).
      — plus `02-data-model.md` T3, GSI2's projection rationale, AP-10 and I-22, which the
      ticket did not anticipate needing.

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

## Resolution

Fixed, not accepted. **D-211** rewrites the key; `src/domain/dedupe-key.ts` is the one
implementation; §2.7, the contract and three places in `02-data-model.md` were brought into
agreement with it; and §8.3's rebuild was performed.

### Two findings beyond what the ticket described

**1. The buckets were too FINE, not only misaligned — which killed the recommended fix.** The
ticket proposed probing the adjacent buckets, keeping the stored derivation and avoiding a
rebuild, and called it the best of the three candidates. It is not enough: two devices disagree
on distance *proportionally*, so 3% of a 10 km run is 300 m — six buckets of 50 m. Probing ±1
would still have split a long run. That only became visible while reasoning about the boundary
case properly, and it is why the key changed shape rather than the lookup widening.

**2. Criterion 3 was already violated, and criterion 2 was unbuildable.** `computeDedupeKey` was
a private function inside `src/adapters/strava/normalize.ts` — a second adapter could not have
reached it and would have had to reimplement it. And criterion 2 asks for a test asserting "one
activity and one award", which requires the **dedupe lookup**: `contracts/ingestion-contract.md`
§3 lists `DEDUPE` as pipeline step 3, and it does not exist. Nothing queries `byUserAndDedupe`
anywhere. **I-22 asserted it did** — its evidence column read *"GSI2 is queried at pipeline step 3
before any write. CI: a fixture supplies the same run through two adapters…"* and neither half was
true. That is a false claim in the invariant register, corrected in place rather than worked
around, and `0179` is the ticket that makes it true.

Criterion 2 was therefore amended to what is buildable today — the same straddling cases, asserted
through the real `dedupeCandidateKeys` + `isSameActivity` pair at the derivation level — with the
half that needs the lookup handed to `0179` verbatim. Amending rather than ticking-as-written is
the point: the original wording describes a check that still does not exist.

### The shape, and why

The key stops trying to be the whole answer. `sha256` destroys locality by design, so an
exact-match lookup on a hashed composite can only ever ask *"same bucket?"* and never *"close
enough?"* — no bucket size fixes that, it only moves the boundary. So `dedupeKey` becomes a coarse
30-minute start-time **anchor**, and the duplicate decision moves to `isSameActivity`, which
compares real tolerances (±5 min start, ±5 min elapsed, ±max(100 m, 3%) distance) over the 0–2
candidates the anchor returns. There is no bucket in the comparison, so there is no boundary.

The anchor is 30 minutes against a 5-minute tolerance, and the *relationship* is what matters:
keeping the tolerance well under half the bucket bounds the probe to two keys and guarantees a
duplicate is never two buckets away. A test asserts the relationship rather than the constants
separately.

### What went wrong while building it

**The sweep test caught an off-by-one in my own boundary condition.** The first version of
`dedupeCandidateKeys` used `offset > ANCHOR - TOLERANCE` for the next-bucket probe; it must be
`>=`, or a duplicate stored *exactly* the tolerance ahead is missed. A sampled test would have
passed. It was caught because the test sweeps a whole anchor window at 15-second steps rather than
checking a few hand-picked points — which is the same class of boundary off-by-one this whole
ticket exists to remove, reintroduced in the fix for it. That is why the sweep is written the way
it is and should not be reduced to samples.

Two smaller ones: the domain guard in `contract-drift.test.ts` requires siblings to be imported by
relative path rather than the `@/` alias, and two `createHash` imports were left behind unused
after the derivation moved out.

### The rebuild §8.3 demands

`02-data-model.md` §8.3 forbids changing the `dedupeKey` derivation "without a full rebuild". Ten
stored rows, all predating any real use, every one recomputed in place from `(userId, startedAt)`
— which is exactly what a replay would have produced, since the derivation is pure. Verified
idempotent on a second run (`0 to change`) and verified to produce no collisions among the ten.
This was the cheapest moment this change will ever have, which is the argument the ticket itself
made for doing it now rather than when Health Connect lands.

## Operator validation

None — the ticket said so and it is still true: no rendered surface, and the failure is invisible
by construction. What replaced it is a test suite and a live rebuild, both the agent's.

**The rebuild, against the deployed table** (`AWS_PROFILE=devault`, `Activity-nog4xy…-NONE`):
10 rows scanned, 10 recomputed and written, then re-run to confirm `10 row(s), 0 to change`. A
scan for duplicate `dedupeKey` values across the table returns none — so no two distinct
activities now share an anchor, which would have been a real regression rather than a cosmetic
one. The temporary script was deleted rather than committed; it was ten lines over a pure
function and re-derivable from `dedupe-key.ts` at any time.

**Tests.** 1108 passing, including 23 new in `src/domain/dedupe-key.test.ts`. The ones that carry
the ticket are the cases that previously FAILED: a 20 m distance disagreement across a 50 m
boundary, a two-second start disagreement across a minute boundary, a 3% disagreement on a 10 km
run, and recordings three minutes apart. Alongside them, the cases that must still separate — a
3.3 km and a 12 km run in the same window, a walk and a run over the same distance — because a key
that merges everything would pass every test above.

`tsc --noEmit`, `eslint --max-warnings 0`, `check-boundaries`, `check-adapter-deletion` and the
rest of the check scripts pass, exit codes verified.

**Not verified, and cannot be:** that this prevents a real cross-source duplicate. Nothing queries
the index (`0179`), and there is no second adapter to duplicate from. The honest end-to-end check
only becomes possible when one exists — the same limitation this ticket recorded when it was
filed.
