import type { Stack } from "aws-cdk-lib"
import { describe, expect, it } from "vitest"

import { INGEST_RECEIPT_TABLE, RECEIPT_TTL_DAYS } from "@/src/pipeline/ingest-receipt"

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
    expect(table().Properties.AttributeDefinitions).toEqual([
      { AttributeName: "ingestKey", AttributeType: "S" },
    ])
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
