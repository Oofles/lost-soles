import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb"

import outputs from "@/amplify_outputs.json"

/**
 * THE SSR COMPUTE'S READS OF THE MODEL TABLES, AND ITS TWO LAMBDA NAMES. Ticket `0331`, D-472.
 *
 * Server-only: it constructs an AWS client at module scope. A browser module that imported it would
 * drag DynamoDB signing into the page bundle, which is why the wire shapes live elsewhere.
 *
 * Every name comes from `amplify_outputs.json`'s `custom` block, written by `backend.addOutput` in
 * `amplify/backend.ts`: the SSR compute has no CloudFormation output or environment of its own
 * (the gap `lib/runs/server.ts` documents). A table or function NAME is not a secret. It grants
 * nothing without the `dynamodb:Query` and `lambda:InvokeFunction` statements that file scopes to
 * exactly these resources.
 */

export type CustomOutput =
  | "activityTableName"
  | "xpLedgerTableName"
  | "skillStateTableName"
  | "profileTableName"
  | "landmarkTableName"
  | "logWorkoutFunctionName"
  | "setActivityKindFunctionName"

/** A `custom` output, or a loud failure naming the deploy that should have written it. */
export function customOutput(key: CustomOutput): string {
  const value = (outputs as { custom?: Partial<Record<CustomOutput, string>> }).custom?.[key]
  if (!value) {
    throw new Error(
      `amplify_outputs.json has no custom.${key}. It is written by backend.addOutput in ` +
        "amplify/backend.ts; a missing value means this build predates that deploy.",
    )
  }
  return value
}

/** The document-client surface the readers use, structural so a test passes a one-method stub. */
export interface QueryDdb {
  send(command: QueryCommand): Promise<{ Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> }>
}

/** Module scope, so a warm SSR container reuses the connection rather than opening TLS per load. */
let cachedDdb: DynamoDBDocumentClient | undefined
export const defaultDdb = (): QueryDdb => (cachedDdb ??= DynamoDBDocumentClient.from(new DynamoDBClient({})))

export interface QueryInput {
  TableName: string
  IndexName?: string
  KeyConditionExpression: string
  FilterExpression?: string
  ExpressionAttributeNames: Record<string, string>
  ExpressionAttributeValues: Record<string, unknown>
  ProjectionExpression?: string
  ScanIndexForward?: boolean
}

/**
 * Every item a query matches, page by page, stopping once `max` items are in hand. `Query` only:
 * the SSR compute holds no `Scan`, `GetItem` or write on any model table (D-472).
 */
export async function queryAll(
  ddb: QueryDdb,
  input: QueryInput,
  { max, page }: { max?: number; page?: number } = {},
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  const cap = max ?? Number.POSITIVE_INFINITY
  let start: Record<string, unknown> | undefined
  do {
    // `Limit` is applied BEFORE a FilterExpression, so a filtered read must not pass `max`.
    const limit = max === undefined ? undefined : Math.min(page ?? max, max - out.length)
    const result = await ddb.send(
      new QueryCommand({ ...input, ...(start ? { ExclusiveStartKey: start } : {}), ...(limit !== undefined ? { Limit: limit } : {}) }),
    )
    for (const item of result.Items ?? []) {
      if (out.length >= cap) break
      out.push(item)
    }
    start = result.LastEvaluatedKey
  } while (start && out.length < cap)
  return out
}
