import { gridDisk, latLngToCell } from "h3-js"

import { cellToBig } from "@/src/domain/explored-blob"
import { RES } from "@/src/domain/fog"

/**
 * A 300-ACTIVITY HISTORICAL IMPORT. Ticket `0257`, criterion 5 — `0084`'s Notes: *"test it against a
 * fixture of 300 activities before the first real connect, not after."*
 *
 * The shape of the operator's real account (2026-10-16), scaled up: a first Sync's month already
 * scored (20 activities), then an import of 278 older ones, then 2 runs recorded and synced WHILE the
 * import was going — newer than everything, so not part of it. Each activity covers a short line of
 * res-11 cells; the imported ones spread outward, the way years of runs do.
 *
 * SYNTHETIC GEOGRAPHY, POINT NEMO (08 §7.2, D-199).
 */

export const NEMO = { lat: -48.876, lng: -123.393 }
export const WINDOW = { from: "2026-10-16T15:10:03.786Z", to: "2026-10-16T15:31:00.000Z" }

export interface FixtureActivity {
  id: string
  startedAt: string
  ingestedAt: string
  status: "ACTIVE"
  /** The res-11 cells it covered. */
  cells: string[]
}

const id = (n: number) => n.toString(16).padStart(64, "0")
const day = (n: number) => new Date(Date.UTC(2020, 1, 24) + n * 86_400_000).toISOString()

/** Cells along a short east-west line `k` steps out from Nemo. */
function line(k: number): string[] {
  const lat = NEMO.lat + ((k % 17) - 8) * 0.0015
  const lng = NEMO.lng + (Math.floor(k / 17) - 8) * 0.002
  return gridDisk(latLngToCell(lat, lng, RES), 1)
}

export const PRE: FixtureActivity[] = Array.from({ length: 20 }, (_, i) => ({
  id: id(1000 + i),
  startedAt: day(2380 + i),
  ingestedAt: "2026-09-07T05:11:17.000Z",
  status: "ACTIVE",
  cells: line(i),
}))

export const IMPORTED: FixtureActivity[] = Array.from({ length: 278 }, (_, i) => ({
  id: id(2000 + i),
  startedAt: day(i * 8),
  ingestedAt: new Date(Date.parse(WINDOW.from) + 5_000 + i * 4_000).toISOString(),
  status: "ACTIVE",
  cells: line(20 + i),
}))

/** Recorded and synced during the import: new runs, not history. */
export const DURING: FixtureActivity[] = Array.from({ length: 2 }, (_, i) => ({
  id: id(3000 + i),
  startedAt: day(2420 + i),
  ingestedAt: new Date(Date.parse(WINDOW.from) + 60_000 * (i + 1)).toISOString(),
  status: "ACTIVE",
  cells: line(300 + i),
}))

export const ALL: FixtureActivity[] = [...PRE, ...IMPORTED, ...DURING]

const sortedBig = (cells: Iterable<string>) =>
  BigUint64Array.from([...new Set(cells)].map(cellToBig)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

/** The explored set before the import, and after it (the runs synced during it included). */
export const BEFORE_CELLS = sortedBig(PRE.flatMap((a) => a.cells))
export const AFTER_CELLS = sortedBig(ALL.flatMap((a) => a.cells))
