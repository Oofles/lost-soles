import { NextResponse, type NextRequest } from "next/server"

import { log } from "@/lib/log"
import { getOAuthClientCredentials } from "@/lib/sources/oauth-credentials"
import { consumeState } from "@/lib/sources/oauth-state-store"
import { putConnectedAccount } from "@/lib/sources/source-account-store"

import { callbackUri, NOT_FOUND, resolveRoute, settingsUrl } from "../shared"

/**
 * The callback. Ticket 0032, `03-integrations.md` §2.2 step 2.
 *
 * THIS ROUTE IS THE POINT OF THE TICKET, and the order of its checks is the design:
 *
 *   1. Owner and source, or 404.
 *   2. Consume the `state` nonce. Missing, unknown, expired or already used — refuse,
 *      WITHOUT exchanging anything. The nonce is also bound to a user and a source,
 *      and both must match the session.
 *   3. Judge the scope the provider put on the callback URL, still before any
 *      exchange. A refusal here means no credential is ever minted.
 *   4. Exchange, then judge the grant again. The callback parameter is a hint; the
 *      token response is the authority. If they disagree, the token that exists is
 *      revoked immediately rather than stored.
 *   5. Only then write the row.
 *
 * Step 3 is the one people skip, because asking for the right scope on the authorize
 * URL feels like enough. It is not: the consent screen lets the user untick a
 * permission and the provider will hand back a working token with less than was asked
 * for. That connection looks healthy and returns privacy-zone-truncated traces — a
 * permanent unexplored hole around home on a map that by D-020 never re-fogs. Failing
 * loudly at connect time is far cheaper than discovering it after fifty runs.
 */

/** SSR, never statically evaluated: this reads SSM, writes DynamoDB and calls a third party. */
export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ source: string }> },
) {
  const { source } = await params
  const ctx = await resolveRoute(source)
  if (ctx === null) return NOT_FOUND()

  const query = request.nextUrl.searchParams
  const settings = (connect: string) => settingsUrl({ connect, source: ctx.sourceId })

  try {
    /**
     * STEP 2 — the CSRF check, before anything else that costs something.
     *
     * A single-use delete, so a replayed callback finds nothing. The binding is
     * checked too: a nonce issued for one user or one source must not complete a
     * connect for another, which is what stops a stolen callback URL from attaching
     * someone else's account to this row. That matters more here than in most apps —
     * a foreign athlete's GPS written into a map that never re-fogs is permanent.
     */
    const claim = await consumeState(query.get("state"))
    if (claim === null || claim.userId !== ctx.userId || claim.sourceId !== ctx.sourceId) {
      log.warn("oauth callback rejected: state did not verify", { source: ctx.sourceId })
      return NextResponse.redirect(settings("failed"), 302)
    }

    /**
     * The provider says the user declined outright. Not an error to shout about — it
     * is a person changing their mind on a consent screen.
     */
    if (query.get("error") !== null) {
      return NextResponse.redirect(settings("denied"), 302)
    }

    /** STEP 3 — judge the scope BEFORE the exchange, so no token is ever minted. */
    const granted = ctx.connector.readCallbackScopes(query.get("scope"))
    if (!granted.check.ok) {
      log.warn("oauth callback refused: required scope missing", {
        source: ctx.sourceId,
        missing: granted.check.missing,
        granted: granted.scopes,
      })
      return NextResponse.redirect(settings("scope-refused"), 302)
    }

    const code = query.get("code")
    if (code === null || code.length === 0) {
      return NextResponse.redirect(settings("failed"), 302)
    }

    /** STEP 4 — exchange, then judge the authoritative scope list. */
    const credentials = await getOAuthClientCredentials(ctx.connector)
    /**
     * The verified callback scopes are carried in, and become the grant's scopes if
     * the token response does not restate them. Ticket 0165: reading an absent
     * `scope` as "nothing was granted" refused every good grant and revoked it.
     */
    const grant = await ctx.connector.exchangeCode({
      code,
      redirectUri: callbackUri(ctx.sourceId),
      credentials,
      grantedScopes: granted.scopes,
    })

    const check = ctx.connector.checkGrant(grant)
    if (!check.ok) {
      /**
       * The callback parameter and the token response disagreed. A live credential
       * now exists that must not be kept, so it is revoked here rather than left at
       * the provider — the row is never written, and there is nothing to clean up
       * later because nothing was stored.
       *
       * A revocation failure is logged and swallowed: the user's answer is the same
       * either way, and the token is unstored and unreachable regardless.
       */
      /**
       * WHAT WAS FOUND, not only what was missing. Ticket 0166: the first version
       * logged `missing` alone, so two very different causes — a genuinely reduced
       * grant, and a scope list this code could not parse — produced an identical
       * line, and telling them apart cost the operator a second failed connect.
       *
       * Scope names are not credentials; there is nothing here to redact.
       */
      log.warn("oauth grant refused after exchange: required scope missing", {
        source: ctx.sourceId,
        missing: check.missing,
        granted: grant.scopes,
        scopeSource: grant.scopeSource,
      })
      try {
        await ctx.connector.revoke({ accessToken: grant.accessToken, credentials })
      } catch (revokeErr) {
        log.error("could not revoke the refused grant", { source: ctx.sourceId }, revokeErr)
      }
      return NextResponse.redirect(settings("scope-refused"), 302)
    }

    /** STEP 5 — and only now. `expiresAt` and `scopes` come from the response. */
    await putConnectedAccount({
      userId: ctx.userId,
      sourceId: ctx.sourceId,
      externalOwnerId: grant.externalOwnerId,
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken,
      expiresAt: grant.expiresAt,
      scopes: grant.scopes,
    })

    /**
     * `scopeSource` is logged because it is the evidence that settles what the
     * provider actually does, and `03-integrations.md` §2.2 step 3 is annotated as
     * unverified until a real connect prints it (ticket 0165).
     */
    log.info("source connected", {
      source: ctx.sourceId,
      externalOwnerId: grant.externalOwnerId,
      scopes: grant.scopes,
      scopeSource: grant.scopeSource,
    })

    return NextResponse.redirect(settings("connected"), 302)
  } catch (err) {
    /**
     * Anything unexpected — SSM, DynamoDB, a malformed token response, the provider
     * returning a 500. Nothing has been stored on this path: the write is the last
     * statement in the try, so a failure before it leaves no partial connection.
     */
    log.error("oauth callback failed", { source: ctx.sourceId }, err)
    return NextResponse.redirect(settings("failed"), 302)
  }
}
