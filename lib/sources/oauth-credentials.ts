import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm"

import type { OAuthClientCredentials, OAuthConnector } from "@/src/adapters/types"

/**
 * Loads a source's OAuth client credentials from SSM. Ticket 0032.
 *
 * WHY SSM AND NOT AN ENVIRONMENT VARIABLE — the standing rule from 0017/D-166.
 * Amplify renders environment variables in plaintext into build artifacts, readable
 * by anyone with `get-app` on the app (`01-architecture.md` §7). A client secret that
 * can mint tokens against the operator's account must never be one of those.
 *
 * WHY THE CLIENT SECRET NEVER REACHES A BROWSER, structurally rather than by care:
 * this module is server-only (it imports the AWS SDK and is imported only by route
 * handlers, which Next never bundles for the client), and no value read here is ever
 * returned to a caller that renders. `scripts/check-bundle-leak.mjs` scans the built
 * output for the shapes anyway — ticket 0032 criterion 6 — because "never" holds
 * until someone adds an import.
 *
 * The path PREFIX is the app's and lives here; the LEAF names are the vendor's and
 * live on the connector (`OAuthConnector.credentialParameters`). That split is what
 * keeps this file free of any source's name, which is what lets it live in `lib/`.
 */

/**
 * The shared Amplify secret path — the same prefix `lib/tickets/github.ts` reads its
 * PAT from, and the one `secret()` writes to. Hard-coded for the reason recorded
 * there: the SSR compute has no CloudFormation output to read a path from.
 */
const PARAMETER_PREFIX = "/amplify/shared/d14fhvl4rp79nn/"

/**
 * Cached per source for the life of the execution environment, so only a cold start
 * pays the SSM calls.
 *
 * The cached value is a PROMISE, not a resolved object: two concurrent cold requests
 * would otherwise each fire their own pair of SSM calls. Caching the promise makes
 * the second one await the first.
 */
const cache = new Map<string, Promise<OAuthClientCredentials>>()

/** Exported for tests only. */
export function __resetCredentialCache(): void {
  cache.clear()
}

async function readParameter(client: SSMClient, leaf: string): Promise<string> {
  const name = `${PARAMETER_PREFIX}${leaf}`
  const res = await client.send(new GetParameterCommand({ Name: name, WithDecryption: true }))
  const value = res.Parameter?.Value

  // The name is safe to put in an error; the value is not, and is not touched here.
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`SSM parameter ${name} is missing or empty`)
  }
  return value
}

export function getOAuthClientCredentials(
  connector: OAuthConnector,
  client: SSMClient = new SSMClient({}),
): Promise<OAuthClientCredentials> {
  const key = connector.source
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const pending = (async () => {
    const [clientId, clientSecret] = await Promise.all([
      readParameter(client, connector.credentialParameters.clientId),
      readParameter(client, connector.credentialParameters.clientSecret),
    ])
    return { clientId, clientSecret }
  })().catch((err: unknown) => {
    // Do not cache a failure: a transient SSM error would otherwise poison this
    // execution environment until it is recycled. Same rule as `github.ts`.
    cache.delete(key)
    throw err
  })

  cache.set(key, pending)
  return pending
}
