import { NextResponse, type NextRequest } from "next/server"

import { log } from "@/lib/log"
import { getOAuthClientCredentials } from "@/lib/sources/oauth-credentials"
import { issueState } from "@/lib/sources/oauth-state-store"

import { callbackUri, NOT_FOUND, resolveRoute, settingsUrl } from "../shared"

/**
 * Starts an OAuth connect. Ticket 0032, `03-integrations.md` §2.2 step 1.
 *
 * GET, because the browser arrives here by following a link and leaves by being
 * redirected to the provider. Nothing is written that a replay could damage: the only
 * side effect is a fresh single-use nonce, and issuing two is harmless — the second
 * connect simply consumes the second one.
 *
 * `?force=1` asks the provider for a fresh consent screen instead of silently
 * re-issuing the previous grant. That is what the re-authorize button on a scope
 * refusal sends, and without it the provider re-approves the same reduced grant
 * without ever showing the user the box they need to tick.
 *
 * NO `export async function POST/PUT/PATCH/DELETE`. Their absence is the control,
 * exactly as in the capture route: a file exporting only GET returns 405 for
 * everything else by construction.
 */

/** SSR, never statically evaluated: this reads SSM and writes DynamoDB. */
export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ source: string }> },
) {
  const { source } = await params
  const ctx = await resolveRoute(source)
  if (ctx === null) return NOT_FOUND()

  const force = request.nextUrl.searchParams.get("force") === "1"

  try {
    const credentials = await getOAuthClientCredentials(ctx.connector)
    const { state } = await issueState({ userId: ctx.userId, sourceId: ctx.sourceId })

    const authorizeUrl = ctx.connector.authorizeUrl({
      clientId: credentials.clientId,
      redirectUri: callbackUri(ctx.sourceId),
      state,
      force,
    })

    /**
     * 302, not 307. The browser is starting a new navigation to a third party, and
     * there is no method or body to preserve.
     */
    return NextResponse.redirect(authorizeUrl, 302)
  } catch (err) {
    /**
     * SSM unreachable, or DynamoDB unable to record the nonce. Fail closed: without a
     * stored nonce there is no CSRF check on the callback, and a connect that skipped
     * it would be worse than one that did not happen.
     *
     * `log` redacts credential shapes before anything reaches CloudWatch.
     */
    log.error("oauth start failed", { source: ctx.sourceId }, err)
    return NextResponse.redirect(settingsUrl({ connect: "failed", source: ctx.sourceId }), 302)
  }
}
