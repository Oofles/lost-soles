import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

import { BatchGetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { latLngToCell } from "h3-js"
import { describe, expect, expectTypeOf, it } from "vitest"

import type { FoldedCell } from "@/src/domain/fold"
import { RES } from "@/src/domain/fog"

import { cellUpdate, firstRunBackfill, type CellWriteActivity } from "./explored-cells"
import { mergeFoldedCells } from "./explored-merge"
import { t6Items } from "./rebuild-drill-back"

/**
 * D-120 / I-9 — EVERY EXPLORED CELL CARRIES `lastRunAt`, AND NO CODE PATH WRITES A PRESENCE BIT.
 * Ticket `0116`, `09-roadmap.md` §9.2.
 *
 * A presence bit is the one schema mistake D-120 cannot recover from: the six-month re-arm and the
 * 50% credit are functions of `activity.startedAt − lastRunAt`, and a boolean throws away the only
 * input they have — permanently, on a map that never re-fogs (D-020). So the absence is asserted
 * STRUCTURALLY, three ways:
 *
 *   1. by the TYPE every writer builds from (`FoldedCell`): `lastRunAt` is a required string and no
 *      field is a boolean;
 *   2. by RUNNING every T6 cell writer — ingest's primary write and its backfill, the replay's merge,
 *      the drill's item builder — and checking what each one sends;
 *   3. by GREP: the set of modules that build a T6 cell key is closed, and nothing in the app writes a
 *      boolean-shaped "explored / visited / revealed" attribute or a DynamoDB `BOOL`.
 */

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const USER = "u-1"
const CELL_A = latLngToCell(-48.876, -123.393, RES)
const CELL_B = latLngToCell(-48.8735, -123.393, RES)
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
const RUN: CellWriteActivity = {
  userId: USER,
  activityId: "a-1",
  startedAt: "2026-06-01T06:00:00.000Z",
} as CellWriteActivity

const FOLDED: FoldedCell = {
  firstRunAt: "2025-01-01T06:00:00.000Z",
  firstRunId: "a-0",
  lastRunAt: "2026-06-01T06:00:00.000Z",
  lastRunId: "a-1",
  visitCount: 2,
  discoveryCount: 1,
}

/** No value a cell writer sends or stores may be a boolean — that is what a presence bit IS. */
const booleans = (values: Record<string, unknown> | undefined) =>
  Object.entries(values ?? {}).filter(([, v]) => typeof v === "boolean").map(([k]) => k)

describe("D-120 / I-9 — every explored cell carries lastRunAt, and no code path writes a presence bit", () => {
  it("by type: FoldedCell's lastRunAt is a required string, and no field of it is a boolean", () => {
    expectTypeOf<FoldedCell["lastRunAt"]>().toEqualTypeOf<string>()
    expectTypeOf<FoldedCell["firstRunAt"]>().toEqualTypeOf<string>()
    type BooleanKeys = { [K in keyof FoldedCell]-?: FoldedCell[K] extends boolean ? K : never }[keyof FoldedCell]
    expectTypeOf<BooleanKeys>().toEqualTypeOf<never>()
  })

  it("ingest's primary write SETs lastRunAt to the run's ISO startedAt, and sends no boolean", () => {
    for (const claim of [undefined, {}, { seen: "2025-01-01T06:00:00.000Z" }]) {
      const u = cellUpdate(CELL_A, RUN, 1, "T6", claim)
      expect(u.UpdateExpression).toMatch(/\blastRunAt = :at\b/)
      expect(u.ExpressionAttributeValues![":at"]).toMatch(ISO)
      expect(booleans(u.ExpressionAttributeValues)).toEqual([])
    }
  })

  it("ingest's backfill write can only apply to an item that already has a lastRunAt", () => {
    const u = firstRunBackfill(CELL_A, RUN, 0, "T6")
    // `firstRunAt > :at` is false on an absent attribute, so this write can never CREATE a cell:
    // every cell is born through the primary write, which sets lastRunAt.
    expect(u.ConditionExpression).toBe("firstRunAt > :at")
    expect(u.UpdateExpression).not.toMatch(/lastRunAt/)
    expect(booleans(u.ExpressionAttributeValues)).toEqual([])
  })

  it("the replay's merge SETs lastRunAt on every cell it writes, and sends no boolean", async () => {
    const sent: UpdateCommand["input"][] = []
    const ddb = {
      async send(c: unknown) {
        if (c instanceof BatchGetCommand) return { Responses: {} }
        if (c instanceof UpdateCommand) sent.push(c.input)
        return {}
      },
    }
    await mergeFoldedCells(USER, new Map([[CELL_A, FOLDED], [CELL_B, { ...FOLDED, lastRunId: "a-2" }]]), { ddb, table: "T6" })
    const cellWrites = sent.filter((u) => String(u.Key!.pk).includes("#C#"))
    expect(cellWrites).toHaveLength(2)
    for (const u of sent) expect(booleans(u.ExpressionAttributeValues)).toEqual([])
    for (const u of cellWrites) {
      expect(u.UpdateExpression).toMatch(/\blastRunAt = :la\b/)
      expect(u.ExpressionAttributeValues![":la"]).toMatch(ISO)
    }
  })

  it("the drill's T6 items each carry an ISO lastRunAt, and no attribute is a boolean", () => {
    const items = t6Items(USER, new Map([[CELL_A, FOLDED], [CELL_B, FOLDED]]))
    const cells = items.filter((i) => String(i.pk).includes("#C#"))
    expect(cells).toHaveLength(2)
    for (const i of cells) expect(i.lastRunAt).toMatch(ISO)
    for (const i of items) expect(booleans(i)).toEqual([])
  })

  it("by grep: only the known writers build a T6 cell key, and nothing writes a boolean explored-ness", () => {
    const files = (dir: string, acc: string[] = []): string[] => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue
        const p = join(dir, e.name)
        if (e.isDirectory()) files(p, acc)
        else if (/\.(ts|tsx|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) acc.push(p)
      }
      return acc
    }
    const sources = ["src", "lib", "app", "components", "amplify", "tools"].flatMap((d) => files(join(ROOT, d)))
    expect(sources.length).toBeGreaterThan(100)

    // A new module that addresses T6 cell items must come here and be checked above.
    const keyBuilders = sources
      .filter((f) => /cellKey\(|`U#\$\{[^}]+\}#C#/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f))
      .sort()
    expect(keyBuilders).toEqual([
      "src/pipeline/explored-cells.ts",
      "src/pipeline/explored-merge.ts",
      "src/pipeline/explored-rebuild.ts",
      "src/pipeline/rebuild-drill-back.ts",
    ])

    const PRESENCE = /\b(explored|visited|revealed|discovered|isExplored|isRevealed|isVisited|hasRun)\s*[:=]\s*(true|false)\b|["']BOOL["']|\bBOOL\s*:/
    const offenders = sources.filter((f) => PRESENCE.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f))
    expect(offenders).toEqual([])
  })
})
