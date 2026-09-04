import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb"

/**
 * T7 `SourceAccount` — the OAuth credentials for one user's connection to one source.
 * Ticket 0032 writes the initial row; 0033 owns refresh, rotation and the CMK.
 * `02-data-model.md` T7.
 *
 * THIS TABLE IS NOT IN APPSYNC, AT ANY AUTH LEVEL, EVER (I-28, I-20, I-29). Not
 * "protected by an auth rule" — absent. No auth rule is as safe as no reachability,
 * and a rule is one careless edit from being widened. A CDK table through the escape
 * hatch is how `01-architecture.md` §2 says machine-only tables arrive.
 *
 * IT IS ALSO THE ONE THING IN THE SYSTEM THAT IS NOT REBUILDABLE, and that is by
 * design (`02-data-model.md` §1.1, §8, I-2). The rebuild drill does not restore T7.
 * Recovery from losing it is re-authorisation, and the alternative — a backup of live
 * credentials — is a worse thing to own than the inconvenience it prevents.
 *
 * 0032 wrote a row on connect and tore one down on disconnect, and nothing else.
 * TICKET 0033 ADDED THE SECOND HALF, below the `putConnectedAccount`/`markDisconnected`
 * pair: the refresh lifecycle, the `byExternalOwner` lookup, and the terminal
 * `NEEDS_REAUTH` state. The CMK and the index itself are in `amplify/backend.ts`.
 */

/** Explicit for the same reason as the other two tables; asserted equal to `amplify/backend.ts`. */
export const SOURCE_ACCOUNT_TABLE = "LostSolesSourceAccount"

export type SourceAccountStatus = "ACTIVE" | "NEEDS_REAUTH" | "DISCONNECTED"

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

const accountPk = (userId: string) => `U#${userId}`
const accountSk = (sourceId: string) => `SRC#${sourceId}`

/** GSI1, declared in `amplify/backend.ts`. Both sides state the literal; a test agrees them. */
export const EXTERNAL_OWNER_INDEX = "byExternalOwner"

/**
 * The index's partition key. QUALIFIED BY SOURCE, not the bare athlete id — two
 * providers are perfectly entitled to number their users from 1, and an unqualified id
 * would let one source's webhook resolve to another source's user. On a map that never
 * re-fogs, attaching a stranger's GPS to this account is permanent.
 */
const externalOwnerKey = (sourceId: string, externalOwnerId: string) =>
  `${sourceId}#${externalOwnerId}`

/**
 * What a caller outside this module is allowed to see. NOTE WHAT IS MISSING: the
 * tokens. Nothing in 0032 needs to read an access token except the disconnect path,
 * which gets it through `takeAccessTokenForRevocation` — a named, single-purpose
 * door rather than a field on the general read.
 *
 * That is not ceremony. A general `getSourceAccount` that returns credentials is a
 * function every future caller will reach for, and each one is a new place a token
 * can reach a log line.
 */
export interface SourceAccountSummary {
  sourceId: string
  externalOwnerId: string
  scopes: string[]
  expiresAt: number
  status: SourceAccountStatus
  connectedAt: string
}

function toSummary(item: Record<string, unknown>): SourceAccountSummary | null {
  const { sourceId, externalOwnerId, expiresAt, status, connectedAt } = item
  if (typeof sourceId !== "string" || typeof externalOwnerId !== "string") return null
  if (typeof status !== "string") return null

  // `scopes` is a DynamoDB string set, which the document client hands back as a Set.
  const rawScopes = item.scopes
  const scopes =
    rawScopes instanceof Set
      ? [...rawScopes].filter((s): s is string => typeof s === "string")
      : Array.isArray(rawScopes)
        ? rawScopes.filter((s): s is string => typeof s === "string")
        : []

  return {
    sourceId,
    externalOwnerId,
    scopes,
    expiresAt: typeof expiresAt === "number" ? expiresAt : 0,
    status: status as SourceAccountStatus,
    connectedAt: typeof connectedAt === "string" ? connectedAt : "",
  }
}

/** The connection as the settings screen is allowed to see it. `null` when never connected. */
export async function getSourceAccountSummary(
  userId: string,
  sourceId: string,
): Promise<SourceAccountSummary | null> {
  const res = await doc().send(
    new GetCommand({
      TableName: SOURCE_ACCOUNT_TABLE,
      Key: { pk: accountPk(userId), sk: accountSk(sourceId) },
      /**
       * The token attributes are not requested. A projection expression is not a
       * security control — the row is readable either way — but it does mean the
       * tokens are not in memory in the request that renders a page, and therefore
       * cannot end up in a stack trace or a serialised prop.
       */
      ProjectionExpression: "sourceId, externalOwnerId, scopes, expiresAt, #s, connectedAt",
      ExpressionAttributeNames: { "#s": "status" },
    }),
  )

  return res.Item === undefined ? null : toSummary(res.Item)
}

/**
 * Writes the row for a completed connect. Ticket 0032 criteria 4 and 5.
 *
 * A plain put, overwriting any previous row for this (user, source). Re-connecting is
 * a legitimate and expected act — it is how a `NEEDS_REAUTH` connection is repaired —
 * and the tokens it replaces are dead the moment the new grant exists.
 *
 * `expiresAt` comes from the caller, which took it from the provider's response.
 * There is no TTL constant in this file, and criterion 5 is why.
 */
export async function putConnectedAccount(input: {
  userId: string
  sourceId: string
  externalOwnerId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  scopes: readonly string[]
  now?: Date
}): Promise<void> {
  const now = input.now ?? new Date()

  await doc().send(
    new PutCommand({
      TableName: SOURCE_ACCOUNT_TABLE,
      Item: {
        pk: accountPk(input.userId),
        sk: accountSk(input.sourceId),
        userId: input.userId,
        sourceId: input.sourceId,
        externalOwnerId: input.externalOwnerId,
        /**
         * The GSI1 partition key. Ticket 0033 — a row without it is simply absent from
         * `byExternalOwner`, which is how the one row written before this ticket
         * behaved until it reconnected.
         */
        gsi1pk: externalOwnerKey(input.sourceId, input.externalOwnerId),
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        expiresAt: input.expiresAt,
        // A DynamoDB string set, per T7. Never empty: the caller has already refused
        // any grant missing a required scope, so there is always at least one member.
        scopes: new Set(input.scopes),
        connectedAt: now.toISOString(),
        status: "ACTIVE" satisfies SourceAccountStatus,
      },
    }),
  )
}

/**
 * Reads the access token for the one caller entitled to it: disconnect, which needs
 * it to revoke at the provider before the row is torn down.
 *
 * Separate from `getSourceAccountSummary` on purpose — see the note on that type.
 */
export async function readAccessTokenForRevocation(
  userId: string,
  sourceId: string,
): Promise<string | null> {
  const res = await doc().send(
    new GetCommand({
      TableName: SOURCE_ACCOUNT_TABLE,
      Key: { pk: accountPk(userId), sk: accountSk(sourceId) },
      ProjectionExpression: "accessToken",
    }),
  )

  const token = res.Item?.accessToken
  return typeof token === "string" && token.length > 0 ? token : null
}

/**
 * Ticket 0032 criterion 7, and `02-data-model.md` §7's disconnect row: status
 * `DISCONNECTED`, tokens DELETED.
 *
 * REMOVE, not overwrite-with-empty. A blanked token is still a row that once held a
 * credential and a field something might later read as a string; an absent attribute
 * is absent. There is no reason to keep a dead credential (§1.1) and one obvious
 * reason not to.
 *
 * The row itself survives, because `externalOwnerId` and `connectedAt` are the
 * history of the connection and disconnecting is not deleting an account
 * (`08-security-privacy.md` §6.5 — conflating the two is how someone destroys years
 * of data while trying to stop a sync).
 */
export async function markDisconnected(input: {
  userId: string
  sourceId: string
  now?: Date
}): Promise<void> {
  const now = input.now ?? new Date()

  await doc().send(
    new UpdateCommand({
      TableName: SOURCE_ACCOUNT_TABLE,
      Key: { pk: accountPk(input.userId), sk: accountSk(input.sourceId) },
      UpdateExpression:
        "SET #s = :disconnected, disconnectedAt = :now REMOVE accessToken, refreshToken",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":disconnected": "DISCONNECTED" satisfies SourceAccountStatus,
        ":now": now.toISOString(),
      },
      /**
       * No condition on the row existing. Disconnect must be idempotent: the operator
       * who taps it twice, or whose first tap timed out after the write, gets the same
       * end state rather than an error about a row that is already in the state they
       * asked for.
       */
    }),
  )
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REFRESH LIFECYCLE  (ticket 0033)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Everything below exists to make one sentence true: THE STORED REFRESH TOKEN IS
 * NEVER LOST. `03-integrations.md` §2.2 calls refresh "the single most common
 * integration bug", and the reason it is expensive here rather than merely annoying
 * is `02-data-model.md` §8 — T7 is the one thing the rebuild drill does not restore.
 * Losing a refresh token is not a retry, it is a trip back through OAuth on a phone.
 *
 * The mechanism is three operations that compose, and none of them is optional:
 *
 *   `acquireRefreshLease`  so two Lambdas do not both exchange
 *   `rotateTokens`         a conditional write on the PREVIOUS token value
 *   `markNeedsReauth`      the terminal state that stops a retry storm
 *
 * The lease makes the race rare. The condition makes it SAFE — which is the one that
 * matters, because a lease can expire mid-flight and a lock that is trusted rather
 * than backed by a condition is a lock that fails exactly when it is loaded.
 */

/**
 * The credential attribute on the connection row that holds the refresh lease.
 *
 * A LEASE ON THE ROW, NOT A SEPARATE ROW WITH A DynamoDB TTL, and that is a deliberate
 * divergence from the ticket's wording (amended before the work started).
 *
 * A lock row with a TTL would mean setting `timeToLiveAttribute` on THIS table — and
 * the table's own declaration in `amplify/backend.ts` says, in as many words, that it
 * must not have one: "a credential that vanishes on a schedule is a connection that
 * dies silently". Adding a TTL to the one table whose contents cannot be rebuilt, in
 * order to expire a fifteen-second lock, trades a large permanent risk for a small
 * temporary convenience.
 *
 * So the lease expires by COMPARISON against the clock rather than by DynamoDB
 * sweeping it. That is strictly better here anyway: DynamoDB's TTL sweep is lazy and
 * runs up to 48 hours late, which is useless for a fifteen-second lock. The nonce
 * table's own comment already records that the sweep is housekeeping and not a control.
 */
const LEASE_ATTRIBUTE = "refreshLeaseUntil"

/** What only the refresh path is allowed to see. Note this DOES carry the tokens. */
export interface SourceCredentials {
  accessToken: string
  refreshToken: string
  /** Epoch seconds, as the provider stated them. */
  expiresAt: number
  scopes: string[]
  status: SourceAccountStatus
  /** Epoch seconds. `0` when no refresh is in flight. */
  leaseUntil: number
}

/**
 * TWO REFUSALS, NOT ONE, and they are not interchangeable.
 *
 * `not-connected` — there is nothing here. Never connected, or deliberately
 * disconnected. A sweep over every source should skip it in silence.
 *
 * `needs-reauth` — there WAS a connection and it is broken. A human has to act, and
 * the settings screen says so. Collapsing these two would either nag about sources the
 * operator removed on purpose, or swallow a real break into a shrug.
 */
export type CredentialLoad =
  | { ok: true; credentials: SourceCredentials }
  | { ok: false; reason: "not-connected" | "needs-reauth"; detail: string }

/**
 * Loads the credentials for one connection, and REFUSES rather than returning
 * something a caller has to remember to check.
 *
 * THE SCOPE CHECK RUNS ON EVERY LOAD (criterion 11), not once at connect. The connect
 * check can only see the grant it was given; this one sees the row as it is now, which
 * is what catches a row written by an older build, hand-edited in the console, or
 * restored from somewhere it should not have been. `requiredScopes` comes from the
 * connector, so this function names no scope of its own and stays source-agnostic.
 *
 * A ROW SHORT OF A REQUIRED SCOPE IS WRITTEN TO `NEEDS_REAUTH` HERE — a write during
 * what reads like a read, which is worth being explicit about. The alternative is
 * refusing every call while the row still claims `ACTIVE`, so the settings screen shows
 * a healthy connection that cannot do anything. The state and the behaviour have to
 * agree, and this is the only place that learns they disagree.
 */
export async function loadCredentials(input: {
  userId: string
  sourceId: string
  requiredScopes: readonly string[]
  now?: Date
}): Promise<CredentialLoad> {
  const res = await doc().send(
    new GetCommand({
      TableName: SOURCE_ACCOUNT_TABLE,
      Key: { pk: accountPk(input.userId), sk: accountSk(input.sourceId) },
      ProjectionExpression:
        "accessToken, refreshToken, expiresAt, scopes, #s, sourceId, externalOwnerId, #lease",
      ExpressionAttributeNames: { "#s": "status", "#lease": LEASE_ATTRIBUTE },
    }),
  )

  const item = res.Item
  if (item === undefined) {
    return { ok: false, reason: "not-connected", detail: "no row for this user and source" }
  }

  const status = typeof item.status === "string" ? (item.status as SourceAccountStatus) : "DISCONNECTED"
  if (status === "DISCONNECTED") {
    return { ok: false, reason: "not-connected", detail: "the connection was disconnected" }
  }
  if (status === "NEEDS_REAUTH") {
    /**
     * THE LINE THAT STOPS THE RETRY STORM (criterion 10). Once a connection is in this
     * state nothing tries again until a human reconnects — no exchange, no API call, no
     * exponential backoff quietly hammering a provider for a credential that is dead.
     */
    return { ok: false, reason: "needs-reauth", detail: "the connection is marked NEEDS_REAUTH" }
  }

  const { accessToken, refreshToken, expiresAt } = item
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
    return { ok: false, reason: "not-connected", detail: "the row carries no tokens" }
  }

  const scopes = readScopes(item.scopes)
  const missing = input.requiredScopes.filter((required) => !scopes.includes(required))
  if (missing.length > 0) {
    await markNeedsReauth({
      userId: input.userId,
      sourceId: input.sourceId,
      detail: `stored scopes are missing ${missing.join(", ")}`,
      now: input.now,
    })
    return {
      ok: false,
      reason: "needs-reauth",
      // The missing scope NAMES are safe to carry: a scope is not a credential, and
      // ticket 0166 is the record of what it costs to log only that something failed.
      detail: `stored scopes are missing ${missing.join(", ")}`,
    }
  }

  return {
    ok: true,
    credentials: {
      accessToken,
      refreshToken,
      expiresAt: typeof expiresAt === "number" ? expiresAt : 0,
      scopes,
      status,
      leaseUntil: typeof item[LEASE_ATTRIBUTE] === "number" ? (item[LEASE_ATTRIBUTE] as number) : 0,
    },
  }
}

/** A DynamoDB string set arrives as a `Set`; a hand-written row may be a list. */
function readScopes(raw: unknown): string[] {
  if (raw instanceof Set) return [...raw].filter((s): s is string => typeof s === "string")
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === "string")
  return []
}

/**
 * Takes the per-connection refresh lease, or reports that someone else holds it.
 *
 * The condition is "no lease, or the lease has expired", evaluated by DynamoDB rather
 * than by the caller — which is what makes it atomic. Two Lambdas issuing this update
 * in the same millisecond produce exactly one success and one
 * `ConditionalCheckFailedException`.
 *
 * FIFTEEN SECONDS, and the number is a trade-off in one direction only. Too short and
 * a slow provider call outlives its own lease, so a second refresher starts while the
 * first is still in flight — survivable, because `rotateTokens` is conditional, but it
 * wastes an exchange. Too long and a Lambda that dies mid-refresh blocks every later
 * refresh for that whole window. Fifteen seconds is comfortably longer than a token
 * exchange and comfortably shorter than a user noticing.
 */
export async function acquireRefreshLease(input: {
  userId: string
  sourceId: string
  leaseSeconds: number
  now?: Date
}): Promise<boolean> {
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000)

  try {
    await doc().send(
      new UpdateCommand({
        TableName: SOURCE_ACCOUNT_TABLE,
        Key: { pk: accountPk(input.userId), sk: accountSk(input.sourceId) },
        UpdateExpression: "SET #lease = :until",
        ConditionExpression:
          "attribute_exists(pk) AND (attribute_not_exists(#lease) OR #lease < :now)",
        ExpressionAttributeNames: { "#lease": LEASE_ATTRIBUTE },
        ExpressionAttributeValues: {
          ":until": nowSeconds + input.leaseSeconds,
          ":now": nowSeconds,
        },
      }),
    )
    return true
  } catch (err) {
    if (isConditionalCheckFailure(err)) return false
    throw err
  }
}

/**
 * Gives the lease back early, after a refresh that failed or turned out to be
 * unnecessary.
 *
 * Not strictly required — the lease expires on its own — but the fifteen seconds it
 * saves are fifteen seconds during which a user-facing Sync would otherwise sit and
 * poll for a refresh that is never coming. Failure here is swallowed by the caller for
 * the same reason: an unreleased lease costs a delay, never correctness.
 */
export async function releaseRefreshLease(input: {
  userId: string
  sourceId: string
}): Promise<void> {
  await doc().send(
    new UpdateCommand({
      TableName: SOURCE_ACCOUNT_TABLE,
      Key: { pk: accountPk(input.userId), sk: accountSk(input.sourceId) },
      UpdateExpression: "REMOVE #lease",
      ExpressionAttributeNames: { "#lease": LEASE_ATTRIBUTE },
    }),
  )
}

/**
 * THE CONDITIONAL WRITE. Criterion 7, and the single most important function in this
 * file.
 *
 * `ConditionExpression: refreshToken = :previous` is the whole trick the ticket's
 * Notes describe. It makes the rotation race resolvable without trusting the lease:
 * whichever refresher wrote first owns the row, and the loser's write is REFUSED
 * rather than applied. The loser then re-reads and uses the winner's token.
 *
 * WHAT THE ALTERNATIVE COSTS, stated because it is not obvious. An unconditional
 * `SET refreshToken = :new` under the same race applies both writes in arrival order.
 * If the slower exchange lands second, the row ends up holding a refresh token that
 * the provider rotated away two calls ago — dead, and indistinguishable from a live
 * one until the next refresh fails. That is the permanent-orphan failure, and it is
 * caused by a write that looked like it succeeded.
 *
 * `won: false` IS NOT AN ERROR. It is the system working: two refreshes happened, one
 * of them is authoritative, and nothing was lost.
 */
export async function rotateTokens(input: {
  userId: string
  sourceId: string
  /** The value the caller read BEFORE it called the provider. The whole condition. */
  previousRefreshToken: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  now?: Date
}): Promise<{ won: boolean }> {
  const now = input.now ?? new Date()

  try {
    await doc().send(
      new UpdateCommand({
        TableName: SOURCE_ACCOUNT_TABLE,
        Key: { pk: accountPk(input.userId), sk: accountSk(input.sourceId) },
        /**
         * The lease is dropped in the SAME update that stores the tokens. One round
         * trip, and — more importantly — there is no window in which the new tokens
         * are stored but the connection still looks locked.
         */
        UpdateExpression:
          "SET accessToken = :access, refreshToken = :refresh, expiresAt = :expires," +
          " refreshedAt = :now REMOVE #lease",
        ConditionExpression: "refreshToken = :previous",
        ExpressionAttributeNames: { "#lease": LEASE_ATTRIBUTE },
        ExpressionAttributeValues: {
          ":access": input.accessToken,
          ":refresh": input.refreshToken,
          ":expires": input.expiresAt,
          ":previous": input.previousRefreshToken,
          ":now": now.toISOString(),
        },
      }),
    )
    return { won: true }
  } catch (err) {
    if (isConditionalCheckFailure(err)) return { won: false }
    throw err
  }
}

/**
 * The terminal state. A human has to reconnect, and until they do nothing tries again.
 *
 * CONDITIONAL ON THE ROW NOT BEING `DISCONNECTED`. Without that, a refresh already in
 * flight when the operator taps Disconnect would resurrect the row into `NEEDS_REAUTH`
 * — a connection they deliberately removed reappearing on the settings screen as
 * broken, asking to be fixed. Idempotent otherwise: marking an already-marked row is a
 * no-op, not an error, because both callers of this reach it from a retry path.
 */
export async function markNeedsReauth(input: {
  userId: string
  sourceId: string
  detail: string
  now?: Date
}): Promise<void> {
  const now = input.now ?? new Date()

  try {
    await doc().send(
      new UpdateCommand({
        TableName: SOURCE_ACCOUNT_TABLE,
        Key: { pk: accountPk(input.userId), sk: accountSk(input.sourceId) },
        /**
         * THE TOKENS ARE LEFT IN PLACE, deliberately, and this is the opposite of
         * `markDisconnected`. `NEEDS_REAUTH` is a diagnosis, not a decision — the
         * refresh token may be perfectly good and the failure transient in a way this
         * code misjudged. Deleting it would turn a recoverable mistake into the
         * unrecoverable one this whole file exists to prevent. Disconnect removes
         * credentials because the user asked; this does not, because nobody did.
         */
        UpdateExpression:
          "SET #s = :needs, needsReauthAt = :now, needsReauthDetail = :detail REMOVE #lease",
        ConditionExpression: "attribute_exists(pk) AND #s <> :disconnected",
        ExpressionAttributeNames: { "#s": "status", "#lease": LEASE_ATTRIBUTE },
        ExpressionAttributeValues: {
          ":needs": "NEEDS_REAUTH" satisfies SourceAccountStatus,
          ":disconnected": "DISCONNECTED" satisfies SourceAccountStatus,
          ":now": now.toISOString(),
          ":detail": input.detail,
        },
      }),
    )
  } catch (err) {
    if (isConditionalCheckFailure(err)) return
    throw err
  }
}

/**
 * The GSI's only reason to exist: `owner_id` → `userId`, for a webhook that is handed
 * a provider's athlete id and nothing else (`02-data-model.md` T7, resolved conflict).
 *
 * IT CAN RETURN NOTHING BUT KEYS, and that is structural rather than careful coding.
 * `byExternalOwner` is projected KEYS_ONLY, so the items DynamoDB returns here contain
 * `pk`, `sk` and `gsi1pk` — the token attributes are not in the index at all. A caller
 * that wanted a credential from this function could not get one by asking differently;
 * it would have to go to the base table, which is a separate IAM grant the webhook does
 * not hold.
 *
 * The userId is parsed back out of the partition key rather than projected as its own
 * attribute, because KEYS_ONLY means the keys are all there is — and `U#<uid>` is a
 * shape this module already owns both ends of.
 */
export async function resolveUserByExternalOwner(input: {
  sourceId: string
  externalOwnerId: string
}): Promise<string | null> {
  const res = await doc().send(
    new QueryCommand({
      TableName: SOURCE_ACCOUNT_TABLE,
      IndexName: EXTERNAL_OWNER_INDEX,
      KeyConditionExpression: "gsi1pk = :owner",
      ExpressionAttributeValues: { ":owner": externalOwnerKey(input.sourceId, input.externalOwnerId) },
      Limit: 1,
    }),
  )

  const pk = res.Items?.[0]?.pk
  return typeof pk === "string" && pk.startsWith("U#") ? pk.slice(2) : null
}

/**
 * DynamoDB signals a refused condition by exception, and the SDK v3 shape is a named
 * error rather than a status code. Matched on `name` and not `instanceof`: the
 * document client wraps the low-level client, and a version bump that changes which
 * package the class comes from would silently turn "the race was handled" into an
 * unhandled throw. The name is the stable part of that contract.
 */
function isConditionalCheckFailure(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name: unknown }).name === "ConditionalCheckFailedException"
  )
}
