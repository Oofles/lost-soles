---
id: 273
slug: home-holds-an-unseen-run-back-without-a-one-request-flash-wh
title: Home holds an unseen run back without a one-request flash when it lands mid-session
type: bug
priority: low
status: open
size: s
capability: 13-home-plinth-and-chronicle
depends_on: []
blocked_by: []
source: agent
created: 2026-10-15T18:54:00Z
---

## Description

Home holds an unseen run's new cells off the map until its sequence plays (D-319). The hold reads
`newCells` from `/api/runs/latest`, but the explored-set delta for a newly landed run arrives one
request earlier than the latest-run refetch. For that one request the new ground is drawn on `/`
before the hold applies, which spoils the reveal the post-run moment owns. The same happens on a
first visit with no cached latest run (D-317's cache is empty). Found by the `0087` agent.

## Acceptance criteria

- [ ] When a new run lands mid-session, no frame on `/` draws its new cells before the hold applies,
      asserted by a test that delivers the explored delta before the latest-run refetch.
- [ ] On a first visit with an empty latest-run cache, an unseen run's new cells are not drawn
      before `/api/runs/latest` answers.
- [ ] The fix adds no second activity query on `/` (D-316).

## Steps to reproduce

1. Have `/` open with territory loaded.
2. Let a new traced run be processed, then trigger focus revalidation.
3. Watch the map between the explored-set refresh and the latest-run refetch.

## Expected vs actual

**Expected:** the new run's cells stay fogged until its sequence is opened.

**Actual:** they show for one request's duration, then fog back over when the hold applies.

## Notes

From `0087`'s report, wave 1 of `13`. `held` in `components/map/map-shell.tsx`,
`lib/fog/home-territory.ts`, `components/map/use-latest-run.ts`. One option: withhold the
explored delta from the fog until the latest-run response for the same generation has arrived.

## Operator validation

None expected: the flash is provable with a test that orders the two responses.
