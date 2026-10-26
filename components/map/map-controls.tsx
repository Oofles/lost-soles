"use client"

import Link from "next/link"
import { useEffect, useMemo, useReducer, useRef, useState } from "react"

import { log } from "@/lib/log"
import { fitTerritory, recentre, type CameraHost } from "@/lib/map-controls"
import {
  cardHeading,
  cardHeight,
  CARD_MAX_ROWS,
  CARD_ROW_PX,
  CARD_WIDTH_PX,
  CHIP_HEIGHT_PX,
  IDLE,
  indexRuns,
  inspect,
  placeBox,
  runLine,
  runsNear,
  selectedRun,
  type IndexedRun,
  type Point,
  type Projection,
} from "@/lib/route-inspect"
import { fetchRunFacts } from "@/lib/runs/client"
import { runHref, type RunFacts, type RunFeatureCollection } from "@/lib/runs/wire"
import { webRuns } from "@/lib/trace-web/runs"
import type { WebRunInput } from "@/lib/trace-web/web"

import { useExplored } from "./explored-provider"

/**
 * `⌖`, FIT-TO-TERRITORY, AND INSPECTING A RUN. Ticket `0101`, `06-ui-ux.md` §4.4–§4.5, D-253, D-313.
 *
 * Home only. The two controls sit on the right edge of the map pane, 40 px each, fit directly above
 * `⌖` with an 8 px gap and `⌖`'s bottom 16 px above the attribution (`06` §2.2 rows 6 and 8; D-313:
 * map controls are 40 px and live on the pane, never under the rail), clear of the mode toggle
 * (top-left) and of `⚙` and jump-to (top-right). Below 1024 px the plinth is a bottom card of
 * variable height, so they join `⚙` and jump-to in ONE ROW along the top-right — fit, `⌖`, jump-to,
 * `⚙` — where neither the card nor the Chronicle can reach them (`0314`; that width only must not
 * break, D-251).
 *
 * The rules themselves — hit test, card placement, the transition function — are `lib/route-inspect.ts`
 * and `lib/map-controls.ts`, pure and tested; this file wires them to MapLibre's events.
 */

/** The slice of MapLibre's `Map` this file touches, so the wiring stays honest about it. */
export interface ControlsHost extends CameraHost {
  project(lngLat: [number, number]): { x: number; y: number }
  unproject(point: [number, number]): { lng: number; lat: number }
  getCanvas(): HTMLCanvasElement
  on(type: string, listener: (event: { point: { x: number; y: number } }) => void): unknown
  off(type: string, listener: (event: { point: { x: number; y: number } }) => void): unknown
}

/**
 * `bottom: 36px` keeps MapLibre's attribution uncovered (§2.2 row 10, the plinth's own inset). The
 * two buttons share one rule set with `⚙` and jump-to: same surface, rule and size. Below 1024px
 * (`0314`) they are a row at `top: 16px`, `right: 112px` — left of jump-to (`right: 64px`) and `⚙`
 * (`right: 16px`), 8px apart — so the four controls are one 40px strip and the card and the
 * Chronicle, whatever their height, stay below it.
 *
 * `.recentre-glyph` (`0317`): neither `⌖` nor `⤢` is in the self-hosted Inter subset, so both are drawn
 * by a system fallback font (Segoe UI Symbol on the operator's Windows desktop). At 18px there `⌖` is a
 * thin-stroked crosshair that reads lighter than `⤢`; 22px brings it to a comparable weight. Scoped to
 * that span so the button stays 40px (D-313) and no other control's glyph moves.
 */
export const MAP_CONTROLS_CSS =
  ".map-controls { position: fixed; z-index: 1; top: 16px; right: 112px; display: flex; flex-direction: row; gap: 8px; }" +
  " .map-control { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;" +
  " box-sizing: border-box; padding: 0; background: var(--surface-raised); border: 1px solid var(--line);" +
  " border-radius: 4px; color: var(--text-primary); font-size: 18px; line-height: 1; cursor: pointer; }" +
  " .map-control .recentre-glyph { font-size: 22px; }" +
  " .map-control:hover:not(:disabled) { background: var(--bg); }" +
  " .map-control:disabled { color: var(--text-secondary); cursor: default; }" +
  " .map-control:focus-visible, .route-card a:focus-visible, .route-chip:focus-visible {" +
  " outline: 2px solid var(--text-primary); outline-offset: 2px; }" +
  " @media (min-width: 1024px) { .map-controls { top: auto; bottom: 36px; right: 16px; flex-direction: column; } }" +
  " .route-chip, .route-card { position: fixed; z-index: 2; box-sizing: border-box; background: var(--surface-raised);" +
  " border: 1px solid var(--line); border-radius: 4px; color: var(--text-primary); font: 400 14px/1.3 var(--font-sans);" +
  " font-variant-numeric: tabular-nums; }" +
  " .route-chip { display: flex; align-items: center; height: " + CHIP_HEIGHT_PX + "px; padding: 0 12px;" +
  " text-decoration: none; white-space: nowrap; }" +
  " .route-chip:hover { background: var(--bg); }" +
  " .route-card { width: " + CARD_WIDTH_PX + "px; padding: 4px 0; }" +
  " .route-card-head { display: flex; align-items: center; height: 32px; padding: 0 12px; color: var(--text-secondary);" +
  " border-bottom: 1px solid var(--line); box-sizing: border-box; }" +
  " .route-card ul { margin: 0; padding: 0; list-style: none; max-height: " + CARD_MAX_ROWS * CARD_ROW_PX + "px;" +
  " overflow-y: auto; }" +
  " .route-card a { display: flex; align-items: center; height: " + CARD_ROW_PX + "px; padding: 0 12px;" +
  " color: var(--text-primary); text-decoration: none; white-space: nowrap; }" +
  " .route-card a:hover { background: var(--bg); }"

function projection(map: ControlsHost): Projection {
  return {
    project: (lngLat) => map.project(lngLat),
    unproject: (p) => {
      const ll = map.unproject([p.x, p.y])
      return [ll.lng, ll.lat]
    },
  }
}

/** The facts for the runs on screen, fetched once per id per mount. */
function useFacts(runs: readonly IndexedRun[]): ReadonlyMap<string, RunFacts> {
  const [facts, setFacts] = useState<ReadonlyMap<string, RunFacts>>(new Map())
  const asked = useRef(new Set<string>())
  const key = runs.map((r) => r.activityId).join(",")
  useEffect(() => {
    const ids = runs.map((r) => r.activityId).filter((id) => !asked.current.has(id))
    if (ids.length === 0) return
    for (const id of ids) asked.current.add(id)
    fetchRunFacts(ids).then(
      (got) =>
        setFacts((prev) => {
          const next = new Map(prev)
          for (const f of got) next.set(f.activityId, f)
          return next
        }),
      (error) => {
        for (const id of ids) asked.current.delete(id)
        log.warn(`route inspect: facts fetch failed: ${(error as Error).message}`)
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the runs' ids.
  }, [key])
  return facts
}

export function MapControls({
  map,
  latest,
  onSelect,
}: {
  map: ControlsHost | null
  /** The latest run, from `useLatestRun` — `⌖`'s target, and hit-testable before the web has it. */
  latest: RunFeatureCollection
  /** The run to draw as the selected run; `null` gives the line back to the latest run. */
  onSelect: (run: IndexedRun | null) => void
}) {
  const { generation } = useExplored()
  const [web, setWeb] = useState<WebRunInput[]>([])
  useEffect(() => {
    let cancelled = false
    webRuns(generation).then(
      (r) => {
        if (!cancelled) setWeb(r)
      },
      // `useTraceWeb` logs the same failed fetch. No web: fit does nothing, only the latest is clickable.
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [generation])

  const index = useMemo(() => indexRuns(web, latest), [web, latest])
  const indexRef = useRef(index)
  indexRef.current = index

  const [state, dispatch] = useReducer(inspect, IDLE)
  /** Where the open chip or card is anchored, on the ground, so a pan carries it with the map. */
  const anchor = useRef<[number, number] | null>(null)
  const [, setTick] = useState(0)

  // Click: hit-test, then the one transition. Empty map with nothing open is a no-op by identity.
  // Hover: the pointer cursor within the slop, and nothing else (D-313).
  useEffect(() => {
    if (!map) return
    const proj = projection(map)
    const onClick = (event: { point: { x: number; y: number } }) => {
      const at: Point = { x: event.point.x, y: event.point.y }
      const hits = runsNear(indexRef.current, at, proj)
      if (hits.length > 0) anchor.current = proj.unproject(at)
      dispatch({ type: "click", hits, at })
    }
    let frame = 0
    let last: Point | null = null
    const onMove = (event: { point: { x: number; y: number } }) => {
      last = { x: event.point.x, y: event.point.y }
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (!last) return
        const over = runsNear(indexRef.current, last, proj).length > 0
        map.getCanvas().style.cursor = over ? "pointer" : ""
      })
    }
    const onPan = () => setTick((t) => t + 1)
    map.on("click", onClick)
    map.on("mousemove", onMove)
    map.on("move", onPan)
    return () => {
      map.off("click", onClick)
      map.off("mousemove", onMove)
      map.off("move", onPan)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [map])

  // `Esc` dismisses (§4.4).
  useEffect(() => {
    if (state.kind === "idle") return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dispatch({ type: "dismiss" })
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [state.kind])

  const selected = selectedRun(state)
  useEffect(() => {
    onSelect(selected)
  }, [onSelect, selected])

  const shown = state.kind === "chip" ? [state.run] : state.kind === "card" ? state.runs : []
  const facts = useFacts(shown)
  const thisYear = new Date().getFullYear()

  let popup: React.ReactNode = null
  if (map && state.kind !== "idle" && anchor.current) {
    const rect = map.getContainer().getBoundingClientRect()
    const p = map.project(anchor.current)
    const pane = { width: rect.width, height: rect.height }
    if (state.kind === "chip") {
      const place = placeBox(p, CHIP_HEIGHT_PX, CARD_WIDTH_PX, pane)
      popup = (
        <Link
          href={runHref(state.run.activityId)}
          className="route-chip"
          data-testid="route-chip"
          style={{ left: rect.left + place.left, top: rect.top + place.top, maxWidth: CARD_WIDTH_PX }}
        >
          {runLine(state.run, facts.get(state.run.activityId), thisYear)}
        </Link>
      )
    } else {
      const place = placeBox(p, cardHeight(state.runs.length), CARD_WIDTH_PX, pane)
      popup = (
        <div
          className="route-card"
          data-testid="route-card"
          data-side={place.side}
          role="dialog"
          aria-label={cardHeading(state.runs.length)}
          style={{ left: rect.left + place.left, top: rect.top + place.top }}
        >
          <div className="route-card-head">{cardHeading(state.runs.length)}</div>
          <ul>
            {state.runs.map((run) => (
              <li key={run.activityId}>
                <Link href={runHref(run.activityId)}>{runLine(run, facts.get(run.activityId), thisYear)}</Link>
              </li>
            ))}
          </ul>
        </div>
      )
    }
  }

  const hasLatest = latest.features.length > 0
  return (
    <>
      <style>{MAP_CONTROLS_CSS}</style>
      <div className="map-controls" data-testid="map-controls">
        <button
          type="button"
          className="map-control"
          aria-label="Fit the whole territory"
          title="Fit the whole territory"
          disabled={!map || web.length === 0}
          onClick={() => map && fitTerritory(map, web)}
        >
          <span aria-hidden="true">⤢</span>
        </button>
        <button
          type="button"
          className="map-control"
          aria-label="Recentre on the last run"
          title="Recentre on the last run"
          disabled={!map || !hasLatest}
          onClick={() => map && recentre(map, latest)}
        >
          <span className="recentre-glyph" aria-hidden="true">⌖</span>
        </button>
      </div>
      {popup}
    </>
  )
}
