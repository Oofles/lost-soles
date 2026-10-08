import { Stub } from "@/components/stub"
import { currentUserId } from "@/lib/auth/owner"
import { defaultRunReadDeps, recentRuns } from "@/lib/runs/server"
import type { RunListItem } from "@/lib/runs/wire"

import { ChronicleLinks } from "./chronicle-links"
import { SeedHome } from "./seed-home"

// §1.3 — a SHEET over the map dragged up from the plinth, not a page. The only way
// back to a past run's /run/:id, and the only place lifetime totals live (there is
// deliberately no stats page — §1.4).
//
// Ticket 0078 adds ONLY the links to /run/:id — §3.1's "Chronicle → any past run" entry point,
// which opens the END STATE (no autoplay intent). The sheet, its totals and paging are 0088's.
export default async function Chronicle() {
  const uid = await currentUserId()
  const runs: RunListItem[] = uid ? await recentRuns(uid, defaultRunReadDeps()) : []

  return (
    <>
      <SeedHome />
      <Stub
        route="/chronicle"
        becomes="Chronicle (run list)"
        note="Renders as a SHEET over the map, dragged up from the plinth — a route only so back and deep links behave. Lifetime totals live at its top; there is no stats page (§1.4)."
      />
      <ChronicleLinks runs={runs} />
    </>
  )
}
