"use client"

import { useEffect, useMemo, useState } from "react"

import { basemapPlaceNames } from "@/lib/place-names"
import { coordinateLabel, regionsOf, type LngLatBounds, type Region } from "@/lib/regions"
import { webRuns } from "@/lib/trace-web/runs"
import type { WebRunInput } from "@/lib/trace-web/web"

import { useExplored } from "./explored-provider"
import { RegionJumpControl, type RegionItem } from "./region-jump-control"

/**
 * THE JUMP-TO CONTROL, ON THE MAP. Ticket `0285`.
 *
 * The regions come from the trace web's runs (`webRuns`) — the fetch the permanent web already makes
 * once per explored generation, so this adds no request — clustered by `regionsOf`. Each is labelled
 * with the most prominent place the basemap names inside it (D-302), and until that answers, or if it
 * never does, with its coordinate area. A name lookup that fails is a plain label, never an error.
 *
 * Choosing a region frames its ground with the same 12% padding as a run's page (§3.2). It is a
 * navigation, so a flight (`fitBounds` animates by default and honours reduced motion), and it is the
 * map's ordinary `moveend` that then writes the stored camera (D-249) — nothing here touches
 * storage. The mode is not read or changed.
 */

/** What the control needs of the map: MapLibre's `Map`, narrowed so it can be faked. */
export interface JumpHost {
  fitBounds(bounds: LngLatBounds, options: { padding: number; maxZoom: number }): unknown
  getContainer(): HTMLElement
}

/** No closer than a street-level view, so a region of one short run does not fill the pane. */
export const JUMP_MAX_ZOOM = 15

export function RegionJump({ map, onJump }: { map: JumpHost | null; onJump?: () => void }) {
  const { generation } = useExplored()
  const [runs, setRuns] = useState<WebRunInput[] | null>(null)

  useEffect(() => {
    let cancelled = false
    webRuns(generation).then(
      (r) => {
        if (!cancelled) setRuns(r)
      },
      // `useTraceWeb` logs the same failed fetch; one log is enough. No regions, no control.
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [generation])

  const regions = useMemo(() => (runs ? regionsOf(runs) : []), [runs])
  const labels = usePlaceLabels(regions)

  const items = jumpItems(regions, labels)
  if (!map || !items) return null

  function jump(id: string) {
    const region = regions.find((r) => r.id === id)
    if (!region || !map) return
    onJump?.()
    frameRegion(map, region.bounds)
  }

  return <RegionJumpControl regions={items} onChoose={jump} />
}

/**
 * The list the control shows, or `null` for no control at all: with one region there is nowhere
 * to jump (criterion 4). A region the basemap has not named (yet, or ever) reads as its coordinates.
 */
export function jumpItems(regions: readonly Region[], labels: ReadonlyMap<string, string>): RegionItem[] | null {
  if (regions.length < 2) return null
  return regions.map((r) => ({ id: r.id, label: labels.get(r.id) ?? coordinateLabel(r.bounds) }))
}

/** Frames a region's ground in the pane, with §3.2's 12% padding. The camera only — never the mode. */
export function frameRegion(map: JumpHost, bounds: LngLatBounds): void {
  const box = map.getContainer().getBoundingClientRect()
  const padding = Math.round(Math.min(box.width, box.height) * 0.12)
  map.fitBounds(bounds, { padding, maxZoom: JUMP_MAX_ZOOM })
}

/** The basemap's names for the regions, by id, as they arrive. Only asked when there is a list. */
function usePlaceLabels(regions: readonly Region[]): Map<string, string> {
  const [labels, setLabels] = useState<Map<string, string>>(new Map())
  // Keyed on the regions' ground, not the array's identity: a new generation that moved nothing
  // does not read tiles again (the lookup caches them anyway).
  const key = regions.map((r) => `${r.id}:${r.bounds.flat().join(",")}`).join("|")

  useEffect(() => {
    if (regions.length < 2) return
    let cancelled = false
    let names: ReturnType<typeof basemapPlaceNames>
    try {
      names = basemapPlaceNames()
    } catch {
      return // No archive configured: coordinate labels throughout.
    }
    for (const region of regions) {
      names.prominent(region.bounds).then(
        (name) => {
          if (cancelled || !name) return
          setLabels((prev) => (prev.get(region.id) === name ? prev : new Map(prev).set(region.id, name)))
        },
        () => {},
      )
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the regions' content.
  }, [key])

  return labels
}
