import { FogSpike } from "@/components/map/fog-spike"

/**
 * THROWAWAY ROUTE. Ticket `0118`, deleted at its close.
 *
 * ─── WHY IT IS A ROUTE ON `main` AND NOT THE "THROWAWAY BRANCH" THE TICKET ASKS FOR ───
 *
 * The ticket predates nothing — D-150 has always said `main` is the only branch — but it
 * says "a throwaway branch", and the two cannot both hold. The deciding fact is that the
 * spike has to reach a browser on a real GPU to answer anything at all, and the only
 * thing that serves this app to a browser is an Amplify deploy from `main`. A throwaway
 * Amplify branch means a branch, its own env-var setup and its own backend deploy, to
 * answer one question for one afternoon.
 *
 * So: a route, under `/dev/*` where `0092`'s owner-only tooling already lives, which
 * `middleware.ts` auth-gates like every other non-`/` route. Criterion 1 is amended to
 * "throwaway route, removed at close" and the Resolution records it.
 *
 * `app/routes.test.ts` asserts the nine segments of §1.2's screen map exist and that six
 * named refused screens do not. A tenth dev segment trips neither, which is correct —
 * `/dev/tickets` is already one.
 */
export default function FogSpikePage() {
  return <FogSpike />
}
