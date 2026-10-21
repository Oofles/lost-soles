import type { Stack } from "aws-cdk-lib"
import { describe, expect, it } from "vitest"

/**
 * Point-in-time recovery, table by table, asserted against the synthesized backend. Ticket
 * `0300`; `02-data-model.md` §8.1–§8.2, `08-security-privacy.md` §6.4.
 *
 * Every `defineData` model is owner-scoped, and every one must carry PITR: the D-135 waterline
 * lives in `SkillState` and the ledger, and 35 days of restore is the backstop between D-259
 * snapshots. T6 carries it too. T7 must NOT — a continuous backup of live credentials is the
 * thing `02` §1.1 forbids — and the three short-lived or non-owner CDK tables stay off.
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

/** The owner-scoped models this ticket names. The loop below must find at least these. */
const OWNER_SCOPED = ["Activity", "Profile", "SkillState", "XpLedgerEntry", "Landmark"]

const models = Object.keys(backend.data.resources.tables)

/** Each Amplify model table lives in its own nested stack; read the physical resource there. */
function modelTableProps(model: string): Record<string, unknown> {
  const stack = backend.data.resources.tables[model]!.stack as Stack
  const found = Object.entries(Template.fromStack(stack).findResources("Custom::AmplifyDynamoDBTable")).find(([id]) =>
    id.startsWith(model),
  )
  expect(found, `no table ${model}`).toBeDefined()
  return found![1].Properties as Record<string, unknown>
}

function cdkTablePitr(stackId: string, tableName: string): unknown {
  const stack = backend.stack.node.findChild(stackId) as Stack
  const found = Object.values(Template.fromStack(stack).findResources("AWS::DynamoDB::Table")).find(
    (r) => (r.Properties as { TableName?: string }).TableName === tableName,
  )
  expect(found, `no table ${tableName}`).toBeDefined()
  return (found!.Properties as { PointInTimeRecoverySpecification?: unknown }).PointInTimeRecoverySpecification
}

describe("PITR on every owner-scoped table (0300)", () => {
  it("the schema still has every owner-scoped model this ticket named", () => {
    expect(models).toEqual(expect.arrayContaining(OWNER_SCOPED))
  })

  it.each(models)("%s has point-in-time recovery enabled", (model) => {
    expect(modelTableProps(model).pointInTimeRecoverySpecification).toEqual({ pointInTimeRecoveryEnabled: true })
  })

  it("T6 ExploredCell has it", () => {
    expect(cdkTablePitr("IngestPipeline", "LostSolesExploredCell")).toEqual({ PointInTimeRecoveryEnabled: true })
  })
})

describe("PITR stays off where a backup is wrong or pointless", () => {
  it("T7 SourceAccount: no continuous copy of live credentials (02 §1.1)", () => {
    expect(cdkTablePitr("SourceConnections", "LostSolesSourceAccount")).toBeUndefined()
  })

  it.each([
    ["SourceConnections", "LostSolesOAuthState"],
    ["IngestPipeline", "LostSolesIngestReceipt"],
    ["CaptureGuard", "LostSolesCaptureGuard"],
  ])("%s / %s is not backed up", (stackId, tableName) => {
    expect(cdkTablePitr(stackId, tableName)).toBeUndefined()
  })
})
