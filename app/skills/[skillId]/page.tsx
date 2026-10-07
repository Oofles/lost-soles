import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"
import type { RuleSet } from "@/src/rules/schema"

import { SkillSheetRoute } from "../skill-sheet-route"

// §5.5 — a SHEET over the skills panel, not a page. It is a route only so back and deep links
// behave (§1.5); the panel under it is `../layout.tsx`'s.
//
// STATIC, like `/skills` (D-282): every registry skill is prerendered, so a tile's link is
// prefetched and the sheet opens with the network off. An id no ruleset knows still renders —
// on demand — and the sheet says so instead of crashing.
export function generateStaticParams() {
  const ids = new Set((Object.values(BUNDLED_RULES) as RuleSet[]).flatMap((r) => r.skills.map((s) => s.id)))
  return [...ids].map((skillId) => ({ skillId }))
}

export default async function SkillDetail({ params }: { params: Promise<{ skillId: string }> }) {
  const { skillId } = await params
  return <SkillSheetRoute skillId={skillId} />
}
