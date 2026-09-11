"use client"

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import { startFogSession, type FogState } from "@/lib/fog/boot"
import { perfDataset } from "@/lib/fog/debug-flags"
import { indexedDbCache } from "@/lib/fog/explored-cache"
import { loadPerfDataset } from "@/lib/fog/perf/dataset-source"
import { httpTransport } from "@/lib/fog/transport"
import { EXTRACT_FALLBACK, readCamera } from "@/lib/map-camera"

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

  /**
   * `0059` — `?fog=perf`. Read ONCE on mount, for the reason `useFogMask` reads its own flags once:
   * a debug flag that re-evaluated on navigation could swap the explored set under a running map.
   */
  const perf = useMemo(
    () => (typeof window === "undefined" ? null : perfDataset(window.location.search)),
    [],
  )

  /**
   * THE SYNTHETIC SET, AND IT REPLACES THE SESSION RATHER THAN RACING IT.
   *
   * The effect below early-returns when `perf` is set, so no `startFogSession` runs: no `LSFG` fetch,
   * no IndexedDB read, no revalidation on focus. That is not an optimisation — a real boot arriving
   * mid-measurement would swap 500,617 synthetic cells for the operator's own few thousand somewhere
   * inside the scripted path, and the run would report a number for a dataset that stopped existing
   * halfway through it.
   *
   * **Nothing here writes.** `ExploredSet` has no `add()` and the perf path never touches the cache,
   * so a synthetic set cannot reach IndexedDB and cannot be mistaken later for territory (D-020's
   * map never re-fogs, and the way to respect that is to never let a fake cell in).
   */
  useEffect(() => {
    if (!perf) return
    let cancelled = false
    const camera = readCamera() ?? EXTRACT_FALLBACK
    setState({ ...EMPTY, message: `?fog=perf — loading the ${perf} dataset` })
    void loadPerfDataset(perf, { lat: camera.lat, lng: camera.lng })
      .then(({ set, dataset, origin, loadMs }) => {
        if (cancelled) return
        setState({
          phase: "ready",
          set,
          source: "synthetic",
          generation: set.generation,
          message:
            `?fog=perf — ${dataset.label} (${set.size.toLocaleString()} cells) ` +
            `${origin === "here" ? "generated around this camera" : "from the checked-in fixture"}` +
            ` in ${loadMs.toFixed(0)} ms. SYNTHETIC — NOT this account's territory.`,
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // `refused` rather than a thrown error: the page still has a map, and the reason a perf run
        // did not start is the one thing worth putting on screen.
        setState({
          ...EMPTY,
          phase: "refused",
          message: error instanceof Error ? error.message : String(error),
        })
      })
    return () => {
      cancelled = true
    }
  }, [perf])

  useEffect(() => {
    if (!uid || perf) return

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
  }, [uid, perf])

  return <ExploredContext.Provider value={state}>{children}</ExploredContext.Provider>
}
