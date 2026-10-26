"use client"

import { useEffect, useState } from "react"

import { log } from "@/lib/log"
import { documentTraceColor, setTraceK, setTraceWeb, type TraceHost } from "@/lib/trace-web/layer"
import { buildWebOffThread } from "@/lib/trace-web/off-thread"
import { webSource } from "@/lib/trace-web/runs"
import { EMPTY_WEB, type WebFeatureCollection } from "@/lib/trace-web/web"

import { useExplored } from "./explored-provider"

/**
 * THE PERMANENT TRACE LAYER, ON THE MAP. Ticket `0085`, D-299. `06-ui-ux.md` §3.5 rule 2.
 *
 * Fetched on mount and again on every explored generation, like the latest run (`use-latest-run`
 * says why the generation is the trigger). Built once per fetch, never per frame — and, since `0259`,
 * in a worker (`lib/trace-web/off-thread.ts`), so five years of routes is not a stalled map. A failed
 * fetch is a map with no web, logged, never thrown: the web is a record, and the map works without it.
 *
 * `0101`. `k` is the settled opacity factor: 1 on `/`, `RUN_PAGE_TRACE_K` on `/run/:id`, where the web
 * dims beneath the selected run (`06` §4.5). Set on the map before the web is drawn, so beat 1 and
 * the steady layer read the same number (`setTraceK`).
 */
export function useTraceWeb(map: (TraceHost & { triggerRepaint(): void }) | null, k = 1): void {
  const { generation } = useExplored()
  const [web, setWeb] = useState<WebFeatureCollection>(EMPTY_WEB)

  useEffect(() => {
    let cancelled = false
    webSource(generation)
      .then(
        (source) => buildWebOffThread(source),
        (error: unknown) => {
          log.error("trace web: fetch failed", error)
          return null
        },
      )
      .then((built) => {
        if (built && !cancelled) setWeb(built)
      })
    return () => {
      cancelled = true
    }
  }, [generation])

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
