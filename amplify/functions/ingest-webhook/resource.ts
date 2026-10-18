import { defineFunction } from "@aws-amplify/backend"

/**
 * `ingest-webhook` — the push-subscription endpoint. Ticket 0091, `01-architecture.md` §2
 * ("Strava's 2-second deadline"), `08-security-privacy.md` §4.
 *
 * THE DESIGN CALLS IT `strava-webhook`, and the code calls it this for the same reason the OAuth
 * routes are `/api/sources/[source]/…` (D-194): a vendor name in `amplify/` is a D-100 boundary
 * hit, and the function never needed one. It reads its source from its own path —
 * `/api/webhooks/<source>` — and resolves it through `registry.ts`'s webhook allowlist, so the
 * vendor lives in a URL and in the adapter directory only.
 *
 * 128 MB and 3 s, both prescribed (§4 / the ticket). Strava wants a 200 inside 2 s; the 3 s
 * timeout is the budget plus a margin, never a licence to spend it. At ~1 event/day this function
 * is ALWAYS cold, which is why it imports nothing it does not call.
 *
 * **No VPC** (D-081). **No `secret()`** (ticket 0286, D-347's fallback). The handshake's verify
 * token is read from SSM on a GET only, by `webhook-secret.ts`, through one explicit
 * `ssm:GetParameter` grant in `backend.ts`. It was a `secret()` in 0092, and Amplify resolves those
 * in init on EVERY cold start — two SSM round trips that took Init from ~300 ms to ~680 ms on event
 * POSTs that never read the token (D-346 is why init time matters at 128 MB).
 *
 * **No API Gateway**: the Function URL is added in `backend.ts`, because `defineFunction` has no
 * `url` property — the third of the escape-hatch uses `01-architecture.md` §2 sanctions.
 */
export const ingestWebhook = defineFunction({
  name: "ingest-webhook",
  entry: "./handler.ts",
  timeoutSeconds: 3,
  memoryMB: 128,
})
