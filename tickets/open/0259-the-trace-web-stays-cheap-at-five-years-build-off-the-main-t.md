---
id: 259
slug: the-trace-web-stays-cheap-at-five-years-build-off-the-main-t
title: The trace web stays cheap at five years — build off the main thread or precompute it
type: chore
priority: low
status: open
size: m
capability: 18-mvp-hardening
depends_on: [85]
blocked_by: []
source: agent
created: 2026-10-14T04:48:33Z
started: 2026-10-26T19:03:53Z
---

## Description

`0085` (D-299) builds the permanent trace web on the browser's main thread from every past route,
each time the explored generation changes. At today's 19 traced runs that is ~17 ms and ~40 KB.
A synthetic five years (1,000 runs × 8 km, GPS-like wiggle) measured **~1.7 s** of main-thread
work and **~15 MB** of `/api/runs/web` input — a visible stall on map load and on every
`/run/:id` beat 1 (which builds it twice: with and without the run).

This is not a problem yet and must not be solved speculatively. It becomes one somewhere past a
few hundred runs. Pick the cheapest of: (a) build in a Web Worker; (b) a worker-side precomputed
drawn web stored beside the inputs, with "without this run" derived by subtraction of that run's
own pieces; (c) a coarser store (delta-encoded integers) to cut the transfer.

## Acceptance criteria

- [x] With a synthetic 1,000-run web, map load spends under 50 ms of main-thread time on the web
      (measured, not estimated), and `/api/runs/web` transfers under 2 MB.
      *Amended in place (operator, 2026-10-26, Q1 = A, Q2 = A):* measured at **realistic density,
      ~30 points/km** after the 2 m simplification (the operator's real web is 27 points/km). The
      transfer is the GZIPPED size, because the deployed SSR responses are `content-encoding: gzip`:
      **1.13 MB** for 1,000 × 8 km, under 2 MB with no format change. The ticket's own 15 MB figure
      was the raw body at a noisier ~96 points/km (3.06 MB gzipped), recorded as the known limit
      rather than the target. *"Main-thread time on the web"* is the web's **build and draw** only.
      The shared `JSON.parse` of the body, which the run index and the region list need anyway
      (~30 ms realistic, ~89 ms noisy), is excluded.
- [x] `lib/trace-web/web.test.ts` still passes unchanged — the drawn web is identical.
- [x] Beat 1 still lasts 2.9 s ± 0.1 s with the large web.

## Notes

Measured in `0085`'s session with a throwaway vitest harness over `buildWeb`; the numbers are in
D-299's last bullet. Filed in `18`, not `12`, so it does not hold capability 12's audit open for a
cost that is years away.

## Operator validation

None perceptual: this is a performance ticket, verified by measurement. The agent runs the
synthetic-scale measurement and records it.

**2026-10-26, agent.** The measurement table is in the Resolution, from headless Chromium on the
desktop. Post-deploy (Amplify job 432, `d70401b`): `GET /api/runs/web` signed out → 404, posture
unchanged. `/_next/static/chunks/trace-web.3386d5f98d94c038.js` → 200 `text/javascript`, 3,599 B.
That hash is the one the local clean build produced, so the deployed worker is this commit's.
Nothing perceptual: the drawn web is identical, and beat 1's timing was measured, not judged.

## Resolution

**Option (a): the web is built in a Web Worker.** The `web.json.gz` format (D-299 v1) is unchanged.
The operator answered three questions at the start of the build (2026-10-26): Q1 = A, measure at
realistic density. Q2 = A, the shared parse is excluded. Q3, option (b), the precomputed drawn web
with subtraction, is ruled out: "without this run" by subtraction is not the same as
`buildWeb(runs, { exclude })`, because removing a run changes wear counts and step smoothing on
ground earlier runs drew.

**Files touched**

- `lib/trace-web/off-thread.ts` (new). `buildWebOffThread(source, { exclude })` uses a pool of two
  lazily spawned workers. `/run/:id` builds the steady web and beat 1's web-without-this-run at once,
  and one worker would make the beat wait for two builds. If `Worker` is missing (tests), or the
  worker fails to load or fails a build, the same `buildWeb` runs on the main thread, as before this
  ticket. It never rejects.
- `lib/trace-web/web.worker.ts` (new). The message loop: three lines around `worker-core.ts`.
- `lib/trace-web/worker-core.ts` (new). The worker's job without the worker, so node can test it.
  It parses the body text once per key and runs one `buildWeb` per request.
- `lib/trace-web/pack.ts` (new). The drawn web as three typed arrays (`Float64Array` wear and
  coordinates, `Uint32Array` ends), TRANSFERRED back rather than structured-cloned. Float64 keeps
  every number bit-identical, and the round trip is `toStrictEqual` to `buildWeb`'s output.
- `lib/trace-web/body.ts` (new). `webRunsFromBody(text)`, the one parser of `/api/runs/web`'s body,
  shared by the main thread and the worker.
- `lib/trace-web/runs.ts`. The per-generation cache now holds `webSource` (`{ key, text, runs }`)
  beside `webRuns`, which is the same array as before. The worker gets the body TEXT, one flat
  string copied in ~2 ms. Posting the parsed runs would structured-clone ~250 k coordinate arrays:
  ~20 ms realistic, ~76 ms noisy.
- `lib/runs/client.ts`. `fetchTraceWebBody` reads the body as text. `fetchTraceWebRuns` is now
  `fetchTraceWebBody(...).runs`, so it keeps its contract and its 10 s timeout (offline-contract
  test unchanged).
- `components/map/use-trace-web.ts`. The synchronous `useMemo(buildWeb)` is replaced by
  `webSource → buildWebOffThread → state`.
- `app/run/[activityId]/run-sequence.tsx`. Beat 1 used to wait for the inputs, then build the
  before-web synchronously inside its first frame. It now waits for the before-web itself, built
  off the main thread. **This fixes a latent bug.** `t0` was that frame's rAF timestamp, taken
  BEFORE the synchronous build, so at five years the ~1 s build would have eaten a third of the
  2.9 s clock. `installWeb` now takes the built web.
- `lib/trace-web/off-thread.test.ts` (new):
  - the pack round trip is exact;
  - `workerCore` builds with and without a run, parses once per key, and answers a bad body with an error;
  - without `Worker` the output is identical;
  - with a fake `Worker`, two builds run at once and an idle worker is reused;
  - a worker that will not load falls back to the main thread for pending and later builds.

`lib/trace-web/web.ts` and `web.test.ts` are untouched.

**Measurement.** Real Chrome (snap Chromium, headless, SwiftShader GL, this desktop under WSL)
ran the real modules (`off-thread.ts`, the worker, `beat1At`) and a real MapLibre 6 map with a
GeoJSON source. Main-thread time on the web was measured as:

- the `postMessage` of the text, timed;
- the worker's message handler and `unpackWeb`, timed;
- a MessageChannel busy-probe over the 300 ms after `setData`, minus an idle baseline of the same
  length. This catches MapLibre's deferred copy into its own worker.

Synthetic data is 1,000 runs × 8 km near Point Nemo: a random walk on a 100 m grid at 1 Hz with GPS
drift, then simplified at 2 m and rounded to 5 dp, exactly as ingest stores it. Three runs each:

| | Realistic, 31 pts/km | Noisy, 96 pts/km (the ticket's 15 MB) | Operator's real web, 113 runs |
|---|---|---|---|
| Body raw / gzipped (transfer) | 5.85 MB / **1.13 MB** | 17.5 MB / 3.06 MB | 316 KB / 73 KB |
| Main thread at map load, the web's build and draw | **6–10 ms** (≤ 24 ms with no baseline subtracted) | **15–23 ms** (≤ 27 ms) | < 1 ms |
| Same work before this ticket (`buildWeb` on the main thread) | 940–980 ms | 1,100 ms | **63–79 ms** |
| Shared `JSON.parse` (excluded, Q2) | ~30 ms | ~89 ms | ~1 ms |
| Worker wall time to the before-web (beat 1 waits for it; `GIVE_UP_MS` is 8 s) | 1.1–1.2 s | 1.3–1.4 s | ~57 ms |
| **Beat 1, t0 to done** | **2,916.5 ms** | **2,916.5 ms** | 2,916.6 ms |
| Longest frame during the beat, with the steady web landing mid-beat | 16.8 ms | 16.8 ms | 16.8 ms |

Beat 1's 2,916.5 ms is 2.9 s plus the one frame it takes to observe `done`, inside ± 0.1 s. Not one
frame was dropped while the steady web's `setData` landed mid-beat. In every run the web from the
worker was byte-identical (`JSON.stringify`) to `buildWeb`'s, with and without the excluded run.

**Real data is already over budget today.** The operator's 113 runs cost 65 ms of main-thread
`buildWeb` in node and 63–79 ms in Chrome. D-299's "19 runs ~17 ms" is stale. This ticket's
premise ("not a problem yet") was already past the 50 ms line.

**The production chunk works.** `next build` emits it as `static/chunks/trace-web.<hash>.js`, a
3.6 KB self-contained classic worker: webpack rewrote `type: "module"` to `undefined`, and the
chunk has no `importScripts`. Loaded from a page served with the app's
`worker-src 'self'; script-src 'self'` CSP, it answered a build request correctly.

**Known limit, recorded for the proposed D-299 amendment.**

- At the noisy ~96 pts/km density, transfer is 3.06 MB gzipped, over 2 MB. A delta-encoded
  integer store (option c, a format change) would take it to 1.27 MB. Not done: the operator's real
  density is 27 pts/km.
- The main-thread parse that inspect and regions need grows with the body: ~30 ms realistic,
  ~89 ms noisy.
- At realistic density the raw body passes ~6 MB at about 1,000 runs. Whether Amplify compute's
  response-size limit applies before or after gzip is unsettled; a ticket is proposed.

**Decisions.** **D-451** (recorded by the orchestrator, wave 18.4) amends D-299's scale bullet.
It says the web is built in a worker, `web.json.gz` stays v1, and lists the known limits above.
The Amplify response-size question is filed as `0320`.
