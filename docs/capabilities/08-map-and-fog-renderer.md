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

Set on the Amplify app (**not** committed, **not** `NEXT_PUBLIC_`):

```bash
aws amplify update-app --app-id d14fhvl4rp79nn --profile devault \
  --environment-variables LOST_SOLES_HOME_LAT=…,LOST_SOLES_HOME_LNG=…,LOST_SOLES_HOME_ZOOM=14
```

A **blank** variable is treated as unset. `Number("")` is `0`, not `NaN`, so a half-finished
console entry would otherwise pass every finite-and-in-range check and centre the map on Null
Island — a valid-looking camera thousands of kilometres from any tile, whose symptom is an empty
grey map that reads as a broken basemap. A unit test covers it.

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

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

