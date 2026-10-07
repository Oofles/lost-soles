import type { ReactNode } from "react"

import { SkillsShell } from "./skills-page"

// §5 — Runescape's skills tab is the explicitly-loved model (D-030). Must survive an unbounded
// number of workout types (D-031) without becoming a wall.
//
// THE PANEL LIVES HERE, not in `page.tsx` (0074): `/skills/:skillId` is a sheet OVER it (§5.5),
// so it must stay mounted while the sheet's route is current.
//
// STATIC ON PURPOSE, like `/log` (D-282): no session read and no data here, so Next prerenders
// it and it renders from the bundled registry plus the IndexedDB cache with the network off.
export default function SkillsLayout({ children }: { children: ReactNode }) {
  return <SkillsShell>{children}</SkillsShell>
}
