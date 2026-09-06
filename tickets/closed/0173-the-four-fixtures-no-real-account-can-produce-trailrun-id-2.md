---
id: 173
slug: the-four-fixtures-no-real-account-can-produce-trailrun-id-2
title: The four fixtures no real account can produce: TrailRun, id>2^53, novel sport_type, and a 429
type: chore
priority: med
status: closed
size: s
capability: 05-strava-adapter
depends_on: []
blocked_by: []
source: agent
created: 2026-09-06T02:17:34Z
closed: 2026-09-06T15:43:13Z
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

- [x] ~~Each of the four is committed with a **header comment**~~ **stating that it is
      synthetic, why no real capture is possible, and exactly what it locks down.** A reader
      must not have to guess which fixtures are captured and which are constructed.
      **AMENDED — JSON has no comments.** The rationale is a table in
      `__fixtures__/README.md`, one row per fixture with all three facts. The alternative
      was a `_comment` key inside each file, and it is worse: an archive-envelope fixture's
      one valuable property is being byte-shaped like what `sealRawEnvelope` writes, and a
      key Strava never sends costs exactly that. The `http/` fixtures DO carry `note`,
      `realism` and `locks` fields inline, because that envelope is ours rather than
      Strava's and there is nothing to stay faithful to.
- [x] Fixture **6** (`id` > 2^53) drives an end-to-end assertion: the oversized id survives
      `openRawEnvelope` → `normalizeStrava` → `computeActivityId` byte for byte, and a
      plain `JSON.parse` of the same bytes is shown to corrupt it.
      — and the id is 2^53 **+ 1**, the smallest integer a double cannot hold: `…993`
      becomes `…992`, silently. A huge round number would have passed a weaker check.
- [x] Fixture **10** (the 429) carries the real header set — `X-RateLimit-Limit`,
      `X-RateLimit-Usage`, `X-ReadRateLimit-Limit`, `X-ReadRateLimit-Usage` — and is fed
      through `afterResponse` to assert the boundary sleep, rather than sitting unused.
      — shipped as a **pair**, `429-rate-limited` and `429-daily-exhausted`, because one
      429 cannot demonstrate the thing that matters: that the sleep target is chosen from
      *which* bucket is exhausted rather than assumed.
- [x] A naming convention distinguishes captured from constructed fixtures at a glance
      (the captured ones are currently prefixed `real-`), and `__fixtures__/README.md`
      states it.
- [x] `scripts/check-fixture-geography.mjs` stays green, and every new fixture is picked up
      by the "every fixture normalizes" sweep in `normalize.test.ts` without being listed.
      — and adding the fixture **found a defect in the sweep itself**: it derived
      `externalId` with a plain `JSON.parse`, so it would have fed `normalize` a corrupted
      id, asserted `normalize` copied it faithfully, and passed. Now reads through
      `openRawEnvelope`.

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

## Resolution

**Files touched**

| File | What |
|---|---|
| `__fixtures__/oversized-activity-id.json` | **new** — `id` = 2^53 + 1, `upload_id` = int64 max |
| `__fixtures__/http/429-rate-limited.json` | **new** — 15-minute bucket at its ceiling |
| `__fixtures__/http/429-daily-exhausted.json` | **new** — daily bucket also at its ceiling |
| `synthetic-fixtures.test.ts` | **new** — 13 tests across all four fixtures |
| `normalize.test.ts` | the every-fixture sweep now reads ids through `openRawEnvelope` |
| `__fixtures__/README.md` | the naming convention, and a row per constructed fixture |

**Adding the fixture found a defect in the test that was supposed to catch it.** The
every-fixture sweep derived its `externalId` as `String(JSON.parse(...).detail.id)`. Feed it
`oversized-activity-id.json` and that rounds `9007199254740993` to `…992`, hands the
corrupted value to `normalize`, asserts `normalize` copied it faithfully — and **passes**.
Green, and proving nothing about the one fixture added to catch exactly that. It reads
through `openRawEnvelope` now. This is the shape `0038` warned about in its own note: a
suite can assert a thing twice and never touch reality.

**Criterion 1 could not be met as written and the amendment is a real choice, not a
shortcut.** JSON has no comments. A `_comment` key inside each envelope was the obvious
workaround and it is the wrong one: an archive-envelope fixture's single valuable property
is being byte-shaped like what `sealRawEnvelope` writes to S3, and a key Strava never sends
destroys that for the sake of a sentence. So the rationale is a README table — three facts
per fixture, which is what the criterion actually wanted. The `http/` fixtures do carry
`note`/`realism`/`locks` inline, because that envelope is ours and there is nothing to stay
faithful to.

**The id is 2^53 + 1 on purpose.** A gross value like `12345678901234567890` would also
corrupt, and it would let a weaker implementation pass — the boundary is where the failure
starts, so the boundary is what ships. `…993` becomes `…992`: one less, no error, no
warning. The test asserts that corruption explicitly rather than describing it, because
"JSON.parse rounds int64s" is a sentence people nod at and do not believe.

**The 429 is a pair, not a fixture.** One 429 cannot demonstrate the behaviour that matters
— that the sleep target comes from *which* bucket is exhausted rather than being assumed to
be the quarter hour. Two files differing in exactly one field can, and a test asserts they
differ in exactly one field so the pair keeps isolating its variable.

**They are constructed but not invented.** Header names and limit values are the ones
observed on live 200s from `client_id 276053` on 2026-09-06; only the usage counters moved.
They live under `http/` because they are HTTP responses rather than archive envelopes, which
also keeps the normalize sweep — which reads only the top level — away from them.

**Fixtures 2 and 9 already existed and needed no new files**, only the record of why they
are constructed and two assertions making that record load-bearing. Fixture 9's `sport_type`
is deliberately absurd (`CoastalRowingWithJetpack`): a plausible-but-unshipped value would
quietly become correct the day Strava shipped it and stop testing the unknown branch with
nobody noticing.

**What is still true and should stay uncomfortable:** four of `0038`'s ten fixtures are not
evidence of what Strava sends. They are evidence that this code handles a shape. The README
says so in as many words, and names the tests to replace with captures if the account ever
produces the real thing.

## Operator validation

**None, as this ticket predicted** — every assertion is a test over a checked-in file. No
screen, no deploy, no AWS resource. Verified by the agent:

**The corruption, shown rather than asserted:**

```
wire digits    id: 9007199254740993   upload_id: 9223372036854775807
JSON.parse     id: 9007199254740992   upload_id: 9223372036854776000   <-- CORRUPTED
```

No error, no warning — just different numbers. `openRawEnvelope` returns both as exact digit
strings, and `computeActivityId` over the exact id differs from `computeActivityId` over the
rounded one, which is the second activity and the double XP award the chain ends in.

**Suite:** `npx vitest run src/adapters/strava/synthetic-fixtures.test.ts` — **13 passed**.
Full run: **891 passed, 1 skipped, 44 files** (up from 877/43).

**Gate:** `npm run typecheck` clean · `npm run lint --max-warnings 0` clean ·
`node scripts/check-fixture-geography.mjs` — 10,611 coordinates across **21** files, all in
the box (up from 18; the three new fixtures carry no coordinates and the count is unchanged,
which is correct) · `node scripts/check-adapter-deletion.mjs` — still exactly one file ·
`node scripts/check-boundaries.mjs` clean · `build-index --check` up to date.

**The sweep picks the new envelope up without being listed**, which was criterion 5:
`normalize.test.ts` went from 75 to 76 tests on adding `oversized-activity-id.json`, with no
edit to any list.

