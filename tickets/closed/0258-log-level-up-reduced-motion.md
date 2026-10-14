---
id: 258
slug: log-level-up-reduced-motion
title: Level-up cards on /log honour prefers-reduced-motion
type: feature
priority: med
status: closed
size: s
capability: 12-post-run-moment
depends_on: [84]
blocked_by: []
source: agent
created: 2026-10-14T02:28:49Z
started: 2026-10-14T16:43:36Z
closed: 2026-10-14T16:57:33Z
---

## Description

`0084` gave `LevelUpQueue` a `reduced` prop (`cardReducedAt`: no scale, no border wipe, no rise, no
flight) and passes it from the run sequence only. `/log` plays the same queue (§6.4, D-288) and still
plays it in full motion under `prefers-reduced-motion`. `06-ui-ux.md` §3.4 states the rule for cards
("appear and hold without scaling"), and §6.4 says `/log` plays them "identically".

Left out of `0084` so as not to widen it (D-298 records the boundary).

## Acceptance criteria

- [x] `/log` passes `reduced` to `LevelUpQueue` from `REDUCED_MOTION_QUERY`, read when the queue starts.
- [x] A test asserts `/log`'s queue is given the flag; the card frames themselves are already tested
      by `lib/run-moment/reduced-motion.test.tsx`.

## Notes

One line in `app/log/log-page.tsx` plus its test. `RunMoment` reads the media query with a
`useMemo` keyed on the play; `/log` can read it the same way, when a queue is created.

## Operator validation

None needed by eye beyond `0084`'s reduced-motion check, which judges the same card. Agent: emulate
`prefers-reduced-motion` in headless Chromium, log a workout that crosses a level, and confirm the
card's transform stays `none`.

## Resolution

**Built** (`e65ccd6`):
- `app/log/log-page.tsx`: a `reduced` state, set from
  `window.matchMedia?.(REDUCED_MOTION_QUERY).matches === true` in `onLog`, immediately before
  `setCards(queue)`. It is passed to `LevelUpQueue` as `reduced`.
  - It is read **when a queue starts**, not at render. This is the same rule as `run-moment.tsx`'s
    `useMemo` keyed on `play`. The two are not identical: `/log` has no play counter, and the queue
    is created in an event handler, so a state set there is the direct equivalent.
  - The optional `?.` mirrors run-moment, so a host without `matchMedia` gets full motion rather
    than throwing.
- `app/log/log-page.test.tsx`: one test, in the existing `app/log/ source` block.
  - It asserts that the query is read on the line before `setCards(queue)`, and that
    `<LevelUpQueue … reduced={reduced} />`.
  - The criterion said "a test asserts `/log`'s queue is given the flag". This suite runs in
    `node` with no DOM and no interactive `/log` test to extend, so the assertion is on source. The
    browser smoke below is the behavioural proof. The card frames themselves are held by
    `lib/run-moment/reduced-motion.test.tsx`, as the ticket said.

**No new decision.** D-298 already drew this boundary; this ticket finishes it.

**Found on the way, filed and not fixed:** `0264`. `GET /api/runs/web` returns 500 for any user who
has no trace web yet. The compute role lacks `s3:ListBucket`, so a missing key comes back as 403,
and `isMissing` only recognises 404. This was pre-existing from `0085`, and the operator's own
trace web exists, so it does not affect real use today.

**Checks:**
- Typecheck, lint and every `node scripts/…` guard from `amplify.yml` passed on a clean copy.
- Full suite: 3359 passed. The one failure, `strava/adapter.test.ts`, is the known `tmp/`-leftover
  false positive, and it passes on the clean copy (47/47).

## Operator validation

**None needed by eye.** `0084`'s reduced-motion check already judges this same card.

**Agent smoke**, against the deployed site after Amplify job 377 (`e65ccd6`, SUCCEED). Headless
Chromium at 1280×900, with a throwaway Cognito user (`tmp/0258/seed.ts`); a fresh user's first log
crosses levels. A per-frame `requestAnimationFrame` sampler read the card's inner `transform`.
8 of the 9 checks passed:
- **Control, full motion:** the plank row played `endurance:2`, `endurance:3`, `constitution:2`.
  There were 54 distinct transforms over 253 frames (`translateY(0px) scale(0.94)`, …).
- **Reduced motion:** `Emulation.setEmulatedMedia` set `prefers-reduced-motion: reduce` with **no
  reload**, which proves the query is read as the queue starts. The sit-up row played
  `fortitude:2`–`4` and `constitution:3`. The transform was **`none` on all 336 sampled frames**.
  Every card still played and cleared.
- **The failed check:** "no console errors" failed on
  `trace web: fetch failed RunFetchError: GET /api/runs/web returned 500`. That comes from the map
  at `/` during sign-in. It is unrelated to this change and is filed as `0264`.
- **Clean-up:** the Cognito user was deleted. A scan of all 11 DynamoDB tables and the user's S3
  prefixes found nothing that mentions the uid. The logs never left the headless browser's
  IndexedDB, which is expected, since the cards play after the IndexedDB write and before any
  flush (§6.4).

