import type { GrantCheck, OAuthConnector, OAuthGrant } from "../types"

/**
 * The Strava OAuth handshake. Ticket 0032. `03-integrations.md` §2.2.
 *
 * THE ONE THING THIS FILE EXISTS FOR is the scope check on the CALLBACK, and it is
 * worth stating plainly because the authorize URL asking for the right scope feels
 * like enough and is not.
 *
 * `activity:read_all` is required (D-121 mitigation 3). With the lesser scope Strava
 * truncates every trace at the boundary of a privacy zone — typically home and work
 * — so the start and end of nearly every run is silently missing. On a fog-of-war map
 * that is a permanent unexplored donut exactly where the operator lives, on a map
 * that by D-020 never re-fogs. There is no repair short of re-ingesting from another
 * source. It is also the only scope that returns "Only You" activities at all, and it
 * is required to receive webhook events for them (§2.3).
 *
 * The consent screen lets the user untick that permission, and Strava will hand back
 * a working token with less than was asked for. The connection then looks healthy and
 * quietly returns degraded data. Failing loudly at connect time is far cheaper than
 * discovering the donut after fifty runs, because by then it is permanent.
 *
 * PURITY. `authorizeUrl`, `checkCallbackScopes` and `checkGrant` are pure — no clock,
 * no randomness, no network. The nonce is generated and stored by the caller and
 * passed in. That is not decoration: it is what makes the refusal path testable
 * without a single stub.
 */

const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize"
const TOKEN_URL = "https://www.strava.com/oauth/token"
const REVOKE_URL = "https://www.strava.com/oauth/revoke"

/**
 * The scope, and the only place it is spelled. Ticket 0032 criterion 1 greps this
 * directory for the lesser scope; keeping exactly one literal is what makes that grep
 * meaningful rather than a formality.
 */
const READ_ALL = "activity:read_all"

/**
 * What the user is told when the grant comes back short. Written to be read outdoors,
 * after a run, on a phone — which is where it will actually be read. It names the
 * consequence rather than the mechanism, because "scope" is not a word that explains
 * anything to the person standing there.
 */
const SCOPE_CONSEQUENCE =
  "Without permission to see all your activities, Strava hides the start and end of " +
  "every run near your home and work. The map will have a permanent hole around home " +
  "— it can never be filled in later, because the map never re-fogs."

/**
 * Splits a scope list on COMMAS OR WHITESPACE. Ticket 0166.
 *
 * This split on commas alone, because that is what Strava's callback query string
 * uses and the design doc only ever showed that form. The token response is a
 * different surface with a different convention: RFC 6749 §5.1 defines the token
 * endpoint's `scope` as SPACE-delimited, and a space-delimited list run through a
 * comma split comes back as ONE element — `"read activity:read_all"` — which matches
 * no required scope and therefore reads as a downgrade.
 *
 * The consequence was not a parse error. It was a fully-authorised connection being
 * refused and its credential revoked, which is the loudest possible failure produced
 * by the quietest possible cause.
 *
 * Accepting both is not leniency papering over an unknown: no scope token defined by
 * any of these grants contains a comma or a space, so the two separators cannot be
 * confused with content, and a parser that handles both is correct on either surface
 * rather than correct on the one it was tested against.
 */
function parseScopes(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function judge(scopes: readonly string[]): GrantCheck {
  const missing = [READ_ALL].filter((required) => !scopes.includes(required))
  return missing.length === 0 ? { ok: true } : { ok: false, missing, consequence: SCOPE_CONSEQUENCE }
}

/**
 * Thrown for any non-2xx or unparseable response from Strava's OAuth endpoints.
 *
 * The response BODY is not attached and not logged. An OAuth error body routinely
 * echoes the request back, which on the token endpoint means the client secret — so
 * the one place it would be most tempting to include for debugging is the one place
 * it must not be (O-005, `08-security-privacy.md` §7.4).
 */
export class StravaOAuthError extends Error {
  readonly status: number

  constructor(step: string, status: number) {
    super(`Strava ${step} failed with HTTP ${status}`)
    this.name = "StravaOAuthError"
    this.status = status
  }
}

/**
 * Strava's athlete id arrives as a JSON number. The contract requires a string
 * (§2), and the reason is not style: some sources' ids are int64 and `JSON.parse`
 * corrupts them past 2^53 without telling anyone.
 *
 * Strava's own ids are nowhere near that today, so this throws rather than silently
 * accepting a rounded value — the day it stops being true, the connection refuses to
 * be made instead of being made against the wrong athlete.
 */
function athleteIdToString(id: unknown): string {
  if (typeof id === "string" && /^\d+$/.test(id)) return id
  if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) return String(id)
  throw new Error("Strava returned an athlete id that cannot be represented exactly")
}

interface TokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  expires_at?: unknown
  scope?: unknown
  athlete?: { id?: unknown }
}

function grantFromTokenResponse(body: TokenResponse, grantedScopes: readonly string[]): OAuthGrant {
  const { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt } = body

  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("Strava token response carried no access token")
  }
  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    throw new Error("Strava token response carried no refresh token")
  }
  /**
   * Taken from the response and never from a constant. Strava's access tokens live
   * six hours today; a hardcoded six hours is correct right up to the day it is not,
   * and the failure mode is a dead token treated as live.
   */
  if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new Error("Strava token response carried no usable expires_at")
  }

  /**
   * TICKET 0165 — THE LINE THAT BROKE THE CONNECT FLOW, and what it now does.
   *
   * This read `scopes: typeof body.scope === "string" ? parseScopes(body.scope) : []`.
   * An absent field became an empty grant, `checkGrant` found the required scope
   * missing, and the route dutifully revoked a credential that was perfectly good.
   * Every test passed, because every fixture was built from `03-integrations.md`
   * §2.2 step 3's example response — which carries a `scope` key the live service
   * did not send. The suite proved the code matched the document.
   *
   * An absent `scope` is the provider DECLINING TO RESTATE what it already told us on
   * the callback, not a claim that nothing was granted. Those are opposite meanings
   * and only one of them is a refusal.
   *
   * What is deliberately NOT done: skipping the check when the field is present. If
   * the response does state a scope, it is believed over the callback and judged, so
   * a provider that downgrades a grant between the two is still caught. That is the
   * only thing this second check was ever able to catch, and it survives.
   */
  const statesItsOwnScope = typeof body.scope === "string" && body.scope.length > 0

  return {
    externalOwnerId: athleteIdToString(body.athlete?.id),
    accessToken,
    refreshToken,
    expiresAt,
    scopes: statesItsOwnScope ? parseScopes(body.scope as string) : [...grantedScopes],
    scopeSource: statesItsOwnScope ? "response" : "callback",
  }
}

export const stravaOAuth: OAuthConnector = {
  source: "strava",

  displayName: "Strava",

  requiredScopes: [READ_ALL],

  scopeConsequence: SCOPE_CONSEQUENCE,

  /**
   * SSM leaf names. The path prefix belongs to the app and lives with the loader;
   * these belong to the vendor and live here. Both are already provisioned — 0017
   * put them under the shared Amplify secret path.
   */
  credentialParameters: {
    clientId: "STRAVA_CLIENT_ID",
    clientSecret: "STRAVA_CLIENT_SECRET",
  },

  authorizeUrl({ clientId, redirectUri, state, force }) {
    const url = new URL(AUTHORIZE_URL)
    url.searchParams.set("client_id", clientId)
    /**
     * The HOST of this URI must match the "Authorization Callback Domain" in the
     * Strava app settings — a bare domain, no scheme, no path, no port. `localhost`
     * is accepted only as a separate value and an app cannot hold both at once, so
     * local development uses a second throwaway app rather than flipping this one.
     */
    url.searchParams.set("redirect_uri", redirectUri)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("scope", READ_ALL)
    url.searchParams.set("state", state)
    /**
     * `auto` re-uses an existing approval silently, which is the right default and
     * the wrong one after a refusal: the user needs the consent screen back to tick
     * the box they unticked. `force` is what the re-authorize button sends.
     */
    url.searchParams.set("approval_prompt", force ? "force" : "auto")
    return url.toString()
  },

  readCallbackScopes(rawScope) {
    // No scope parameter at all is a refusal, not an unknown. Strava always sends one
    // on a successful authorization, and treating "absent" as "probably fine" is the
    // shape of every fail-open bug.
    //
    // Note this is the OPPOSITE reading from the token response's absent `scope`
    // (see `grantFromTokenResponse`), and deliberately so. Here nothing has been said
    // yet, so silence is a refusal. There, the callback has already spoken, so silence
    // is the provider not repeating itself.
    const scopes = rawScope === null ? [] : parseScopes(rawScope)
    return { scopes, check: judge(scopes) }
  },

  async exchangeCode({ code, redirectUri, credentials, grantedScopes }) {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        grant_type: "authorization_code",
        // Strava does not require it here, but sending it makes the exchange fail
        // loudly if the two halves of the handshake ever disagree about the callback.
        redirect_uri: redirectUri,
      }),
    })

    if (!res.ok) throw new StravaOAuthError("code exchange", res.status)

    return grantFromTokenResponse((await res.json()) as TokenResponse, grantedScopes)
  },

  checkGrant(grant) {
    return judge(grant.scopes)
  },

  async revoke({ accessToken, credentials }) {
    /**
     * HTTP Basic with the client credentials, recommended since 2026-06-01. The
     * legacy `POST /oauth/deauthorize` with the access token still exists; this is
     * the current form and the one the docs point at.
     */
    const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")

    const res = await fetch(REVOKE_URL, {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({ token: accessToken }),
    })

    /**
     * 401 is treated as success, deliberately. It is what Strava returns for a token
     * that is already dead — revoked earlier, or expired past recovery — and the
     * caller's goal is "this credential cannot be used", which is already true. Any
     * other failure throws, so that a row is never marked disconnected while a live
     * token remains at the provider.
     */
    if (!res.ok && res.status !== 401) throw new StravaOAuthError("revocation", res.status)
  },
}
