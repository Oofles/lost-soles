import { Stub } from "@/components/stub"

// §5 — Runescape's skills tab is the explicitly-loved model (D-030). Must survive
// an unbounded number of workout types (D-031) without becoming a wall.
export default function Skills() {
  return <Stub route="/skills" becomes="Skills panel" note="Every session moves a named number, and this is where those names live." />
}
