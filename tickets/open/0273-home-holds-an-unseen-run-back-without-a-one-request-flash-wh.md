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
started: 2026-10-16T00:55:18Z
---

## Description

Home holds an unseen run's new cells off the map until its sequence plays (D-319). The hold reads
`newCells` from `/api/runs/latest`, but the explored-set delta for a newly landed run arrives one
request earlier than the latest-run refetch. For that one request the new ground is drawn on `/`
before the hold applies, which spoils the reveal the post-run moment owns. The same happens on a
first visit with no cached latest run (D-317's cache is empty). Found by the `0087` agent.

## Acceptance criteria

- [x] When a new run lands mid-session, no frame on `/` draws its new cells before the hold applies,
      asserted by a test that delivers the explored delta before the latest-run refetch.
- [x] On a first visit with an empty latest-run cache, an unseen run's new cells are not drawn
      before `/api/runs/latest` answers.
- [x] The fix adds no second activity query on `/` (D-316).

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

## Resolution

**The fix: the fog on `/` never runs ahead of its hold.** The hold now has a third state, *pending*,
and while it is pending home keeps drawing exactly what it last drew under a known hold. The delta
waits on screen until the latest-run answer that speaks for it (and that run's `seen` flag) has
arrived. This is the ticket's suggested option, done without a second query or a second copy of the
set: `applyDelta` swaps in a new cells array rather than writing the old one, so remembering the
array reference is the snapshot.

**When does an answer "speak for" the explored set?** (`answersFor`, `lib/plinth/states.ts`.) When
it was asked at the same explored generation. A *cached* answer counts only for a *cached* set:
both are what the last session left, so a cold start still draws fog before any request (`06`
§4.8, asserted). A set the network has moved (`delta` or `full`) needs the network's answer for that
generation. A failed request also counts as an answer, with the runs already on screen, so an
offline open never freezes waiting on a network that is not there.

**First visit, empty latest-run cache:** pending with nothing drawn yet means no fog layer, the same
state as before the explored set itself has loaded. D-319 already lists "a cleared cache before the
network answers" as a zero-cell case. The new cells are never drawn as territory. The fog arrives
when `/api/runs/latest` answers, with the run held back.

**Why no frame can slip through.** `HomeScreen` computes the hold in render from the same explored
context `useFogMask` reads, so the commit that delivers a new generation also delivers *pending*.
`MapShell` hands the runs and their answer tag up in one `onLatestRun(runs, answer)` call, so a new
run is never paired with an old answer.

**What a pending hold also covers:** the `isSeen` IndexedDB read for a newly named run. That window
used to draw the live set, because "nothing is held while `seen` is unknown". Now it waits, so the
rule no longer has to pick between a flash and a guess.

Files touched:
- `lib/fog/home-territory.ts`: `HOLD_PENDING`, `HomeHold`, and `homeTerritoryView()`, the
  per-mount view that freezes the last frame while pending (copying at most once per pending
  stretch, and only if the live set it drew has since been mutated).
- `components/map/use-fog-mask.ts`: home's `set` comes from a per-mount `homeTerritoryView`;
  `home.hold` may be `HOLD_PENDING`.
- `lib/plinth/latest-run.ts`: `emit` now passes where each answer came from (`"cache"` or
  `"network"`).
- `components/map/use-latest-run.ts`: returns `{ runs, answer }`. `LatestAnswer` holds the
  generation the answer was asked at and whether it came from the network, and a failure also
  answers. The cache is re-read on a generation change while the explored set is still the cached
  one: its generation usually lands after the first ask. The cache is written before every emit,
  so it is never behind the screen. The request count is unchanged (D-316), and the generation is
  still the only refetch trigger.
- `components/map/map-shell.tsx`: the `held` prop accepts `HOLD_PENDING`, and `onLatestRun` passes
  `(runs, answer)`. The build effect is untouched (0278 edits it).
- `components/plinth/home-screen.tsx`: keeps `answer` beside `latest`, set in one callback, and
  `held = homeHold(latest, seen, answersFor(answer, explored))`.
- `lib/plinth/states.ts`: `answersFor`, `homeHold`.
- Tests:
  - `lib/plinth/hold-ordering.test.ts` (new): delivers the in-place delta first, then holds the
    refetch open, then resolves it, then answers `seen`. It asserts that no frame drew the run's new
    cells and that nothing drawn was ever fogged back over. It also covers the empty-cache first
    visit, the cached cold start drawing before any request, the "seen run still appears" case, and
    a wiring tripwire.
  - `lib/fog/home-territory.test.ts`: covers the freeze behaviour.
  - `lib/plinth/latest-run.test.ts`: covers the emit tag.

Decision recorded as D-333: "Home's fog waits for the hold, and keeps its last
frame while it waits." In a node test environment, the React ordering is proved by construction (the
hold is computed in render from the same context) plus a source tripwire, not by mounting the tree.

Known, accepted: a camera move in the sub-millisecond gap between `applyDelta` (which invalidates
the live store's buckets in place) and React's commit could re-derive one bucket from the new cells
for one frame. This existed before. Closing it would mean making `boot.ts` aware of the hold.

## Operator validation

None needed. The ticket's own note says the flash is provable with a test that orders the two
responses, and `lib/plinth/hold-ordering.test.ts` does exactly that. Post-deploy smoke test, by the
orchestrator: `/` returns 200, and `/api/runs/latest` still answers 401 to a request with no session.
