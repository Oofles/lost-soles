import "fake-indexeddb/auto"

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { IDBFactory } from "fake-indexeddb"
import { beforeEach, describe, expect, it } from "vitest"

import { indexedDbSeen, type SeenStore } from "./seen"

/**
 * Ticket `0084`, criteria 10 and 11. The `seen` flag is local, per-device display state: it survives
 * a reload, it is lost with the site's data, and NOTHING that scores reads it (D-135's spirit).
 */

let factory: IDBFactory
let store: SeenStore

beforeEach(() => {
  factory = new IDBFactory()
  store = indexedDbSeen(factory)!
})

describe("the seen store", () => {
  it("an unplayed run is not seen", async () => {
    expect(await store.isSeen("a-1")).toBe(false)
  })

  it("marking is per activity, and idempotent (a Relive marks again)", async () => {
    await store.markSeen("a-1")
    await store.markSeen("a-1")
    expect(await store.isSeen("a-1")).toBe(true)
    expect(await store.isSeen("a-2")).toBe(false)
  })

  it("survives a reload: a second store on the same device reads it", async () => {
    await store.markSeen("a-1")
    expect(await indexedDbSeen(factory)!.isSeen("a-1")).toBe(true)
  })

  it("lives only on the device: another device (another IndexedDB) has never seen it", async () => {
    await store.markSeen("a-1")
    expect(await indexedDbSeen(new IDBFactory())!.isSeen("a-1")).toBe(false)
  })

  it("clearing IndexedDB restores the replay offer (criterion 11)", async () => {
    await store.markSeen("a-1")
    await new Promise<void>((resolve, reject) => {
      const r = factory.deleteDatabase("lost-soles-seen")
      r.onsuccess = () => resolve()
      r.onerror = () => reject(r.error)
      r.onblocked = () => reject(new Error("blocked: the store did not let go of its connection"))
    })
    expect(await indexedDbSeen(factory)!.isSeen("a-1")).toBe(false)
  })

  it("no IndexedDB at all (SSR, a locked-down window) is no store, not a throw", () => {
    expect(indexedDbSeen(null)).toBeNull()
  })

  it("does not share the fog cache's database, so it can never block that one's upgrade", () => {
    const src = readFileSync(join(import.meta.dirname, "seen.ts"), "utf8")
    expect(src).toContain('const DB_NAME = "lost-soles-seen"')
    expect(src).not.toContain('"lost-soles-fog"')
  })
})

/**
 * CRITERION 11's other half: clearing it changes no XP, no ledger row and no `SkillState` value —
 * because nothing that computes them can see it. Held structurally: the only importers of the seen
 * module are on the client side of the run page, and none of the scoring, pipeline or server code does.
 */
describe("seen never reaches scoring", () => {
  const ROOT = join(import.meta.dirname, "..", "..")
  const files: string[] = []
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p)) if (f !== "node_modules" && !f.startsWith(".")) walk(join(p, f))
    } else if (/\.(ts|tsx|mjs)$/.test(p) && !/\.test\.(ts|tsx|mjs)$/.test(p)) files.push(p)
  }
  for (const d of ["src", "lib", "app", "components", "amplify"]) walk(join(ROOT, d))

  it("only RunMoment and the plinth's new-run line (0087) import it", () => {
    const importers = files
      .filter((f) => /from ["']@\/lib\/run-moment\/seen["']|from ["']\.\/seen["']/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f))
    expect(importers.sort()).toEqual(["app/run/[activityId]/run-moment.tsx", "components/plinth/home-screen.tsx"])
  })

  it("no scoring, pipeline or server code mentions it", () => {
    const hits = files
      .filter((f) => /^(src|amplify)\//.test(relative(ROOT, f)) || /\/(scoring|pipeline|server)/.test(f))
      .filter((f) => /lost-soles-seen|markSeen|isSeen/.test(readFileSync(f, "utf8")))
    expect(hits).toEqual([])
  })
})
