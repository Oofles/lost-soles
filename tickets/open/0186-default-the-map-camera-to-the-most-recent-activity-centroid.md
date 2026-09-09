---
id: 186
slug: default-the-map-camera-to-the-most-recent-activity-centroid
title: Default the map camera to the most recent activity centroid
type: feature
priority: med
status: open
size: s
capability: 08-map-and-fog-renderer
depends_on: [54]
blocked_by: []
source: agent
created: 2026-09-09T02:55:10Z
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

- [ ] On a first-ever load with at least one activity, the map centres on the centroid of the most
      recent activity rather than on the configured home.
- [ ] With no activities, behaviour is unchanged from `0053` — configured home, then the
      extract-wide fallback.
- [ ] The centroid is computed and returned only for an authenticated request, through the same
      session check `lib/map-home.ts` uses. A signed-out request for `/` contains no coordinate.
- [ ] A test asserts the signed-out payload carries neither the centroid nor the configured home.
- [ ] A stored camera still wins over the centroid.
- [ ] No new client-side query path — reuse whatever `0054` established for reaching activity data.

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
