"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import type { MapStage } from "@/components/map/map-shell"
import { revealSeenKey, type BackfillMark } from "@/lib/backfill/batch"
import { backfillDue, backfillHold } from "@/lib/backfill/plan"
import { addedCells, aggregateRevealCells } from "@/lib/backfill/reveal"
import type { HomeHold } from "@/lib/fog/home-territory"
import type { RevealCell } from "@/lib/fog/reveal"
import { httpTransport, type FogTransport } from "@/lib/fog/transport"
import { log } from "@/lib/log"
import { isSeen, markSeen } from "@/lib/run-moment/seen"
import type { RunFeatureCollection } from "@/lib/runs/wire"
import { bigToCell, decodeExploredBlobTyped } from "@/src/domain/explored-blob"

/**
 * HOME'S HALF OF THE AGGREGATE REVEAL. Ticket `0257`, `06-ui-ux.md` §3.4 *Backfill*.
 *
 * Reads the batch mark off the latest-run answer home already waits for (`/api/runs/latest`), asks
 * the per-device `seen` store whether this device has played it, and if not:
 *
 *   1. fetches the two explored blobs the mark names — `before` and `after`, immutable, and served by
 *      generation (`/api/fog/blob/<gen>`) — and HOLDS their difference back, so `/` shows the map as
 *      it was before the import (the same hold an unseen run gets, D-319);
 *   2. once the map is ready, places those cells on the burn's clock outward from where the map is
 *      looking (`aggregateRevealCells`) and hands them to `MapShell` as the reveal;
 *   3. on `finish` — completed or skipped, by any of the one exit's ways out — marks the batch seen on
 *      this device and lets go of both.
 *
 * Until it knows, the hold is PENDING and the fog keeps its last frame (D-333): drawing the imported
 * ground and then fogging it back for the reveal would be the flash that rule forbids. A failure to
 * load the blobs is "no reveal this visit": nothing held, nothing marked, so the next visit tries
 * again.
 */

type Phase =
  | { id: string; kind: "checking" | "loading" | "skip" | "done" }
  | { id: string; kind: "ready"; added: bigint[]; hold: string[] }
  | { id: string; kind: "playing"; added: bigint[]; hold: string[]; reveal: RevealCell[] }

export interface BackfillReveal {
  /** What home must hold back for the import: pending, its cells, or `null` for nothing. */
  hold: HomeHold | null
  /** The burn's cells while the reveal plays; `null` otherwise. Stable identity. */
  reveal: RevealCell[] | null
  /** The batch being revealed, while it plays. */
  playing: BackfillMark | null
  /** The reveal ended — finished, skipped or aborted. Marks it seen on this device. */
  finish(): void
}

const EMPTY = new BigUint64Array(0)

export function useBackfillReveal({
  latest,
  answer,
  stage,
  enabled,
  transport,
}: {
  latest: RunFeatureCollection
  answer: { network: boolean } | null
  stage: MapStage
  /** `false` while the Chronicle is open: the reveal waits for the map to be the subject. */
  enabled: boolean
  transport?: FogTransport
}): BackfillReveal {
  const due = useMemo(() => backfillDue(latest, answer), [latest, answer])
  const mark = due.kind === "due" ? due.mark : null
  const id = mark?.batchId ?? null
  const before = mark?.before.generation ?? 0
  const after = mark?.after.generation ?? 0
  const [phase, setPhase] = useState<Phase | null>(null)

  useEffect(() => {
    if (id === null) return
    let live = true
    setPhase({ id, kind: "checking" })
    void (async () => {
      if (await isSeen(revealSeenKey(id))) {
        if (live) setPhase({ id, kind: "skip" })
        return
      }
      if (!live) return
      setPhase({ id, kind: "loading" })
      try {
        const fog = transport ?? httpTransport()
        const [b, a] = await Promise.all([
          before > 0 ? fog.blob(before).then((bytes) => decodeExploredBlobTyped(bytes).cells) : Promise.resolve(EMPTY),
          fog.blob(after).then((bytes) => decodeExploredBlobTyped(bytes).cells),
        ])
        const added = addedCells(a, b)
        if (!live) return
        if (added.length === 0) {
          // Nothing to burn back (an import over ground already explored): the ledger and the card
          // still play — the numbers never depend on the map.
          setPhase({ id, kind: "ready", added, hold: [] })
          return
        }
        setPhase({ id, kind: "ready", added, hold: added.map(bigToCell) })
      } catch (error) {
        log.error("backfill reveal: the explored blobs could not be read", error)
        if (live) setPhase({ id, kind: "skip" })
      }
    })()
    return () => {
      live = false
    }
  }, [id, before, after, transport])

  // The map is ready and the reveal may start: place the cells outward from where the map looks.
  useEffect(() => {
    if (!enabled || !phase || phase.kind !== "ready" || phase.id !== id) return
    if (stage === null || stage.kind === "lost") return
    const centre = stage.kind === "ready" ? stage.map.getCenter() : null
    const reveal = aggregateRevealCells(phase.added, centre ? { lat: centre.lat, lng: centre.lng } : null)
    setPhase({ ...phase, kind: "playing", reveal })
  }, [enabled, phase, id, stage])

  const current = phase && phase.id === id ? phase : null
  const hold = useMemo<HomeHold | null>(() => backfillHold(due, current), [due, current])

  const finish = useCallback(() => {
    if (id === null) return
    markSeen(revealSeenKey(id))
    setPhase({ id, kind: "done" })
  }, [id])

  return {
    hold,
    reveal: current?.kind === "playing" ? current.reveal : null,
    playing: current?.kind === "playing" ? mark : null,
    finish,
  }
}
