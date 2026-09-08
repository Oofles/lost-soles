import { gunzipSync, gzipSync } from "node:zlib"

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { gridDisk, latLngToCell } from "h3-js"
import { beforeEach, describe, expect, it } from "vitest"

import { computeAgg } from "@/src/domain/explored-agg"
import {
  cellToBig,
  decodeDeltaBlob,
  decodeExploredBlob,
  decodeLastRunBlob,
} from "@/src/domain/explored-blob"
import { RES } from "@/src/domain/fog"

import { raiseGenerationTo } from "./explored-generation"

import {
  DELTA_CHAIN_KEEP,
  IMMUTABLE_CACHE_CONTROL,
  MANIFEST_CACHE_CONTROL,
  expiringDeltaGenerations,
  objectKeys,
  readDeltaChain,
  readManifest,
  regenerateExplored,
  type BlobStoreDeps,
} from "./explored-blob-store"

/** Synthetic geography, Point Nemo (08 §7.2, D-199). */
const ORIGIN = latLngToCell(-48.876, -123.393, RES)
const USER = "u-test"

interface StoredObject {
  body: Uint8Array
  contentType?: string
  contentEncoding?: string
  cacheControl?: string
  etag: string
}

/**
 * An S3 that ENFORCES the preconditions rather than recording them.
 *
 * The same reasoning `explored-cells.test.ts` gives for evaluating condition expressions:
 * a fake that stored `IfMatch` and let the test assert the string would pass whether or
 * not S3 would have refused the write, and the refusal is the mechanism under test.
 */
class FakeS3 {
  readonly objects = new Map<string, StoredObject>()
  readonly gets: string[] = []
  readonly puts: PutObjectCommand[] = []
  private seq = 0
  /** Runs immediately before a PUT lands. Lets a test publish a rival generation mid-flight. */
  beforePut?: (key: string) => void

  /** Set to make every delete fail the way a missing grant would. */
  failDeletes = false

  send = async (
    command: GetObjectCommand | PutObjectCommand | DeleteObjectCommand,
  ): Promise<unknown> => {
    if (command instanceof DeleteObjectCommand) {
      if (this.failDeletes) throw new Error("AccessDenied")
      this.objects.delete(command.input.Key!)
      return {}
    }
    if (command instanceof GetObjectCommand) {
      const key = command.input.Key!
      this.gets.push(key)
      const found = this.objects.get(key)
      if (found === undefined) {
        const e = new Error("The specified key does not exist.") as Error & { name: string }
        e.name = "NoSuchKey"
        throw e
      }
      return { Body: { transformToByteArray: async () => found.body }, ETag: found.etag }
    }

    const input = command.input
    const key = input.Key!
    this.beforePut?.(key)
    this.puts.push(command)
    const existing = this.objects.get(key)

    if (input.IfNoneMatch === "*" && existing !== undefined) throw preconditionFailed()
    if (input.IfMatch !== undefined && existing?.etag !== input.IfMatch) throw preconditionFailed()

    const etag = `"etag-${++this.seq}"`
    this.objects.set(key, {
      body: Uint8Array.from(input.Body as Uint8Array),
      contentType: input.ContentType,
      contentEncoding: input.ContentEncoding,
      cacheControl: input.CacheControl,
      etag,
    })
    return { ETag: etag }
  }

  /** The bytes as a decoder sees them: S3 stores what it was given, gzip included. */
  plain(key: string): Uint8Array {
    const o = this.objects.get(key)
    if (o === undefined) throw new Error(`no object at ${key}`)
    return o.contentEncoding === "gzip" ? new Uint8Array(gunzipSync(o.body)) : o.body
  }

  json<T>(key: string): T {
    return JSON.parse(Buffer.from(this.plain(key)).toString("utf8")) as T
  }
}

function preconditionFailed(): Error {
  const e = new Error("At least one of the pre-conditions you specified did not hold") as Error & {
    name: string
  }
  e.name = "PreconditionFailed"
  return e
}

/**
 * A DynamoDB that answers the counter and NOTHING ELSE. Criterion 5 — *"issuing zero T6
 * `Query` calls on the hot path"* — is asserted by this stub refusing anything that is not
 * the `ADD generation` update, which is stronger than counting `QueryCommand`s: a `Scan`,
 * a `BatchGetItem` or a `GetItem` would fail it too.
 */
class FakeCounter {
  readonly value = new Map<string, number>()
  readonly commands: unknown[] = []

  send = async (command: unknown): Promise<{ Attributes?: Record<string, unknown> }> => {
    this.commands.push(command)
    if (!(command instanceof UpdateCommand)) {
      throw new Error(
        `regenerateExplored issued a ${command?.constructor?.name} against T6. The hot path ` +
          "may only bump the generation counter (02 §5.6, §2.10).",
      )
    }
    const input = command.input
    const key = String(input.Key?.pk)
    // The drill's step 7 (02 §8.3). Not a hot-path write — no test drives it through
    // `regenerateExplored` — but the counter is the same item, so the fake must model it.
    if (input.UpdateExpression === "SET generation = :n") {
      const n = input.ExpressionAttributeValues![":n"] as number
      const current = this.value.get(key)
      if (current !== undefined && current >= n) {
        throw Object.assign(new Error("refused"), { name: "ConditionalCheckFailedException" })
      }
      this.value.set(key, n)
      return {}
    }
    if (input.UpdateExpression !== "ADD generation :one") {
      throw new Error(`unexpected T6 write on the blob path: ${input.UpdateExpression}`)
    }
    const next = (this.value.get(key) ?? 0) + 1
    this.value.set(key, next)
    return { Attributes: { generation: next } }
  }
}

let s3: FakeS3
let ddb: FakeCounter
let deps: BlobStoreDeps

beforeEach(() => {
  s3 = new FakeS3()
  ddb = new FakeCounter()
  deps = {
    s3: s3 as unknown as BlobStoreDeps["s3"],
    bucket: "b",
    ddb: ddb as unknown as BlobStoreDeps["ddb"],
    table: "T",
    now: () => new Date("2026-09-08T12:00:00.000Z"),
  }
})

const run = (k: number) => gridDisk(ORIGIN, k)

describe("objectKeys — 02 §6.1's layout, verbatim", () => {
  it("puts everything under users/<uid>/ with the generation in the name", () => {
    expect(objectKeys.manifest("u")).toBe("users/u/manifest.json")
    expect(objectKeys.cells("u", 42)).toBe("users/u/explored/explored-r10.42.bin")
    expect(objectKeys.agg("u", 42)).toBe("users/u/explored/explored-agg.42.json")
    expect(objectKeys.lastRun("u", 42)).toBe("users/u/explored/explored-lastrun-r10.42.bin")
    expect(objectKeys.delta("u", 42)).toBe("users/u/deltas/42.bin")
  })
})

describe("regenerateExplored — the first ever run", () => {
  it("bootstraps from no manifest and publishes generation 1", async () => {
    const result = await regenerateExplored({ userId: USER, touched: run(3), day: 2444 }, deps)

    expect(result.generation).toBe(1)
    expect(result.previousGeneration).toBe(0)
    expect(result.cellCount).toBe(run(3).length)
    expect(result.addedCount).toBe(run(3).length)

    const decoded = decodeExploredBlob(s3.plain(objectKeys.cells(USER, 1)))
    expect(decoded.cells).toEqual(run(3).map(cellToBig).sort((a, b) => (a < b ? -1 : 1)))
  })

  it("writes the manifest exactly as 02 §6.1 lists it", async () => {
    await regenerateExplored({ userId: USER, touched: run(2), day: 2444 }, deps)
    const manifest = s3.json<Record<string, unknown>>(objectKeys.manifest(USER))

    expect(Object.keys(manifest).sort()).toEqual([
      "agg",
      "cellCount",
      "cells",
      "deltasFrom",
      "generation",
      "lastRun",
      "res",
      "updatedAt",
    ])
    expect(manifest.res).toBe(10)
    expect(manifest.generation).toBe(1)
    expect(manifest.cellCount).toBe(run(2).length)
    expect(manifest.updatedAt).toBe("2026-09-08T12:00:00.000Z")
    expect(manifest.cells).toBe(objectKeys.cells(USER, 1))
  })

  /** CRITERION 8. */
  it("serves every <gen> object immutable for a year and the manifest no-cache", async () => {
    await regenerateExplored({ userId: USER, touched: run(2), day: 2444 }, deps)

    for (const key of [
      objectKeys.cells(USER, 1),
      objectKeys.agg(USER, 1),
      objectKeys.lastRun(USER, 1),
      objectKeys.delta(USER, 1),
    ]) {
      expect(s3.objects.get(key)!.cacheControl, key).toBe(IMMUTABLE_CACHE_CONTROL)
      expect(s3.objects.get(key)!.contentEncoding, key).toBe("gzip")
    }
    expect(IMMUTABLE_CACHE_CONTROL).toBe("public, max-age=31536000, immutable")

    const manifest = s3.objects.get(objectKeys.manifest(USER))!
    expect(manifest.cacheControl).toBe(MANIFEST_CACHE_CONTROL)
    expect(manifest.contentEncoding).toBeUndefined()
    // Readable in a browser tab — the operator step this ticket asks for.
    expect(Buffer.from(manifest.body).toString("utf8")).toContain('"generation": 1')
  })

  it("writes the aggregate the same way computeAgg does, from the merged set", async () => {
    await regenerateExplored({ userId: USER, touched: run(4), day: 2444 }, deps)
    const cells = run(4).map(cellToBig).sort((a, b) => (a < b ? -1 : 1))
    expect(s3.json(objectKeys.agg(USER, 1))).toEqual(JSON.parse(JSON.stringify(computeAgg(cells, 1))))
  })

  it("stamps every new cell's lastRunDay and keeps the sidecar parallel", async () => {
    await regenerateExplored({ userId: USER, touched: run(3), day: 2444 }, deps)
    const cells = decodeExploredBlob(s3.plain(objectKeys.cells(USER, 1)))
    const sidecar = decodeLastRunBlob(s3.plain(objectKeys.lastRun(USER, 1)))
    expect(sidecar.days).toHaveLength(cells.cells.length)
    expect(sidecar.generation).toBe(1)
    expect([...sidecar.days].every((d) => d === 2444)).toBe(true)
  })
})

describe("regenerateExplored — the incremental path (02 §2.10)", () => {
  /**
   * CRITERION 5, and the check is the FakeCounter refusing anything that is not the
   * counter bump. §5.6: *"Calling [AP-16] from `process-activity` is a review-blocking bug."*
   */
  it("reads the previous blob from S3 and issues ZERO T6 reads of any kind", async () => {
    await regenerateExplored({ userId: USER, touched: run(3), day: 2444 }, deps)
    ddb.commands.length = 0
    s3.gets.length = 0

    await regenerateExplored({ userId: USER, touched: run(4), day: 2450 }, deps)

    // One counter bump, nothing else. The fake throws on anything but `ADD generation`.
    expect(ddb.commands).toHaveLength(1)
    // The previous generation's objects, read rather than queried.
    expect(s3.gets).toContain(objectKeys.cells(USER, 1))
    expect(s3.gets).toContain(objectKeys.lastRun(USER, 1))
  })

  it("merges rather than replaces — old ground survives a new run elsewhere", async () => {
    await regenerateExplored({ userId: USER, touched: run(3), day: 2444 }, deps)
    const far = gridDisk(latLngToCell(-48.9, -123.35, RES), 2)
    const result = await regenerateExplored({ userId: USER, touched: far, day: 2450 }, deps)

    const cells = new Set(
      decodeExploredBlob(s3.plain(objectKeys.cells(USER, 2))).cells.map(String),
    )
    for (const c of [...run(3), ...far]) expect(cells.has(String(cellToBig(c)))).toBe(true)
    expect(result.cellCount).toBe(cells.size)
  })

  it("adds nothing for a run over entirely known ground, and still publishes", async () => {
    await regenerateExplored({ userId: USER, touched: run(4), day: 2444 }, deps)
    const result = await regenerateExplored({ userId: USER, touched: run(2), day: 2450 }, deps)

    expect(result.addedCount).toBe(0)
    expect(result.generation).toBe(2)
    // Operator step 3: the blob is within a few bytes of its predecessor.
    const before = s3.objects.get(objectKeys.cells(USER, 1))!.body.length
    const after = s3.objects.get(objectKeys.cells(USER, 2))!.body.length
    expect(Math.abs(after - before)).toBeLessThan(16)
  })

  it("advances lastRunDay on re-run ground and leaves the rest alone", async () => {
    await regenerateExplored({ userId: USER, touched: run(4), day: 2444 }, deps)
    await regenerateExplored({ userId: USER, touched: run(1), day: 2500 }, deps)

    const cells = decodeExploredBlob(s3.plain(objectKeys.cells(USER, 2))).cells
    const days = decodeLastRunBlob(s3.plain(objectKeys.lastRun(USER, 2))).days
    const reRun = new Set(run(1).map((c) => String(cellToBig(c))))
    for (let i = 0; i < cells.length; i++) {
      expect(days[i]).toBe(reRun.has(String(cells[i])) ? 2500 : 2444)
    }
  })

  /**
   * The array's half of I-8, end to end: a backfilled run must not drag a day backwards.
   * The `ConditionExpression` in `explored-cells.ts` enforces the same rule on the table,
   * so the blob and T6 agree without the blob path reading the table.
   */
  it("never lowers a lastRunDay when a backfill arrives", async () => {
    await regenerateExplored({ userId: USER, touched: run(2), day: 2500 }, deps)
    await regenerateExplored({ userId: USER, touched: run(2), day: 1000 }, deps)
    const days = decodeLastRunBlob(s3.plain(objectKeys.lastRun(USER, 2))).days
    expect([...days].every((d) => d === 2500)).toBe(true)
  })

  it("writes a delta naming the two generations it spans and the cells it added", async () => {
    await regenerateExplored({ userId: USER, touched: run(2), day: 2444 }, deps)
    await regenerateExplored({ userId: USER, touched: run(3), day: 2450 }, deps)

    const delta = decodeDeltaBlob(s3.plain(objectKeys.delta(USER, 2)))
    expect(delta.fromGen).toBe(1)
    expect(delta.toGen).toBe(2)
    const before = new Set(run(2).map((c) => String(cellToBig(c))))
    expect(delta.added.map(String).sort()).toEqual(
      run(3)
        .map((c) => String(cellToBig(c)))
        .filter((c) => !before.has(c))
        .sort(),
    )
  })

  it("does not report a healthy sidecar as rebuilt", async () => {
    await regenerateExplored({ userId: USER, touched: run(2), day: 2444 }, deps)
    const result = await regenerateExplored({ userId: USER, touched: run(3), day: 2450 }, deps)
    expect(result.sidecarRebuilt).toBe(false)
  })

  it("never rewrites a generation that has already been published", async () => {
    await regenerateExplored({ userId: USER, touched: run(2), day: 2444 }, deps)
    const first = s3.objects.get(objectKeys.cells(USER, 1))!.etag
    await regenerateExplored({ userId: USER, touched: run(3), day: 2450 }, deps)
    expect(s3.objects.get(objectKeys.cells(USER, 1))!.etag).toBe(first)
  })

  /**
   * `deltasFrom` is `generation − DELTA_CHAIN_KEEP`, clamped at 0 — the oldest generation the
   * chain still reaches (`0051`, D-220), not the generation this publish merged from. Below
   * 20 published generations nothing has been expired yet, so the answer is 0 and every
   * cached client can chain.
   */
  it("points deltasFrom at the oldest generation the chain still reaches", async () => {
    await regenerateExplored({ userId: USER, touched: run(2), day: 2444 }, deps)
    await regenerateExplored({ userId: USER, touched: run(3), day: 2450 }, deps)
    expect(s3.json<{ deltasFrom: number }>(objectKeys.manifest(USER)).deltasFrom).toBe(0)
  })
})

describe("regenerateExplored — the manifest is the commit point (02 §6.4)", () => {
  it("writes every blob BEFORE the manifest", async () => {
    await regenerateExplored({ userId: USER, touched: run(2), day: 2444 }, deps)
    const order = s3.puts.map((p) => p.input.Key!)
    expect(order[order.length - 1]).toBe(objectKeys.manifest(USER))
  })

  /**
   * D-219. Two workers for one user — a Sync that pulled several activities — both read
   * generation 41 and merge from it. Without the precondition the second one publishes a
   * set that never saw the first one's cells, and every generation after it inherits the
   * hole. With it, the loser re-merges against what the winner published.
   */
  it("re-merges when another worker publishes mid-flight, losing no cells", async () => {
    await regenerateExplored({ userId: USER, touched: run(2), day: 2444 }, deps)

    const rival = gridDisk(latLngToCell(-48.92, -123.30, RES), 2)
    let fired = false
    s3.beforePut = (key) => {
      // The instant before our manifest lands, a rival worker publishes generation 2.
      if (fired || key !== objectKeys.manifest(USER)) return
      fired = true
      const prior = s3.objects.get(objectKeys.manifest(USER))!
      s3.objects.set(objectKeys.manifest(USER), { ...prior, etag: '"someone-else"' })
    }

    const mine = gridDisk(latLngToCell(-48.83, -123.45, RES), 2)
    const result = await regenerateExplored({ userId: USER, touched: mine, day: 2450 }, deps)

    expect(result.conflicts).toBe(1)
    const published = new Set(
      decodeExploredBlob(s3.plain(s3.json<{ cells: string }>(objectKeys.manifest(USER)).cells))
        .cells.map(String),
    )
    for (const c of [...run(2), ...mine]) expect(published.has(String(cellToBig(c)))).toBe(true)
    void rival
  })

  it("gives up after maxAttempts rather than looping forever", async () => {
    await regenerateExplored({ userId: USER, touched: run(2), day: 2444 }, deps)
    s3.beforePut = (key) => {
      if (key !== objectKeys.manifest(USER)) return
      const prior = s3.objects.get(objectKeys.manifest(USER))!
      s3.objects.set(objectKeys.manifest(USER), { ...prior, etag: `"moved-${Math.random()}"` })
    }
    await expect(
      regenerateExplored({ userId: USER, touched: run(3), day: 2450 }, { ...deps, maxAttempts: 2 }),
    ).rejects.toThrow(/lost the manifest race/)
  })

  it("uses IfNoneMatch on the first publish, so two bootstraps cannot both win", async () => {
    await regenerateExplored({ userId: USER, touched: run(1), day: 2444 }, deps)
    const manifestPut = s3.puts.find((p) => p.input.Key === objectKeys.manifest(USER))!
    expect(manifestPut.input.IfNoneMatch).toBe("*")
    expect(manifestPut.input.IfMatch).toBeUndefined()
  })

  it("uses IfMatch on every later publish", async () => {
    await regenerateExplored({ userId: USER, touched: run(1), day: 2444 }, deps)
    s3.puts.length = 0
    await regenerateExplored({ userId: USER, touched: run(2), day: 2450 }, deps)
    const manifestPut = s3.puts.find((p) => p.input.Key === objectKeys.manifest(USER))!
    expect(manifestPut.input.IfMatch).toMatch(/^"etag-/)
  })
})

describe("regenerateExplored — refusing to guess", () => {
  it("throws when the manifest names a generation whose blob is gone", async () => {
    await regenerateExplored({ userId: USER, touched: run(2), day: 2444 }, deps)
    s3.objects.delete(objectKeys.cells(USER, 1))
    await expect(
      regenerateExplored({ userId: USER, touched: run(3), day: 2450 }, deps),
    ).rejects.toThrow(/AP-17 repair/)
  })

  it("throws on a manifest declaring another resolution", async () => {
    s3.objects.set(objectKeys.manifest(USER), {
      body: Buffer.from(JSON.stringify({ generation: 4, res: 9 })),
      etag: '"x"',
    })
    await expect(readManifest(USER, deps)).rejects.toThrow(/D-115/)
  })

  /**
   * A sidecar that disagrees with the set is misaligned at every index past the first
   * insertion — worse than absent, because nothing errors and the cold-territory overlay
   * simply attributes days to the wrong hexagons. Dropped and rebuilt rather than merged.
   */
  it("drops a sidecar whose count disagrees with the set rather than merging it", async () => {
    await regenerateExplored({ userId: USER, touched: run(3), day: 2444 }, deps)
    const stale = s3.objects.get(objectKeys.lastRun(USER, 1))!
    s3.objects.set(objectKeys.lastRun(USER, 1), {
      ...stale,
      body: Uint8Array.from(gzipSync(Buffer.from(s3.plain(objectKeys.lastRun(USER, 1)).slice(0, 22)))),
    })

    const result = await regenerateExplored({ userId: USER, touched: run(1), day: 2500 }, deps)
    expect(result.generation).toBe(2)
    expect(result.sidecarRebuilt).toBe(true)
    const days = decodeLastRunBlob(s3.plain(objectKeys.lastRun(USER, 2))).days
    const cells = decodeExploredBlob(s3.plain(objectKeys.cells(USER, 2))).cells
    expect(days).toHaveLength(cells.length)
    const reRun = new Set(run(1).map((c) => String(cellToBig(c))))
    // The re-run cells carry today; the rest were lost with the sidecar and read 0.
    for (let i = 0; i < cells.length; i++) {
      expect(days[i]).toBe(reRun.has(String(cells[i])) ? 2500 : 0)
    }
  })

  it("survives a missing sidecar entirely — the set is what matters", async () => {
    await regenerateExplored({ userId: USER, touched: run(2), day: 2444 }, deps)
    s3.objects.delete(objectKeys.lastRun(USER, 1))
    await expect(
      regenerateExplored({ userId: USER, touched: run(3), day: 2450 }, deps),
    ).resolves.toMatchObject({ generation: 2, sidecarRebuilt: true })
  })
})

describe("what actually crosses the wire", () => {
  /**
   * CRITERION 9. `02` §6.2 has no row for a 40-run fixture, so the number this can honestly
   * test is the per-cell one that R3's whole size argument rests on — *"delta encoding +
   * varint gets to ~2-3 bytes per cell"* — plus the claim §6.2 makes about gzip: that it
   * *"buys so little on top of varint"* because the delta step already removed the
   * redundancy, and earns its place on the header, the aggregate and the dense-grid runs.
   */
  it("a 40-run fixture stays inside the documented 2-3 bytes per cell", async () => {
    const cells = new Set<string>()
    for (let r = 0; r < 40; r++) {
      const origin = latLngToCell(-48.876 + (r % 8) * 0.004, -123.393 + Math.floor(r / 8) * 0.004, RES)
      for (const c of gridDisk(origin, 6)) cells.add(c)
    }
    await regenerateExplored({ userId: USER, touched: cells, day: 2444 }, deps)

    const stored = s3.objects.get(objectKeys.cells(USER, 1))!
    const varintBytes = s3.plain(objectKeys.cells(USER, 1)).length - 28
    const perCell = varintBytes / (cells.size - 1)

    expect(cells.size).toBeGreaterThan(500)
    expect(perCell).toBeGreaterThan(2)
    expect(perCell).toBeLessThanOrEqual(3.05)
    // gzip on top: never larger than what it compressed, which is the only guarantee
    // §6.2's "sits on top of each other" claim actually supports at this size.
    expect(stored.body.length).toBeLessThanOrEqual(varintBytes + 28)
  })

  it("gzips the aggregate, where it does earn its place", async () => {
    await regenerateExplored({ userId: USER, touched: run(30), day: 2444 }, deps)
    const stored = s3.objects.get(objectKeys.agg(USER, 1))!
    expect(stored.body.length).toBeLessThan(s3.plain(objectKeys.agg(USER, 1)).length / 2)
    expect(stored.contentType).toBe("application/json")
  })
})

/**
 * Pretend `n` generations have already been published, without publishing them.
 *
 * The retention window is 20 hops, and driving it honestly would mean 25 real publishes per
 * test. This copies the current generation's objects onto generation `n`'s keys, rewrites the
 * manifest to name them, and moves the counter — so the NEXT real publish sees exactly the
 * state it would have seen after 25 runs.
 */
function fastForward(n: number): void {
  const manifest = s3.json<Record<string, unknown>>(objectKeys.manifest(USER))
  const from = manifest.generation as number
  for (const [key, to] of [
    [objectKeys.cells(USER, from), objectKeys.cells(USER, n)],
    [objectKeys.lastRun(USER, from), objectKeys.lastRun(USER, n)],
    [objectKeys.agg(USER, from), objectKeys.agg(USER, n)],
  ] as const) {
    s3.objects.set(to, { ...s3.objects.get(key)! })
  }
  const existing = s3.objects.get(objectKeys.manifest(USER))!
  s3.objects.set(objectKeys.manifest(USER), {
    ...existing,
    body: Buffer.from(
      JSON.stringify({
        ...manifest,
        generation: n,
        cells: objectKeys.cells(USER, n),
        lastRun: objectKeys.lastRun(USER, n),
        agg: objectKeys.agg(USER, n),
      }),
    ),
  })
  ddb.value.set(`U#${USER}#GEN`, n)
}

describe("delta retention — criterion 6 (02 §6.5)", () => {
  it("keeps the newest ~20 hops and expires nothing before that", () => {
    // Nothing to drop until 20 generations exist.
    for (let g = 1; g <= DELTA_CHAIN_KEEP; g++) {
      expect(expiringDeltaGenerations(g - 1, g), `gen ${g}`).toEqual([])
    }
    expect(expiringDeltaGenerations(20, 21)).toEqual([1])
    expect(expiringDeltaGenerations(41, 42)).toEqual([22])
  })

  /**
   * The counter burns a number whenever a worker loses the manifest race (D-219), so
   * published generations are not contiguous. Deleting only `generation − KEEP` would step
   * over the gap and leak every number inside it — so the GC deletes the RANGE, which is
   * `generation − previousGeneration` wide and is 1 in the ordinary case.
   */
  it("expires the whole range when the counter skipped a burned generation", () => {
    expect(expiringDeltaGenerations(41, 44)).toEqual([22, 23, 24])
  })

  it("never proposes a generation below 1", () => {
    expect(expiringDeltaGenerations(0, 1)).toEqual([])
    expect(expiringDeltaGenerations(0, 25)).toEqual([1, 2, 3, 4, 5])
  })

  it("actually deletes them, and only from deltas/", async () => {
    await regenerateExplored({ userId: USER, touched: run(1), day: 2444 }, deps)
    for (let g = 1; g <= 24; g++) {
      s3.objects.set(objectKeys.delta(USER, g), { body: Uint8Array.from([1]), etag: `"d${g}"` })
    }
    fastForward(24)

    const result = await regenerateExplored({ userId: USER, touched: run(2), day: 2450 }, deps)

    expect(result.generation).toBe(25)
    expect(result.deltasExpired).toBe(1)
    expect(s3.objects.has(objectKeys.delta(USER, 5))).toBe(false)
    expect(s3.objects.has(objectKeys.delta(USER, 6))).toBe(true)
    // The set, the sidecar and the aggregate are untouchable by the GC.
    expect(s3.objects.has(objectKeys.cells(USER, 1))).toBe(true)
  })

  /**
   * GC runs AFTER the commit point. The manifest already names `deltasFrom`, so a client is
   * correct the instant it lands; an undeleted delta is an orphan, and `02` §6.4 already calls
   * orphans harmless. Throwing would be far worse: the receipt is still `PROCESSING`, so the
   * redelivery would allocate a fresh generation and republish an identical map, forever.
   */
  it("a delete that fails does NOT fail the publish", async () => {
    await regenerateExplored({ userId: USER, touched: run(1), day: 2444 }, deps)
    s3.objects.set(objectKeys.delta(USER, 10), { body: Uint8Array.from([1]), etag: '"d10"' })
    fastForward(30)
    s3.failDeletes = true

    const result = await regenerateExplored({ userId: USER, touched: run(2), day: 2450 }, deps)
    expect(result.generation).toBe(31)
    expect(result.deltasExpired).toBe(0)
    expect(s3.json<{ generation: number }>(objectKeys.manifest(USER)).generation).toBe(31)
  })

  it("deltasFrom tracks the window, so a client below it is told to refetch", async () => {
    await regenerateExplored({ userId: USER, touched: run(1), day: 2444 }, deps)
    fastForward(99)

    await regenerateExplored({ userId: USER, touched: run(2), day: 2450 }, deps)
    expect(s3.json<{ deltasFrom: number }>(objectKeys.manifest(USER)).deltasFrom).toBe(
      100 - DELTA_CHAIN_KEEP,
    )
  })
})

describe("readDeltaChain — the chain is walkable (D-220, criterion 4)", () => {
  const publish = (cells: string[], day: number) =>
    regenerateExplored({ userId: USER, touched: cells, day }, deps)

  it("returns nothing to apply when the client is already current", async () => {
    await publish(run(2), 2444)
    expect(await readDeltaChain(USER, 1, deps)).toEqual([])
  })

  /**
   * The whole point of naming the object by `toGen`. A client knows only its own cached
   * generation; it walks BACKWARDS from the manifest's, reading each hop's `fromGen` out of
   * the header, and never has to guess a key.
   */
  it("walks three hops backwards and returns them in APPLICATION order", async () => {
    await publish(run(1), 2440)
    await publish(run(2), 2441)
    await publish(run(3), 2442)
    await publish(run(4), 2443)

    const chain = (await readDeltaChain(USER, 1, deps))!
    expect(chain).toHaveLength(3)
    expect(chain.map((h) => [h.fromGen, h.toGen])).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
    ])
  })

  it("the hops it returns are exactly the cells added since the cached generation", async () => {
    await publish(run(2), 2440)
    await publish(run(3), 2441)
    await publish(run(4), 2442)

    const chain = (await readDeltaChain(USER, 1, deps))!
    const applied = new Set(chain.flatMap((h) => h.added).map(String))
    const before = new Set(run(2).map((c) => String(cellToBig(c))))
    const after = new Set(run(4).map((c) => String(cellToBig(c))))
    expect([...applied].sort()).toEqual([...after].filter((c) => !before.has(c)).sort())
  })

  it("refuses when a hop in the middle is missing, rather than returning a short chain", async () => {
    await publish(run(1), 2440)
    await publish(run(2), 2441)
    await publish(run(3), 2442)
    s3.objects.delete(objectKeys.delta(USER, 2))

    // A short chain would silently skip a run's cells — the map losing ground on the client.
    expect(await readDeltaChain(USER, 1, deps)).toBeUndefined()
  })

  it("refuses a cached generation below deltasFrom", async () => {
    await publish(run(1), 2440)
    const prior = s3.json<Record<string, unknown>>(objectKeys.manifest(USER))
    const existing = s3.objects.get(objectKeys.manifest(USER))!
    s3.objects.set(objectKeys.manifest(USER), {
      ...existing,
      body: Buffer.from(JSON.stringify({ ...prior, deltasFrom: 40, generation: 60 })),
    })
    expect(await readDeltaChain(USER, 39, deps)).toBeUndefined()
  })

  it("refuses a cached generation ahead of the manifest", async () => {
    await publish(run(1), 2440)
    expect(await readDeltaChain(USER, 99, deps)).toBeUndefined()
  })

  it("returns nothing for a user with no manifest", async () => {
    expect(await readDeltaChain("nobody", 1, deps)).toBeUndefined()
  })
})

describe("the manifest is the commit point — fault injection (criterion 1)", () => {
  /**
   * CRITERION 1, literally: *"a fault-injection test killing the writer between blob PUT and
   * manifest PUT leaves clients on the previous generation, still rendering correctly."*
   *
   * `02` §6.4: *"A crash before it leaves orphan blobs (harmless, garbage-collected); a crash
   * after it would point clients at an object that does not exist. There is no third
   * possibility, because the manifest PUT is a single atomic S3 operation."*
   */
  it("a crash before the manifest leaves the client on the previous generation, still rendering", async () => {
    await regenerateExplored({ userId: USER, touched: run(2), day: 2444 }, deps)
    const good = s3.json<{ generation: number; cells: string; cellCount: number }>(
      objectKeys.manifest(USER),
    )

    s3.beforePut = (key) => {
      if (key === objectKeys.manifest(USER)) throw new Error("the worker died here")
    }
    await expect(
      regenerateExplored({ userId: USER, touched: run(4), day: 2450 }, deps),
    ).rejects.toThrow("the worker died here")

    // 1. The manifest is untouched, so every client still resolves generation 1.
    const after = s3.json<typeof good>(objectKeys.manifest(USER))
    expect(after).toEqual(good)

    // 2. And what it points at is still there and still decodes — "still rendering correctly".
    const cells = decodeExploredBlob(s3.plain(after.cells))
    expect(cells.generation).toBe(1)
    expect(cells.cells).toHaveLength(after.cellCount)

    // 3. The orphaned generation-2 blobs exist and no manifest names them. Harmless.
    expect(s3.objects.has(objectKeys.cells(USER, 2))).toBe(true)
  })

  it("and the redelivery republishes cleanly, losing none of the dead run's ground", async () => {
    await regenerateExplored({ userId: USER, touched: run(2), day: 2444 }, deps)
    s3.beforePut = (key) => {
      if (key === objectKeys.manifest(USER)) throw new Error("died")
    }
    await expect(
      regenerateExplored({ userId: USER, touched: run(4), day: 2450 }, deps),
    ).rejects.toThrow("died")

    // The receipt was never closed, so SQS redelivers the same activity.
    s3.beforePut = undefined
    const retry = await regenerateExplored({ userId: USER, touched: run(4), day: 2450 }, deps)

    expect(retry.generation).toBe(3)
    const published = new Set(
      decodeExploredBlob(s3.plain(objectKeys.cells(USER, 3))).cells.map(String),
    )
    for (const c of run(4)) expect(published.has(String(cellToBig(c)))).toBe(true)
  })
})

describe("the Profile mirror rides along (criterion 7)", () => {
  it("reports no-table today, because T1 does not exist", async () => {
    const result = await regenerateExplored({ userId: USER, touched: run(1), day: 2444 }, deps)
    expect(result.mirrored).toBe("no-table")
  })

  it("mirrors after the manifest PUT when a table is configured", async () => {
    const rows = new Map<string, number>()
    const order: string[] = []
    const mirror = {
      table: "Profile",
      ddb: {
        async send(command: { input: { Key: { id: string }; ExpressionAttributeValues: Record<string, number> } }) {
          order.push("mirror")
          rows.set(command.input.Key.id, command.input.ExpressionAttributeValues[":g"]!)
          return {}
        },
      },
    }
    s3.beforePut = (key) => {
      if (key === objectKeys.manifest(USER)) order.push("manifest")
    }

    const result = await regenerateExplored(
      { userId: USER, touched: run(1), day: 2444 },
      { ...deps, mirror: mirror as never },
    )
    expect(result.mirrored).toBe("mirrored")
    expect(rows.get(USER)).toBe(result.generation)
    // §6.4: mirrored AFTER the manifest PUT. The manifest is the commit point, not this.
    expect(order).toEqual(["manifest", "mirror"])
  })

  it("a failing mirror does not fail the publish", async () => {
    const mirror = {
      table: "Profile",
      ddb: {
        async send() {
          throw Object.assign(new Error("denied"), { name: "AccessDeniedException" })
        },
      },
    }
    const result = await regenerateExplored(
      { userId: USER, touched: run(1), day: 2444 },
      { ...deps, mirror: mirror as never },
    )
    expect(result.mirrored).toBe("failed")
    expect(s3.json<{ generation: number }>(objectKeys.manifest(USER)).generation).toBe(1)
  })
})

describe("monotonicity across a full rebuild — criterion 8, I-11", () => {
  /**
   * `02` §8.3 step 7: the drill rebuilds into **new, empty tables** and must *"set
   * `generation` = the step-0 generation + 1, never 1."*
   *
   * The failure this prevents is silent and total: a generation that goes backwards leaves
   * every cached client convinced it is already current, so the fog appears to regress on
   * exactly the devices that were working correctly. Nothing errors and no one is told.
   *
   * The drill's S3 is the SAME bucket — only the tables are new — so the pre-drill blobs are
   * still sitting there under their old generation names. That is what makes this testable
   * end to end rather than as an assertion about a counter.
   */
  it("a rebuilt counter set forward never republishes a generation a client already holds", async () => {
    await regenerateExplored({ userId: USER, touched: run(2), day: 2440 }, deps)
    fastForward(412)
    const preDrill = s3.json<{ generation: number }>(objectKeys.manifest(USER)).generation
    expect(preDrill).toBe(412)

    // The drill: new, empty tables. The counter is gone; S3 is untouched.
    ddb.value.clear()
    expect(await raiseGenerationTo(USER, preDrill + 1, deps)).toBe(true)

    const rebuilt = await regenerateExplored({ userId: USER, touched: run(4), day: 2450 }, deps)

    expect(rebuilt.generation).toBeGreaterThan(preDrill)
    expect(rebuilt.generation).toBe(414)
    expect(s3.json<{ generation: number }>(objectKeys.manifest(USER)).generation).toBe(414)
    // And nothing overwrote a generation a client may be holding.
    expect(s3.objects.has(objectKeys.cells(USER, 412))).toBe(true)
  })

  /**
   * The same drill WITHOUT step 7 — and the publish **refuses** rather than stranding anyone.
   *
   * This was not designed in; it was found by writing the test. An empty counter returns 1
   * while the manifest still names 412, so `encodeDeltaBlob` is asked for a hop from 412 to 1
   * and throws on its own `toGen > fromGen` check. `05` §7.4 put that check there to keep the
   * delta format honest; it turns out to be the last line of defence for I-11 as well.
   *
   * The failure mode it replaces is the one I-11 describes and is far worse than a thrown
   * error: a manifest naming generation 1 leaves every client cached at 412 convinced it is
   * ahead, so the fog silently stops updating on exactly the devices that were working.
   * Failing the drill loudly at step 7 is the cheap outcome.
   */
  it("and a drill that SKIPS step 7 fails loudly instead of stranding every client", async () => {
    await regenerateExplored({ userId: USER, touched: run(2), day: 2440 }, deps)
    fastForward(412)

    ddb.value.clear() // new tables, and NO raiseGenerationTo
    await expect(
      regenerateExplored({ userId: USER, touched: run(4), day: 2450 }, deps),
    ).rejects.toThrow(/I-11/)

    // And nothing was published: the manifest still names the pre-drill generation.
    expect(s3.json<{ generation: number }>(objectKeys.manifest(USER)).generation).toBe(412)
  })

  /**
   * What the first ORDINARY ingest after a drill does, which is the case that actually
   * happens: the counter has been set forward, the manifest and blobs in S3 survived
   * untouched (the drill rebuilds tables, not the bucket), so the publish merges from the
   * pre-drill generation exactly as any other run would and a client cached at 412 gets a
   * one-hop delta rather than a 300 KB refetch.
   *
   * Note the number in the hop: `fromGen` is 412 and `toGen` is 414, because 413 was consumed
   * by `raiseGenerationTo`. That is the gap D-220 exists to survive — a client guessing
   * `from + 1` would fetch `deltas/413.bin`, which was never written.
   */
  it("the first ingest after a drill still hands a current client a one-hop delta", async () => {
    await regenerateExplored({ userId: USER, touched: run(2), day: 2440 }, deps)
    fastForward(412)
    ddb.value.clear()
    await raiseGenerationTo(USER, 413, deps)
    await regenerateExplored({ userId: USER, touched: run(4), day: 2450 }, deps)

    const chain = (await readDeltaChain(USER, 412, deps))!
    expect(chain).toHaveLength(1)
    expect(chain[0]!.fromGen).toBe(412)
    expect(chain[0]!.toGen).toBe(414)
    // The generation the counter skipped was never written, and nothing looks for it.
    expect(s3.objects.has(objectKeys.delta(USER, 413))).toBe(false)
  })
})
