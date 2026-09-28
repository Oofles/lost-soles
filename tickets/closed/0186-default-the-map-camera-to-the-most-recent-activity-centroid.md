---
id: 186
slug: default-the-map-camera-to-the-most-recent-activity-centroid
title: Default the map camera to the most recent activity centroid
type: feature
priority: med
status: closed
size: s
capability: 08-map-and-fog-renderer
depends_on: [54]
blocked_by: []
source: agent
created: 2026-09-09T02:55:10Z
started: 2026-09-28T13:26:41Z
closed: 2026-09-28T13:30:38Z
---

## Description

`0053`'s Description specifies the default camera as **"the user's most recent activity centroid,
falling back to a configured home coordinate"**. `0053` built only the fallback, and this ticket
carries the other half.

It was split rather than dropped because there was no honest way to build it at the time. `0053`
had no client-side activity data of any kind — `0054` is the ticket that first brings the explored
set to the browser — so the centroid would have meant inventing a query path in the map shell that
`0054` then replaces. `0053`'s acceptance criterion asked only for the configured home, so the
split is visible in the criteria rather than hidden in an implementation.

**The privacy constraint from `0053` carries over intact and is the main design pressure here.**
`/` is the signed-out landing route, so anything the server renders into it is fetchable without a
session; `lib/map-home.ts` therefore reads the home coordinate behind a both-tokens session check
and returns `null` to a signed-out request. An activity centroid is *more* sensitive than the
configured home, not less — it is where the operator actually ran, most recently. It must travel
the same authenticated path, and it must never reach a prerendered payload or a `NEXT_PUBLIC_`
variable (`08-security-privacy.md` §7.2, D-199, D-123's standing revisit condition in
`05-fog-of-war.md` §9.10).

Precedence should be: **stored camera → most recent activity centroid → configured home →
extract fallback.** The stored camera stays first for the reason `0053` records — during
capability 08 the app is reloaded dozens of times a session and re-navigating each time is the
cost this exists to remove.

## Acceptance criteria

- [x] On a first-ever load with at least one activity, the map centres on the centroid of the most
      recent activity rather than on the configured home.
- [x] With no activities, behaviour is unchanged from `0053` — configured home, then the
      extract-wide fallback.
- [x] The centroid is computed and returned only for an authenticated request, through the same
      session check `lib/map-home.ts` uses. A signed-out request for `/` contains no coordinate.
- [x] A test asserts the signed-out payload carries neither the centroid nor the configured home.
- [x] A stored camera still wins over the centroid.
- [x] No new client-side query path — reuse whatever `0054` established for reaching activity data.

## Notes

Depends on `0054` for the data path, not for the blob itself: the centroid needs one activity's
summary, not the explored set. If `0054` lands a loader that makes the most recent activity
reachable cheaply, this is a small ticket; if it does not, the honest options are a server
component read or waiting for the capability that adds one, and this ticket should say which
rather than growing a query layer of its own.

## Operator validation

1. Sign in on a device that has never loaded the map (or with `localStorage` cleared). The map
   opens on your most recent run's area, not on the configured home and not on the state view.
2. Pan away, reload. The map stays where you left it — the stored camera still wins.

## Resolution

**Built client-side, on `0057`'s `useLatestRun`, not as a server read.** The Notes offered two
honest options (a loader from `0054`, or a server component read). What `0054`/`0057`/`0195` had
actually established by now is `/api/runs/latest`: session-gated, already fetched by `MapShell` on
every mount. The centroid is derived from that response in the browser, and nothing new queries
anything. The server alternative would have put a DynamoDB `Query` and an S3 `GetObject` on every
render of `/`. That cost pays for a default the stored camera overrides on every load but the first,
and the server cannot see `localStorage` to skip it. It would also have put the coordinate into the
server-rendered payload of the signed-out landing route, albeit behind the gate. Client-side, the
centroid is never in that payload at all.

**The cost of that choice, stated plainly:** on a first-ever load the map constructs at the
configured home (or the extract) and then `jumpTo`s the run when the fetch returns, so there is one
visible jump, once per device. The `moveend` it fires writes the camera to storage, so every later
load opens on the run area directly.

Files:
- `lib/map-camera.ts` has two new pure functions.
  - `runCamera(collection)` returns the centre of the run's **bounding box** at `HOME_ZOOM` (14). It
    is a box centre rather than a vertex mean because GPS is sampled by time, so a vertex mean drifts
    toward wherever the runner stood still. A test pins that. It returns `null` for no run or no
    usable position.
  - `firstLoadRunCamera(state)` holds the precedence decision. Three things veto a move: a camera was
    stored at mount, the operator has already moved the map, or the move already happened this mount.
    The last one is needed because `useLatestRun` refetches on every explored-set generation change,
    and a sync must not snap the camera back.
- `components/map/map-shell.tsx` does four things:
  - records `storedAtMount` at mount;
  - sets `userMoved` on a `movestart` carrying an `originalEvent` (the `jumpTo` itself carries none);
  - takes `useLatestRun`'s return value, which was previously discarded;
  - adds one effect that `jumpTo`s the decided camera once the map has loaded.

  The call order `useFogMask` → `useLatestRun` is unchanged.
- `lib/map-camera.test.ts` has 8 new tests. They cover the bbox centre, dwell-point resistance, the
  null cases, and each of the three vetoes plus the no-run fallthrough.
- `app/page.test.tsx` is new and covers criterion 4. It renders `Home()` signed-out with the
  configured home set and asserts:
  - `MapShell` receives exactly `{ home: null }`;
  - neither configured digit string appears anywhere in the element tree;
  - `lib/runs/server` is never imported (its mock throws if it is). That keeps the centroid off the
    server if someone later moves the read there "to avoid the jump".

  A signed-in control case proves the assertion can fail.

**Precedence as built:** stored camera → most recent run → configured home → extract fallback.
"Most recent activity" means the most recent **traced** activity within `latestRun`'s 20-row
window (`LATEST_SCAN_LIMIT`), because an untraced activity has no centroid. If none is found, the
precedence falls through to home, which is criterion 2 unchanged.

**Not exercised in a browser.** There is no browser driver in the repo. The effect's wiring
(`jumpTo` after `load`, and the `originalEvent` distinction) is covered by typecheck and by
the pure decision function, not by an executed map. That is the one desktop check listed below.

Checks: `tsc` clean, `eslint --max-warnings 0` clean, full suite 118 files / 2126 passed.
`check-fixture-geography`, `check-boundaries`, `check-design-tokens`,
`check-fog-render-boundary`, `check-private-method-update`, `check-no-deckgl` and
`check-bundle-leak` all pass. `next build` succeeds, and `/` First Load JS is **212 kB, identical to
clean `main`** (built both to compare). That matches the figure `08-map-and-fog-renderer.md` already
records and accepts, so this ticket adds no measurable weight.

No new `D-xxx`. This implements `0053`'s already-specified default and changes no architecture.

## Operator validation

**Smoke test, run by the agent against production (2026-09-28).** Ran the shipped `latestRun`
with its real deps (the `main` Activity table and bucket, `AWS_PROFILE=devault`) for the owner's
`sub`, then fed its result to the shipped `runCamera`. Result: 1 feature, the
2026-09-28T00:26Z run, 1,338 vertices. It yielded a camera at z14 inside the Florida extract's
bounds, roughly 350 km from the state-wide fallback centre. No coordinate was printed or recorded.
This proves the real data path produces a usable camera from real rows, which fixtures alone could
not.

**Desktop browser check (perceptual, after deploy):** in DevTools on `soles.devaultsecurity.com`,
run `localStorage.removeItem("lost-soles.camera.v1")` and reload. The map should open on the
latest run's neighbourhood at street zoom, not on the state view. Pan away and reload: it should
stay where you left it.
