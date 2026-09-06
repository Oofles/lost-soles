import {
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import type { Activity } from "@/src/domain/activity"
import { computeActivityId } from "@/src/domain/activity-id"
import { INGEST_RECEIPT_TABLE } from "@/src/pipeline/ingest-receipt"
import {
  activityItem,
  assertNoCellWrites,
  persistActivity,
  userIdLocalDay,
  type PersistDeps,
} from "@/src/pipeline/persist"

/**
 * Ticket 0041. The transaction is the unit under test, so what these assert is the
 * ITEM LIST — its contents, its ordering guard, and the fact that nothing is written
 * when the send fails. DynamoDB itself is stubbed; a stub that evaluated transactions
 * would be a second, wrong implementation of the thing being relied on.
 */

const USER = "b3f1c2d4-0000-4000-8000-000000000001"
const ACTIVITY_TABLE = "Activity-testapi-NONE"
const KEY = "receipt-key-1"

function stub(outcome?: unknown) {
  const sent: TransactWriteCommand[] = []
  const deps: PersistDeps = {
    activityTable: ACTIVITY_TABLE,
    ddb: {
      async send(command: TransactWriteCommand) {
        sent.push(command)
        if (outcome instanceof Error) throw outcome
        return outcome ?? {}
      },
    },
  }
  return { deps, sent }
}

const activity = (over: Partial<Activity> = {}): Activity => ({
  activityId: computeActivityId(USER, "gpslogger", "9001"),
  userId: USER,
  kind: "run",
  /** 9pm on the 5th, local — which is the 6th in UTC. See the local-day test. */
  startedAt: "2026-09-06T03:00:00.000Z",
  startedAtLocal: "2026-09-05T21:00:00",
  timezone: "America/Denver",
  elapsedS: 2706,
  movingS: 2648,
  distanceM: 6043,
  elevationGainM: 2.9,
  name: "Evening Run",
  source: {
    source: "gpslogger",
    externalId: "9001",
    sourceTypeRaw: "Run",
    fetchedAt: "2026-09-06T04:00:00.000Z",
  },
  raw: {
    bucket: "b",
    key: "raw/u/gpslogger/9001/abc.json",
    contentType: "application/json",
    bytes: 88,
    sha256: "abc",
    archivedAt: "2026-09-06T04:00:00.000Z",
  },
  traceRef: "traces/u/9001.bin",
  hasTrace: true,
  sets: [],
  dedupeKey: "gpslogger#9001",
  ingestedAt: "2026-09-06T04:00:01.000Z",
  revision: 1,
  ...over,
})

const items = (sent: TransactWriteCommand[]) => sent[0].input.TransactItems ?? []

describe("userIdLocalDay", () => {
  /**
   * I-13 and conflict #3, and the bug it exists to prevent is not hypothetical: a 9pm
   * run on the 5th in Denver is `2026-09-06T03:00Z`. Deriving the day from UTC files it
   * under the 6th, so "did I work out today" answers wrongly for every evening workout
   * west of Greenwich — and every streak built on it is wrong the same way.
   */
  it("buckets on the LOCAL wall clock, not UTC", () => {
    const a = activity()
    expect(userIdLocalDay(a.userId, a.startedAtLocal)).toBe(`${USER}#2026-09-05`)
    expect(a.startedAt.slice(0, 10)).toBe("2026-09-06")
  })

  /**
   * `startedAtLocal` is naive — no offset, no `Z`. Parsing it into a `Date` would
   * attach the RUNTIME's zone, which in Lambda is UTC, reintroducing the exact bug
   * above. So the derivation must stay a string slice.
   */
  it("does not go through Date", () => {
    expect(userIdLocalDay("u", "2026-01-01T00:30:00")).toBe("u#2026-01-01")
    expect(userIdLocalDay("u", "2026-12-31T23:59:59")).toBe("u#2026-12-31")
  })
})

describe("the Activity item", () => {
  it("stores all three time fields (I-13)", () => {
    const item = activityItem(activity())
    expect(item.startedAt).toBe("2026-09-06T03:00:00.000Z")
    expect(item.startedAtLocal).toBe("2026-09-05T21:00:00")
    expect(item.timezone).toBe("America/Denver")
    /** An offset is not a timezone: the IANA id is stored, never a "(GMT-06:00) " prefix. */
    expect(item.timezone).not.toMatch(/GMT|[+-]\d\d:\d\d/)
  })

  it("uses the deterministic id, not a fresh one (I-5)", () => {
    expect(activityItem(activity()).id).toBe(computeActivityId(USER, "gpslogger", "9001"))
  })

  /**
   * CRITERION 2. Purity is what makes this assertable: `activityItem` takes no clock,
   * so the same activity serialises to the same bytes forever. With `createdAt` set
   * from `new Date()` this test could only have compared "everything except the fields
   * that always differ", which is not the property the criterion asks for.
   */
  it("re-persisting the same activity produces identical bytes", () => {
    expect(JSON.stringify(activityItem(activity()))).toBe(
      JSON.stringify(activityItem(activity())),
    )
  })

  /**
   * D-207. The row is written as raw DynamoDB so it can join a transaction, which
   * makes the pipeline responsible for Amplify's own item conventions. Without these
   * the row exists in DynamoDB and is invisible in the app — nothing errors, which is
   * what makes it worth pinning.
   */
  it("carries the Amplify model metadata the client needs to read it", () => {
    const item = activityItem(activity())
    expect(item.__typename).toBe("Activity")
    expect(item.owner).toBe(`${USER}::${USER}`)
    expect(item.createdAt).toBe("2026-09-06T04:00:01.000Z")
    expect(item.updatedAt).toBe("2026-09-06T04:00:01.000Z")
  })

  /**
   * 05 §8.2 and §7.2: written even when zero, so a reader never has to know which era
   * wrote a row and "absent" never has to be told apart from "none".
   */
  it("writes the game-layer counters even for an activity with no cells", () => {
    const item = activityItem(activity({ hasTrace: false, traceRef: null }))
    for (const field of [
      "xpAwarded",
      "cellCount",
      "newCellCount",
      "rearmedCellCount",
      "cooledCellCount",
    ]) {
      expect(item[field], field).toBe(0)
    }
    expect(item.status).toBe("ACTIVE")
  })

  /** Null traceRef is a NORMAL outcome — treadmill, manual, strength — not an error. */
  it("keeps a null traceRef as null rather than omitting it", () => {
    const item = activityItem(activity({ hasTrace: false, traceRef: null }))
    expect(item.traceRef).toBeNull()
    expect("traceRef" in item).toBe(true)
    expect(item.hasTrace).toBe(false)
  })

  /** The trace lives in `raw/` and as a derived object; T3 carries no point arrays. */
  it("stores no trace points", () => {
    expect(JSON.stringify(activityItem(activity()))).not.toContain("points")
  })
})

describe("the transaction", () => {
  it("is ONE TransactWriteItems holding the Activity put and the receipt transition", async () => {
    const { deps, sent } = stub()

    await persistActivity(activity(), { ingestKey: KEY }, deps)

    expect(sent).toHaveLength(1)
    expect(sent[0]).toBeInstanceOf(TransactWriteCommand)

    const list = items(sent)
    expect(list).toHaveLength(2)
    expect(list[0].Put?.TableName).toBe(ACTIVITY_TABLE)
    expect(list[1].Update?.TableName).toBe(INGEST_RECEIPT_TABLE)
  })

  /** T8 layer 3: the DONE transition is guarded, so a receipt nobody claimed fails it all. */
  it("guards the receipt transition on PROCESSING", async () => {
    const { deps, sent } = stub()

    await persistActivity(activity(), { ingestKey: KEY }, deps)

    const update = items(sent)[1].Update
    expect(update?.ConditionExpression).toBe("#status = :processing")
    expect(update?.Key).toEqual({ ingestKey: KEY })
  })

  /**
   * Capability 09's seam. Stated as a test because the alternative — discovering at
   * the time that the signature has to change — means restructuring the atomic commit,
   * which is the one piece of code nobody wants to be editing under pressure.
   */
  it("accepts extra items so the ledger can join without a refactor", async () => {
    const { deps, sent } = stub()
    const ledgerRow = { Put: { TableName: "XpLedgerEntry", Item: { id: "a#run#discovery#v1" } } }

    await persistActivity(activity(), { ingestKey: KEY }, deps, [ledgerRow])

    expect(items(sent)).toHaveLength(3)
    expect(items(sent)[2]).toEqual(ledgerRow)
  })

  /**
   * I-10 / D-144, AND IT IS THE ASSERTION THAT MATTERS MOST HERE. Adding cells to this
   * transaction works for every activity under 98 cells and then starts failing at the
   * 100-item cap — on exactly the long runs that reveal the most ground. The repair for
   * scored-but-unrevealed ground is re-fogging, which D-020 forbids outright.
   */
  it("REFUSES a cell write in the transaction", async () => {
    const { deps, sent } = stub()
    const cellWrite = {
      Put: { TableName: "ExploredCell", Item: { PK: `U#${USER}#C#8628308ffffffff`, SK: "8a2..." } },
    }

    await expect(
      persistActivity(activity(), { ingestKey: KEY }, deps, [cellWrite]),
    ).rejects.toThrow(/I-10/)

    /** And it refuses BEFORE sending, so nothing partial reaches DynamoDB. */
    expect(sent).toHaveLength(0)
  })

  it("recognises a cell write however it is expressed", () => {
    const shapes: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
      { Put: { TableName: "t", Item: { PK: "U#u#C#86283" } } },
      { Update: { TableName: "t", Key: { PK: "U#u#C#86283" }, UpdateExpression: "SET x = :x" } },
      { Delete: { TableName: "t", Key: { pk: "U#u#C#86283" } } },
    ]
    for (const item of shapes) {
      expect(() => assertNoCellWrites([item])).toThrow(/I-10/)
    }
  })

  it("does not mistake the receipt or a ledger row for a cell write", () => {
    expect(() =>
      assertNoCellWrites([
        { Put: { TableName: "t", Item: { PK: `U#${USER}#PROFILE` } } },
        { Put: { TableName: "t", Item: { id: "a#run#discovery#v1" } } },
      ]),
    ).not.toThrow()
  })

  /**
   * A failed transaction writes NOTHING — that is what `TransactWriteItems` means, and
   * it is why this function does no cleanup. The receipt stays `PROCESSING` and the
   * score gate's stale clause reclaims it on the next delivery.
   */
  it("leaves no partial write when the transaction throws", async () => {
    const { deps, sent } = stub(new Error("TransactionCanceledException"))

    await expect(persistActivity(activity(), { ingestKey: KEY }, deps)).rejects.toThrow(
      "TransactionCanceledException",
    )

    /** One attempt, no compensating write, no retry loop of its own. */
    expect(sent).toHaveLength(1)
  })

  it("defaults the receipt numbers to zero before capability 09 exists", async () => {
    const { deps, sent } = stub()

    await persistActivity(activity(), { ingestKey: KEY }, deps)

    const values = items(sent)[1].Update?.ExpressionAttributeValues
    expect(values?.[":xpAwarded"]).toBe(0)
    expect(values?.[":newCellCount"]).toBe(0)
  })
})
