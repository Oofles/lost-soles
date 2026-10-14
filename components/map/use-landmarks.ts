"use client"

import { useEffect, useMemo, useState } from "react"

import {
  documentMarkerPalette,
  landmarkFeatures,
  NO_LANDMARKS,
  renderGlyph,
  setLandmarks,
  type LandmarkHost,
} from "@/lib/landmarks/markers"
import { log } from "@/lib/log"
import { currentUid } from "@/lib/log/transport"
import type { LandmarkRow } from "@/lib/skills/detail"
import { fetchAllLandmarks } from "@/lib/skills/transport"

import { useExplored } from "./explored-provider"

/**
 * RECORDED LANDMARKS, ON THE HOME MAP. Ticket `0260` (`lib/landmarks/markers.ts`).
 *
 * Read owner-scoped through AppSync on mount and again on every explored generation — a run that
 * crosses 50 arrives as a new generation, and its cairn should be standing when the map settles.
 * A failed read is a map with no markers, logged without the rows: never a coordinate in a log
 * (`08` §7.2, D-199).
 */
export function useLandmarks(map: (LandmarkHost & { triggerRepaint(): void }) | null): void {
  const { generation } = useExplored()
  const [rows, setRows] = useState<LandmarkRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    currentUid()
      .then((uid) => (uid ? fetchAllLandmarks(uid) : []))
      .then(
        (r) => {
          if (!cancelled) setRows(r)
        },
        (error) => log.error("landmarks: fetch failed", error),
      )
    return () => {
      cancelled = true
    }
  }, [generation])

  const data = useMemo(() => (rows ? landmarkFeatures(rows) : NO_LANDMARKS), [rows])

  useEffect(() => {
    if (!map) return
    try {
      const palette = documentMarkerPalette()
      setLandmarks(map, data, (form) => renderGlyph(form, palette))
      map.triggerRepaint()
    } catch (error) {
      log.error("landmarks: could not draw", error)
    }
  }, [map, data])
}
