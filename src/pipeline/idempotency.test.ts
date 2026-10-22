import { describe, expect, it } from "vitest"

import { JOB, LEDGER_TABLE, PROFILE_TABLE, SKILL_STATE_TABLE, ACTIVITY_TABLE, TRACE, rig } from "./__fixtures__/process-rig"
import { statefulCellTable } from "./__fixtures__/stateful-cell-table"
import { INGEST_RECEIPT_TABLE } from "./ingest-receipt"
import { processActivity } from "./process-activity"

/**
 * I-21 / I-23 — RE-PROCESSING AN ALREADY-INGESTED ACTIVITY WRITES NOTHING FURTHER. Ticket `0116`;
 * `09-roadmap.md` §9.2 *"changes zero cells, zero timestamps, zero ledger rows (idempotency, T8)"*.
 *
 * Measured as WRITES THAT APPLIED, never as a final state that happens to match: a counter that is
 * incremented twice and decremented once also "ends where it started". The T6 side runs against a
 * stateful table that evaluates the real conditions (`stateful-cell-table.ts`); the ledger side is
 * the transaction the pipeline actually sent.
 *
 * Two re-processings, because the design has two defences and a TTL between them:
 *
 *   - **within the receipt's 90 days** (T8 layer 2): the score gate answers DONE and the pipeline
 *     sends NO write at all to T6, T4, T2, T1 or S3;
 *   - **after the receipt expired, or by `reingest`** (I-23, D-254): every gate is passed again. The
 *     cell writes are attempted and refused by their own conditions, and the ledger is refused by
 *     layer 1 (an `isFloor = false` row already exists for this activity). What still goes out is
 *     listed by the last test, by name, so it cannot grow unnoticed.
 */

const TRACED_RUN = { hasTrace: true, trace: TRACE, distanceM: 280 }

/** The T4 rows a delivery committed, as `byActivity` would return them to a later one. */
const ledgerRowsOf = (transacts: ReturnType<typeof rig>["transacts"]) =>
  transacts.flatMap((t) => t.TransactItems ?? []).filter((i) => i.Put?.TableName === LEDGER_TABLE).map((i) => i.Put!.Item!)

const writesTo = (transacts: ReturnType<typeof rig>["transacts"], table: string) =>
  transacts.flatMap((t) => t.TransactItems ?? []).filter((i) => (i.Put ?? i.Update ?? i.Delete)?.TableName === table)

describe("I-21 — re-ingesting an activity awards nothing further", () => {
  it("within the receipt TTL: a DONE receipt means zero writes to cells, aggregates, ledger, SkillState, Profile and the map", async () => {
    const t6 = statefulCellTable()
    const second = rig({ ingest: TRACED_RUN, cellsTable: t6, claim: { kind: "duplicate", attributes: { status: "DONE", xpAwarded: 28, newCellCount: 4 } } })

    expect(await processActivity(JOB, second.deps)).toEqual({ outcome: "already-done", xpAwarded: 28, newCellCount: 4 })

    expect(second.cellWrites).toHaveLength(0)
    expect(second.aggWrites).toHaveLength(0)
    expect(second.transacts).toHaveLength(0)
    expect(second.blobPuts).toHaveLength(0)
    expect(second.snapshotPuts).toHaveLength(0)
    expect(second.calls).not.toContain("generation")
    expect(t6.applied).toEqual({ cell: 0, agg: 0 })
  })
})

describe("I-21 / I-23 — after the receipt expired, a re-processing still applies zero cell writes and zero ledger rows", () => {
  async function twice() {
    const t6 = statefulCellTable()
    const first = rig({ ingest: TRACED_RUN, cellsTable: t6 })
    const r1 = await processActivity(JOB, first.deps)
    if (r1.outcome !== "persisted") throw new Error(`first delivery: ${r1.outcome}`)
    const t3Row = writesTo(first.transacts, ACTIVITY_TABLE).at(-1)!.Put!.Item!
    const cellsAfterFirst = structuredClone([...t6.store.entries()])
    const firstApplied = { ...t6.applied }
    t6.resetCounts()

    // The receipt is gone (TTL) or bypassed (reingest): the gate claims again. Layer 1 sees the
    // first delivery's ledger rows; T3 holds the first delivery's row.
    const second = rig({ ingest: TRACED_RUN, cellsTable: t6, ledgerExisting: ledgerRowsOf(first.transacts), storedActivity: t3Row })
    const r2 = await processActivity(JOB, second.deps)
    if (r2.outcome !== "persisted") throw new Error(`second delivery: ${r2.outcome}`)
    return { t6, first, second, r1, r2, cellsAfterFirst, firstApplied }
  }

  it("the first delivery really did write: cells, aggregates and ledger rows exist to be re-written", async () => {
    const { firstApplied, first, r1 } = await twice()
    expect(firstApplied.cell).toBeGreaterThan(0)
    expect(firstApplied.agg).toBeGreaterThan(0)
    expect(ledgerRowsOf(first.transacts).length).toBeGreaterThan(0)
    expect(r1.xp).toMatchObject({ alreadyScored: false })
  })

  it("zero ExploredCell writes apply — the attempts are refused by their own conditions (I-8's max)", async () => {
    const { t6, second } = await twice()
    expect(second.cellWrites.length).toBeGreaterThan(0)
    expect(t6.applied.cell).toBe(0)
  })

  it("zero timestamps move: every cell's firstRunAt and lastRunAt is what the first delivery wrote", async () => {
    const { t6, cellsAfterFirst } = await twice()
    const stamps = (entries: Array<[string, Record<string, unknown>]>) =>
      entries.filter(([k]) => k.includes("#C#")).map(([k, i]) => [k, i.firstRunAt, i.lastRunAt, i.visitCount, i.discoveryCount])
    expect(stamps([...t6.store.entries()])).toEqual(stamps(cellsAfterFirst))
  })

  it("zero ledger rows, zero SkillState ADDs, zero Profile writes, and the first delivery's XP is what it reports", async () => {
    const { second, r1, r2 } = await twice()
    expect(writesTo(second.transacts, LEDGER_TABLE)).toHaveLength(0)
    expect(writesTo(second.transacts, SKILL_STATE_TABLE)).toHaveLength(0)
    expect(writesTo(second.transacts, PROFILE_TABLE)).toHaveLength(0)
    expect(r2.xp).toMatchObject({ alreadyScored: true, rowsWritten: 0, xpAwarded: r1.xp.xpAwarded })
  })

  it("what it does still send is named: the aggregate upkeep (changing nothing), the T3 put, the receipt, the publish", async () => {
    const { t6, second } = await twice()
    // `writeAggregates` is unconditional by design (explored-cells.ts: "runs even when count is 0"):
    // the writes APPLY, and change no attribute.
    expect(t6.changed.agg).toBe(0)
    // The T3 row is re-put with the first delivery's award (D-254, D-260) — no XP, no ledger.
    // The explored blob is regenerated from the touched set: a new generation over identical cells
    // (I-11 holds; the map is unchanged). Value-idempotent, but a write — see 0116's Resolution.
    expect(second.calls).toContain("generation")
    expect(second.calls).toContain("blobs")
    // Exactly one transaction, of exactly two items: the T3 row and the receipt's DONE.
    expect(second.transacts).toHaveLength(1)
    expect(second.transacts[0]!.TransactItems!.map((i) => (i.Put ?? i.Update)?.TableName).sort()).toEqual(
      [ACTIVITY_TABLE, INGEST_RECEIPT_TABLE].sort(),
    )
  })
})
