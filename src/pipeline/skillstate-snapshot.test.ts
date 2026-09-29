import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3"
import { describe, expect, it } from "vitest"

import { loadRuleSet } from "@/src/rules/load"
import { levelForXp } from "@/src/scoring"

import {
  buildSnapshot,
  latestSnapshot,
  snapshotKey,
  waterlineOfSnapshot,
  writeSnapshot,
  type SkillStateSnapshot,
} from "./skillstate-snapshot"

/** Ticket `0067`. D-143, `02-data-model.md` §8.2. The S3 shapes; the orchestration is tested where it runs. */

const V1 = loadRuleSet(1)
const BUCKET = "b"

const snap = (takenAt: string, generation: number, xp = 100): SkillStateSnapshot =>
  buildSnapshot({
    userId: "u-1",
    takenAt,
    generation,
    trigger: "ingest",
    rules: V1,
    rows: [{ skillId: "wayfaring", displayedXp: xp, xpLedgerSum: xp }],
  })

describe("buildSnapshot", () => {
  it("covers every registry skill, and fills level and levelHighWater from the curve when T2 lacks them", () => {
    const s = snap("2026-09-29T12:00:00.000Z", 4, 5_000)
    expect(s.skills.map((k) => k.skillId)).toEqual(V1.skills.map((k) => k.id).sort())
    const way = s.skills.find((k) => k.skillId === "wayfaring")!
    expect(way.level).toBe(levelForXp(5_000, V1.curve))
    expect(way.levelHighWater).toBe(way.level)
    expect(way.firstSeenRulesVersion).toBe(V1.skills.find((k) => k.id === "wayfaring")!.introducedIn)
  })

  it("keeps a stored high-water above the computed level (I-17)", () => {
    const s = buildSnapshot({
      userId: "u-1",
      takenAt: "t",
      generation: 0,
      trigger: "ingest",
      rules: V1,
      rows: [{ skillId: "wayfaring", displayedXp: 10, level: 1, levelHighWater: 9 }],
    })
    expect(s.skills.find((k) => k.skillId === "wayfaring")).toMatchObject({ level: 1, levelHighWater: 9 })
    expect(waterlineOfSnapshot(s).wayfaring).toEqual({ xp: 10, level: 9 })
  })

  it("an untrained skill is in the snapshot but constrains nothing in the waterline", () => {
    const w = waterlineOfSnapshot(snap("t", 0))
    expect(Object.keys(w)).toEqual(["wayfaring"])
  })
})

describe("writeSnapshot", () => {
  it("PUTs plain JSON under <uid>/<takenAt>-<generation>.json with IfNoneMatch", async () => {
    const sent: PutObjectCommand[] = []
    const s = snap("2026-09-29T12:00:00.000Z", 7)
    const key = await writeSnapshot(s, { bucket: BUCKET, s3: { send: async (c: PutObjectCommand) => void sent.push(c) } as never })

    expect(key).toBe("snapshots/skillstate/u-1/2026-09-29T12:00:00.000Z-7.json")
    expect(key).toBe(snapshotKey(s))
    expect(sent[0]!.input).toMatchObject({ Bucket: BUCKET, Key: key, IfNoneMatch: "*", ContentType: "application/json" })
    expect(JSON.parse(String(sent[0]!.input.Body))).toEqual(s)
  })
})

describe("latestSnapshot", () => {
  function bucket(objects: Record<string, SkillStateSnapshot>, pageSize = 2) {
    const keys = Object.keys(objects)
    const lists: ListObjectsV2Command["input"][] = []
    const s3 = {
      async send(c: ListObjectsV2Command | GetObjectCommand) {
        if (c instanceof ListObjectsV2Command) {
          lists.push(c.input)
          const start = Number(c.input.ContinuationToken ?? 0)
          const page = keys.filter((k) => k.startsWith(c.input.Prefix!)).slice(start, start + pageSize)
          const more = start + pageSize < keys.length
          return { Contents: page.map((Key) => ({ Key })), IsTruncated: more, NextContinuationToken: more ? String(start + pageSize) : undefined }
        }
        const body = JSON.stringify(objects[c.input.Key!])
        return { Body: { transformToString: async () => body } }
      },
    }
    return { deps: { bucket: BUCKET, s3: s3 as never }, lists }
  }

  it("returns the newest by key across pages — ISO takenAt sorts", async () => {
    const all = [snap("2026-01-01T00:00:00.000Z", 1, 1), snap("2026-09-29T12:00:00.000Z", 9, 900), snap("2026-05-01T00:00:00.000Z", 5, 5)]
    const { deps, lists } = bucket(Object.fromEntries(all.map((s) => [snapshotKey(s), s])))
    const got = await latestSnapshot("u-1", deps)
    expect(got?.takenAt).toBe("2026-09-29T12:00:00.000Z")
    expect(lists).toHaveLength(2)
    expect(lists[0]!.Prefix).toBe("snapshots/skillstate/u-1/")
  })

  it("is undefined for a user who was never snapshotted", async () => {
    const { deps } = bucket({})
    expect(await latestSnapshot("u-1", deps)).toBeUndefined()
  })
})
