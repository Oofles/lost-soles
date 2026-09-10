import type { Stack } from "aws-cdk-lib"
import { describe, expect, it } from "vitest"

/**
 * THE SSR COMPUTE ROLE'S READ ON T3. Ticket `0195`.
 * `02-data-model.md` §5.1 (S-7); `08-security-privacy.md` §5.3, §6.2.
 *
 * `/api/runs/latest` answers "where did my last run go" by querying T3 as this role, so the
 * grant is the whole of the browser's reach into the activity table. Same argument as
 * `fog-delivery-read-grant.test.ts` makes for S3, applied to DynamoDB: this fails in CI, before
 * a widened grant reaches a table holding every activity this account has ever recorded.
 *
 * The CDK context below is what `ampx` normally supplies. Set before the import because
 * `defineBackend` reads it while the module is evaluating.
 */
process.env.CDK_CONTEXT_JSON = JSON.stringify({
  "amplify-backend-namespace": "lost-soles-test",
  "amplify-backend-name": "test",
  "amplify-backend-type": "branch",
})

const { Template } = await import("aws-cdk-lib/assertions")
const { backend } = await import("./backend")

const template = Template.fromStack(backend.stack.node.findChild("CaptureGuard") as Stack)

type Statement = { Sid?: string; Effect?: string; Action?: unknown; Resource?: unknown }

function statements(): Statement[] {
  return Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
    (policy) =>
      ((policy.Properties as { PolicyDocument: { Statement: Statement[] } }).PolicyDocument
        .Statement ?? []) as Statement[],
  )
}

const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [v as string])

const grant = (): Statement => {
  const found = statements().find((s) => s.Sid === "QueryActivityForLatestRun")
  expect(found, "the SSR compute role has no T3 query grant").toBeDefined()
  return found!
}

describe("the SSR compute's read path into T3", () => {
  /**
   * `dynamodb:Query` ALONE, and deliberately not `grantReadData` — which would add `GetItem`,
   * `BatchGetItem` and `Scan`. A `Scan` on T3 is every activity of every user in one call,
   * which is exactly what the per-user partition key exists to make impossible.
   */
  it("grants Query, and only Query", async () => {
    const statement = grant()
    expect(statement.Effect).toBe("Allow")
    expect(list(statement.Action)).toEqual(["dynamodb:Query"])
  })

  /**
   * SCOPED TO T3, NOT TO THE ROLE. The compute role does hold `Scan` on the four small CDK
   * tables it owns outright — `grantReadWriteData` on the capture guard, the source accounts,
   * the OAuth state and the ingest receipts. Those are the role's own stores. T3 is not, and it
   * is the one table where a `Scan` means "every activity of every user in one call", which is
   * precisely what the per-user partition key exists to make impossible.
   *
   * Matched on the RESOURCE naming the activity table rather than on a Sid, because the failure
   * this guards against is somebody reaching for `grantReadWriteData(computeRole)` out of habit
   * — and that grant arrives unnamed, with `Scan` in the middle of ten other actions.
   */
  it("grants no Scan on any resource naming the activity table", async () => {
    for (const statement of statements()) {
      const actions = list(statement.Action).filter((a) => typeof a === "string")
      if (!actions.includes("dynamodb:Scan")) continue
      expect(
        JSON.stringify(statement.Resource),
        `statement ${statement.Sid ?? "(unnamed)"} grants a Scan reaching T3`,
      ).not.toMatch(/Activity/i)
    }
  })

  /**
   * THE INDEX ARN IS NOT OPTIONAL, and its absence fails only at runtime and only in a deploy.
   * A GSI is a separate ARN; a grant naming the table alone authorises a base-table query and
   * refuses every query that names an index — which is the only kind this route issues.
   */
  it("covers the GSI as well as the table, because byUserAndStart is a separate ARN", async () => {
    const resources = list(grant().Resource)
    expect(resources).toHaveLength(2)
    expect(JSON.stringify(resources)).toContain("/index/*")
  })

  /**
   * The asymmetry `fog-delivery-read-grant.test.ts` argues for, on the other store. Every write
   * to T3 belongs to the ingest worker, inside the transaction that closes the receipt; a bug in
   * a route handler must not be able to alter an activity row.
   */
  it("gives the SSR compute no write to the activity table", async () => {
    const forbidden = /^dynamodb:(Put|Update|Delete|BatchWrite|TransactWrite)/
    const statement = grant()
    expect(list(statement.Action).filter((a) => forbidden.test(String(a)))).toEqual([])
  })
})
