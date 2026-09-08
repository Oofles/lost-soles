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
   * `0048`, AP-15 — the ingest-time diff. The ONE read this worker performs, and it is a
   * batch of known keys rather than a `Query` over the res-6 partition: the run crossed
   * 45 cells and the partition may hold 2,401.
   */
  it("grants BatchGetItem, and only that read", () => {
    expect(actionsOnTable()).toContain("dynamodb:BatchGetItem")
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
   * `Query` is AP-16/AP-17's, the blob rebuild — and `0049` BUILT that path
   * (`src/pipeline/explored-rebuild.ts`) and still did not add the grant.
   *
   * `02` §5.6: *"AP-16 is the repair path. Calling it from `process-activity` is a
   * review-blocking bug."* A role that cannot perform the action is the version of that
   * sentence which survives a refactor, so the repair path takes its `Query` when it gets
   * an execution context of its own (the drill, `0105`), where the ~1,000-3,000 RRU is a
   * cost someone chose rather than one the worker inherited.
   * `scripts/check-fog-hot-path.mjs` is the same rule at build time, over the import graph.
   */
  it("STILL grants no Query, GetItem or Scan, even though 0049 built the rebuild", () => {
    const granted = actionsOnTable()
    expect(granted).not.toContain("dynamodb:Query")
    expect(granted).not.toContain("dynamodb:GetItem")
    expect(granted).not.toContain("dynamodb:Scan")
  })

  /**
   * `0049` added a THIRD item type to this table (D-218): the generation counter at
   * `U#<uid>#GEN`. It needs no new action — `ADD generation :one` is an `UpdateItem`, which
   * the worker already holds — and that is worth an assertion rather than a comment,
   * because "we added storage and no permission" is the kind of claim that quietly stops
   * being true.
   */
  it("needs no new action for the generation counter or the aggregate items", () => {
    const dynamo = actionsOnTable().filter((a) => a.startsWith("dynamodb:"))
    expect([...new Set(dynamo)].sort()).toEqual(["dynamodb:BatchGetItem", "dynamodb:UpdateItem"])
  })
})

/**
 * `0049`, `02` §2.10 and §6.1. The delivery layer's own prefix, granted separately from
 * `raw/*` because the two have opposite rules — one is undeletable system-of-record bytes
 * (I-3), the other is derived and republished on every run.
 */
describe("the explored delivery layer in S3", () => {
  const s3Statements = () => {
    const out: { sid?: string; actions: string[]; resource: string }[] = []
    for (const t of [workerTemplate, template]) {
      for (const policy of Object.values(t.findResources("AWS::IAM::Policy"))) {
        const doc = (policy.Properties as { PolicyDocument?: { Statement?: unknown[] } })
          .PolicyDocument
        for (const raw of doc?.Statement ?? []) {
          const st = raw as { Sid?: string; Action?: string | string[]; Resource?: unknown }
          const actions = [st.Action ?? []].flat()
          if (!actions.some((a) => a.startsWith("s3:"))) continue
          out.push({ sid: st.Sid, actions, resource: JSON.stringify(st.Resource ?? "") })
        }
      }
    }
    return out
  }

  const delivery = () => s3Statements().find((s) => s.sid === "WriteAndReadExploredDeliveryLayer")

  it("grants the worker Get and Put under users/", () => {
    const statement = delivery()
    expect(statement, "the delivery-layer grant must exist").toBeDefined()
    expect([...statement!.actions].sort()).toEqual(["s3:GetObject", "s3:PutObject"])
    expect(statement!.resource).toContain("users/*")
  })

  /**
   * `GetObject` is the whole of §2.10: regeneration READS the previous generation's blob
   * instead of `Query`ing 24 MB out of DynamoDB. This grant is what makes the cheap path
   * available, and the absent `dynamodb:Query` above is what makes the expensive one
   * unavailable. The pair is the design.
   */
  it("can read, which is what makes the incremental path possible at all", () => {
    expect(delivery()!.actions).toContain("s3:GetObject")
  })

  /**
   * `0049` predicted this: *"Delta GC (`0051`) is the first thing that will want
   * `s3:DeleteObject` here, and it can argue for it in its own diff."* It did, and the grant
   * it took is narrower than the prefix it GCs within — `users/*​/deltas/*`, not `users/*`.
   *
   * The read/write statement above must NOT have absorbed it. Folding a delete into that
   * statement would widen deletion to the manifest, the set, the sidecar and the aggregate
   * for one line of convenience, and there would be no diff later to notice it in.
   */
  it("grants delete ONLY on the deltas, in a statement of its own", () => {
    const gc = s3Statements().find((s) => s.sid === "ExpireExploredDeltas")
    expect(gc, "the delta GC grant must exist").toBeDefined()
    expect(gc!.actions).toEqual(["s3:DeleteObject"])
    expect(gc!.resource).toContain("users/*/deltas/*")

    expect(delivery()!.actions).not.toContain("s3:DeleteObject")
  })

  /**
   * `DeleteObject` on a versioned bucket writes a delete marker; `DeleteObjectVersion` is what
   * destroys bytes, and it is denied bucket-wide by the resource policy. So the GC's worst
   * case is an object a client wanted becoming unreachable — one 300 KB immutable GET, the
   * outcome `02` §6.5 already calls correct — and never data loss.
   */
  it("cannot delete a version anywhere, so no delete in this account destroys bytes", () => {
    const statements = s3Statements()
    expect(statements.length).toBeGreaterThan(0)
    for (const statement of statements) {
      for (const action of statement.actions) {
        expect(action, `${statement.sid} grants ${action}`).not.toBe("s3:DeleteObjectVersion")
        expect(action).not.toBe("s3:*")
      }
    }
  })

  /** The archive keeps its absolute rule: I-3, no delete of any kind, ever. */
  it("still cannot delete anything under raw/", () => {
    const archive = s3Statements().find((s) => s.sid === "WriteAndReadRawArchive")!
    expect(archive.actions.filter((a) => a.startsWith("s3:Delete"))).toEqual([])
  })

  /**
   * The two prefixes stay separate. A single statement covering both would work and would
   * erase the distinction the two comments in `backend.ts` exist to keep visible.
   */
  it("keeps the archive grant scoped to raw/ and nothing else", () => {
    const archive = s3Statements().find((s) => s.sid === "WriteAndReadRawArchive")!
    expect(archive.resource).toContain("raw/*")
    expect(archive.resource).not.toContain("users/*")
  })
})
