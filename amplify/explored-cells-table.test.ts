import type { Stack } from "aws-cdk-lib"
import { describe, expect, it } from "vitest"

import { EXPLORED_CELL_TABLE } from "@/src/pipeline/explored-cells"

/**
 * T6's shape and its IAM, asserted against the CloudFormation this backend actually
 * synthesizes. Ticket `0047`; `02-data-model.md` T6 and §7.2/5; I-7.
 *
 * ─── WHY THIS IS A SYNTH TEST AND NOT A CONSOLE CHECK ───────────────────────
 *
 * Everything here is about what must NEVER be true of the deployed table, and a live
 * check can only ever confirm the state of a deploy that already happened. The close
 * records a live smoke test too (D-181) — but this one fails in CI, before the change
 * reaches a table that holds a map which can never re-fog.
 *
 * I-7 is classified **[S] Structural**: *"no code path deletes an `ExploredCell` item, at
 * any level of retreat"* must not be removable without the removal showing up in an
 * infrastructure diff. That sentence is only true if something reads the diff, and this
 * is the something.
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
/**
 * The worker's IAM lives in the FUNCTION's stack, not the table's — Amplify puts
 * `defineFunction` resources in their own nested stack, and the grant reaches across as a
 * CloudFormation reference. Reading the table's own stack finds no policy at all, which is
 * how the first draft of this file passed every "grants no delete" assertion vacuously.
 */
const workerTemplate = Template.fromStack(backend.processActivity.stack)

const table = () => {
  const tables = Object.values(template.findResources("AWS::DynamoDB::Table")).filter(
    (t) => (t.Properties as { TableName?: string }).TableName === EXPLORED_CELL_TABLE,
  )
  expect(tables).toHaveLength(1)
  return tables[0] as { Properties: Record<string, unknown>; DeletionPolicy?: string }
}

/**
 * Every action any policy in the account grants on THIS table, flattened.
 *
 * The cross-stack reference embeds the table's logical id, which is the only thing that
 * tells its statements apart from the receipt table's in the same policy document.
 */
function actionsOnTable(): string[] {
  const out: string[] = []
  for (const t of [workerTemplate, template]) {
    for (const policy of Object.values(t.findResources("AWS::IAM::Policy"))) {
      const doc = (policy.Properties as { PolicyDocument?: { Statement?: unknown[] } })
        .PolicyDocument
      for (const raw of doc?.Statement ?? []) {
        const statement = raw as { Action?: string | string[]; Resource?: unknown }
        const resource = JSON.stringify(statement.Resource ?? "")
        if (!resource.includes("ExploredCellTable")) continue
        out.push(...[statement.Action ?? []].flat())
      }
    }
  }
  return out
}

describe("T6 ExploredCell — the table", () => {
  /**
   * RETAIN means the table outlives the stack, so a generated name would be orphaned by
   * the very teardown it exists to survive and the next deploy would start from an empty
   * table. `src/pipeline/explored-cells.ts` states the same literal; asserted equal rather
   * than trusted to stay in step, the same guard T7 and T8 carry.
   */
  it("has the name src/pipeline/explored-cells.ts states", () => {
    expect(table().Properties.TableName).toBe("LostSolesExploredCell")
    expect(EXPLORED_CELL_TABLE).toBe("LostSolesExploredCell")
  })

  it("is keyed pk/sk — the res-6 parent partition and the res-10 cell", () => {
    expect(table().Properties.KeySchema).toEqual([
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ])
    expect(table().Properties.AttributeDefinitions).toEqual([
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "sk", AttributeType: "S" },
    ])
  })

  /** §7.2/5: T6, T7 and T8 survive a stack teardown. For T6 it is D-020 in CloudFormation. */
  it("is RETAIN on both delete and replace", () => {
    expect(table().DeletionPolicy).toBe("Retain")
    expect((table() as { UpdateReplacePolicy?: string }).UpdateReplacePolicy).toBe("Retain")
  })

  it("has point-in-time recovery on", () => {
    expect(table().Properties.PointInTimeRecoverySpecification).toEqual({
      PointInTimeRecoveryEnabled: true,
    })
  })

  /**
   * NO TTL, and the absence is the assertion. `LostSolesIngestReceipt` expires its rows at
   * 90 days because it is an optimisation over two structural backstops; this table IS a
   * backstop, and a `TimeToLiveSpecification` here would be the map quietly forgetting.
   */
  it("has no TTL — nothing in the fog expires (D-020)", () => {
    expect(table().Properties.TimeToLiveSpecification).toBeUndefined()
  })

  it("is on-demand billing, so 20k–150k items cost nothing to hold", () => {
    expect(table().Properties.BillingMode).toBe("PAY_PER_REQUEST")
  })

  it("has no GSI — every read is by known partition (AP-15/16/17)", () => {
    expect(table().Properties.GlobalSecondaryIndexes).toBeUndefined()
  })
})

describe("T6 ExploredCell — the IAM (I-7)", () => {
  /**
   * FIRST, because every assertion below is an ABSENCE and an empty scan satisfies all of
   * them. The first draft of this file read the table's own stack, found no policy, and
   * reported that nothing grants `DeleteItem` — which was true and meant nothing.
   */
  it("finds the grant at all, so the absences below are not vacuous", () => {
    expect(actionsOnTable().length).toBeGreaterThan(0)
  })

  it("grants the worker UpdateItem", () => {
    expect(actionsOnTable()).toContain("dynamodb:UpdateItem")
  })

  /**
   * THE POINT OF THIS FILE. Each of these would be handed out for free by
   * `grantReadWriteData`, and each one breaks a different invariant:
   *
   *   - `DeleteItem` / `BatchWriteItem` — I-7. A batch carries `DeleteRequest`.
   *   - `PutItem` — a `Put` replaces the item, which is the unconditional `SET` that lets
   *     a 2024 backfill stomp a 2026 `lastRunAt` (I-8).
   */
  it("grants NO DeleteItem, BatchWriteItem or PutItem to anyone in this stack", () => {
    const granted = actionsOnTable()
    for (const forbidden of [
      "dynamodb:DeleteItem",
      "dynamodb:BatchWriteItem",
      "dynamodb:PutItem",
    ]) {
      expect(granted, `${forbidden} must never be granted on T6`).not.toContain(forbidden)
    }
  })

  it("grants no wildcard that would smuggle a delete in", () => {
    for (const action of actionsOnTable()) {
      expect(action).not.toBe("dynamodb:*")
      expect(action).not.toBe("*")
    }
  })

  /**
   * The reads AP-15 and AP-16 need belong to `0048` and `0049`. Asserting their absence
   * now means each of those tickets has to add its own grant where a reviewer can see it,
   * rather than inheriting one nobody chose.
   */
  it("grants no read yet — this ticket only writes", () => {
    const granted = actionsOnTable()
    expect(granted).not.toContain("dynamodb:Query")
    expect(granted).not.toContain("dynamodb:GetItem")
    expect(granted).not.toContain("dynamodb:Scan")
  })
})
