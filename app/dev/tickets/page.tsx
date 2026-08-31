import { Stub } from "@/components/stub"

// §7, D-090 + D-092 — required from day one. Phone-friendly capture, so the idea
// you had at the end of a run is not lost. Owner-only; with one user (P9) that is
// the same as authenticated, and it stays owner-only when that stops being true.
export default function DevTickets() {
  return <Stub route="/dev/tickets" becomes="Tickets" note="Owner-only. Capture is a sheet over this list (§7.3); browse is read-only (§7.5)." />
}
