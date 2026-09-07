import type { Stack } from "aws-cdk-lib"
import { describe, expect, it } from "vitest"

import {
  FAILED_BY_USER_INDEX,
  INGEST_RECEIPT_TABLE,
  RECEIPT_TTL_DAYS,
} from "@/src/pipeline/ingest-receipt"

/**
 * T8's shape, asserted against the CloudFormation this backend actually synthesizes
 * (ticket 0040). Same reasoning as `raw-archive-immutability.test.ts`: a live check
 * only runs against a deploy that already happened, and the close records one of
 * those too — but this fails in CI, before the change reaches the table.
 *
 * The CDK context is what `ampx` normally supplies; it is set before the import
 * because `defineBackend` reads it while the module is evaluating.
 */
process.env.CDK_CONTEXT_JSON = JSON.stringify({
  "amplify-backend-namespace": "lost-soles-test",
  "amplify-backend-name": "test",
  "amplify-backend-type": "branch",
})

const { Template } = await import("aws-cdk-lib/assertions")
const { backend } = await import("./backend")

const ingestStack = backend.stack.node.findChild("IngestPipeline") as Stack
const template = Template.fromStack(ingestStack)

const table = () => {
  const tables = Object.values(template.findResources("AWS::DynamoDB::Table")).filter(
    (t) => (t.Properties as { TableName?: string }).TableName === INGEST_RECEIPT_TABLE,
  )
  expect(tables).toHaveLength(1)
  return tables[0] as { Properties: Record<string, unknown>; DeletionPolicy?: string }
}

describe("T8 IngestReceipt", () => {
  /**
   * The SSR compute reads this literal at runtime with no CloudFormation output to
   * read it from, so the name is stated in two places. Asserted equal rather than
   * trusted to stay in step — the same guard the other two named tables carry.
   */
  it("has the name src/pipeline/ingest-receipt.ts states", () => {
    expect(table().Properties.TableName).toBe("LostSolesIngestReceipt")
  })

  /** T8: `pk = ingestKey`, and explicitly NO sort key. */
  it("is keyed on ingestKey alone", () => {
    expect(table().Properties.KeySchema).toEqual([
      { AttributeName: "ingestKey", KeyType: "HASH" },
    ])
  })

  /**
   * The table's own key plus the two the sparse index needs, and NOTHING ELSE.
   *
   * DynamoDB requires an attribute definition for every key of every index and refuses
   * a definition for anything that is not one, so this list is exactly the set of
   * attributes this table has committed to a shape for. Asserted as a set because
   * CloudFormation's ordering is not a contract.
   */
  it("defines attributes only for keys — the table's and the index's", () => {
    expect(table().Properties.AttributeDefinitions).toEqual(
      expect.arrayContaining([
        { AttributeName: "ingestKey", AttributeType: "S" },
        { AttributeName: "failedUserId", AttributeType: "S" },
        { AttributeName: "failedAt", AttributeType: "S" },
      ]),
    )
    expect(table().Properties.AttributeDefinitions).toHaveLength(3)
  })

  /**
   * Without a TTL this table grows forever holding rows nobody will read. The 90-day
   * value is the store's constant; the attribute name is what DynamoDB expires on, and
   * the two have to agree or nothing ever expires and nothing says so.
   */
  it("expires rows on the ttl attribute", () => {
    expect(table().Properties.TimeToLiveSpecification).toEqual({
      AttributeName: "ttl",
      Enabled: true,
    })
    expect(RECEIPT_TTL_DAYS).toBe(90)
  })

  /**
   * `02-data-model.md` §7.2/5 names T6, T7 and T8 together: they survive a stack
   * teardown by construction, and that is the whole reason they sit outside
   * `defineData`. This is the assertion that keeps that sentence true.
   */
  it("is RETAIN, per 02 §7.2/5", () => {
    expect(table().DeletionPolicy).toBe("Retain")
  })

  /** ~250 live items at five years. Provisioned capacity would bill for idle (D-083). */
  it("bills on demand", () => {
    expect(table().Properties.BillingMode).toBe("PAY_PER_REQUEST")
  })
})

/**
 * THE SPARSE FAILURE INDEX (ticket 0044, criterion 4).
 *
 * Sparse is the entire design, not an optimisation: `failedUserId` is written only by
 * `recordFailure` and removed again by `claimForScoring`, so this index holds one entry
 * per OUTSTANDING failure and is normally empty. An index keyed on the receipt's own
 * `userId` would have worked identically today at ~250 rows and would have made the cost
 * of asking "is anything broken?" a function of how many activities have ever been
 * imported rather than of how many are currently broken.
 */
describe("the failedByUser index", () => {
  const index = () => {
    const indexes = (table().Properties.GlobalSecondaryIndexes ?? []) as Array<
      Record<string, unknown>
    >
    const found = indexes.filter((i) => i.IndexName === FAILED_BY_USER_INDEX)
    expect(found, `one index named ${FAILED_BY_USER_INDEX}`).toHaveLength(1)
    return found[0]
  }

  /**
   * Stated in two places for the reason the table name is — the Sync action runs on the
   * SSR compute, which has no CloudFormation output to be handed a generated name
   * through. A literal both sides state, asserted equal rather than trusted.
   */
  it("has the name src/pipeline/ingest-receipt.ts states", () => {
    expect(index().IndexName).toBe("failedByUser")
  })

  /** Partition by user; sort by when it broke, so the newest failure reads first. */
  it("is keyed on failedUserId, sorted by failedAt", () => {
    expect(index().KeySchema).toEqual([
      { AttributeName: "failedUserId", KeyType: "HASH" },
      { AttributeName: "failedAt", KeyType: "RANGE" },
    ])
  })

  /**
   * INCLUDE, NOT ALL, and at this size that is not about cost. A projection is a
   * statement of what an index is FOR: a failure report needs the identity of the run,
   * its error class, and whether the raw bytes reached S3 — the field the runbook
   * branches on. It has no business carrying `xpAwarded`, which belongs to the DONE path
   * and would invite a reader to answer a different question from this index.
   */
  it("projects the failure report and nothing from the DONE path", () => {
    const projection = index().Projection as {
      ProjectionType?: string
      NonKeyAttributes?: string[]
    }
    expect(projection.ProjectionType).toBe("INCLUDE")
    expect(projection.NonKeyAttributes).toEqual(
      expect.arrayContaining(["activityId", "source", "externalId", "errorClass", "rawArchived", "attempts"]),
    )
    expect(projection.NonKeyAttributes).not.toContain("xpAwarded")
    expect(projection.NonKeyAttributes).not.toContain("newCellCount")
  })
})
