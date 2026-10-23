import { API_TIMEOUT_MS } from "@/lib/http/timeout"

/**
 * WHEN THE MAP HAS PAINTED. Ticket `0113`, `06` §9.5: *"The fog payload is fetched after first paint,
 * never before."*
 *
 * The map shell marks it on MapLibre's `load` — *"the first visually complete rendering of the map"*
 * — once the fog layer that `load` lets `useFogMask` add has had a frame to draw the cached set. The
 * fog session (`boot.ts`) awaits it between the cached paint and the revalidation request.
 *
 * ─── THE CEILING ────────────────────────────────────────────────────────────
 *
 * A map that never paints — no WebGL2, a chunk that failed to load, a stalled tile keeping `load`
 * from firing — must not freeze the explored set at whatever IndexedDB held. So the gate also opens
 * on its own after `06` §9.5's API timeout, the same 10 s after which no request may hold a screen:
 * past it, holding the network back no longer protects a paint that is not happening.
 */
export interface PaintGate {
  /** Resolves on the first `mark()`, or at the ceiling. Never rejects. */
  readonly painted: Promise<void>
  /** The map has painted. Idempotent. */
  mark(): void
  /** Clears the ceiling timer and opens the gate, so nothing is left awaiting a map that is gone. */
  dispose(): void
}

export function paintGate(ceilingMs: number = API_TIMEOUT_MS): PaintGate {
  let open!: () => void
  const painted = new Promise<void>((resolve) => {
    open = resolve
  })
  const timer = setTimeout(() => open(), ceilingMs)
  return {
    painted,
    mark() {
      clearTimeout(timer)
      open()
    },
    dispose() {
      clearTimeout(timer)
      open()
    },
  }
}
