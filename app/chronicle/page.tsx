import { Stub } from "@/components/stub"

// §1.3 — a SHEET over the map dragged up from the plinth, not a page. The only way
// back to a past run's /run/:id, and the only place lifetime totals live (there is
// deliberately no stats page — §1.4).
export default function Chronicle() {
  return (
    <Stub
      route="/chronicle"
      becomes="Chronicle (run list)"
      note="Renders as a SHEET over the map, dragged up from the plinth — a route only so back and deep links behave. Lifetime totals live at its top; there is no stats page (§1.4)."
    />
  )
}
