"use client"

import { useSyncExternalStore } from "react"

import { DEFAULT_MAP_MODE, mapModeStore, type MapMode } from "@/lib/map-mode"

const noop = () => () => {}

/**
 * `0098`. The saved map mode, live. The server has no saved mode (it is per device, 05 §5.3), so it
 * renders the default; the client's first read is the stored one. Nothing the server renders
 * depends on the mode — the map is built in an effect, after this has its client value.
 */
export function useMapMode(): MapMode {
  const store = mapModeStore()
  return useSyncExternalStore(
    store ? store.subscribe : noop,
    () => store?.get() ?? DEFAULT_MAP_MODE,
    () => DEFAULT_MAP_MODE,
  )
}
