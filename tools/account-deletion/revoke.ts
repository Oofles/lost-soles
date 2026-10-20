import { getOAuthClientCredentials } from "../../lib/sources/oauth-credentials"
import { readAccessTokenForRevocation } from "../../lib/sources/source-account-store"
import { connectableSources, getOAuthConnector } from "../../src/adapters/registry"
import type { OAuthClientCredentials, OAuthConnector } from "../../src/adapters/types"
import type { RevokeOutcome } from "./deletion"

/**
 * STEP 1 — REVOKE UPSTREAM, for every connectable source. Ticket `0106`, `08` §6.4 step 1.
 *
 * Through the same connector `revoke` as `/settings`' disconnect (`0089`), so the two cannot come to
 * disagree about what revoking means: today that is Strava's `POST /oauth/revoke` with HTTP Basic
 * client credentials, which superseded the legacy `/oauth/deauthorize` named in the design text and
 * treats a 401 (a token already dead) as done.
 *
 * NO TOKEN IS A RECORDED NO-OP, NOT A FAILURE (D-348). No row, a `DISCONNECTED` row, or a
 * `NEEDS_REAUTH` row all read back as `null`: there is no live credential for the third party to
 * use, so there is nothing to revoke. A throwaway account that never connected Strava lands here.
 * Any other failure throws, and the run aborts BEFORE step 2 — never delete the tokens while a live
 * grant may remain at the provider.
 */
export interface RevokeDeps {
  sources(): string[]
  readToken(userId: string, source: string): Promise<string | null>
  connector(source: string): Pick<OAuthConnector, "revoke">
  credentials(source: string): Promise<OAuthClientCredentials>
}

export const defaultRevokeDeps: RevokeDeps = {
  sources: () => connectableSources(),
  readToken: (userId, source) => readAccessTokenForRevocation(userId, source),
  connector: (source) => getOAuthConnector(source as never),
  credentials: (source) => getOAuthClientCredentials(getOAuthConnector(source as never)),
}

export async function revokeAllSources(userId: string, deps: RevokeDeps = defaultRevokeDeps): Promise<RevokeOutcome[]> {
  const out: RevokeOutcome[] = []
  for (const source of deps.sources()) {
    const accessToken = await deps.readToken(userId, source)
    if (accessToken === null) {
      out.push({ source, outcome: "no-connection" })
      continue
    }
    await deps.connector(source).revoke({ accessToken, credentials: await deps.credentials(source) })
    out.push({ source, outcome: "revoked" })
  }
  return out
}
