import type { CSSProperties } from "react"

/**
 * Text for a screen reader and nobody else (`0112`, 06 §9.4). The standard clip pattern: in the
 * accessibility tree, out of layout, never `display: none` (which would take it out of both).
 */
export const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
}
