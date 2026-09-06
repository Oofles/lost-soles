import type { Stack } from "aws-cdk-lib"
import { describe, expect, it } from "vitest"

/**
 * T3's physical shape, asserted against the CloudFormation this backend synthesizes
 * (ticket 0041). The GSI PROJECTIONS are the reason this file exists: a projection is
 * not tunable after creation — changing one replaces the index — and `02-data-model.md`
 * argues each of the three explicitly. Silently getting `ALL` everywhere would work,
 * cost double the write units on every ingest, and never announce itself.
 */
process.env.CDK_CONTEXT_JSON = JSON.stringify({
  "amplify-backend-namespace": "lost-soles-test",
  "amplify-backend-name": "test",
  "amplify-backend-type": "branch",
})

const { Template } = await import("aws-cdk-lib/assertions")
const { backend } = await import("./backend")

/**
 * Gen 2 creates each model's table through the AmplifyTableManager custom resource
 * rather than an `AWS::DynamoDB::Table`, so the shape is asserted on the CDK construct
 * Amplify exposes rather than on synthesized CFN.
 */
const activity = backend.data.resources.tables["Activity"]

interface IndexShape {
  indexName: string
  partitionKey: string
  sortKey?: string
  projectionType: string
  nonKeyAttributes?: string[]
}

/**
 * The table is filtered by LOGICAL ID, not by `tableName`. Amplify builds the name as
 * an `Fn::Join` over the API id, so it is an object at synth time and a string only
 * after deploy — comparing it to `"Activity-"` silently matched nothing and every
 * assertion below reported a missing index rather than a wrong one.
 */
function indexes(): IndexShape[] {
  const stack = activity.stack as Stack
  const template = Template.fromStack(stack)
  const found: IndexShape[] = []
  for (const [logicalId, resource] of Object.entries(
    template.findResources("Custom::AmplifyDynamoDBTable"),
  )) {
    if (!logicalId.startsWith("Activity")) continue
    const props = resource.Properties as {
      globalSecondaryIndexes?: Array<{
        indexName: string
        keySchema: Array<{ attributeName: string; keyType: string }>
        projection: { projectionType: string; nonKeyAttributes?: string[] }
      }>
    }
    for (const gsi of props.globalSecondaryIndexes ?? []) {
      found.push({
        indexName: gsi.indexName,
        partitionKey: gsi.keySchema.find((k) => k.keyType === "HASH")!.attributeName,
        sortKey: gsi.keySchema.find((k) => k.keyType === "RANGE")?.attributeName,
        projectionType: gsi.projection.projectionType,
        nonKeyAttributes: gsi.projection.nonKeyAttributes,
      })
    }
  }
  return found
}

const byName = (name: string) => {
  const found = indexes().find((i) => i.indexName === name)
  expect(found, `no GSI named ${name}`).toBeDefined()
  return found!
}

describe("T3 Activity", () => {
  it("exists as a model table", () => {
    expect(activity).toBeDefined()
  })

  it("has exactly the three indexes T3 names", () => {
    expect(indexes().map((i) => i.indexName).sort()).toEqual([
      "byUserAndDay",
      "byUserAndDedupe",
      "byUserAndStart",
    ])
  })

  /** AP-3/AP-4 — the activity list wants whole rows, so projecting less costs a read each. */
  it("byUserAndStart projects ALL", () => {
    expect(byName("byUserAndStart")).toMatchObject({
      partitionKey: "userId",
      sortKey: "startedAt",
      projectionType: "ALL",
    })
  })

  /**
   * KEYS_ONLY, AND THIS IS THE DECISION RATHER THAN AN OPTIMISATION. T3 states it: the
   * dedupe check needs only "does an activity with this key exist, and what is its id".
   * Projecting the whole item would double the write cost of a table written on every
   * single ingest.
   */
  it("byUserAndDedupe projects KEYS_ONLY", () => {
    expect(byName("byUserAndDedupe")).toMatchObject({
      partitionKey: "userId",
      sortKey: "dedupeKey",
      projectionType: "KEYS_ONLY",
    })
  })

  /** INCLUDE, and exactly the three fields "did I work out today" needs to render. */
  it("byUserAndDay projects INCLUDE with the three fields T3 names", () => {
    const index = byName("byUserAndDay")
    expect(index).toMatchObject({
      partitionKey: "userIdLocalDay",
      sortKey: "startedAtLocal",
      projectionType: "INCLUDE",
    })
    expect([...(index.nonKeyAttributes ?? [])].sort()).toEqual([
      "distanceM",
      "kind",
      "xpAwarded",
    ])
  })
})
