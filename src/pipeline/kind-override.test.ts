import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3"
import { describe, expect, it } from "vitest"

import type { Activity } from "@/src/domain/activity"
import {
  applyKindOverride,
  assertKnownKind,
  kindOverrideKey,
  knownKinds,
  newKindOverrideId,
  readKindOverride,
  recordKindOverride,
  UnknownKindError,
  type KindOverride,
} from "@/src/pipeline/kind-override"
import { archivePrefix } from "@/src/pipeline/replay"
import { loadRuleSet } from "@/src/rules/load"

/** Ticket `0243`, D-284. The storage half: where the fact lives, which one wins, what it changes. */

const ADDRESS = { userId: "u-1", source: "gpslogger" as const, externalId: "9001" }
const OVERRIDE: KindOverride = {
  id: "20261007T120000000Z-aaaaaa",
  activityId: "a",
  ...ADDRESS,
  derivedKind: "ride",
  kind: "walk",
  setBy: "operator",
  setAt: "2026-10-07T12:00:00.000Z",
}

describe("where it lives", () => {
  it("is a sibling of the archive prefix, never inside it — a replay must not read it as the run", () => {
    const key = kindOverrideKey(ADDRESS, OVERRIDE.id)
    expect(key).toBe("raw/u-1/gpslogger/9001.kind-override/20261007T120000000Z-aaaaaa.json")
    expect(key.startsWith(archivePrefix(ADDRESS))).toBe(false)
  })

  it("ids sort in time order, so the newest is the greatest key", () => {
    const a = newKindOverrideId(new Date("2026-10-07T12:00:00.000Z"), () => 0.9)
    const b = newKindOverrideId(new Date("2026-10-07T12:00:00.001Z"), () => 0.1)
    expect(a < b).toBe(true)
  })
})

describe("recordKindOverride", () => {
  it("writes the derived kind, the new kind, who and when — under IfNoneMatch, as raw/* demands", async () => {
    const puts: PutObjectCommand["input"][] = []
    const key = await recordKindOverride(OVERRIDE, {
      bucket: "b",
      s3: { send: async (c: PutObjectCommand) => void puts.push(c.input) } as never,
    })
    expect(key).toBe(kindOverrideKey(ADDRESS, OVERRIDE.id))
    expect(puts[0]!.IfNoneMatch).toBe("*")
    expect(JSON.parse(String(puts[0]!.Body))).toMatchObject({ derivedKind: "ride", kind: "walk", setBy: "operator", setAt: OVERRIDE.setAt })
  })

  it("a 412 is the same object already landed, and is success", async () => {
    const s3 = { send: async () => { throw Object.assign(new Error("pf"), { name: "PreconditionFailed" }) } }
    await expect(recordKindOverride(OVERRIDE, { bucket: "b", s3: s3 as never })).resolves.toBeTypeOf("string")
  })
})

describe("readKindOverride", () => {
  function bucket(objects: KindOverride[]) {
    return {
      bucket: "b",
      s3: {
        async send(c: unknown) {
          if (c instanceof ListObjectsV2Command) {
            return { Contents: objects.map((o) => ({ Key: `${c.input.Prefix}${o.id}.json` })) }
          }
          const key = String((c as GetObjectCommand).input.Key)
          const o = objects.find((x) => key.endsWith(`${x.id}.json`))
          return { Body: { transformToString: async () => JSON.stringify(o) } }
        },
      } as never,
    }
  }

  it("is null for an activity nobody corrected", async () => {
    expect(await readKindOverride(ADDRESS, bucket([]))).toBeNull()
  })

  it("returns the newest by key, a later override being a new object", async () => {
    const later = { ...OVERRIDE, id: "20261008T090000000Z-bbbbbb", kind: "hike" as const }
    const found = await readKindOverride(ADDRESS, bucket([later, OVERRIDE]))
    expect(found?.override.kind).toBe("hike")
    expect(found?.key).toBe(kindOverrideKey(ADDRESS, later.id))
  })
})

describe("the kinds the rules know", () => {
  const v2 = loadRuleSet(2)

  it("are the kinds an enabled activity row matches on", () => {
    expect([...knownKinds(v2)].sort()).toEqual(["hike", "other", "ride", "run", "strength", "walk"])
  })

  it("anything else is refused", () => {
    expect(() => assertKnownKind("swim", v2)).toThrow(UnknownKindError)
    expect(() => assertKnownKind("walk", v2)).not.toThrow()
  })
})

describe("applyKindOverride", () => {
  const activity = { activityId: "a", kind: "ride" } as Activity

  it("replaces only the kind, and keeps what normalize derived beside it", () => {
    const out = applyKindOverride(activity, { override: OVERRIDE, key: "k" })
    expect(out.kind).toBe("walk")
    expect(out.derivedKind).toBe("ride")
    expect(out.kindOverride).toEqual({ kind: "walk", derivedKind: "ride", setBy: "operator", setAt: OVERRIDE.setAt, key: "k" })
  })

  it("without one, the kind is the derived kind and the mirror is null", () => {
    expect(applyKindOverride(activity, null)).toMatchObject({ kind: "ride", derivedKind: "ride", kindOverride: null })
  })
})
