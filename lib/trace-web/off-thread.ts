import { log } from "@/lib/log"

import { unpackWeb } from "./pack"
import { buildWeb, EMPTY_WEB, type WebFeatureCollection, type WebRunInput } from "./web"
import type { BuildRequest, BuildResponse } from "./worker-core"

/**
 * THE WEB, BUILT OFF THE MAIN THREAD. Ticket `0259`, amending D-299's scale bullet.
 *
 * `buildWeb` is ~65 ms at today's 113 runs and ~1.5 s at five years (1,000 runs × 8 km), all of it
 * main-thread time: a stalled map on load and, on `/run/:id`, a stall that ate beat 1's clock (the
 * beat's `t0` was the frame BEFORE the synchronous build). Here it runs in a worker. What the main
 * thread still pays per web is the body text's copy in (~2 ms) and `unpackWeb` out (`pack.ts`) — and
 * MapLibre's own copy of the result into ITS worker in `setData`, which no build strategy avoids.
 *
 * ─── WHY THE TEXT GOES IN, NOT THE RUNS ─────────────────────────────────────
 *
 * The main thread parses the body anyway — the run index and the region list read it — but posting
 * the parsed runs would structured-clone ~250 k coordinate arrays (~20 ms at five years, ~76 ms at a
 * noisier density). The text is one string, copied flat; the worker parses its own.
 *
 * ─── TWO WORKERS ────────────────────────────────────────────────────────────
 *
 * `/run/:id` wants two builds of the same body at once: the steady web (`use-trace-web`) and beat 1's
 * web without this run (`run-sequence`). One worker would finish the beat's after the steady one, so
 * the beat would wait two builds to start. Two let them run side by side.
 *
 * ─── NO WORKER IS THE OLD PATH ──────────────────────────────────────────────
 *
 * Where `Worker` does not exist (a test) or the worker cannot load, the same `buildWeb` runs here on
 * the main thread, as before this ticket. The output is identical either way: the worker runs the same
 * function and `pack.ts` moves its numbers bit for bit.
 */

export interface WebSource {
  /** One per fetched body (`lib/trace-web/runs.ts`). The worker parses each key's text once. */
  key: number
  text: string
  runs: WebRunInput[]
}

const POOL = 2

interface Job {
  source: WebSource
  exclude: string | undefined
  resolve(web: WebFeatureCollection): void
}

interface Slot {
  worker: Worker
  job: (Job & { id: number }) | null
}

let slots: Slot[] = []
let queue: Job[] = []
let broken = typeof Worker === "undefined"
let nextId = 1

function onMainThread(job: Job): void {
  try {
    job.resolve(buildWeb(job.source.runs, job.exclude === undefined ? {} : { exclude: job.exclude }))
  } catch (error) {
    // The same as a failed fetch: a map with no web, logged, never thrown (`use-trace-web`).
    log.error("trace web: could not build", error)
    job.resolve(EMPTY_WEB)
  }
}

function spawn(): Slot | null {
  try {
    const worker = new Worker(new URL("./web.worker.ts", import.meta.url), { type: "module", name: "trace-web" })
    const slot: Slot = { worker, job: null }
    worker.onmessage = (event: MessageEvent<BuildResponse>) => {
      const job = slot.job
      if (!job || event.data.id !== job.id) return
      slot.job = null
      if (event.data.ok) job.resolve(unpackWeb(event.data.web))
      else {
        log.error("trace web: the worker's build failed; building on the main thread", event.data.error)
        onMainThread(job)
      }
      pump()
    }
    worker.onerror = (event) => {
      event.preventDefault?.()
      fail("trace web: the worker would not run; building on the main thread", event.message)
    }
    return slot
  } catch (error) {
    fail("trace web: no worker; building on the main thread", error)
    return null
  }
}

/** The worker cannot load (a CSP, a bad chunk): every pending and later build runs here instead. */
function fail(message: string, detail: unknown): void {
  if (broken) return
  broken = true
  log.error(message, detail)
  const stranded = [...slots.flatMap((s) => (s.job ? [s.job] : [])), ...queue]
  for (const s of slots) s.worker.terminate()
  slots = []
  queue = []
  for (const job of stranded) onMainThread(job)
}

function pump(): void {
  while (queue.length > 0 && !broken) {
    let slot = slots.find((s) => s.job === null)
    if (!slot && slots.length < POOL) {
      const fresh = spawn()
      if (!fresh) break
      slots.push(fresh)
      slot = fresh
    }
    if (!slot) return
    const job = queue.shift()!
    const id = nextId++
    slot.job = { ...job, id }
    const request: BuildRequest = { id, key: job.source.key, text: job.source.text }
    if (job.exclude !== undefined) request.exclude = job.exclude
    slot.worker.postMessage(request)
  }
  if (broken) {
    const stranded = queue
    queue = []
    for (const job of stranded) onMainThread(job)
  }
}

/** `buildWeb(source.runs, options)`, in a worker. Never rejects: no worker is a main-thread build. */
export function buildWebOffThread(source: WebSource, options: { exclude?: string } = {}): Promise<WebFeatureCollection> {
  return new Promise((resolve) => {
    queue.push({ source, exclude: options.exclude, resolve })
    // A microtask, so a test's fallback resolves asynchronously exactly as a worker would.
    queueMicrotask(pump)
  })
}

/** Tests only: forget the pool, and whether `Worker` exists. */
export function resetOffThread(): void {
  for (const s of slots) s.worker.terminate()
  slots = []
  queue = []
  broken = typeof Worker === "undefined"
}
