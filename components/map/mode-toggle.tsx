"use client"

import { useEffect, useState } from "react"

import { isModeShortcut, mapModeStore, type MapMode } from "@/lib/map-mode"

import { useMapMode } from "./use-map-mode"

/**
 * THE MODE TOGGLE. Ticket `0098`, `06` §4.2, D-052, D-253.
 *
 * A two-state segmented control with BOTH labels always visible — never an icon, never one button
 * whose label might be the state or the destination. Top-left of the map pane, 16px insets: it is a
 * state display first, and the top-left is where the question "what am I looking at?" is asked.
 *
 * The second path is the keyboard: `M`, anywhere on the page this is shown on, except in a text
 * field (`isModeShortcut`). A plain click on the map does nothing — this control is the only
 * pointer path (06 §4.4).
 *
 * D-148: OPAQUE, like all floating chrome, because the surface under it swings from parchment to
 * near-black fog within one screen. Gold is the selected row's FILL, never text.
 *
 * Rendered with neither row selected until the client knows the saved mode: the server cannot
 * (05 §5.3 — it is per device), and a flash of the wrong selection is a lie about the state.
 */

const ROWS: ReadonlyArray<{ mode: MapMode; label: string }> = [
  { mode: "atlas", label: "Atlas" },
  { mode: "adventure", label: "Adventure" },
]

/**
 * 1024px is `06` §2's breakpoint: above it the map pane starts where the plinth's 24rem rail ends
 * (`PLINTH_CSS`), so the toggle sits 16px inside the PANE, not the window.
 */
export const MODE_TOGGLE_CSS =
  ".mode-toggle { position: fixed; z-index: 1; top: 16px; left: 16px; display: flex; flex-direction: column;" +
  " width: 112px; box-sizing: border-box; background: var(--surface-raised); border: 1px solid var(--line);" +
  " border-radius: 8px; overflow: hidden; font-family: var(--font-sans); }" +
  " .mode-toggle button { height: 32px; margin: 0; padding: 0 12px; border: 0; background: var(--surface-raised);" +
  " color: var(--text-secondary); font: 500 12px/1 var(--font-sans); letter-spacing: .08em; text-transform: uppercase;" +
  " text-align: center; cursor: pointer; }" +
  " .mode-toggle button + button { border-top: 1px solid var(--line); }" +
  " .mode-toggle button[aria-checked='true'] { background: var(--accent); color: var(--text-primary); }" +
  " .mode-toggle button:hover[aria-checked='false'] { background: var(--bg); }" +
  " .mode-toggle button:focus-visible { outline: 2px solid var(--text-primary); outline-offset: -2px; }" +
  " @media (min-width: 1024px) { .mode-toggle { left: calc(24rem + 16px); } }"

export function ModeToggle() {
  const mode = useMapMode()
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isModeShortcut(event)) return
      event.preventDefault()
      mapModeStore()?.toggle()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <>
      <style>{MODE_TOGGLE_CSS}</style>
      <div className="mode-toggle" role="radiogroup" aria-label="Map mode (M)" data-testid="mode-toggle">
        {ROWS.map((row) => (
          <button
            key={row.mode}
            type="button"
            role="radio"
            aria-checked={hydrated && mode === row.mode}
            aria-keyshortcuts="M"
            onClick={() => mapModeStore()?.set(row.mode)}
          >
            {row.label}
          </button>
        ))}
      </div>
    </>
  )
}
