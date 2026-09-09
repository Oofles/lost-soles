import { gzipSync } from "node:zlib"

import { gridDisk, latLngToCell } from "h3-js"
import { describe, expect, it } from "vitest"

import { cellToBig, encodeDeltaBlob } from "@/src/domain/explored-blob"
import { RES } from "@/src/domain/fog"
import { objectKeys, type ExploredManifest } from "@/src/pipeline/explored-blob-store"

import { MAX_CHAIN_BYTES, readDeltaChainBytes, resolveFogUpdate, type FogReadDeps } from "./server"

/**
 * THE SERVER'S HALF. Ticket `0054`. `02-data-model.md` §6.4 steps 3-5; `05` §7.4, D-220.
 *
 * S3 is a `Map`, and everything else is real: the manifest is parsed, the chain is walked
 * backwards out of `LSFD` headers, and the objects are GZIPPED exactly as
 * `explored-blob-store.ts` writes them — which is the one detail a hand-rolled stub is
 * most likely to get wrong, and it fails as "corrupt blob" rather than as "wrong
 * encoding".
 *
 * SYNTHETIC GEOGRAPHY, POINT NEMO (08 §7.2, D-199).
 */
const ORIGIN = latLngToCell(-48.876, -123.393, RES)
const UID = "user-under-test"

const sortBig = (cells: readonly string[]): bigint[] =>
  cells.map(cellToBig).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

class NoSuchKey extends Error {
  readonly name = "NoSuchKey"
}

function fakeS3(objects: Map<string, Uint8Array>): FogReadDeps {
  const reads: string[] = []
  return {
    bucket: "test-bucket",
    s3: {
      async send(command: unknown) {
        const key = (command as { input: { Key: string } }).input.Key
        reads.push(key)
        const bytes = objects.get(key)
        if (!bytes) throw new NoSuchKey(key)
        return { Body: { transformToByteArray: async () => bytes } }
      },
    },
    // The read log, hung off the deps so a test can assert what was NOT fetched.
    ...({ reads } as object),
  } as FogReadDeps & { reads: string[] }
}

const manifest = (over: Partial<ExploredManifest> = {}): ExploredManifest => ({
  generation: 42,
  res: RES,
  cellCount: 1_234,
  updatedAt: "2026-08-30T14:02:11Z",
  cells: objectKeys.cells(UID, 42),
  agg: objectKeys.agg(UID, 42),
  lastRun: objectKeys.lastRun(UID, 42),
  deltasFrom: 22,
  ...over,
})

/** As `explored-blob-store.ts` writes them: the manifest plain, everything else gzipped. */
function store(entries: {
  manifest?: ExploredManifest
  deltas?: Array<{ toGen: number; fromGen: number; added: readonly bigint[] }>
}): Map<string, Uint8Array> {
  const objects = new Map<string, Uint8Array>()
  if (entries.manifest) {
    objects.set(
      objectKeys.manifest(UID),
      new TextEncoder().encode(JSON.stringify(entries.manifest)),
    )
  }
  for (const hop of entries.deltas ?? []) {
    objects.set(
      objectKeys.delta(UID, hop.toGen),
      new Uint8Array(gzipSync(encodeDeltaBlob(hop.added, hop.fromGen, hop.toGen))),
    )
  }
  return objects
}

const RUN = sortBig(gridDisk(ORIGIN, 2))

describe("resolving the client's cached generation into a plan", () => {
  it("answers `empty` for a user who has published nothing", async () => {
    const update = await resolveFogUpdate(UID, 0, fakeS3(store({})))

    expect(update.plan).toBe("empty")
    expect(update.generation).toBe(0)
    expect(update.cellCount).toBe(0)
    // Not `full`: there is no blob to send them after, and a 404 would read as an outage.
    expect(update.res).toBe(RES)
  })

  it("answers `full` when nothing is cached", async () => {
    const update = await resolveFogUpdate(UID, 0, fakeS3(store({ manifest: manifest() })))

    expect(update.plan).toBe("full")
    expect(update.generation).toBe(42)
    expect(update.deltas).toBeUndefined()
  })

  it("answers `up-to-date` when the client is already at the manifest's generation", async () => {
    const update = await resolveFogUpdate(UID, 42, fakeS3(store({ manifest: manifest() })))

    expect(update.plan).toBe("up-to-date")
    expect(update.deltas).toBeUndefined()
  })

  it("answers `full` when the client is behind `deltasFrom`", async () => {
    // A month-closed tab. `02` §6.5 calls the full immutable GET *"the correct outcome"*.
    const update = await resolveFogUpdate(UID, 21, fakeS3(store({ manifest: manifest() })))
    expect(update.plan).toBe("full")
  })

  it("answers `full` for a client somehow AHEAD of the manifest", async () => {
    // Unreachable by the counter, reachable by a restored bucket or an AP-17 repair. The
    // honest answer to "my cache is newer than the server's" is to replace the cache.
    const update = await resolveFogUpdate(UID, 43, fakeS3(store({ manifest: manifest() })))
    expect(update.plan).toBe("full")
  })

  it("echoes a foreign resolution rather than throwing, so the CLIENT can refuse", async () => {
    /**
     * `explored-blob-store.ts`'s own `readManifest` throws on a res mismatch, which is
     * right for a worker about to merge. Here the refusal belongs to the client
     * (criterion 8), and it can only refuse over a value it has been told — a 500 would
     * produce a blank map with no message, which is the failure D-115's rule exists to
     * prevent.
     */
    const update = await resolveFogUpdate(UID, 0, fakeS3(store({ manifest: manifest({ res: 9 }) })))

    expect(update.res).toBe(9)
    expect(update.plan).toBe("full")
  })

  it("assembles the chain when the client is inside the window", async () => {
    const objects = store({
      manifest: manifest({ generation: 44 }),
      deltas: [
        { fromGen: 42, toGen: 43, added: sortBig(gridDisk(ORIGIN, 1)) },
        { fromGen: 43, toGen: 44, added: RUN },
      ],
    })

    const update = await resolveFogUpdate(UID, 42, fakeS3(objects))

    expect(update.plan).toBe("delta")
    expect(update.deltas).toHaveLength(2)
    // APPLICATION ORDER — oldest first. The chain is walked backwards; it is applied
    // forwards, and getting this the wrong way round fails every `fromGen` assertion in
    // the browser rather than here.
    const first = Buffer.from(update.deltas![0]!, "base64")
    expect(first.readBigUInt64LE(8)).toBe(42n)
    const second = Buffer.from(update.deltas![1]!, "base64")
    expect(second.readBigUInt64LE(8)).toBe(43n)
  })
})

describe("walking the chain backwards (D-220)", () => {
  it("stops at the client's generation and returns the hops oldest first", async () => {
    const objects = store({
      deltas: [
        { fromGen: 40, toGen: 41, added: sortBig([ORIGIN]) },
        { fromGen: 41, toGen: 42, added: sortBig(gridDisk(ORIGIN, 1)) },
        { fromGen: 42, toGen: 43, added: RUN },
      ],
    })

    const hops = await readDeltaChainBytes(UID, 40, 43, fakeS3(objects))

    expect(hops).toHaveLength(3)
    expect(Buffer.from(hops![0]!).readBigUInt64LE(8)).toBe(40n)
    expect(Buffer.from(hops![2]!).readBigUInt64LE(16)).toBe(43n)
  })

  /**
   * D-219's burned generations. A worker that loses the manifest race allocates a number
   * and never publishes it, so 41 → 44 is a reachable single hop — which is exactly why
   * the walk reads `fromGen` out of the header instead of guessing `from + 1`.
   */
  it("crosses a gap left by a burned generation", async () => {
    const objects = store({ deltas: [{ fromGen: 41, toGen: 44, added: RUN }] })

    const hops = await readDeltaChainBytes(UID, 41, 44, fakeS3(objects))
    expect(hops).toHaveLength(1)
  })

  it("gives up when a hop has been garbage-collected", async () => {
    const objects = store({ deltas: [{ fromGen: 42, toGen: 43, added: RUN }] })
    // Asking from 41 needs the 41→42 hop, which is not there.
    expect(await readDeltaChainBytes(UID, 41, 43, fakeS3(objects))).toBeUndefined()
  })

  it("gives up on a corrupt hop rather than passing it to the browser", async () => {
    const objects = store({ deltas: [{ fromGen: 41, toGen: 42, added: RUN }] })
    const corrupt = objects.get(objectKeys.delta(UID, 42))!
    // The decode here is a CHECK, not a conversion: a malformed object becomes a full
    // fetch on the server rather than a refusal to render in the browser.
    objects.set(objectKeys.delta(UID, 42), new Uint8Array(gzipSync(corrupt.slice(0, 12))))

    expect(await readDeltaChainBytes(UID, 41, 42, fakeS3(objects))).toBeUndefined()
  })

  it("refuses a chain that does not descend, rather than spinning", async () => {
    // A `fromGen` at or above its own `toGen` cannot terminate the walk. Bounded anyway
    // by the retention window, but refusing on the first non-descending hop is the honest
    // answer: the objects disagree with each other.
    const objects = store({ deltas: [{ fromGen: 42, toGen: 43, added: RUN }] })
    const hop = encodeDeltaBlob(RUN, 43, 43 + 1)
    // fromGen === at, forged by hand because the encoder refuses to write it.
    const forged = Buffer.from(hop)
    forged.writeBigUInt64LE(43n, 8)
    forged.writeBigUInt64LE(43n, 16)
    objects.set(objectKeys.delta(UID, 43), new Uint8Array(gzipSync(forged)))

    expect(await readDeltaChainBytes(UID, 10, 43, fakeS3(objects))).toBeUndefined()
  })

  /**
   * `02` §6.5: the incremental path exists so the CLIENT'S WORK stays small. A chain that
   * has grown past a quarter of a megabyte is no longer that, and the full immutable blob
   * is then smaller, browser-cacheable and one merge instead of twenty.
   */
  it("gives up on a chain larger than the blob it exists to avoid", async () => {
    const big = sortBig(gridDisk(ORIGIN, 180))
    const bytes = encodeDeltaBlob(big, 41, 42)
    expect(bytes.length).toBeGreaterThan(MAX_CHAIN_BYTES)

    const objects = new Map<string, Uint8Array>([
      [objectKeys.delta(UID, 42), new Uint8Array(gzipSync(bytes))],
    ])
    expect(await readDeltaChainBytes(UID, 41, 42, fakeS3(objects))).toBeUndefined()
  })
})
