import { existsSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * The screen map is a contract (06-ui-ux.md §1.2, ticket 0016).
 *
 * "Seven routes" is a stated design position, not an accident — §1.4 lists the
 * screens deliberately REFUSED (no stats page, no profile, no badge gallery, no
 * calendar heatmap, no onboarding) and §10 lists what is deliberately not built.
 * This test fails if a route disappears OR if one quietly appears, because the
 * second is how a refused screen gets built by increments.
 */
const ROOT = join(import.meta.dirname, "..")

/**
 * The seven routes of §1.2, as their seven App Router segments. Nine until D-252 withdrew the
 * in-app ticket UI: `0216` deleted the two `/dev/tickets` stub segments, so a route for a
 * feature that will never be built is no longer pinned here as though it were intended.
 */
const SCREEN_MAP = [
  "app/(home)/page.tsx",               // /                      map + plinth (home)
  "app/skills/page.tsx",               // /skills                skills panel
  "app/skills/[skillId]/page.tsx",     // /skills/:skillId       skill detail (dialog ≥1024px, sheet below)
  "app/log/page.tsx",                  // /log                   add workout (D-061)
  "app/(home)/chronicle/page.tsx",     // /chronicle             panel in the rail's column
  "app/run/[activityId]/page.tsx",     // /run/:activityId       the post-run moment
  "app/settings/page.tsx",             // /settings              small and boring
]

describe("the §1.2 screen map", () => {
  it.each(SCREEN_MAP)("%s exists", (rel) => {
    expect(existsSync(join(ROOT, rel)), `${rel} is in the screen map but not on disk`).toBe(true)
  })

  it("has exactly seven segments — no route added without a design decision", () => {
    expect(SCREEN_MAP).toHaveLength(7)
  })

  it("does not contain a screen §1.4 explicitly refused", () => {
    // Named rather than inferred, so the failure message teaches rather than just fails.
    const REFUSED = {
      "app/stats/page.tsx": "a stats/dashboard page — cumulative numbers live on the plinth alone (D-329)",
      "app/dashboard/page.tsx": "a stats/dashboard page — P5 rules out progress that only exists in one",
      "app/profile/page.tsx": "a profile page — there is one user (P9); a profile is a social organ",
      "app/achievements/page.tsx": "a badge gallery — milestones are placed on the MAP as landmarks",
      "app/calendar/page.tsx": "a calendar/heatmap — a streak visualisation in disguise (H2)",
      "app/onboarding/page.tsx": "an onboarding flow — the first reveal IS the onboarding",
    }
    for (const [rel, why] of Object.entries(REFUSED)) {
      expect(existsSync(join(ROOT, rel)), `${rel} exists, but §1.4 refuses ${why}`).toBe(false)
    }
  })
})
