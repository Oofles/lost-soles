"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

import { startFogSession, type FogState } from "@/lib/fog/boot"
import { indexedDbCache } from "@/lib/fog/explored-cache"
import { httpTransport } from "@/lib/fog/transport"

/**
 * THE EXPLORED SET, IN REACT. Ticket `0054`. `01-architecture.md` §5:
 * *"Held in a React context for the session. Every consumer reads that `Set`
 * synchronously."*
 *
 * The consumers do not exist yet — `0055`'s mask pass, `0058`'s buckets, `08`'s derived
 * statistics. This is the seam they attach to, and it is built now rather than with the
 * first of them so that the boot sequence, the cache and the delta path can be finished
 * and validated as one thing (`02` §6.4 is an obligation on the whole sequence, not on
 * any one step of it).
 *
 * ONE SESSION PER MOUNT, AND IT IS DISPOSED. The session registers `visibilitychange` and
 * `focus` listeners (`05` §7.4's trigger 2), so a provider that leaked one would
 * revalidate twice per return to the app and grow a listener per navigation.
 */

const EMPTY: FogState = {
  phase: "loading",
  set: null,
  source: "none",
  generation: null,
  message: null,
}

const ExploredContext = createContext<FogState>(EMPTY)

/** Synchronous, and always defined — a consumer never has to null-check the context. */
export function useExplored(): FogState {
  return useContext(ExploredContext)
}

export function ExploredProvider({
  uid,
  children,
}: {
  /**
   * The Cognito `sub`, from the server component that already read the session. Used as
   * the IndexedDB key (`02` §6.4) and for nothing else — in particular it is never sent
   * back to the server, which re-derives it from the verified session.
   *
   * `null` for a signed-out visitor. `/` is the signed-out landing route, so this must be
   * a real state rather than an assumption: no session, no boot, no requests.
   */
  uid: string | null
  children: ReactNode
}) {
  const [state, setState] = useState<FogState>(EMPTY)

  useEffect(() => {
    if (!uid) return

    const session = startFogSession({
      uid,
      transport: httpTransport(),
      /**
       * `null` where IndexedDB is unavailable — a locked-down private window, or a
       * browser with site data blocked. Every boot then behaves as a cold one: slower,
       * never wrong.
       */
      cache: indexedDbCache(),
      onChange: setState,
    })

    return () => session.dispose()
  }, [uid])

  return <ExploredContext.Provider value={state}>{children}</ExploredContext.Provider>
}
