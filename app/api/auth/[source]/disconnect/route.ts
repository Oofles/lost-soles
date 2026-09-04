import { NextResponse, type NextRequest } from "next/server"

import { APP_ORIGIN } from "@/lib/app-origin"
import { log } from "@/lib/log"
import { getOAuthClientCredentials } from "@/lib/sources/oauth-credentials"
import { markDisconnected, readAccessTokenForRevocation } from "@/lib/sources/source-account-store"

import { NOT_FOUND, resolveRoute, settingsUrl } from "../shared"

/**
 * Disconnect. Ticket 0032 criterion 7; `02-data-model.md` §7 and
 * `08-security-privacy.md` §6.5.
 *
 * REVOKE FIRST, THEN TEAR DOWN THE ROW. The order is the whole of it: marking the row
 * dead while a live token remains at the provider produces a credential nobody in
 * this system can see and nobody will ever revoke. So a revocation failure aborts,
 * loudly, with the row untouched and the connection still visibly connected — which
 * is honest, because it still is.
 *
 * DISCONNECTING IS NOT DELETING AN ACCOUNT (§6.5). The map, the ledger and the raw
 * archive are untouched. Conflating the two is how someone destroys years of data
 * while trying to stop a sync. The row itself survives with its tokens REMOVED — the
 * history of the connection is not a credential.
 *
 * POST, not GET, and that is not decoration: a GET that revokes a credential is one
 * `<img>` tag away from being fired by any page the operator visits.
 */

/** SSR, never statically evaluated. */
export const dynamic = "force-dynamic"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ source: string }> },
) {
  const { source } = await params
  const ctx = await resolveRoute(source)
  if (ctx === null) return NOT_FOUND()

  /**
   * CSRF. The settings form is same-origin, so the browser sends `Origin` on the
   * POST; a cross-site form post carries a different one. Absent is refused rather
   * than allowed — a request with no `Origin` is not a request proven to be ours.
   *
   * This is a state-changing POST reached from a page, which is the one shape the
   * capture endpoint's CORS headers do not defend: CORS governs what a script may
   * READ, and a form post does not need to read the answer to have done the damage.
   */
  if (request.headers.get("origin") !== APP_ORIGIN) {
    log.warn("disconnect rejected: origin did not match", { source: ctx.sourceId })
    return NOT_FOUND()
  }

  try {
    const accessToken = await readAccessTokenForRevocation(ctx.userId, ctx.sourceId)

    if (accessToken !== null) {
      const credentials = await getOAuthClientCredentials(ctx.connector)
      await ctx.connector.revoke({ accessToken, credentials })
    }

    await markDisconnected({ userId: ctx.userId, sourceId: ctx.sourceId })
    log.info("source disconnected", { source: ctx.sourceId })

    /**
     * 303, so the browser follows with a GET. A 302 after a POST is permitted to
     * re-issue the POST, which here would mean a second revocation attempt.
     */
    return NextResponse.redirect(settingsUrl({ connect: "disconnected", source: ctx.sourceId }), 303)
  } catch (err) {
    log.error("disconnect failed", { source: ctx.sourceId }, err)
    return NextResponse.redirect(
      settingsUrl({ connect: "disconnect-failed", source: ctx.sourceId }),
      303,
    )
  }
}
