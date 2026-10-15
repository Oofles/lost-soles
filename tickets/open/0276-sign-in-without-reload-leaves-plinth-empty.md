---
id: 276
slug: sign-in-without-reload-leaves-plinth-empty
title: Signing in on / leaves the plinth without fog data until a reload
type: bug
priority: med
status: open
size: s
capability: 13-home-plinth-and-chronicle
depends_on: []
blocked_by: []
source: agent
created: 2026-10-15T19:20:57Z
started: 2026-10-15T20:13:38Z
---

## Description

`app/(home)/layout.tsx` resolves the signed-in `uid` on the server and hands it to
`<ExploredProvider uid>`. Signing in through the Authenticator on `/` is a client-side state change:
nothing refreshes the server layout, so `uid` stays `null` until a reload. Until then, no fog session
starts, the plinth's cells read `—` indefinitely, `sources` is undefined, and `0087`'s nothing-imported
"Connect Strava to begin" line never appears. Found by the wave 1 smoke test of capability `13`
(Amplify job 402, throwaway user). It is probably older than `0087`; `0087` and `0090` both surface it.

## Acceptance criteria

- [ ] Signing in on `/` without a reload starts the fog session: the plinth shows the lifetime cell
      count and, for a user with no source, the connect line.
- [ ] Signing out without a reload drops the session the same way (no previous user's cells linger).
- [ ] A test covers the sign-in transition (e.g. the layout or provider reacting to the auth event /
      `router.refresh()`), red before the fix.

## Steps to reproduce

1. Sign out, load `/`.
2. Sign in through the Authenticator. Do not reload.
3. Look at the plinth.

## Expected vs actual

**Expected:** cells and the right state line appear within the usual load time.

**Actual:** cells stay `—` and no state line shows until a manual reload.

## Notes

`app/(home)/layout.tsx:49` computes `uid`; line 59 passes it. The likely fix is a `router.refresh()`
on the Amplify `signedIn`/`signedOut` Hub events, so the server layout re-runs; check that this does
not re-mount the map.

## Operator validation

None expected: the deployed smoke harness (`tmp/wave13-1/harness.ts` pattern) can sign in without a
reload and read the plinth.
