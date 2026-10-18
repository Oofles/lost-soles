import { gzipSync } from "node:zlib"

import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3"
import { QueryCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import { encodeExploredBlob } from "@/src/domain/explored-blob"
import { objectKeys } from "@/src/pipeline/explored-blob-store"

import { ALL, AFTER_CELLS, BEFORE_CELLS, DURING, IMPORTED, PRE, WINDOW } from "./__fixtures__/three-hundred"
import { markOf, parseBackfillBatch } from "./batch"
import { backfillBatchKey, batchActivities, buildBackfillBatch, readBackfillBatch, writeBackfillBatch } from "./store"

/**
 * Ticket `0257`. The record, built from a 300-activity account against stubs of the stores it reads —
 * T3 (`byUserAndStart`), SkillState, the SkillState snapshots (D-143) and the generation-named blobs.
 */

const UID = "u-nemo"
const BUCKET = "bkt"

function fakeS3(objects: Map<string, { body: Uint8Array | string; modified: Date }>) {
  const sent: unknown[] = []
  return {
    sent,
    async send(command: unknown) {
      sent.push(command)
      if (command instanceof ListObjectsV2Command) {
        const prefix = command.input.Prefix ?? ""
        return {
          Contents: [...objects.entries()]
            .filter(([k]) => k.startsWith(prefix))
            .map(([Key, o]) => ({ Key, LastModified: o.modified })),
          IsTruncated: false,
        }
      }
      if (command instanceof GetObjectCommand) {
        const o = objects.get(command.input.Key!)
        if (!o) throw Object.assign(new Error("missing"), { name: "NoSuchKey" })
        const bytes = typeof o.body === "string" ? new TextEncoder().encode(o.body) : o.body
        return {
          Body: {
            transformToByteArray: async () => bytes,
            transformToString: async () => new TextDecoder().decode(bytes),
          },
        }
      }
      if (command instanceof PutObjectCommand) {
        objects.set(command.input.Key!, { body: String(command.input.Body), modified: new Date() })
        return {}
      }
      throw new Error(`unexpected command ${String(command)}`)
    },
  }
}

const snapshot = (takenAt: string, generation: number, xp: Record<string, number>) =>
  JSON.stringify({
    userId: UID,
    takenAt,
    rulesVersion: 3,
    generation,
    trigger: "ingest",
    skills: Object.entries(xp).map(([skillId, displayedXp]) => ({
      skillId,
      displayedXp,
      xpLedgerSum: displayedXp,
      level: 1,
      levelHighWater: 1,
      firstSeenRulesVersion: 1,
    })),
  })

function account() {
  const at = (iso: string) => new Date(iso)
  const objects = new Map<string, { body: Uint8Array | string; modified: Date }>([
    // The map the user saw before the import (gen 40), and after it (gen 340).
    [objectKeys.cells(UID, 39), { body: gzipSync(encodeExploredBlob([], 39)), modified: at("2026-09-07T05:11:00Z") }],
    [objectKeys.cells(UID, 40), { body: gzipSync(encodeExploredBlob([...BEFORE_CELLS], 40)), modified: at("2026-09-07T05:11:19Z") }],
    [objectKeys.cells(UID, 41), { body: gzipSync(encodeExploredBlob([...BEFORE_CELLS], 41)), modified: at("2026-10-16T15:10:09Z") }],
    [objectKeys.cells(UID, 340), { body: gzipSync(encodeExploredBlob([...AFTER_CELLS], 340)), modified: at("2026-10-16T15:32:31Z") }],
    [
      objectKeys.manifest(UID),
      { body: JSON.stringify({ generation: 340, res: 11, cellCount: AFTER_CELLS.length }), modified: at("2026-10-16T15:32:31Z") },
    ],
    // Snapshots: an older one, the one just before the window, and ones inside it.
    [`snapshots/skillstate/${UID}/2026-09-07T05:11:10.000Z-39.json`, { body: snapshot("2026-09-07T05:11:10.000Z", 39, { wayfaring: 100 }), modified: at("2026-09-07T05:11:10Z") }],
    [`snapshots/skillstate/${UID}/2026-10-14T02:01:30.842Z-40.json`, { body: snapshot("2026-10-14T02:01:30.842Z", 40, { wayfaring: 5159, cartography: 16439 }), modified: at("2026-10-14T02:01:30Z") }],
    [`snapshots/skillstate/${UID}/2026-10-16T15:10:40.628Z-41.json`, { body: snapshot("2026-10-16T15:10:40.628Z", 41, { wayfaring: 9999 }), modified: at("2026-10-16T15:10:40Z") }],
  ])
  const s3 = fakeS3(objects)
  const ddb = {
    async send(command: QueryCommand) {
      if (command.input.TableName === "Activity") {
        return { Items: ALL.map((a) => ({ id: a.id, userId: UID, startedAt: a.startedAt, ingestedAt: a.ingestedAt, status: a.status })) }
      }
      return {
        Items: [
          { userId: UID, skillId: "wayfaring", displayedXp: 31482, xpLedgerSum: 31482, levelHighWater: 30, rulesVersionLastComputed: 3 },
          { userId: UID, skillId: "cartography", displayedXp: 26678, xpLedgerSum: 26678, rulesVersionLastComputed: 3 },
        ],
      }
    },
  }
  return { objects, s3, deps: { ddb, s3, bucket: BUCKET, activityTable: "Activity", skillStateTable: "SkillState", now: () => new Date("2026-10-17T00:00:00Z") } }
}

describe("which activities the import brought in", () => {
  it("is every activity ingested in the window that is older than the account's earlier ones", () => {
    const { pre, batch } = batchActivities(ALL, WINDOW)
    expect(pre).toHaveLength(PRE.length)
    expect(batch.map((r) => r.id)).toEqual(IMPORTED.map((a) => a.id))
    // A run recorded and synced while the import ran is a new run, not history.
    for (const d of DURING) expect(batch.map((r) => r.id)).not.toContain(d.id)
  })

  it("is everything in the window when the import was the account's first", () => {
    const { batch } = batchActivities([...IMPORTED, ...DURING], WINDOW)
    expect(batch).toHaveLength(IMPORTED.length + DURING.length)
  })

  it("leaves out a tombstoned row and one ingested after the window closed", () => {
    const rows = [...PRE, { ...IMPORTED[0]!, status: "TOMBSTONED" }, { ...IMPORTED[1]!, ingestedAt: "2026-10-16T15:31:00.001Z" }]
    expect(batchActivities(rows, WINDOW).batch).toEqual([])
  })
})

describe("buildBackfillBatch, over a 300-activity account (criterion 5)", () => {
  it("records the 278 imported activities, and the standing before and after", async () => {
    const { deps } = account()
    const b = await buildBackfillBatch(UID, WINDOW, deps as never)

    expect(b.batchId).toBe(WINDOW.from)
    expect(b.imported.count).toBe(278)
    expect(b.activityIds).toEqual(IMPORTED.map((a) => a.id).sort())
    expect(b.imported.firstStartedAt).toBe(IMPORTED[0]!.startedAt)
    expect(b.imported.lastStartedAt).toBe(IMPORTED.at(-1)!.startedAt)

    // BEFORE: the newest snapshot taken before the window, and the newest blob published before it.
    expect(b.before.generation).toBe(40)
    expect(b.before.cells).toBe(BEFORE_CELLS.length)
    expect(b.before.activities).toBe(20)
    expect(Object.fromEntries(b.before.skills.map((s) => [s.skillId, s.xp]))).toEqual({ wayfaring: 5159, cartography: 16439 })

    // AFTER: the account now — SkillState and the manifest.
    expect(b.after.generation).toBe(340)
    expect(b.after.cells).toBe(AFTER_CELLS.length)
    expect(b.after.activities).toBe(300)
    expect(Object.fromEntries(b.after.skills.map((s) => [s.skillId, s.xp]))).toEqual({ wayfaring: 31482, cartography: 26678 })
    expect(b.after.totalLevel).toBeGreaterThan(b.before.totalLevel)
    expect(b.after.totalXp).toBe(31482 + 26678)
  })

  it("refuses a window that closes before it opens", async () => {
    const { deps } = account()
    await expect(buildBackfillBatch(UID, { from: WINDOW.to, to: WINDOW.from }, deps as never)).rejects.toThrow(/window/)
  })

  it("round-trips through the object it writes, and serves the browser no ids", async () => {
    const { deps, objects } = account()
    const b = await buildBackfillBatch(UID, WINDOW, deps as never)
    const key = await writeBackfillBatch(b, UID, { s3: deps.s3 as never, bucket: BUCKET })
    expect(key).toBe(backfillBatchKey(UID))
    expect(key.startsWith(`users/${UID}/`)).toBe(true)
    expect(parseBackfillBatch(String(objects.get(key)!.body))).toEqual(b)
    expect(await readBackfillBatch(UID, { s3: deps.s3 as never, bucket: BUCKET })).toEqual(b)
    expect(JSON.stringify(markOf(b))).not.toContain(IMPORTED[0]!.id)
  })

  it("reads no record as null, not an error", async () => {
    const { deps } = account()
    expect(await readBackfillBatch("someone-else", { s3: deps.s3 as never, bucket: BUCKET })).toBeNull()
  })

  it("never writes while building", async () => {
    const { deps, s3 } = account()
    await buildBackfillBatch(UID, WINDOW, deps as never)
    expect(s3.sent.some((c) => c instanceof PutObjectCommand)).toBe(false)
  })
})
