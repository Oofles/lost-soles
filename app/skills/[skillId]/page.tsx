import { Stub } from "@/components/stub"

// §5.5 — this is a SHEET over the skills panel, not a full page. It is a route
// only so the Android back button and deep links behave (§1.2). Stubbed as a page
// because that is simpler today; do NOT enshrine page presentation when building it.
export default async function SkillDetail({ params }: { params: Promise<{ skillId: string }> }) {
  const { skillId } = await params
  return (
    <Stub
      route={`/skills/${skillId}`}
      becomes="Skill detail"
      note="Renders as a SHEET over the skills panel, not a page — it is a route only so back and deep links behave (§5.5)."
    />
  )
}
