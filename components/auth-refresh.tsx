"use client"

import { Hub } from "aws-amplify/utils"
import { useRouter } from "next/navigation"
import { useEffect, useTransition } from "react"

/**
 * TICKET 0276. SIGNING IN OR OUT WITHOUT A RELOAD RE-RUNS THE SERVER COMPONENTS.
 *
 * The `(home)` layout reads the session on the server: `uid` for `<ExploredProvider>` (the fog
 * session's IndexedDB key), `home` for the camera and `sources` for D-320's connect line. Signing in
 * through the Authenticator is a CLIENT state change, so without this the RSC payload the page loaded
 * with — the signed-out one, `uid: null` — stays in place: no fog session, the plinth's cells read
 * `—`, and the connect line never appears until a reload.
 *
 * Amplify announces both transitions on the `auth` Hub channel (it writes the session cookies first,
 * then dispatches), and `router.refresh()` re-runs the server components for the current route with
 * the new cookies. Signing out refreshes too, so the payload the NEXT sign-in mounts with is the
 * signed-out one rather than the previous account's `uid` — no previous user's cells can boot under
 * a stale key (criterion 2). The Authenticator already unmounts the children while signed out, which
 * disposes the running fog session.
 */
export const REFRESH_ON = ["signedIn", "signedOut"] as const

type AuthListener = (capsule: { payload: { event: string } }) => void

/**
 * The subscription, separate from React so it can be tested without a DOM. Returns the
 * unsubscribe. `listen` defaults to Amplify's Hub; tests pass their own.
 */
export function refreshOnAuthTransitions(
  refresh: () => void,
  listen: (callback: AuthListener) => () => void = (callback) => Hub.listen("auth", callback),
): () => void {
  return listen(({ payload }) => {
    if ((REFRESH_ON as readonly string[]).includes(payload.event)) refresh()
  })
}

/**
 * Subscribes for the whole page and returns `true` while a refresh it started is in flight. Used by
 * `AuthGate` OUTSIDE the Authenticator — the sign-in transition happens while the Authenticator is
 * showing its form and the children are not mounted, so a listener inside them would never hear it.
 *
 * THE CALLER HOLDS THE CHILDREN WHILE THIS IS `true`. After `signedIn`, the Authenticator would
 * otherwise mount them at once with the STALE signed-out payload, and the fresh one would land a
 * moment later. That second render is not free: `MapShell` rebuilds MapLibre when `home` changes
 * (null → the configured home), so the map would be built twice, and the provider would see `uid`
 * arrive late. Holding the children until the transition commits means the home screen mounts
 * exactly once, with the signed-in `uid`, `home` and `sources` (D-322: the map does not re-mount on
 * the auth transition).
 *
 * `pending` is set from the Hub callback, which Amplify dispatches before `signIn()` resolves — so
 * before the Authenticator's own state machine leaves the sign-in form.
 */
export function useAuthRefresh(): boolean {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  useEffect(
    () => refreshOnAuthTransitions(() => startTransition(() => router.refresh())),
    [router],
  )

  return pending
}
