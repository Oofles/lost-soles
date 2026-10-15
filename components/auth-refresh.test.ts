import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import { refreshOnAuthTransitions } from "./auth-refresh"

/**
 * TICKET 0276 — SIGNING IN ON `/` WITHOUT A RELOAD.
 *
 * The `(home)` layout's `uid`, `home` and `sources` are read on the server. Before this ticket a
 * sign-in through the Authenticator changed nothing the server could see, so the plinth kept the
 * signed-out payload until a reload. The fix is a `router.refresh()` on Amplify's `signedIn` and
 * `signedOut` Hub events, with the children held while it is in flight.
 *
 * There is no DOM in this suite, so the subscription is tested as a function (with Amplify's own
 * dispatch shape) and the wiring into `AuthGate` is asserted from the source.
 */

type Capsule = { payload: { event: string } }

function fakeHub() {
  const listeners = new Set<(capsule: Capsule) => void>()
  return {
    listen: (callback: (capsule: Capsule) => void) => {
      listeners.add(callback)
      return () => void listeners.delete(callback)
    },
    dispatch: (event: string) => {
      for (const listener of listeners) listener({ payload: { event } })
    },
    get size() {
      return listeners.size
    },
  }
}

describe("refreshOnAuthTransitions", () => {
  it("refreshes the server components when the user signs in", () => {
    const hub = fakeHub()
    const refresh = vi.fn()
    refreshOnAuthTransitions(refresh, hub.listen)
    hub.dispatch("signedIn")
    expect(refresh).toHaveBeenCalledOnce()
  })

  it("refreshes when the user signs out, so the next sign-in does not mount the old uid", () => {
    const hub = fakeHub()
    const refresh = vi.fn()
    refreshOnAuthTransitions(refresh, hub.listen)
    hub.dispatch("signedOut")
    expect(refresh).toHaveBeenCalledOnce()
  })

  it("ignores the auth events that do not change who is signed in", () => {
    const hub = fakeHub()
    const refresh = vi.fn()
    refreshOnAuthTransitions(refresh, hub.listen)
    for (const event of ["tokenRefresh", "tokenRefresh_failure", "signInWithRedirect", "customOAuthState"]) {
      hub.dispatch(event)
    }
    expect(refresh).not.toHaveBeenCalled()
  })

  it("unsubscribes, so an unmounted gate never refreshes", () => {
    const hub = fakeHub()
    const refresh = vi.fn()
    const stop = refreshOnAuthTransitions(refresh, hub.listen)
    stop()
    expect(hub.size).toBe(0)
    hub.dispatch("signedIn")
    expect(refresh).not.toHaveBeenCalled()
  })

  it("listens on Amplify's real auth channel by default", async () => {
    const { Hub } = await import("aws-amplify/utils")
    const listen = vi.spyOn(Hub, "listen")
    const stop = refreshOnAuthTransitions(vi.fn())
    expect(listen).toHaveBeenCalledWith("auth", expect.any(Function))
    stop()
    listen.mockRestore()
  })
})

describe("AuthGate", () => {
  const source = readFileSync(join(import.meta.dirname, "auth-gate.tsx"), "utf8")

  it("subscribes OUTSIDE the Authenticator, where it hears the sign-in the form performs", () => {
    expect(source).toMatch(/const refreshing = useAuthRefresh\(\)[\s\S]*<Authenticator/)
  })

  it("holds the children while the refresh is in flight, so the map mounts once with fresh props", () => {
    expect(source).toContain("{refreshing ? null : children}")
  })
})
