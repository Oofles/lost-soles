import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"

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
 * WHAT 0032 DELIBERATELY DOES NOT DO. No refresh, no rotation, no `byExternalOwner`
 * index, no CMK. Those are 0033's, and each of them is a place to get the rotation
 * race wrong. This module writes a row on connect and tears one down on disconnect.
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
