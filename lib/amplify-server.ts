import { createServerRunner } from "@aws-amplify/adapter-nextjs"

import outputs from "@/amplify_outputs.json"

/**
 * The one Amplify server runner, shared by `middleware.ts` and by route handlers.
 * Ticket 0019.
 *
 * Extracted from `middleware.ts`, which created its own (ticket 0016). Two runners
 * would be two configurations that can drift, and the thing they configure is how a
 * session is read — `01-architecture.md` §5's complaint about the existing
 * devaultsecurity repo declaring its aliases twice, applied to something that
 * matters more than an alias.
 *
 * DELIBERATELY IMPORTS NOTHING BUT THE ADAPTER. `middleware.ts` runs in Next's edge
 * runtime, so anything reaching this module reaches the edge bundle. An AWS SDK
 * client imported here would break middleware at build time, and the failure would
 * point at middleware rather than at the import that caused it.
 */
export const { runWithAmplifyServerContext } = createServerRunner({ config: outputs })
