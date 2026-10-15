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

- [x] Signing in on `/` without a reload starts the fog session: the plinth shows the lifetime cell
      count and, for a user with no source, the connect line.
      *(Satisfied in code; the deployed proof is the post-deploy smoke in the Resolution, which the
      orchestrator runs — no browser harness exists in this worktree.)*
- [x] Signing out without a reload drops the session the same way (no previous user's cells linger).
- [x] A test covers the sign-in transition (e.g. the layout or provider reacting to the auth event /
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

## Resolution

**Cause.** `app/(home)/layout.tsx` reads `uid`, `home` and `sources` on the server. The Authenticator
signs in on the client, and nothing asked the server components to run again, so the page kept the
signed-out RSC payload (`uid: null`, no `sources`) until a reload.

**Fix.** `router.refresh()` on Amplify's `auth` Hub events `signedIn` and `signedOut`, wired into
`AuthGate`, with the children held back while the refresh is in flight.

- The listener sits in `AuthGate`, **outside** the `<Authenticator>`. While signed out the Authenticator
  shows its form and the children are not mounted, so a listener inside the home screen would never
  hear the sign-in.
- **Children are held until the refresh commits** (`useTransition`'s `isPending`). Without the hold
  the Authenticator would mount the home screen at once with the stale signed-out props, and the fresh
  ones would land a moment later. `MapShell`'s build effect depends on `[home, framed]`, so `home` going
  from `null` to the configured camera would tear down and rebuild MapLibre: the map built twice.
  With the hold the home screen mounts once, with the signed-in `uid`, `home` and `sources` (D-322).
  Ordering: Amplify writes the session cookies and dispatches `signedIn` *before* `signIn()`
  resolves (`signInWithSRP.mjs`: `cacheCognitoTokens` then `dispatchSignedInHubEvent` then return).
  So `isPending` is set before the Authenticator's state machine leaves the form.
- **Sign-out refreshes too** (criterion 2). The Authenticator unmounts the children on sign-out, which
  disposes the fog session (`ExploredProvider`'s effect cleanup). The refresh replaces the payload
  with the signed-out one, so a later sign-in, possibly as another account, never mounts with the
  previous `uid`. That closes a real hazard: a session started under a stale `uid` would cache the new
  account's cells under the old account's IndexedDB key. `/settings`' Sign out already does a full
  navigation; this covers the Authenticator's own sign-out paths (session expiry, any future sign-out
  that does not reload).
- `tokenRefresh` and the other auth events are ignored: they do not change who is signed in, and a
  refresh while the map is mounted would rebuild it (a new `home` object identity).
- `app/(home)/layout.tsx` is unchanged. The fix applies to every route, because `router.refresh()`
  re-runs whichever route is current. On `/chronicle` it also re-runs the shared `(home)` layout.

**Files**
- `components/auth-refresh.tsx` (new): `refreshOnAuthTransitions(refresh, listen?)`, the subscription
  as a plain function, and `useAuthRefresh()`, the hook returning `pending`.
- `components/auth-gate.tsx`: calls `useAuthRefresh()` and renders `{refreshing ? null : children}`
  inside the Authenticator.
- `components/auth-refresh.test.ts` (new): `signedIn` and `signedOut` refresh; other events do not;
  unsubscribe; the default listens on Amplify's real `auth` channel; the source of `AuthGate`
  subscribes outside the Authenticator and holds the children. It is red before the fix, because the
  module does not exist and `AuthGate` has neither the hook nor the hold. The suite has no DOM, so
  the hook's React wiring is asserted from the source, as elsewhere in this repo.
- `components/plinth/plinth.tsx` is untouched. Ticket `0270` edits it in parallel.

**Decisions.** None new; this builds on D-320 and D-322. An agent-proposed decision has been
returned to the orchestrator: an auth transition refreshes the server components and holds the
app's children until the fresh payload lands.

**Verification (worktree).** The amplify.yml build-phase guards pass. `typecheck`, `lint`
(0 warnings), `vitest run` (210 files, 3609 passed) and `build` all pass. `check-bundle-leak`
passes; `check-home-not-in-client`'s self-test passes. Its scan is a no-op here because the home
env vars are unset locally.

**Decisions recorded at merge (orchestrator):** D-331.
