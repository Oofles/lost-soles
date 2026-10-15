import type { CSSProperties } from "react"

/**
 * Shared between the server page and the client controls. A plain module, not the
 * "use client" one: a non-component export of a client module reaches a server
 * component as a client reference, not as the object.
 */
export const button: CSSProperties = {
  display: "inline-block",
  minHeight: "2rem",
  padding: ".5rem 1rem",
  borderRadius: ".375rem",
  border: "1px solid var(--accent)",
  background: "transparent",
  color: "var(--accent-text)",
  font: "inherit",
  cursor: "pointer",
  textDecoration: "none",
}
