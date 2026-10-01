import type { Stack } from "aws-cdk-lib"
import { describe, expect, it } from "vitest"

/**
 * T2 `SkillState` and T4 `XpLedgerEntry`, asserted against the synthesized backend. Ticket 0062.
 * `02-data-model.md` T2, T4; I-18, I-20.
 *
 * THE MUTATION ASSERTION IS THE REASON THIS FILE EXISTS. `allow.owner().to(["read"])` alone
 * still GENERATES `createXpLedgerEntry`, `updateXpLedgerEntry` and `deleteXpLedgerEntry`, and
 * refuses them at the auth check. `Activity` is that shape today. For the two tables that ARE
 * the XP, the models call `disableOperations(["mutations", "subscriptions"])`, so no resolver
 * exists at all. The resolver map is what AppSync actually serves, so a mutation that
 * reappears (a dropped `disableOperations`, a new model sharing the name) fails the build here.
 *
 * Synthesized once at module scope — see `activity-model.test.ts` on the 5 s timeout.
 */
process.env.CDK_CONTEXT_JSON = JSON.stringify({
  "amplify-backend-namespace": "lost-soles-test",
  "amplify-backend-name": "test",
  "amplify-backend-type": "branch",
})

const { Template } = await import("aws-cdk-lib/assertions")
const { backend } = await import("./backend")

const ledgerTable = backend.data.resources.tables["XpLedgerEntry"]
const stateTable = backend.data.resources.tables["SkillState"]
/** Each Amplify model table lives in its own nested stack. */
const TEMPLATES = {
  XpLedgerEntry: Template.fromStack(ledgerTable.stack as Stack),
  SkillState: Template.fromStack(stateTable.stack as Stack),
}
const WORKER = Template.fromStack(backend.processActivity.stack)

const resolvers = Object.keys(backend.data.resources.cfnResources.cfnResolvers)

interface TableShape {
  keySchema: Array<{ attributeName: string; keyType: string }>
  globalSecondaryIndexes?: Array<{
    indexName: string
    keySchema: Array<{ attributeName: string; keyType: string }>
    projection: { projectionType: string; nonKeyAttributes?: string[] }
  }>
}

function table(prefix: keyof typeof TEMPLATES): TableShape {
  const found = Object.entries(TEMPLATES[prefix].findResources("Custom::AmplifyDynamoDBTable")).find(([id]) =>
    id.startsWith(prefix),
  )
  expect(found, `no table ${prefix}`).toBeDefined()
  return found![1].Properties as TableShape
}

const keys = (ks: TableShape["keySchema"]) =>
  Object.fromEntries(ks.map((k) => [k.keyType, k.attributeName]))

describe("I-18 / I-20 — no client can write XP", () => {
  it.each(["XpLedgerEntry", "SkillState"])("the API serves no mutation and no subscription for %s", (model) => {
    const reaching = resolvers.filter(
      (r) => (r.startsWith("Mutation.") || r.startsWith("Subscription.")) && r.includes(model),
    )
    expect(reaching).toEqual([])
  })

  it.each(["XpLedgerEntry", "SkillState"])("%s is still readable: get and list resolvers exist", (model) => {
    expect(resolvers.some((r) => r.startsWith("Query.get") && r.endsWith(model))).toBe(true)
    expect(resolvers.some((r) => r.startsWith("Query.list") && r.includes(model))).toBe(true)
  })

  /**
   * The GENERATED SCHEMA, as the Amplify transformer receives it: the directive line each model
   * compiles to. `@model(mutations:null,subscriptions:null)` is what removes the operations, and
   * the `@auth` rule is exactly owner-scoped read. Anything else in either fails here.
   */
  it.each(["XpLedgerEntry", "SkillState"])("%s compiles to a read-only, mutation-free @model", async (model) => {
    const { data } = await import("./data/resource")
    const sdl = (data as unknown as { props: { schema: { transform(): { schema: string } } } }).props.schema.transform().schema
    const line = sdl.split("\n").find((l) => l.startsWith(`type ${model} `))
    expect(line).toBe(
      `type ${model} @model(mutations:null,subscriptions:null) ` +
        `@auth(rules: [{allow: owner, operations: [read], ownerField: "owner"}])`,
    )
  })
})

describe("T4 XpLedgerEntry — keys and indexes", () => {
  const t4 = () => table("XpLedgerEntry")

  it("PK is the deterministic id, with no sort key", () => {
    expect(keys(t4().keySchema)).toEqual({ HASH: "id" })
  })

  it("has exactly T4's three indexes, with T4's projections", () => {
    const gsis = Object.fromEntries(
      (t4().globalSecondaryIndexes ?? []).map((g) => [
        g.indexName,
        { ...keys(g.keySchema), projection: g.projection.projectionType, include: g.projection.nonKeyAttributes?.sort() },
      ]),
    )
    expect(gsis).toEqual({
      byActivity: { HASH: "activityId", RANGE: "skillIdReason", projection: "ALL", include: undefined },
      byUserAndSeq: { HASH: "userId", RANGE: "seq", projection: "ALL", include: undefined },
      bySkill: {
        HASH: "userIdSkillId",
        RANGE: "awardedAt",
        projection: "INCLUDE",
        include: ["xpAwarded", "xpRulesVersion"],
      },
    })
  })
})

describe("T2 SkillState — keys", () => {
  it("PK userId, SK skillId, no GSIs", () => {
    const t2 = table("SkillState")
    expect(keys(t2.keySchema)).toEqual({ HASH: "userId", RANGE: "skillId" })
    expect(t2.globalSecondaryIndexes ?? []).toEqual([])
  })
})

describe("the worker's grants on T1/T2/T3/T4", () => {
  type Statement = { Action?: unknown; Resource?: unknown }
  const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [v as string])
  const statements = (): Statement[] =>
    Object.values(WORKER.findResources("AWS::IAM::Policy")).flatMap(
      (p) => (p.Properties as { PolicyDocument: { Statement: Statement[] } }).PolicyDocument.Statement,
    )
  const reaching = (logicalPrefix: string) =>
    statements().filter((s) => JSON.stringify(s.Resource).includes(logicalPrefix))

  const actionsOn = (prefix: string) => [...new Set(reaching(prefix).flatMap((s) => list(s.Action)))].sort()

  /** No UpdateItem and no DeleteItem: ingest never changes or removes a row (I-18). */
  it("T4: PutItem and Query only", () => {
    expect(actionsOn("XpLedgerEntry")).toEqual(["dynamodb:PutItem", "dynamodb:Query"])
  })

  it("T4: the Query reaches the byActivity index and not the base table", () => {
    const query = reaching("XpLedgerEntry").filter((s) => list(s.Action).includes("dynamodb:Query"))
    expect(JSON.stringify(query.map((s) => s.Resource))).toMatch(/index\/byActivity/)
    expect(query).toHaveLength(1)
  })

  it("T2: UpdateItem and Query only", () => {
    expect(actionsOn("SkillState")).toEqual(["dynamodb:Query", "dynamodb:UpdateItem"])
  })

  /** `0219`. The Profile totals only; the ingest never reads or deletes T1. */
  it("T1: UpdateItem only", () => {
    expect(actionsOn("Profile")).toEqual(["dynamodb:UpdateItem"])
  })

  /**
   * `0220`. The put, and the consistent read of the award that precedes it. No Update, no Delete.
   * `0179` adds `Query` — on GSI2 alone, asserted below.
   */
  it("T3: GetItem, PutItem and Query only", () => {
    expect(actionsOn("ActivityNestedStack")).toEqual([
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
    ])
  })

  /** `0179`. Step 3's dedupe lookup reaches `byUserAndDedupe` and never the base table. */
  it("T3: the Query reaches the byUserAndDedupe index and not the base table", () => {
    const query = reaching("ActivityNestedStack").filter((s) => list(s.Action).includes("dynamodb:Query"))
    expect(query).toHaveLength(1)
    expect(JSON.stringify(query[0]!.Resource)).toMatch(/index\/byUserAndDedupe/)
    expect(list(query[0]!.Action)).toEqual(["dynamodb:Query"])
  })

  it("the worker is told all three table names", () => {
    const fn = Object.values(WORKER.findResources("AWS::Lambda::Function")).find((f) =>
      JSON.stringify(f).includes("ACTIVITY_TABLE"),
    )!
    const env = (fn.Properties as { Environment: { Variables: Record<string, unknown> } }).Environment.Variables
    expect(env).toHaveProperty("XP_LEDGER_TABLE")
    expect(env).toHaveProperty("SKILL_STATE_TABLE")
    expect(env).toHaveProperty("PROFILE_TABLE")
  })
})
