"use client"

import { useEffect } from "react"

import { browserHistoryHost, seedHomeBehind } from "@/lib/runs/history"

/**
 * `/chronicle` opened cold (typed, bookmarked) has nothing of the app behind it, and its run links
 * REPLACE it — so without this, back from a run left the site instead of landing on `/` (§3.3).
 * Same seed as a cold `/run/:id`; a soft navigation in from `/` is not cold and does nothing.
 */
export function SeedHome() {
  useEffect(() => {
    seedHomeBehind(browserHistoryHost())
  }, [])
  return null
}
