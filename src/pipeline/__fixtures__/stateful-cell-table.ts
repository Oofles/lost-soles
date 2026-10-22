import { BatchGetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"

import { cellUpdate, firstRunBackfill, type CellWriteActivity } from "../explored-cells"

/**
 * A STATEFUL T6 for the pipeline rig (`process-rig.ts`'s `cellsTable`). Ticket `0116`, for the
 * idempotency sweep (I-21, I-23): re-processing an activity must be measured as WRITES THAT APPLIED,
 * not inferred from a final state that happens to match.
 *
 * It evaluates exactly the conditions the shipped writers send, and nothing else. The expressions
 * are read off `cellUpdate` and `firstRunBackfill` themselves, so a change to either is a change
 * here; any expression it does not recognise throws, because a fake that guessed would pass a
 * write the real table might refuse — or refuse one it would pass.
 */

type Item = Record<string, unknown>

const PROBE = { userId: "probe", activityId: "probe", startedAt: "2000-01-01T00:00:00.000Z" } as CellWriteActivity
const PRIMARY = cellUpdate("8f0000000000000" as never, PROBE, 0).UpdateExpression
const UNCLAIMED = cellUpdate("8f0000000000000" as never, PROBE, 0).ConditionExpression
const NEW_CLAIM = cellUpdate("8f0000000000000" as never, PROBE, 0, undefined, {}).ConditionExpression
const REARM_CLAIM = cellUpdate("8f0000000000000" as never, PROBE, 0, undefined, { seen: "x" }).ConditionExpression
const BACKFILL = firstRunBackfill("8f0000000000000" as never, PROBE, 0).UpdateExpression
const AGG_TOTAL = "SET totalChildren = :total ADD exploredChildren :added"
const AGG_DAY = "SET lastRunDay = :day"

const conditionalFailure = () => Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" })

export interface StatefulCellTable {
  send(command: UpdateCommand | BatchGetCommand): Promise<unknown>
  /** `pk|sk` → item, as stored. */
  store: Map<string, Item>
  /** Every write that APPLIED, by item type. A refused conditional write is not counted. */
  applied: { cell: number; agg: number }
  /** Writes that applied AND changed at least one attribute — an `ADD 0` applies and changes nothing. */
  changed: { cell: number; agg: number }
  /** Zero all counters; the store is kept. Call between two deliveries. */
  resetCounts(): void
}

export function statefulCellTable(): StatefulCellTable {
  const store = new Map<string, Item>()
  const applied = { cell: 0, agg: 0 }
  const changed = { cell: 0, agg: 0 }

  const commit = (id: string, before: Item | undefined, after: Item, kind: "cell" | "agg") => {
    store.set(id, after)
    applied[kind]++
    if (JSON.stringify(before ?? {}) !== JSON.stringify(after)) changed[kind]++
  }

  return {
    store,
    applied,
    changed,
    resetCounts() {
      applied.cell = applied.agg = changed.cell = changed.agg = 0
    },
    async send(command) {
      if (command instanceof BatchGetCommand) {
        const [[table, { Keys }]] = Object.entries(command.input.RequestItems!) as [[string, { Keys: Item[] }]]
        return {
          Responses: { [table]: Keys.map((k) => store.get(`${k.pk}|${k.sk}`)).filter((i): i is Item => i !== undefined) },
        }
      }
      const input = command.input
      const id = `${input.Key!.pk}|${input.Key!.sk}`
      const item = store.get(id)
      const v = (input.ExpressionAttributeValues ?? {}) as Record<string, string | number>
      const at = String(v[":at"])

      if (input.UpdateExpression === PRIMARY) {
        const holds = {
          [String(UNCLAIMED)]: () => item?.lastRunAt === undefined || String(item.lastRunAt) < at,
          [String(NEW_CLAIM)]: () => item?.lastRunAt === undefined,
          [String(REARM_CLAIM)]: () => item !== undefined && item.lastRunAt === v[":seen"],
        }[String(input.ConditionExpression)]
        if (!holds) throw new Error(`stateful T6: unrecognised condition ${input.ConditionExpression}`)
        if (!holds()) throw conditionalFailure()
        commit(id, item, {
          ...input.Key,
          ...item,
          firstRunAt: item?.firstRunAt ?? at,
          firstRunId: item?.firstRunId ?? v[":rid"],
          lastRunAt: at,
          lastRunId: v[":rid"],
          lastRunDay: v[":day"],
          visitCount: (Number(item?.visitCount) || 0) + Number(v[":one"]),
          discoveryCount: (Number(item?.discoveryCount) || 0) + Number(v[":credit"]),
        }, "cell")
        return {}
      }
      if (input.UpdateExpression === BACKFILL) {
        // An absent attribute satisfies no comparison in DynamoDB, so this never creates a cell.
        if (!item || !(String(item.firstRunAt) > at)) throw conditionalFailure()
        commit(id, item, {
          ...item,
          firstRunAt: at,
          firstRunId: v[":rid"],
          visitCount: (Number(item.visitCount) || 0) + Number(v[":one"]),
          discoveryCount: (Number(item.discoveryCount) || 0) + Number(v[":credit"]),
        }, "cell")
        return {}
      }
      if (input.UpdateExpression === AGG_TOTAL) {
        commit(id, item, {
          ...input.Key,
          ...item,
          totalChildren: v[":total"],
          exploredChildren: (Number(item?.exploredChildren) || 0) + Number(v[":added"]),
        }, "agg")
        return {}
      }
      if (input.UpdateExpression === AGG_DAY) {
        if (item?.lastRunDay !== undefined && !(Number(item.lastRunDay) < Number(v[":day"]))) throw conditionalFailure()
        commit(id, item, { ...input.Key, ...item, lastRunDay: v[":day"] }, "agg")
        return {}
      }
      throw new Error(`stateful T6: unrecognised expression ${input.UpdateExpression}`)
    },
  }
}
