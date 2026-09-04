import { randomBytes } from "node:crypto"

import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DeleteCommand, DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb"

/**
 * The OAuth `state` nonce: issued when a connect starts, consumed exactly once when
 * the provider redirects back. Ticket 0032, `03-integrations.md` §2.2 step 1.
 *
 * WHAT IT DEFENDS. `state` is the CSRF control on the callback. Without it, anyone
 * who can make the operator's browser visit the callback URL with a code of their
 * choosing can bind THEIR Strava account to the operator's row — and every run that
 * follows writes a stranger's GPS into a map that never re-fogs (D-020). The failure
 * is not a wrong page, it is permanent corruption of the one artefact the project
 * exists to build.
 *
 * WHY SERVER-SIDE AND NOT A SIGNED COOKIE. A cookie can carry a nonce and prove it
 * was issued here, but it cannot prove the nonce has not already been used: the
 * holder of a cookie holds every copy of it. Single-use is the property that matters
 * on a callback, and single-use needs somewhere to record "used". So: a row, deleted
 * on consumption, and the delete IS the check.
 *
 * WHY NOT IN `LostSolesCaptureGuard`. That table's own comment argues for one table
 * with several item shapes, and it is right — for items written on the SAME request
 * path. These are not: they belong to a different feature with a different IAM story,
 * and a table named for the capture endpoint holding the credential handshake's
 * nonces is a table nobody will think to look in.
 *
 * WHY NOT IN `LostSolesSourceAccount`. That table holds credentials and nothing else.
 * Every item shape added to it is another reason for something to hold a write grant
 * on the table where the tokens live (I-28's reasoning, applied one level out).
 *
 * FAIL CLOSED. Every function here throws rather than returning a permissive default
 * when DynamoDB cannot answer — the same rule `capture-store.ts` states, for the same
 * reason: a CSRF check that could not read its record has not found the request to be
 * genuine, it has failed to look, and those two must not produce the same outcome.
 */

/**
 * Explicit, not CDK-generated, for the reason `CAPTURE_GUARD_TABLE` records: the SSR
 * compute is not a `defineFunction` Lambda and has no CloudFormation output to read a
 * generated name from. `amplify/backend.ts` states the identical literal and a test
 * asserts the two agree.
 */
export const OAUTH_STATE_TABLE = "LostSolesOAuthState"

/**
 * Ten minutes. Long enough for a consent screen that involves reading, a password
 * manager and possibly a second-factor prompt; short enough that an abandoned
 * connect attempt is not a nonce sitting valid for an hour.
 */
const STATE_TTL_SECONDS = 600

/**
 * 32 bytes from the CSPRNG. `base64url` because the value goes in a query string and
 * comes back through a redirect — a nonce that needs percent-encoding is a nonce that
 * will one day be compared after a round trip that changed it.
 */
const NONCE_BYTES = 32

let cachedDoc: DynamoDBDocumentClient | null = null

function doc(): DynamoDBDocumentClient {
  cachedDoc ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  })
  return cachedDoc
}

/** Exported for tests only — swaps in a stub client and resets between cases. */
export function __setDocClient(client: DynamoDBDocumentClient | null): void {
  cachedDoc = client
}

const stateKey = (state: string) => `STATE#${state}`

export interface IssuedState {
  /** The opaque value to put on the authorize URL. */
  state: string
}

export interface ConsumedState {
  userId: string
  sourceId: string
}

/**
 * Issues a nonce bound to the user and source that asked for it.
 *
 * The binding is the second half of the control. Verifying only that a nonce is one
 * we issued would let a nonce minted for one source complete a callback for another.
 * The callback re-derives the signed-in user from the session and requires it to
 * equal the one recorded here — so a nonce stolen from one browser is useless in
 * another.
 *
 * The put is conditional on the key not existing. That will never fire in practice at
 * 32 bytes of entropy; it is here so that if it somehow does, the result is an error
 * rather than a silently overwritten in-flight connect.
 */
export async function issueState(input: {
  userId: string
  sourceId: string
  now?: Date
}): Promise<IssuedState> {
  const now = input.now ?? new Date()
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const state = randomBytes(NONCE_BYTES).toString("base64url")

  await doc().send(
    new PutCommand({
      TableName: OAUTH_STATE_TABLE,
      Item: {
        pk: stateKey(state),
        userId: input.userId,
        sourceId: input.sourceId,
        issuedAt: now.toISOString(),
        /**
         * TWO expiries, and they are not redundant. `ttl` is DynamoDB's, which is
         * free but LAZY — an expired item can remain readable for up to 48 hours.
         * `expiresAt` is ours and is checked on consumption, so the ten minutes above
         * is the real window rather than an aspiration.
         */
        expiresAt: nowSeconds + STATE_TTL_SECONDS,
        ttl: nowSeconds + STATE_TTL_SECONDS,
      },
      ConditionExpression: "attribute_not_exists(pk)",
    }),
  )

  return { state }
}

/**
 * Consumes a nonce. Returns the binding it carried, or `null` if the nonce is
 * missing, unknown, expired or already consumed — the four cases criterion 2 names,
 * collapsed into one answer because the caller must treat them identically and a
 * caller given four reasons will eventually treat one of them as recoverable.
 *
 * A conditional DELETE with `ALL_OLD`, not a read followed by a delete. Read-then-
 * delete has a window in which two copies of the same callback both see a valid
 * nonce, and a replayed callback is exactly the request that arrives twice. Here the
 * delete IS the claim: DynamoDB serialises it, so the second attempt finds nothing.
 */
export async function consumeState(
  state: string | null,
  now: Date = new Date(),
): Promise<ConsumedState | null> {
  if (state === null || state.length === 0) return null

  let old: Record<string, unknown> | undefined
  try {
    const res = await doc().send(
      new DeleteCommand({
        TableName: OAUTH_STATE_TABLE,
        Key: { pk: stateKey(state) },
        ConditionExpression: "attribute_exists(pk)",
        ReturnValues: "ALL_OLD",
      }),
    )
    old = res.Attributes
  } catch (err) {
    // The nonce was not there: unknown, or already consumed by an earlier callback.
    if (err instanceof ConditionalCheckFailedException) return null
    // Anything else is DynamoDB failing to answer. Fail closed, loudly.
    throw err
  }

  if (old === undefined) return null

  const expiresAt = old.expiresAt
  if (typeof expiresAt !== "number" || expiresAt <= Math.floor(now.getTime() / 1000)) return null

  const { userId, sourceId } = old
  if (typeof userId !== "string" || typeof sourceId !== "string") return null

  return { userId, sourceId }
}
