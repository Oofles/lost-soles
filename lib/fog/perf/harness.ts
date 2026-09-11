import { FogPerf, type PerfHost } from "./collector"
import { GpuTimer } from "./gpu-timer"

/**
 * THE TWO INSTRUMENT OBJECTS, CREATED TOGETHER OR NOT AT ALL. Ticket `0059`.
 *
 * `MapShell` builds one when `?fog=perf` is present and passes it to `useFogMask`, which threads the
 * timer into the layer and the collector into the store and the controller. **Explicitly, rather than
 * through a module singleton**: a singleton would survive a context-loss rebuild and a fast-refresh
 * reload holding query objects from a dead GL context and samples from a previous run, and the second
 * of those is worse than the first — it would silently average two builds together and report the
 * mean as this one's p95.
 *
 * `null` everywhere else, which is what keeps the cost of carrying these hooks in the frame path at
 * one optional-chain per call.
 */
export interface FogHarness {
  perf: FogPerf
  timer: GpuTimer
}

export function createFogHarness(host?: PerfHost): FogHarness {
  return { perf: new FogPerf(host), timer: new GpuTimer() }
}
