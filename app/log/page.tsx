import { Stub } from "@/components/stub"

// §6, D-061 verbatim: an "Add workout" BUTTON, not per-exercise buttons, opening a
// DEDICATED PAGE. Exists because no API on earth exposes reps (D-060).
export default function Log() {
  return <Stub route="/log" becomes="Add workout" note="One row per type, one tap to log. Used standing in a hallway, breathing hard, one-handed (§6.2)." />
}
