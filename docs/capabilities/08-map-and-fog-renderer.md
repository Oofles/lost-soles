# 08-map-and-fog-renderer

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`08-map-and-fog-renderer\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (10)

- `0052` — Protomaps PMTiles basemap on Cloudflare R2 with the stock light flavour
- `0053` — MapLibre GL JS 6.x shell as the home route, DPR capped at 2
- `0054` — Client blob loader and decoder — explored-r10.bin to a sorted typed array
- `0055` — Custom WebGL2 layer, pass 1 — instanced soft-disc coverage mask in prerender
- `0056` — Pass 2 — noisy composite: fBm-perturbed smoothstep with a warm rim glow
- `0057` — Layer order — fog above labels, run polyline above the fog
- `0058` — Zoom bucketing and two-level viewport culling
- `0059` — Perf harness against the §6.4 budget on a real mid-range Android phone — FIRST USABLE
- `0118` — Spike — prove gl.MAX on a half-res R8 FBO inside MapLibre's prerender works on the target Android phone
- `0119` — Tune the fog atmosphere against atlas legibility — time-boxed

## Design notes

_Filled in at the DESIGN step, before TICKET-WRITE._

### The basemap: where the ground comes from (ticket `0052`, D-226)

**Hosting is a dedicated private S3 bucket, `lost-soles-tiles`, behind our own CloudFront
distribution** — not Cloudflare R2, which is what the ticket and `01-architecture.md` originally
specified. D-226 carries the full reasoning; the short version is that §8 Risk 1's
"100 GB/month = $15/month" sizes a map-heavy *multi-user* app, and at one user the measured figure
is ~1 GB/month, which is inside Amplify's own free allowance. The rule that was load-bearing —
**tiles never route through Amplify Hosting** — is unchanged.

Both resources are provisioned in `amplify/backend.ts` (the fifth and last use of the CDK escape
hatch) and asserted in `amplify/basemap-tiles-stack.test.ts`. The bucket blocks all public access;
CloudFront reaches it through Origin Access Control scoped to the `tiles/` prefix.

#### Regenerating the extract

The source is the Protomaps daily planet build. **Builds are retained for about a week**, so
`YYYYMMDD` must be a recent date — a 404 on the source URL means the date has aged out, not that
the command is wrong.

```bash
# 1. The CLI (Go release binary; there is no npm equivalent that does `extract`)
curl -sL -o pmtiles.tar.gz \
  https://github.com/protomaps/go-pmtiles/releases/download/v1.31.2/go-pmtiles_1.31.2_Linux_x86_64.tar.gz
tar xzf pmtiles.tar.gz

# 2. Cut the region. --dry-run first if you are changing the bbox: it prints the
#    resulting archive size without downloading anything, in about three seconds.
./pmtiles extract https://build.protomaps.com/20260908.pmtiles basemap-fl-20260908.pmtiles \
  --bbox=-87.7,24.4,-79.9,31.1 --maxzoom=15

# 3. Upload under the dated key, immutable for its whole life (see below)
aws s3 cp basemap-fl-20260908.pmtiles s3://lost-soles-tiles/tiles/ \
  --cache-control "public, max-age=31536000, immutable" \
  --content-type application/octet-stream --profile devault

# 4. Point the app at it — ONE line
#    lib/basemap.ts: export const BASEMAP_ARCHIVE = "basemap-fl-YYYYMMDD.pmtiles"
```

| | |
|---|---|
| Source build | `https://build.protomaps.com/20260908.pmtiles` |
| Region | Florida, bbox `-87.7,24.4,-79.9,31.1` |
| Zoom | `0–15` (MapLibre overzooms past 15; the z14–17 legibility floor is met by overzoom) |
| Archive size | **1.1 GB**, 1.2 GB transferred, 46 HTTP requests, ~40 s |
| Storage cost | ~**$0.025/month** at S3's $0.023/GB-mo |

**Why Florida and not a box around Nocatee.** A 100 km box around the operator's actual running
area (`-81.9,29.6,-80.9,30.6`) is only 62 MB, so the statewide extract costs about two extra cents
a month. It buys every in-state travel run a real street map with no regeneration. Out-of-state
travel is the four steps above — but note that **nothing about ingest, H3 cells, fog reveal or XP
is region-scoped**: a run anywhere in the world imports, scores and reveals correctly, and the only
thing missing outside the extract is the ground underneath. Tickets `0113` and `0087` already
specify what that looks like — *missing tiles render flat parchment, never a checkerboard, never a
spinner* — so an un-extracted region degrades to a design that already exists.

#### Two decisions that look like details and are not

**The archive key carries its source build date.** Replacing a `.pmtiles` archive in place under a
stable key is a genuine correctness bug, not a staleness annoyance: the client caches the archive's
directory and then reads byte ranges against it, so ranges served from a *different* archive still
resolve — to the wrong bytes. The reader gets coherent-looking garbage rather than an error. A
dated key makes that unrepresentable; the cost is step 4 above.

**CORS is needed in BOTH places, and the first deploy got this wrong.** The reasoning that felt
obvious — the browser only ever talks to CloudFront, so a bucket CORS rule is configuration for a
request that cannot happen — is false for `OPTIONS`, which CloudFront forwards to the origin. A
bucket with no CORS configuration answers it `403`, and the distribution's response headers policy
then decorates that 403 with entirely correct CORS headers. A browser rejects any preflight that is
not 2xx, so the headers being right buys nothing.

It went unnoticed because the smoke test asserted the header and not the status, and it broke
nothing because `Range` with a simple `bytes=a-b` value is a CORS-safelisted request header, so
pmtiles does not preflight at all. That is a property of the Fetch spec rather than of this app —
"works until someone adds a header" is precisely the desktop-works/phone-fails shape `0052` warns
about. The bucket now carries its own CORS rule, the distribution forwards `Origin` via
`OriginRequestPolicy.CORS_S3_ORIGIN` so the rule is reachable, and
`amplify/basemap-tiles-stack.test.ts` asserts both. `Range` remains the load-bearing entry in every
allow-list here.

### The map shell (ticket `0053`)

`maplibre-gl` is pinned to **exactly `6.6.0`**. `6.7.0` and `6.8.0` exist; the pin is
deliberate and the ticket's Notes say why — `prerender`/`render` custom-layer hooks and the
`shaderData.vertexShaderPrelude` that `0055` depends on are version-sensitive, and a minor bump
can break projection silently.

**MapLibre 6 is ESM-only with NO default export.** `addProtocol` and `Map` are named exports, so
the v5 idiom `maplibregl.addProtocol` off a default import does not work. It fails as a type
error rather than at runtime, which is the good outcome, but it will catch anyone porting a v5
snippet.

**The library is imported inside the mount effect, not at module scope.** Effects do not run
during SSR, so the WebGL bundle never enters the server render or the initial payload. This
replaces `next/dynamic` with `ssr: false`, which cannot be called from a Server Component in
Next 15 and would need a client wrapper whose only job is to hold the dynamic call.

#### The worker, and why the map was grey (ticket `0053`)

**This shipped broken and is the most useful thing in this document.** The symptom was a flat grey
screen on desktop and phone. Grey is not "nothing rendered": `#cccccc` is the Protomaps `light`
flavour's **background layer**, so the map had constructed and the style had loaded — only no tile
was ever parsed. The console said:

```
Failed to load module script: The server responded with a non-JavaScript MIME type of "text/html".
```

Two independent faults, both on the worker's path, either of which alone produces that exact line:

1. **MapLibre 6 derives its worker URL from `import.meta.url`, and webpack inlines that at build
   time** as `file:///…/node_modules/maplibre-gl/dist/maplibre-gl.mjs`. MapLibre's own guard is
   `if (!/^https?:/.test(t)) return ""`, so the worker URL became the **empty string**, the browser
   resolved `""` against the current page, and the server answered with the app's HTML.
2. **`/maplibre/` was not exempt from `middleware.ts`'s matcher**, so even with a correct URL the
   worker took a `307` to `/`. A worker is fetched as a subresource; a redirect is not an answer.

The fix is `scripts/copy-maplibre-worker.mjs` (runs at `prebuild`) plus `setWorkerUrl`, and the
matcher exemption. Both files are copied with a **`.js`** extension — `.mjs` is not universally
served as JavaScript, and getting that wrong reproduces the identical error — with the worker's
relative import rewritten to match and that rewrite **asserted**, so a future MapLibre that changes
its import shape fails the build instead of shipping a worker whose sibling 404s.

**A fourth, which cost more than any single bug: three separate assertions this ticket shipped
could not fail.** The `0052` CORS smoke test read the preflight's `allow-headers` and ignored its
`403` status. The `0053` leak check ran `grep -qF "-81.4046"`, whose leading minus grep parsed as an
option — it errored on every run while the suite printed PASS. And the server-vs-client bundle
comparison piped `grep -rl` into `head`, which masks grep's exit status, so both branches reported
success. Each was written in a hurry to confirm something already believed true. **An assertion that
cannot fail is indistinguishable from one that passes, and it is worse than no assertion, because it
is counted.**

**Three lessons worth more than the fix.**

- **Nothing in the symptom pointed at a worker.** The investigation that found it went the other
  way: prove the archive, the protocol handler, the deployed URL, the style↔data contract and the
  sprite/glyph URLs all correct, until only the client runtime was left. Each of those was checkable
  from a terminal; none of them was the bug.
- **A stale `next start` cost twenty minutes.** The matcher fix appeared not to work because an
  older server still held the port. Verify what is *running*, not what was *built*.
- **The tests could not have caught either fault**, and still cannot catch the first. `middleware.test.ts`
  called `middleware()` directly, so nothing tested which paths *reach* it — the matcher was an
  untested string. It is tested now, including the negative case (the exemption is a prefix, not
  "anything ending in `.js`"). The worker URL itself is only provable against a running server, which
  is what the `0053` smoke test does.

#### Bundle size baseline (ticket `0053` criterion 8)

Measured with `npm run build` at the close of `0053`:

| | |
|---|---|
| `/` route size | **18.4 kB** |
| `/` First Load JS | **121 kB** (shared baseline is 102 kB) |
| MapLibre chunk | **560 kB raw, ~139 kB gzipped** — lazily loaded, **not** in First Load |
| Middleware | 66.8 kB |

The number worth watching is **First Load JS**, not the MapLibre chunk. Because the library is
dynamically imported, the map route's initial payload grew by ~19 kB rather than by half a
megabyte; the big chunk arrives after mount. A future change that hoists the `maplibre-gl` import
to module scope would move ~139 kB gzipped into First Load and this table is how that gets
noticed.

`/` is now **dynamic** (`ƒ`) rather than prerendered. That is a consequence of reading the
session, and it is intended — see below.

#### The home coordinate is an environment variable, and that is a privacy decision

`08-security-privacy.md` §7.2 and D-199 forbid the operator's real coordinates from entering this
repository, which is public. A camera default is not exempt: the reasoning §7.2 gives — "a home
address in git history forever" — does not care whether the coordinate arrived as a fixture or as
a constant.

Keeping it out of git is only half of it. **`/` is the signed-out landing route**, so anything
rendered into it is fetchable without a session, and a `NEXT_PUBLIC_` variable would be worse
still — inlined into a publicly served JS bundle. So `lib/map-home.ts` reads the value on the
server, behind the same both-tokens session check `middleware.ts` uses, and hands a signed-out
request `null`. The map then opens on the extract-wide fallback, which identifies nobody.

This is not ceremony for a single-user app. D-123 declines special privacy handling for the
explored set *on the grounds that the map is shown only to its owner* — an argument that holds
precisely because the map is behind auth. An unauthenticated landing page carrying the same
information is the one hole in it.

**Getting the value to the server took three attempts, and the two failures are the useful part.**
Amplify environment variables reach the **build container** but not the **SSR compute runtime**:

| Attempt | Result |
|---|---|
| `update-app --environment-variables` (app level) | Reaches the build. `process.env` undefined at request time. Map opened on the extract-wide fallback. |
| `update-branch --environment-variables` (branch level) | Identical. Also does not reach the compute. |
| `.env.production` written at preBuild | Next *loaded* the file, but an App Router server component's `process.env` read happens at **request** time — Next only statically replaces `NEXT_PUBLIC_*` on its own — so the reference still resolved against an empty runtime environment. Verified: the value was in neither `.next/server` nor `.next/static`. |
| **`next.config.ts` `env`** | **Works.** Next replaces the reference during the build, which the Amplify container does have. Verified in `.next/server`, absent from `.next/static`. |

Set the values on the Amplify app (or branch), then **redeploy** — the coordinate is baked in at
build time, so changing it needs a rebuild rather than a variable edit. For a value that changes
when the operator moves house, that is the right trade.

```bash
aws amplify update-app --app-id d14fhvl4rp79nn --profile devault \
  --environment-variables LOST_SOLES_HOME_LAT=…,LOST_SOLES_HOME_LNG=…,LOST_SOLES_HOME_ZOOM=14
# then a rebuild: aws amplify start-job --job-type RELEASE …
```

**Build-time inlining has a sharp edge, and it is guarded.** Static replacement follows the
reference, so the coordinate *would* land in a publicly served chunk if a client component ever
read it — and `/` is the signed-out landing route, so that chunk needs no session.
`scripts/check-home-not-in-client.mjs` scans `.next/static` in the Amplify build (the only place
the values exist) and fails the build if either appears. It never echoes the coordinate, and an
unset variable reports *"NOT a pass — nothing was checked"* rather than a tick.

A **blank** variable is treated as unset. `Number("")` is `0`, not `NaN`, so a half-finished console
entry would otherwise pass every finite-and-in-range check and centre the map on Null Island — a
valid-looking camera thousands of kilometres from any tile, whose symptom is an empty grey map that
reads as a broken basemap. A unit test covers it.

#### What `0053` does NOT do

The ticket's Description says the default camera is "the user's most recent activity centroid,
falling back to a configured home coordinate". **Only the fallback is built.** There is no
client-side activity query in the app yet — `0054` is the ticket that first brings the explored
set to the client — so the centroid would mean inventing a data path here that `0054` then
replaces. The acceptance criterion asks only for the configured home, and ticket `0186` carries
the centroid.

#### Sandbox note

`lost-soles-tiles` is an explicit, globally-unique bucket name, so an `ampx sandbox` deploy
**cannot coexist** with the `main` branch's stack — the same trade-off `LostSolesCaptureGuard`
documents, taken for operability (a runbook that opens with "look up the generated bucket name"
is a runbook that stops being followed).

### The `gl.MAX` spike — GO, with one risk knowingly deferred (ticket `0118`, D-230)

**Verdict: GO.** `05-fog-of-war.md` §4's technique works. `09-roadmap.md` §8.2 called this the
mitigation for the project's largest technical risk and §4 has no plan B, so this is the paragraph
that unblocks the rest of capability `08` — and it is written before `0055` starts, which was the
whole point of splitting it out of that ticket.

#### What was observed, and on what

| | |
|---|---|
| Route | `/dev/fog-spike` on `soles.devaultsecurity.com` — throwaway, removed at `0118`'s close |
| Geometry | 469 H3 res-10 cells (`gridDisk` k=12) around **downtown Tampa**, plus 2 isolated overlapping discs, in **one** `drawArraysInstanced` |
| Mask | half the drawing buffer, `R8`, `LINEAR`, `CLAMP_TO_EDGE`, bound inside MapLibre's `prerender` |
| MapLibre | 6.6.0, real `shaderData.vertexShaderPrelude` — `variant=mercator`, 664 bytes, `#define PROJECTION_MERCATOR` |
| Headless | Chromium 152 / SwiftShader (ANGLE over Vulkan 1.3), `FRAMEBUFFER_COMPLETE` |
| Desktop browser | **verified 2026-09-09** — the overlap reads as one region of uniform brightness, and the basemap is unchanged across a remove/reinstall A/B |

**The `MAX` probe, which is the actual finding.** Two discs at coverage 0.55 and 0.35 were drawn into
the real mask inside `prerender` and read back with `gl.readPixels`: `low(89)=88687 high(140)=160989
summed(230)=0 maxByte=140`. Coverage never exceeds the higher of the two inputs, so the discs are
being **unioned and not summed** — which is the union semantics D-020 rests on. Blend equation, blend
func, bound framebuffer and viewport all read back restored; `gl.getError()` stayed `NO_ERROR` across
32 blitted frames and across a remove-and-reinstall of the layer.

#### Three things the spike found that the ticket had wrong

1. **"Flat white discs" would have made the spike unable to fail.** `R8` is a normalised unsigned
   format, so under an additive blend `1.0 + 1.0` clamps to `1.0` — byte-identical to
   `max(1.0, 1.0)`. Two overlapping white discs look the same whether `MAX` is honoured or silently
   ignored. The discs are **mid-grey (0.45)** and the probe pair is deliberately unequal, which is
   what makes the two outcomes separable at all. `lib/fog/spike-mask.test.ts` asserts the summed
   overlap stays representable so nobody reverts it to match the ticket's wording.
2. **A value-based assertion cannot see the worst failure mode.** Three behaviours, two of them
   indistinguishable by value: `MAX` gives an overlap of 0.55, an additive blend gives 0.90 — loud —
   and **a driver ignoring the blend equation entirely gives 0.35, with the same maximum byte and the
   same distinct values as `MAX`**. Silent, and it would have destroyed the union semantics while
   reporting a pass. The verdict is therefore decided on **pixel counts**: both discs have the same
   radius, so under `MAX` the high disc keeps all of its pixels and the low one loses the overlap, and
   under last-write-wins it is the other way round. `count(high) > count(low)` *is* "`MAX` was
   honoured", and it needs no knowledge of where on screen the discs landed.
3. **`EXT_color_buffer_half_float` has nothing to do with `R8`.** Criterion 6 named it as though the
   mask depended on it. `R8` is **core colour-renderable in WebGL2**; the extension would matter only
   for an `R16F` mask, which §4.2's is not. Both are detected and recorded, but
   `checkFramebufferStatus` on a real `R8` attachment is what the verdict gates on.

#### What this does NOT prove — read before treating §9.6 as closed

§9.6's exact words are *"unvalidated: `MAX` blending against `R8` on older Android GPUs via ANGLE"*.
The evidence above is desktop and SwiftShader. **Qualcomm/Mali ANGLE honouring `MIN`/`MAX` into a
single-channel normalised target is still unverified**, and D-230 records the operator's decision to
accept that and defer it to **`0059`**, which already carries a real mid-range Android phone.

Why that is a cheap deferral rather than a gap: the failure, if it comes, is loud and local — the fog
looks wrong on the phone in a way nobody could miss, and the fix is confined to the mask pass. Nothing
downstream of `0055` is built on the blend equation. Contrast the risk that WAS retired here, where a
wrong answer would have invalidated the whole two-pass architecture.

#### For whoever writes `0055`

**The spike's code is gone.** `app/dev/fog-spike/`, `lib/fog/spike-mask.ts`,
`lib/fog/spike-cells.ts`, their tests and `tools/spike-harness/` were deleted when `0118` closed, as
that ticket instructed — *"nothing here is meant to survive; 0055 rebuilds it properly."* It is in
git at commit `9dfcd89` if a line of it is ever wanted; these five findings are here because they are
what the code was FOR, and rediscovering them costs a session each:

- **`defaultProjectionData`'s six uniforms are named in MapLibre's own type docs** —
  `u_projection_matrix`, `u_projection_tile_mercator_coords`, `u_projection_clipping_plane`,
  `u_projection_transition`, `u_projection_fallback_matrix`, `u_projection_clip_antimeridian`. Under
  mercator the compiler strips the globe ones, so every `getUniformLocation` must be null-guarded.
- **Resources cannot be built in `onAdd`.** The vertex shader needs
  `shaderData.vertexShaderPrelude`, which only exists on the render-method input. Build on first
  `prerender`, and rebuild when `shaderData.variantName` changes — that is MapLibre's own cache key
  for a changed projection.
- **Criteria 3 and 4 only hold together if the veil is transparent where the mask is zero.** The blit
  outputs **premultiplied** `vec4(rgb * a, a)` with alpha carrying the mask, because MapLibre's
  `render` pass sets `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`. An opaque full-screen blit satisfies
  "visible" and breaks "the basemap renders unchanged".
- **The spike used FLAT discs, not §4.2's `1.0 - smoothstep(0.45, 1.0, d)` falloff.** Deliberate: a
  flat disc writes one exact byte, so the probe compares integers. The soft edge is §4.1's whole
  argument and is `0055`'s to build.
- **If `0059` rebuilds the probe for the device check (D-230), rebuild it as a COUNT comparison.**
  The whole argument is three paragraphs up: a driver that ignores the blend equation produces the
  same bytes as one that honours it, and only the areas differ. A probe that compares values would
  pass the phone and mean nothing.

### The grid moved under this capability mid-flight (ticket `0194`, D-237)

**Recorded here because `08` was built entirely against res 10 and now renders res 11**, and the
audit reads this section before it reads the code.

The operator, looking at `0056`'s finished mist over ground they know, reported the revealed corridor
*zig-zagging* rather than following runs taken at an angle. `0194` established that the cause is not
the grid's silhouette — §4's discs mean hex geometry never reaches the screen, and that part of §2.1
was right — but the disc **radius**, which is `revealScale × circumradius` and therefore set by the
grid after all. Res 10's brush is 102 m, res 11's is 39 m, against a centre wander of a median 28 m
that is `REVEAL_R_M` and identical at both resolutions.

**What this capability inherits, none of it optional:**

- **`0058`'s viewport culling is load-bearing, not an optimisation.** 7× the cells, times D-232's
  ~2–3× bridge instances, against §6.4's `visibleInstanceCount <= 6,000` at every zoom.
- **The render disc shrank by 2.6×**, so every judgement recorded against the old brush — `0119`'s
  deferred tuning findings especially — was made at a scale that no longer ships. `0119` found the
  warm rim imperceptible at `u_rimAmt = 0.08` and the boundary too smooth to read as ragged, both
  computed against a 102 m disc and a 17 m reveal ramp. **Those arithmetic conclusions need redoing
  at 39 m before they are acted on.**
- **`SEAM_FLOOR` was measured once on a real GPU (D-231) and is derived from adventure's
  `noiseAmp`**, not from cell size, so it is unaffected — but it is worth confirming rather than
  assuming during the audit.

**USE-step evidence, for §3.** The capability has been exercised with real data through the real path
at res 11, twice, without asking the operator to go running (D-229):

- **2026-09-11, ten archived activities replayed** through `0192`'s path after the cutover: manifest
  `res: 11`, 590 cells, and the published `explored-r11.54.bin` decoded to exactly the set
  `traceToCells` derives from the same archived bytes — 0 missing, 0 extra.
- **2026-09-11, one genuinely new run** (`strava/20124614542`) through **normal ingest**, never
  replayed: 246 cells, 169 of them new ground — 31% overlap with existing territory, which is R3 §2's
  "heavy overlap" assumption appearing in live data. Blob at generation 56, 759 cells, again an exact
  match against the shipped derivation.
- **Looked at on the desktop browser** (D-227) by the operator, who reported it *"looks so much
  better"* and the new run *"showing up perfectly"*. That is the perception half; the counts above
  are the mechanical half.


### The perf harness, and what its first run found (ticket `0059`, `05` §6.4)

`?fog=perf` in the shipped app, `node tools/fog-harness/run-perf.mjs` headless. Seven instruments,
three checked-in synthetic datasets, one deterministic camera path, one summary table.

#### The split that makes the numbers mean something

Two surfaces answer two halves of §6.4, and **the capability doc records which number came from
which**, because conflating them is the failure mode this section exists to prevent.

| | answers | why it and not the other |
|---|---|---|
| `run-perf.mjs`, headless | items **1, 4, 5, 7** — counts, allocations, synchronous wall-clock | Chromium runs it under `--virtual-time-budget`, which advances the clock instantly whenever the renderer would wait. Counts and heap are unaffected by that; frame deltas are meaningless under it. The report forces items 2, 3 and 6 to no verdict here rather than printing a `PASS` a virtual clock cannot support. |
| `?fog=perf` in a real browser | items **2, 3, 6**, and everything else | A real clock. The phone is the only device §6.3's budget is actually about. |

**`EXT_disjoint_timer_query_webgl2` is absent on Chrome for Android** and on SwiftShader, so item 2's
per-pass split is a desktop-only measurement and item 3's frame time is what stands on the phone.
That is not a workaround; it is stated up front so a missing row is never read as a broken shader.

#### Baseline — headless, one Chromium per dataset, 2026-09-11

`HeadlessChrome/152.0.0.0`, `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader
driver)`, 400x800 CSS px — **D-238's reference viewport**, so §6.4's literal 6,000 is the number
checked rather than an area-scaled one.

| item | 50k | 150k | 500k | budget | |
|---|---|---|---|---|---|
| 1 `visibleInstanceCount` peak | 10,394 @ z13.5 | 10,394 @ z13.5 | 10,394 @ z13.5 | <= 6,000 | **FAIL — `0201`** |
| 4 cull, net of derivation, pan | 0.10 ms max | 0.20 ms max | 0.20 ms max | < 2 ms | PASS |
| 4 cull, gross, worst single pan | 17.8 ms | 19.6 ms | 20.0 ms | — | **finding — `0202`** |
| 4 culls inside the padded region | 0 / 6 events | 0 / 6 | 0 / 6 | 0 | PASS |
| 5 bucket cache hit rate | 77% | 77% | 78% | lazily, once | PASS |
| 7 peak JS heap over baseline | 32.8 MB | 73.7 MB | 90.3 MB | low tens of MB | **50k passes, `0203`** |

**The cross-dataset canary passes, and it is the result that matters most.** §6.4: *"an absolute
ceiling can pass by luck, while a count that is the same at 50k and 500k cannot."* From z13 up the
count is **10,394 at all three sizes** — ten times the stored cells, byte-identical draw. Below z13 it
does track dataset size (303 / 720 / 1,976 at z9) and that is §6.1's bucket ladder working rather than
the cull failing: at z9 the whole dataset is on screen, so what bounds the count is how many res-8
cells exist, and the absolute numbers are tiny *because* the resolution is coarse. §6.4 scopes its
claim to "from z13 up" for exactly this reason and the harness scopes its assertion the same way.

#### Three findings, filed rather than fixed

None of these is a regression; all three are the design meeting measurement for the first time.

- **`0201` — the peak is at z13.5, not at an integer zoom.** `ZOOM_TO_RES`'s `{ maxZoom: 13, res: 10 }`
  gives res 11 to every zoom **above 13.0**, while `zoom-buckets.ts`'s own header says twice that res
  11 owns *"z14 and up"* and that at z13 the finer bucket *"is not available there at any price"*. The
  band `(13, 14)` is the interval that argument excludes. §6.4's recorded *"peak is 5,271 at z14"*
  reproduces exactly — it only ever sampled integer zooms, which is the whole argument for a scripted
  path over a spot check.
- **`0202` — group geometry is derived inside `cullBucket`, on the frame path.** §6.3 budgets the cull
  at 1-5 ms and derivation at 30-80 ms *off* the frame path; `discsFor` runs the second inside the
  first, inside a `move` handler. Separating the two clocks is what produced the two item-4 rows
  above: the cull is 0.1-0.4 ms and does its job, and a single pan into new ground cost 19.6 ms of
  synchronous main-thread work — a dropped frame on its own.
- **`0203` — heap is 74-90 MB, not "low tens".** `ExploredSet` keeps a `Set<string>` of every cell id
  beside the `BigUint64Array`. 50k passes; 150k does not. §6.3 already names the exit and
  `explored-set.ts`'s `has()` already points at it.

#### Things worth knowing before touching this

- **The scripted path is measured in STEPS, not seconds.** `easeTo` is a function of wall-clock time,
  so a 30 fps device visits half as many camera states as a 60 fps one and then reports a better p95
  for having done less work. One camera state per animation frame makes every device visit the same
  states in the same order.
- **And in SCREEN PIXELS, not degrees.** Every claim §6.2 and §6.4 make is screen-relative — the
  padded region is 20% of the viewport, the instance ceiling is per unit of screen area. A path in
  degrees would pan a phone out of its padded region on a step a desktop absorbed, and `pan-inside`'s
  zero-cull assertion would then mean two different things while reporting one number.
- **`pan-across` goes out and back.** The first version panned 960 px one way, which left every later
  phase over ground offset from the dataset centre — far enough at 50k for the disc's edge to enter
  the viewport, which made the cross-dataset canary report geometry as drift.
- **The fixtures live in `public/fog-fixtures/`** (100 KB / 306 KB / 1.0 MB) and are written by
  `encodeExploredBlob`, the same function that writes the real `explored-r10.bin`.
  `lib/fog/perf/fixtures.test.ts` is both the generator (`FOG_FIXTURES=write`) and the byte-for-byte
  drift guard, so a change to the wire format, to `RES` or to h3's ordering fails on the commit that
  made it rather than silently invalidating every number above.
- **`?fog=perf:here` regenerates the same disc around the current camera**, because the fixtures sit
  at 30°N 100°E where the Florida extract has no tiles — and fog over an empty background is a frame
  that leaves out most of a frame. It also commits no coordinate.

#### The phone run was dropped, and the harness changed shape because of it (D-240)

`0059`'s title says *"on a real mid-range Android phone"*. There is no phone run: the operator
declined it, and the reasoning is worth keeping here because it changes what the numbers above are
defending.

D-227 had already moved the viewing surface to the desktop. What it kept was a headroom argument —
*"the phone remains the worst case even when it is not the common case"* — and that is still true and
was no longer worth the operator's time. The device is also a **Pixel 10 Pro**, a 2025 flagship, not
the mid-range Android `05` §6.3 and R4 price the budget against; a reading from it would have been
the wrong end of the range and would have reported PASS while proving nothing about the case §6.3
defends. D-230's deferred ANGLE `MIN`/`MAX` conformance question stays unverified and is accepted
into ordinary use on its own original reasoning: the failure is loud, local, and confined to the mask
pass.

**The first attempt at the phone run is what produced the harness's failure handling.** It sat on
`running…` and there was no way to tell slow from stuck — `run()` was `async`, the click handler
discarded its promise, and anything that threw left the button in that state for ever with no message
anywhere. It now has `try/catch/finally`, a **Cancel** that still yields a report over whatever ran,
an elapsed clock, an explicit stall warning after 8 s without a frame, and a notice when the tab was
backgrounded (which stops `requestAnimationFrame` and pauses the path — correct, and
indistinguishable from a hang unless said out loud). A harness whose failure mode is silence costs a
trip to find out, which is exactly what it cost.

#### The React half is proved separately (`tools/fog-harness/run-overlay.mjs`)

`run-perf.mjs` drives a real MapLibre Map and touches **no React**, while roughly 180 lines of `0059`
are React — the `?fog=perf` branch in `ExploredProvider` and the whole of `PerfOverlay`. Those are
what the operator interacts with, on a phone, outdoors, in one trip, and *"it typechecked"* is not
what should be standing behind that. This project has no jsdom and no testing-library by design —
`use-latest-run.test.ts` asserts hook ORDER with a source grep rather than by rendering — so the
browser is where React gets run.

`run-overlay.mjs` renders the **real** provider and the **real** overlay against a **fake MapLibre
Map**: the seam is chosen so that everything untested is exercised (flag read, synthetic load, ready
gate, run button, the driver, the sampler reading `layer.stats()`, the table, the Copy button) while
the thing already proved elsewhere is not rebuilt. It asserts the path drove 690 camera states from
z5 to z17 and that `pan-across` returns to where it started.

Three things it cost to get running, all written down because each failed **silently**:

- **`--jsx=automatic` is mandatory.** `tsconfig.json` sets `jsx: "preserve"` because Next does its own
  transform, so esbuild falls back to the CLASSIC runtime — `React.createElement` against a `React`
  none of these components import. The page dies at module scope and `--dump-dom` reports a `<pre>`
  still saying `pending`, with nothing in the output. `vitest.config.ts` documents the same trap.
- **`requestAnimationFrame` has to be shimmed to a timer.** Headless Chromium under
  `--virtual-time-budget` drives no compositor, so rAF callbacks never arrive and an rAF-driven loop
  waits forever — same wall `run-cull.mjs` hit from the other side. It costs nothing this surface was
  allowed to measure: frame cadence is item 3's business and item 3 carries no verdict here.
- **`PerfOverlay.run` jumps once before the path starts**, so the jump log is one longer than the
  path and every fixed index into it is off by one. It surfaced as a residual of exactly 4 px — one
  step of `pan-across` — which is what an off-by-one in a cancelling pair looks like.

**It also found a real one.** The `SYNTHETIC — NOT this account's territory` line used to render only
under `!ready`, so it disappeared the moment the dataset arrived — precisely when it starts mattering.
`?fog=perf:here` puts up to 500,617 cells of synthetic solid ground over the operator's own
neighbourhood; with the line hidden, nothing on screen said so. It is now always visible.


## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

