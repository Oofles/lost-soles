import "fake-indexeddb/auto"

import { IDBFactory } from "fake-indexeddb"
import { gridDisk, latLngToCell } from "h3-js"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { startFogSession, type FogState } from "@/lib/fog/boot"
import { indexedDbCache } from "@/lib/fog/explored-cache"
import type { CachedSkill } from "@/lib/log/optimistic"
import { memoryLogStore, skillsKey } from "@/lib/log/queue"
import type { RunFeatureCollection } from "@/lib/runs/wire"
import { cellToBig } from "@/src/domain/explored-blob"
import { RES } from "@/src/domain/fog"

import { latestRunKey, loadLatestRun } from "./latest-run"
import { loadStanding } from "./load"
import { plinthModel } from "./model"

/**
 * TICKET `0087`, CRITERIA 1 AND 10 — THE OFFLINE COLD START, END TO END THROUGH THE THREE LOADERS.
 *
 * `/` paints from three caches: the explored set (`lib/fog/boot.ts`, `lost-soles-fog`), the cached
 * standing (`loadStanding`) and, since this ticket, the last `/api/runs/latest` answer
 * (`loadLatestRun`). This test runs all three against a network that refuses every request, as
 * DevTools' Offline does, and records every request and every first paint on one timeline:
 *
 * - each loader paints from its cache BEFORE it issues its first request — so nothing on screen is
 *   waiting on the network (`06` §2.4, §4.8);
 * - with every request failing, the plinth still renders Total Level, the cells and the last-run
 *   line, and nothing on it reads as an error ("no error chrome").
 *
 * The vitest environment is `node` (`vitest.config.ts`), so the React tree is not mounted; what is
 * proved is the loaders' ordering and the markup the painted values produce.
 *
 * SYNTHETIC GEOGRAPHY, POINT NEMO (08 §7.2, D-199).
 */
vi.mock("@/app/sync-action", () => ({ syncNowAction: vi.fn() }))
const { Plinth } = await import("@/components/plinth/plinth")

const UID = "user-under-test"
const CELLS = gridDisk(latLngToCell(-48.876, -123.393, RES), 3)
  .map(cellToBig)
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

const RUN: RunFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates: [] } as unknown as RunFeatureCollection["features"][0]["geometry"],
      properties: {
        activityId: "a-9",
        startedAt: "2026-08-28T11:00:00.000Z",
        name: null,
        startedAtLocal: "2026-08-28T07:00:00",
        distanceM: 8400,
        newCellCount: 21,
      },
    },
  ],
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
}

describe("an offline cold start with a populated IndexedDB (0087)", () => {
  it("paints every number from cache before any request, and shows no error when every request fails", async () => {
    const timeline: string[] = []
    const offline = (what: string) => async (): Promise<never> => {
      timeline.push(`request:${what}`)
      throw new TypeError("Failed to fetch")
    }

    // The caches, as a previous online session left them.
    const fogCache = indexedDbCache(new IDBFactory())!
    await fogCache.write(UID, 7, new BigUint64Array(CELLS))
    const store = memoryLogStore()
    await store.setKv(skillsKey(UID), [{ skillId: "x", xp: 1_000_000 }] satisfies CachedSkill[])
    await store.setKv(latestRunKey(UID), RUN)

    let fog: FogState | undefined
    let skills: CachedSkill[] | undefined
    let latest: RunFeatureCollection | undefined
    const paint = (what: string) => {
      if (!timeline.includes(`paint:${what}`)) timeline.push(`paint:${what}`)
    }

    const session = startFogSession({
      uid: UID,
      cache: fogCache,
      transport: { update: offline("fog"), blob: offline("fog-blob") },
      onChange: (state) => {
        fog = state
        if (state.set) paint("fog")
      },
      schedulePersist: (task) => task(),
      revalidateOnFocus: false,
    })
    loadStanding(
      {
        currentUid: async () => UID,
        store,
        fetchSkills: offline("skills"),
        fetchReplayInProgress: offline("replay"),
        later: () => () => undefined,
      },
      (s) => {
        skills = s
        paint("standing")
      },
    )
    const onError = vi.fn()
    loadLatestRun({ currentUid: async () => UID, store, fetchLatest: offline("latest"), onError }, (r) => {
      latest = r
      paint("latest")
    })
    await session.ready
    await flush()
    session.dispose()

    // Each source painted before it asked the network anything.
    for (const [painted, asked] of [
      ["fog", "fog"],
      ["standing", "replay"],
      ["latest", "latest"],
    ]) {
      expect(timeline).toContain(`paint:${painted}`)
      expect(timeline.indexOf(`paint:${painted}`)).toBeLessThan(timeline.indexOf(`request:${asked}`))
    }
    // Every request was made and failed; every cached value is still the one on screen.
    expect(fog).toMatchObject({ phase: "ready", source: "cache" })
    expect(fog!.set!.size).toBe(CELLS.length)
    expect(latest).toEqual(RUN)
    expect(onError).toHaveBeenCalledTimes(1)

    const model = plinthModel({ skills, cells: fog!.set!.size, latest: latest!, seen: true, sources: [] })
    const text = renderToStaticMarkup(<Plinth model={model} />)
      .replace(/<(style|script)>[\s\S]*?<\/(style|script)>/g, "")
      .replace(/<[^>]+>/g, " ")
    expect(text).toContain(String(model.totalLevel))
    expect(text).toContain(String(CELLS.length))
    expect(text).toContain("Last: Fri 28 Aug · 8.40 km · 21 new")
    // No error chrome: nothing on the plinth says the network is gone.
    expect(text).not.toMatch(/offline|error|fail|could not|couldn't|try again|retry|unavailable/i)
  })
})
