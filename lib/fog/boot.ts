import { BlobFormatError } from "@/src/domain/explored-blob"
import { RES } from "@/src/domain/fog"

import { base64ToBytes, decodeDelta } from "./decode"
import type { ExploredCache } from "./explored-cache"
import { DeltaSkewError, ExploredSet, type BucketInvalidator } from "./explored-set"
import type { FogTransport } from "./transport"

/**
 * THE BOOT SEQUENCE, AS AN OBLIGATION. Ticket `0054`. `02-data-model.md` §6.4;
 * `05-fog-of-war.md` §7.3, §7.4.
 *
 *   1. Read IndexedDB. If a set is cached, RENDER IMMEDIATELY. Do not wait for the network.
 *   2. Ask the server what has changed.
 *   3. `generation === since` → done, nothing else fetched.
 *   4. `since >= deltasFrom` → apply the chain, validating `fromGen` before each hop.
 *   5. Otherwise → the full `.bin`, replacing the cache.
 *
 * ─── STEP 1 BEFORE STEP 2, RATHER THAN GENUINELY IN PARALLEL ────────────────
 *
 * §6.4 says *"fetch `manifest.json` in parallel"*, which assumed the client fetches a
 * manifest and re-derives the three-way branch itself. It does not: the branch is resolved
 * server-side and the request carries `since`, so the cached generation has to be known
 * before the request can be sent (D-228).
 *
 * **What the parallelism was for is preserved exactly.** The obligation is that first
 * paint does not wait for the network, and it does not — the cache read is local, the
 * request is in flight before the set is handed to the renderer, and nothing awaits the
 * response before painting. An IndexedDB read is a few milliseconds against a network
 * round trip; the alternative — a `localStorage` generation hint, so the request could be
 * sent first — buys that back at the cost of two sources of truth that can disagree, and
 * a disagreement here silently renders a map that is missing a run.
 *
 * ─── OFFLINE IS NOT A REFUSAL ───────────────────────────────────────────────
 *
 * A failed request leaves the cached set on screen and the phase at `ready`. That is this
 * ticket's first operator check — airplane mode, and territory appears anyway — and it is
 * licensed by D-020 exactly as the warm start is: stale can only mean *missing the newest
 * run*, never *wrong about revealed ground*.
 *
 * **Version skew IS a refusal.** `manifest.res !== 10` (D-115) or an unknown `version`
 * byte discards the cache and refuses to render, with a message on screen. `02` §6.4:
 * *"a silent mis-parse of cell IDs looks like territory teleporting, which is
 * indistinguishable from data loss to the user."*
 */

export type FogSource =
  /** IndexedDB, before the network answered. */
  | "cache"
  /** One or more `LSFD` hops applied to what was already held. */
  | "delta"
  /** A full `LSFG` fetch — a cold start, or a client past `deltasFrom`. */
  | "full"
  /** The user has ingested nothing yet. A real, renderable, empty set. */
  | "empty"
  /** Nothing is loaded. */
  | "none"

export type FogPhase =
  | "loading"
  /** A set is on screen. It may still be stale; see the header. */
  | "ready"
  /** Version skew. Nothing may be rendered, and the message is shown instead. */
  | "refused"

export interface FogState {
  phase: FogPhase
  set: ExploredSet | null
  source: FogSource
  generation: number | null
  /** A refusal reason, or a note that the last revalidation could not reach the server. */
  message: string | null
}

export interface FogSessionOptions {
  /**
   * The Cognito `sub`, from the server component that already read the session. The
   * IndexedDB key (`02` §6.4), and the reason a second account on the same device cannot
   * open the first one's map from cache.
   *
   * It is NOT sent to the server: `08-security-privacy.md` §5.3 requires every route to
   * re-derive `sub` from the verified session and never take a uid from a request.
   */
  uid: string
  transport: FogTransport
  /** `null` where IndexedDB is unavailable; every boot then behaves as a cold one. */
  cache?: ExploredCache | null
  invalidators?: readonly BucketInvalidator[]
  onChange: (state: FogState) => void
  /**
   * `persistToIndexedDB` runs in an idle callback, NEVER on the frame path (`02` §6.5).
   * Injected so a test can run it synchronously rather than racing a scheduler.
   */
  schedulePersist?: (task: () => void) => void
  /**
   * `05` §7.4's trigger 2 — revalidate on `visibilitychange` → visible and on `focus`.
   * Trigger 1, the AppSync subscription, is capability `14`; trigger 3 is the Sync
   * button, which already exists. **Never a timer** — that is the upkeep D-013 rejects.
   */
  revalidateOnFocus?: boolean
}

export interface FogSession {
  readonly state: FogState
  /**
   * Resolves when the initial boot has finished — cache read, first paint, and the first
   * revalidation. **It never rejects**: every failure this sequence can have is already a
   * state (`refused`, or `ready` with a note), and a rejecting promise nobody awaited
   * would surface as an unhandled rejection in a browser where the map is fine.
   */
  readonly ready: Promise<void>
  /** Revalidate now. Safe to call concurrently; overlapping calls collapse. */
  refresh(): Promise<void>
  dispose(): void
}

const idle = (task: () => void): void => {
  const scheduler = (
    globalThis as { requestIdleCallback?: (cb: () => void) => number }
  ).requestIdleCallback
  if (scheduler) scheduler(task)
  else setTimeout(task, 0)
}

export function startFogSession(options: FogSessionOptions): FogSession {
  const {
    uid,
    transport,
    cache = null,
    invalidators = [],
    onChange,
    schedulePersist = idle,
    revalidateOnFocus = typeof document !== "undefined",
  } = options

  let state: FogState = {
    phase: "loading",
    set: null,
    source: "none",
    generation: null,
    message: null,
  }
  let disposed = false
  let inFlight: Promise<void> | null = null

  function emit(next: Partial<FogState>): void {
    state = { ...state, ...next }
    if (!disposed) onChange(state)
  }

  /** Registered on every set, including a replacement, so `0058`'s buckets survive one. */
  function adopt(set: ExploredSet): ExploredSet {
    for (const invalidator of invalidators) set.addInvalidator(invalidator)
    return set
  }

  function persist(set: ExploredSet): void {
    if (!cache) return
    /**
     * Generation 0 is the "nothing published" sentinel (`server.ts`), and it is also what
     * the transport sends as `since` when there is no cache. Persisting it would make the
     * next boot indistinguishable from a cold one while still costing a read — and the
     * empty set it holds is reconstructible in a line.
     */
    if (set.generation <= 0) return
    schedulePersist(() => {
      void cache.write(uid, set.generation, set.cells).catch(() => {
        // A cache that will not write is a slower next boot, never a wrong map. The
        // authoritative copy is S3's and the next start simply takes the full blob.
      })
    })
  }

  async function refuse(message: string): Promise<void> {
    await cache?.discard(uid).catch(() => {})
    emit({ phase: "refused", set: null, source: "none", generation: null, message })
  }

  async function takeFullBlob(generation: number): Promise<void> {
    const bytes = await transport.blob(generation)
    const set = adopt(ExploredSet.fromBlob(bytes))
    /**
     * The blob names its own generation in its header, and it must be the one the plan
     * promised. A disagreement means the manifest and the object have diverged — the one
     * thing `02` §6.4's ordering rule (blobs before manifest) is designed to make
     * impossible — so it is refused rather than rendered under the wrong cache key.
     */
    if (set.generation !== generation) {
      await refuse(
        `The map data is inconsistent: generation ${generation} was requested and the ` +
          `payload declares ${set.generation}. Nothing has been lost — reload to try again.`,
      )
      return
    }
    emit({ phase: "ready", set, source: "full", generation: set.generation, message: null })
    persist(set)
  }

  async function sync(): Promise<void> {
    const since = state.set?.generation ?? null

    let response
    try {
      response = await transport.update(since)
    } catch {
      /**
       * OFFLINE, or the route is unreachable. The cached map stays exactly as it is; see
       * the header. The note is for the `?fog=debug` readout, not for the map — a banner
       * over a map that is correct-but-stale would be alarming about a state D-020 makes
       * harmless.
       */
      emit({
        message: state.set
          ? "Offline — showing the map as of the last time it synced."
          : "Could not reach the server, and there is nothing cached to show yet.",
        phase: state.set ? "ready" : state.phase,
      })
      return
    }

    if (response.status === 304) {
      emit({ phase: "ready", message: null })
      return
    }

    const update = response.update

    /**
     * D-115, CHECKED BEFORE A SINGLE BYTE OF PAYLOAD IS FETCHED. `05` §7.3 and `02` §6.4
     * both put `res` in the manifest for exactly this: cell ids at two resolutions are not
     * comparable, not mergeable and not renderable together, so the refusal must happen
     * where it is cheapest and loudest.
     */
    if (update.res !== RES) {
      await refuse(
        `This map was built at H3 resolution ${update.res}, and this app only reads ` +
          `resolution ${RES}. Refusing to draw it rather than guess — the cached copy has ` +
          "been cleared. Reload after the app updates.",
      )
      return
    }

    try {
      if (update.plan === "empty") {
        /**
         * A user with no ingested activity. Not an error and not a loading state: the
         * correct map for someone who has not run yet is entirely unrevealed, and saying
         * so lets the renderer draw full fog instead of waiting forever for a payload.
         */
        const set = adopt(ExploredSet.fromCells(new BigUint64Array(0), 0))
        emit({ phase: "ready", set, source: "empty", generation: 0, message: null })
        return
      }

      if (update.plan === "up-to-date") {
        emit({ phase: "ready", message: null })
        return
      }

      if (update.plan === "delta" && state.set) {
        const set = state.set
        let applied = 0
        for (const encoded of update.deltas ?? []) {
          // `fromGen === state.generation` is asserted inside `applyDelta`, per hop, and
          // a mismatch throws `DeltaSkewError` — caught below and answered with the full
          // blob, which is what `02` §6.5 requires.
          set.applyDelta(decodeDelta(base64ToBytes(encoded)))
          applied++
        }
        if (applied === 0) {
          // A `delta` plan with an empty chain is the server telling us we are current by
          // another name. Nothing to apply, nothing to persist.
          emit({ phase: "ready", message: null })
          return
        }
        emit({ phase: "ready", set, source: "delta", generation: set.generation, message: null })
        persist(set)
        return
      }

      await takeFullBlob(update.generation)
    } catch (error) {
      if (error instanceof BlobFormatError) {
        /**
         * An unknown `version`, a bad magic, a non-zero reserved byte, a flag this
         * decoder cannot honour. `02` §6.4 is unambiguous: discard the cache and refuse
         * to render rather than guessing.
         */
        await refuse(
          "The map data is in a format this version of the app does not understand. " +
            "Nothing has been drawn, and the cached copy has been cleared so a stale " +
            "reader cannot show it either. Reload once the app has updated.",
        )
        return
      }
      if (error instanceof DeltaSkewError) {
        // The chain moved on under us — a second run landed between the plan being
        // resolved and it being applied. The bytes were fine; they simply do not apply
        // here. §6.5's named remedy, taken without ceremony.
        await takeFullBlob(update.generation)
        return
      }
      throw error
    }
  }

  function refresh(): Promise<void> {
    /**
     * Overlapping revalidations collapse onto the one in flight. `visibilitychange` and
     * `focus` both fire when a phone returns to the app, so without this every return
     * would issue two requests and — worse — could apply the same delta chain twice
     * against a set that had already moved.
     */
    inFlight ??= sync().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  async function boot(): Promise<void> {
    try {
      const cached = await cache?.readLatest(uid)
      if (cached && !disposed) {
        /**
         * STEP 1, AND THE `fromCells` CALL IS THE CRITERION. It cannot reach a decoder, so
         * `decodeStats.blobDecodes` staying at 0 across a warm start is a structural fact
         * rather than a hopeful assertion.
         */
        const set = adopt(ExploredSet.fromCells(cached.cells, cached.generation))
        emit({
          phase: "ready",
          set,
          source: "cache",
          generation: set.generation,
          message: null,
        })
      }
    } catch {
      // A cache that will not read is a cold start. Nothing else changes.
    }
    if (!disposed) await refresh()
  }

  /**
   * The one place an unexpected throw can land. `sync` already answers a transport
   * failure with a note and version skew with a refusal, so reaching here means a bug —
   * and the honest response to a bug in the loader is to say the map could not be loaded,
   * not to leave a spinner running forever.
   */
  const ready = boot().catch(() => {
    emit({
      phase: state.set ? "ready" : "loading",
      message: "Something went wrong loading the map data.",
    })
  })

  const onVisible = (): void => {
    if (document.visibilityState === "visible") void refresh()
  }
  const onFocus = (): void => void refresh()

  if (revalidateOnFocus) {
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onFocus)
  }

  return {
    get state() {
      return state
    },
    ready,
    refresh,
    dispose() {
      disposed = true
      if (revalidateOnFocus) {
        document.removeEventListener("visibilitychange", onVisible)
        window.removeEventListener("focus", onFocus)
      }
    },
  }
}
