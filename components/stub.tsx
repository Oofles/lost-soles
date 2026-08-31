import type { ReactNode } from "react"

/**
 * A route stub (ticket 0016). Every route in 06-ui-ux.md §1.2 exists and is
 * reachable from day one, so nothing later has to introduce a route — only fill
 * one in. Each says what it will become, because a blank page is indistinguishable
 * from a broken one.
 *
 * Deliberately near-unstyled: 09-roadmap.md §2.3 puts this milestone at "unstyled
 * chrome — the token system is DEFINED but applied only to the map and one
 * button". These reference semantic tokens only; no raw colour appears here, and
 * scripts/check-design-tokens.mjs enforces that.
 */
export function Stub({
  route,
  becomes,
  note,
}: {
  route: string
  becomes: string
  note?: ReactNode
}) {
  return (
    <main style={{ padding: "1.5rem", maxWidth: "40rem" }}>
      <p style={{ color: "var(--text-muted)", fontFamily: "monospace", margin: 0 }}>{route}</p>
      <h1 style={{ color: "var(--text-primary)", marginTop: ".25rem" }}>{becomes}</h1>
      {note ? <p style={{ color: "var(--text-secondary)" }}>{note}</p> : null}
      <p style={{ color: "var(--text-muted)", fontSize: ".875rem" }}>
        Stub — this route exists so navigation, deep links and the Android back
        button behave correctly before the screen is built.
      </p>
    </main>
  )
}
