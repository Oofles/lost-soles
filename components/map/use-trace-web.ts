"use client"

import { useEffect, useMemo, useState } from "react"

import { log } from "@/lib/log"
import { documentTraceColor, setTraceK, setTraceWeb, type TraceHost } from "@/lib/trace-web/layer"
import { webRuns } from "@/lib/trace-web/runs"
import { buildWeb, EMPTY_WEB, type WebRunInput } from "@/lib/trace-web/web"

import { useExplored } from "./explored-provider"

/**
 * THE PERMANENT TRACE LAYER, ON THE MAP. Ticket `0085`, D-299. `06-ui-ux.md` §3.5 rule 2.
 *
 * Fetched on mount and again on every explored generation, like the latest run (`use-latest-run`
 * says why the generation is the trigger). Built once per fetch, never per frame. A failed fetch is
 * a map with no web, logged, never thrown: the web is a record, and the map works without it.
 *
 * `0101`. `k` is the settled opacity factor: 1 on `/`, `RUN_PAGE_TRACE_K` on `/run/:id`, where the web
 * dims beneath the selected run (`06` §4.5). Set on the map before the web is drawn, so beat 1 and
 * the steady layer read the same number (`setTraceK`).
 */
export function useTraceWeb(map: (TraceHost & { triggerRepaint(): void }) | null, k = 1): void {
  const { generation } = useExplored()
  const [runs, setRuns] = useState<WebRunInput[] | null>(null)

  useEffect(() => {
    let cancelled = false
    webRuns(generation).then(
      (r) => {
        if (!cancelled) setRuns(r)
      },
      (error) => log.error("trace web: fetch failed", error),
    )
    return () => {
      cancelled = true
    }
  }, [generation])

  const web = useMemo(() => (runs ? buildWeb(runs) : EMPTY_WEB), [runs])

  useEffect(() => {
    if (!map) return
    try {
      setTraceK(map, k)
      map.triggerRepaint()
    } catch (error) {
      log.error("trace web: could not set its opacity", error)
    }
  }, [map, k])

  useEffect(() => {
    if (!map) return
    try {
      setTraceWeb(map, web, documentTraceColor())
      map.triggerRepaint()
    } catch (error) {
      log.error("trace web: could not draw", error)
    }
  }, [map, web])
}
