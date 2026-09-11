import { ExploredSet } from "../explored-set"
import { datasetFor, fixtureUrl, syntheticSet, type PerfDataset, PERF_ORIGIN } from "./synthetic"

/**
 * WHERE `?fog=perf`'s CELLS COME FROM. Ticket `0059`. `05-fog-of-war.md` §6.4.
 *
 * Two sources, because §6.4 asks two questions that cannot be answered in the same place — see
 * `debug-flags.ts`'s `perfDataset` for the argument in full. In short:
 *
 *   `50k` / `150k` / `500k`   the checked-in fixture, at 30°N 100°E, through the real decoder.
 *                             Answers items 1 and 7, which the basemap cannot affect.
 *   `here`                    the same disc regenerated around the camera's last position, so the
 *                             fog sits over real tiles. Answers item 3, which is meaningless
 *                             without them.
 *   `here:500k`               `here`, at a stated size. Defaults to 150k, §6.4's own kill-criteria
 *                             size and the one the budget is quoted at.
 *
 * ─── THE FIXTURE PATH GOES THROUGH `ExploredSet.fromBlob`, DELIBERATELY ─────
 *
 * Not `fromCells`. The fixture is `LSFG` bytes written by the shipped `encodeExploredBlob`, and
 * reading them back through the shipped decoder means the harness measures the **real boot cost** —
 * the varint walk and the `Set` build that `02` §6.3 prices at ~50 ms for 150k — rather than a
 * best-case one it reached by shortcut. Item 7's heap number depends on that too: `fromCells` builds
 * the same `Set`, but the decoder's intermediate array is real allocation the phone really does.
 */

export interface LoadedDataset {
  set: ExploredSet
  dataset: PerfDataset
  /** Which of the two sources answered, for the summary table's header. */
  origin: "fixture" | "here"
  /** Milliseconds from request to usable set. The `load` phase's headline number. */
  loadMs: number
}

/** `here`, `here:500k`, `150k`, … → a size and whether to re-centre. */
export function parsePerfDataset(value: string): { dataset: PerfDataset; here: boolean } | null {
  const here = value === "here" || value.startsWith("here:")
  const label = here ? value.slice("here".length).replace(/^:/, "") || "150k" : value
  const dataset = datasetFor(label)
  return dataset ? { dataset, here } : null
}

export async function loadPerfDataset(
  value: string,
  centre: { lat: number; lng: number },
  fetchImpl: typeof fetch = fetch,
): Promise<LoadedDataset> {
  const parsed = parsePerfDataset(value)
  if (!parsed) {
    throw new Error(
      `?fog=perf:${value} — unknown dataset. Expected one of 50k, 150k, 500k, here, here:<size>.`,
    )
  }
  const { dataset, here } = parsed
  const started = performance.now()

  if (here) {
    /**
     * Built on the main thread, and it blocks for a second or two at 500k. That is a long task and
     * it is **inside the `load` phase**, which §6.4 makes no assertion about — item 6's *"zero long
     * tasks"* is scoped to the pan. Moving this to a worker would hide a cost the harness is
     * supposed to show: a real cold boot at 500k cells pays the same `Set` build, just from a
     * decoder rather than from h3.
     */
    const set = syntheticSet(centre, dataset.k)
    return { set, dataset, origin: "here", loadMs: performance.now() - started }
  }

  const response = await fetchImpl(fixtureUrl(dataset.label))
  if (!response.ok) {
    throw new Error(
      `${fixtureUrl(dataset.label)} → ${response.status}. Regenerate with ` +
        `FOG_FIXTURES=write npx vitest run lib/fog/perf/fixtures.test.ts`,
    )
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  const set = ExploredSet.fromBlob(bytes)
  return { set, dataset, origin: "fixture", loadMs: performance.now() - started }
}

/** Where a fixture-backed run has to fly the camera to find its fog. */
export const FIXTURE_CENTRE = PERF_ORIGIN
