---
id: 173
slug: the-four-fixtures-no-real-account-can-produce-trailrun-id-2
title: The four fixtures no real account can produce: TrailRun, id>2^53, novel sport_type, and a 429
type: chore
priority: med
status: open
size: s
capability: 05-strava-adapter
depends_on: []
blocked_by: []
source: agent
created: 2026-09-06T02:17:34Z
---

## Description

**Split out of `0038` on 2026-09-06, with the operator's decision to drop them from that
ticket's required set rather than let a wording keep four real assertions unwritten.**

`0038` required ten fixtures and said *"every one is a real captured response, not
hand-written."* Six were captured. **Four cannot be**, and the reasons are properties of
the world rather than of the ticket — established by probing the live account, not by
reading a settings page:

| `0038` fixture | Why the connected account cannot produce it |
|---|---|
| **2.** A `TrailRun`, proving the `type`/`sport_type` divergence is real | All 104 activities are `Run/Run`, `Ride/Ride`, `Walk/Walk` or `Workout/Workout`. **Zero divergence anywhere in six years.** |
| **6.** An activity `id` above 2^53 | The largest real id on the account is `20014448765` — that is 2.0 × 10¹⁰ against 2^53 ≈ 9.0 × 10¹⁵. Strava is **five orders of magnitude** away from minting one. |
| **9.** An unknown / novel `sport_type` | Nothing novel has ever been recorded. By definition the interesting value is one Strava has not shipped yet. |
| **10.** A `429` with full rate-limit headers | Forcing one means deliberately burning ~1,000 reads against a quota that is **per-application and shared across every athlete** (§2.5). A day of budget, on the only connected account, to capture a response whose headers are already documented. |

Synthetic stand-ins for 2 and 9 already exist and are exercised
(`trailrun-legacy-type-mismatch.json`, `unknown-sport-type.json`). **6 and 10 have
nothing at all**, and 6 is the one `0038` itself calls *"the cheapest insurance in the
capability"*: `upload_id` and `activity.id` are int64s that `JSON.parse` silently
corrupts, and a wrong `externalId` breaks the deterministic `activityId`, which breaks
idempotency, which **double-awards XP on replay**. `json-ids.ts` and its tests exist and
cover the parser directly; what is missing is the end-to-end fixture proving an oversized
id survives `openRawEnvelope` → `normalize` → `activityId`.

**This is not "write four synthetic fixtures".** The value is in each one being honest
about what it is and what it locks down — a hand-written fixture that nobody can tell from
a captured one is how `0165` happened, where 76 green tests proved the code matched a
document that was wrong about the live service.

## Acceptance criteria

- [ ] Each of the four is committed with a header comment stating **that it is synthetic,
      why no real capture is possible, and exactly what it locks down**. A reader must not
      have to guess which fixtures are captured and which are constructed.
- [ ] Fixture **6** (`id` > 2^53) drives an end-to-end assertion: the oversized id survives
      `openRawEnvelope` → `normalizeStrava` → `computeActivityId` byte for byte, and a
      plain `JSON.parse` of the same bytes is shown to corrupt it.
- [ ] Fixture **10** (the 429) carries the real header set — `X-RateLimit-Limit`,
      `X-RateLimit-Usage`, `X-ReadRateLimit-Limit`, `X-ReadRateLimit-Usage` — and is fed
      through `afterResponse` to assert the boundary sleep, rather than sitting unused.
- [ ] A naming convention distinguishes captured from constructed fixtures at a glance
      (the captured ones are currently prefixed `real-`), and `__fixtures__/README.md`
      states it.
- [ ] `scripts/check-fixture-geography.mjs` stays green, and every new fixture is picked up
      by the "every fixture normalizes" sweep in `normalize.test.ts` without being listed.

## Notes

Filed by the agent while closing `0038`. The probe that established the table above:

```
GET /athlete/activities?per_page=200  ->  104 activities, 2020-02-24 .. 2026-09-03
   type/sport_type pairs: Run/Run 89, Walk/Walk 12, Ride/Ride 2, Workout/Workout 1
   max id: 20014448765
```

**Do not let this become "capture them later when the data appears".** Three of the four
describe conditions that may never occur on this account, and fixture 6 describes one that
will not occur for years. Waiting is the same as not writing them.

## Operator validation

**None required, and here is why** (D-181). Every assertion in this ticket is a test over a
checked-in file: no screen, no deploy, no AWS resource, nothing a human eye can see that a
`vitest` run cannot. The close should carry a smoke test — `npm test` plus
`node scripts/check-fixture-geography.mjs` — and nothing routed to the operator.
