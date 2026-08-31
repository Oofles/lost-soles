# R3 — Geospatial Data Model for Fog of War + Novelty Routing

**Research date:** 2026-08-30
**Project:** Lost Soles — fog-of-war running map + Runescape-style per-skill XP
**Context:** GPS traces (arriving via Strava, see R1) permanently reveal a fog of war over a real
map. The same data must also answer *"plan me a ~5 mile route from my house that maximizes
streets I haven't run."* Hosting is AWS Amplify. Scale: 1 primary user, ≤5 ever, 3–5 runs/week,
3–8 mi/run, for years. **Cheapness matters a lot.**

---

## RECOMMENDATION

### The headline

**This is a few-megabytes problem, not a gigabytes problem.** Five years of the stated usage
pattern produces **~150,000 H3 resolution-10 cells in the absolute worst case (zero route
overlap), which is 1.2 MB of raw 64-bit cell IDs** — and realistically closer to 15k–50k cells
because a home-based runner re-runs the same streets constantly. The entire explored-territory
dataset fits comfortably in a browser tab's memory, forever.

**That single fact should drive the whole architecture.** Do not build a tile server. Do not
build a spatial index service. Do not pay for a database that scales with data volume.

### Chosen model: hybrid

| Layer | Representation | Resolution | Where it lives |
|---|---|---|---|
| **Visual fog** (primary) | **H3 hex cells** | **res 10** (~15,048 m² per cell, 75.9 m edge, ~131 m center-to-center) | One row/item per cell, plus a **precomputed compacted blob** served whole to the client |
| **Route planning + % stats** | **OSM way-segment matching** (Wandrer-style) | OSM `way_id` + fractional `[start,end]` ranges along the way | PostGIS-style tables, computed in a Lambda at ingest |
| **Zoom-out rendering** | H3 **parent cells** (res 6/7/8) with a *coverage fraction* | Derived, recomputed on write | Same store, separate partition |

### Chosen resolution: **H3 res 10**, with res 11 as a stretch goal

Res 10 hexes are ~76 m edge / ~151 m corner-to-corner, ~131 m between adjacent centers. That
maps almost exactly onto the "you revealed this by running past it" radius of 20–100 m the
project wants. Res 9 (201 m edge) is visibly too coarse — a single run down one street would
reveal a blob three streets wide. Res 11 (28.7 m edge) is prettier and still cheap (657k cells
worst case at 5 years, ~5 MB raw) but 4.4× the data for a difference most users won't notice at
typical zoom. **Start at res 10.** The reveal radius is then implemented as `gridDisk(cell, k)`
around each GPS sample, with `k=0` (~65 m effective radius) or `k=1` (~200 m) — pick `k=0` for a
tight, street-shaped reveal.

Store res 10 as the *canonical* resolution. Never store a mix — resolution mixing in H3 is a
correctness footgun (a res-9 cell and its res-10 children are different IDs and `gridDisk` /
`gridDistance` refuse to cross resolutions).

### Chosen storage: **DynamoDB** (Amplify-native), plus a derived S3 blob

- **DynamoDB** for the cell set and the run ledger. At this volume it sits permanently inside the
  **always-free 25 GB tier**, which AWS confirmed survived the July 2025 Free Tier overhaul.
  Realistic monthly bill: **$0.00–0.10.**
- **S3** for a per-user precomputed `explored.bin` (delta-varint-encoded sorted cell IDs, gzipped
  → roughly 300–500 KB even at the 5-year worst case). The web app downloads this once per
  session and renders the whole fog client-side with `h3-js` + MapLibre. No tile server, no
  per-viewport query, no latency. **S3 cost: fractions of a cent.**
- **Lambda** for ingest (Strava webhook → decode polyline → H3 cells → diff → write) and for
  map-matching. Comfortably inside the always-free 1M requests/month.

**Do not use Aurora Serverless v2 for this.** It *does* scale to zero ACUs in 2026 (min capacity
0, `SecondsUntilAutoPause` 300 s–86,400 s, ~15 s resume, longer after 24 h idle), and Aurora
PostgreSQL supports **both PostGIS and `h3-pg` 4.2.3** natively — technically a lovely fit. But it
lives in a VPC, its storage bills continuously, and every browsing session wakes it for at least
the pause interval. Realistic idle-ish bill is **$5–15/month** versus **~$0** on DynamoDB, for a
dataset that fits in a phone's RAM. See §3 for the full comparison.

**If you want SQL anyway** (and the segment-matching feature genuinely wants SQL), the cheap
answer is **Neon's free tier** — Postgres with PostGIS, scale-to-zero in ~a few hundred ms,
0.5 GB storage, 100 CU-hours/project/month, $0 — and Amplify Gen 2 has first-class support for
connecting a Data API to an *external* PostgreSQL, explicitly including Neon.

### Why not the alternatives, in one line each

- **Geohash** — rectangular cells with wildly varying aspect ratio by latitude, and the classic
  "adjacent cells have unrelated prefixes at boundaries" problem. No advantage over H3 here.
- **S2** — technically excellent and genuinely better than H3 for exact area/containment math,
  but the JS ecosystem is weaker (`s2-geometry` last published 2018; `@radarlabs/s2` and
  `nodes2ts` are alive but niche), and square cells make an uglier fog. H3 wins on ecosystem.
- **Buffered polygon union** (turf) — best-looking result on run #1, catastrophic by run #300:
  the union multipolygon grows to hundreds of thousands of vertices, GeoJSON payloads hit
  multiple MB, and JSTS-backed `union` throws topology exceptions on degenerate self-touching
  geometry. Non-idempotent and unbounded. Reject.
- **Raster bitmap tiles** — actually a decent fit (a z16 1-bit 256×256 mask is 8 KiB and covers
  432 m × 432 m), but every insert is a read-modify-write of every touched tile, "% explored of a
  neighborhood" becomes pixel counting, and it contributes *nothing* to route planning. H3 does
  everything it does plus the routing math.
- **Street-segment-only** — the right model for routing and for "% of streets in my city," but a
  bad *visual* fog: it can't reveal parks, trails, beaches, or off-road, and a map-matching
  failure silently erases territory the user actually ran. Use it *alongside* H3, not instead.

---

## 1. Representations of explored territory

### 1.1 H3 hex cells

H3 is Uber's hierarchical hexagonal index. Every cell is a 64-bit integer; every cell at
resolution *r* has a deterministic parent at *r−1* obtained by masking bits — this hierarchy is
the property that makes DynamoDB partitioning and zoom-out aggregation nearly free.

**Resolution ladder** (official figures, spherical earth / WGS84 authalic radius):

| Res | Avg cell area | Avg edge length | Center-to-center (≈ edge × √3) | Total cells on earth |
|---:|---:|---:|---:|---:|
| 8 | 737,327.6 m² (0.737 km²) | 531.4 m | ~920 m | 691,776,122 |
| 9 | 105,332.5 m² (0.105 km²) | 200.8 m | ~348 m | 4,842,432,842 |
| **10** | **15,047.5 m²** | **75.9 m** | **~131 m** | 33,897,029,882 |
| 11 | 2,149.6 m² | 28.7 m | ~50 m | 237,279,209,162 |
| 12 | 307.1 m² | 10.8 m | ~19 m | 1,660,954,464,122 |
| 13 | 43.9 m² | 4.1 m | ~7 m | 11,626,681,248,842 |

Source: <https://h3geo.org/docs/core-library/restable/>

**Mapping to the 20–100 m reveal radius:**

- A res-10 hex's inradius is ~65.7 m and circumradius ~75.9 m. So **"the cell you're standing in"
  is already a ~66–76 m reveal** — dead center of the target range, with zero extra work.
- Want ~20 m? You'd need res 11 (inradius 24.8 m) or 12, and accept 4–70× the cell count.
- Want ~100–150 m? Use res 10 with `gridDisk(cell, 1)` — that adds a ring at ~131 m out, giving
  an effective radius near 200 m. Slightly generous but cheap.
- **Recommendation: res 10, `k=0`.** Runs down adjacent parallel streets (typically 80–150 m
  apart in a US grid) will *mostly* stay in distinct cells, which is what makes the fog feel like
  it's tracking streets rather than smearing.

**Cells covered by a single 5-mile (8,047 m) run**, estimated as
`corridorArea(R + r_hex) / cellArea` where `r_hex` is the mid of inradius/circumradius:

| Res | R = 20 m | R = 50 m | R = 100 m |
|---:|---:|---:|---:|
| 8 | 12 | 13 | 15 |
| 9 | 33 | 38 | 46 |
| **10** | **99** | **132** | **189** |
| 11 | 353 | 583 | 972 |
| 12 | 1,587 | 3,187 | 5,894 |
| 13 | 8,778 | 19,950 | 38,857 |

A useful sanity check: at res 10 a straight line's *mean chord* through a hexagon is
`πA/P = π·15047.5/(6·75.9) ≈ 104 m`, so a bare 8,047 m polyline touches ~78 cells with no buffer
at all. **A 5-mile run is ~80–130 res-10 cells.** That is a laughably small write.

**Pros:** fixed-size 64-bit keys; equal-area-ish cells (unlike geohash); uniform neighbor distance
(unlike squares, where diagonal ≠ orthogonal); free hierarchy for aggregation and partitioning;
set operations are just integer set ops, so inserts are idempotent and dedup is trivial;
`cellsToMultiPolygon` turns a cell set into renderable outlines; `compactCells` losslessly
shrinks dense regions.

**Cons:** hexagons don't perfectly nest (a res-10 cell's 7 children at res 11 are approximate, not
exact — H3 parent/child is *not* an exact area partition), so "% explored" derived from parent
aggregation is approximate at the sub-percent level. There are also 12 pentagon cells globally;
they're in the ocean and you will never hit one, but `gridDisk` can return fewer than expected
neighbors near them — use `gridDisk` (safe) rather than `gridRingUnsafe`.

### 1.2 Geohash

Geohash interleaves lat/lng bits into a base-32 string; prefix length controls precision. Length
7 ≈ 153 m × 153 m; length 8 ≈ 38 m × 19 m.

**Why not:** (a) cells are *rectangles that get progressively squashed with latitude* — at 45°N a
geohash-8 cell is roughly twice as wide as tall, so a circular "reveal radius" becomes an
ellipse; (b) the **prefix discontinuity problem** — two physically adjacent points can have
geohashes sharing zero prefix characters when they straddle a major cell boundary, so
prefix-range scans miss neighbors and you must compute the 8 neighbors explicitly anyway;
(c) neighbor distance is anisotropic (diagonal neighbors are √2 further). H3 has none of these.
Geohash's one advantage — being a *string* that sorts lexicographically, making DynamoDB
`begins_with` range queries natural — is matched by H3 if you store the parent cell as the
partition key. `ngeohash@0.6.4` is maintained if you want it; you don't.

### 1.3 S2 cells

Google's S2 projects the sphere onto a cube, then applies a Hilbert curve, yielding 64-bit cell
IDs at 31 levels. Level 15 ≈ 100 m × 100 m; level 16 ≈ 50 m. It is **mathematically the best of
the three**: exact hierarchical nesting (each cell has exactly 4 children, no approximation), so
"% of parent explored" is exact; excellent range-query properties via the Hilbert ordering
(`S2CellUnion` collapses a region into a small list of contiguous ID ranges, which is the single
nicest property for a viewport query in *any* key-value store).

**Why not, for this project:** (a) the JS ecosystem is thin — `s2-geometry@1.2.10` was last
published in **2018**, `@radarlabs/s2@0.0.8` (Node native binding, actively published July 2026)
and `nodes2ts@4.0.2` are the live options but neither has H3's docs/community; (b) square cells
produce a blocky fog that looks like a screenshot of a spreadsheet, whereas hexagons read as an
organic reveal; (c) **AWS ships `h3-pg` as a managed extension on RDS/Aurora PostgreSQL and there
is no equivalent S2 extension** — if you ever move to Postgres, H3 is a one-line
`CREATE EXTENSION`. If the fog were a serious analytics product I'd argue for S2. For a personal
game, H3's ergonomics win.

### 1.4 Buffered polygon union (turf.js)

The "obvious" approach: `turf.buffer(runLineString, 50, {units:'meters'})` then
`turf.union(existingExplored, newBuffer)`. Current version: `@turf/turf@7.4.0` (published
2026-08-03).

**Quality:** best-looking result of any option. Smooth, organic, exactly the reveal radius you
asked for, no grid artifacts at any zoom.

**Why it collapses:**

- **Vertex explosion.** A 5-mile run downsampled to 10 m spacing is ~800 points. Buffering emits
  roughly 2 points per input point plus arc segments at each vertex — call it ~2,000 vertices per
  run. Union with the accumulated shape does not simplify; over 208 runs/year the union's ring
  count and vertex count grow roughly linearly with *unique* territory perimeter, and self-
  intersecting streets create a rapidly-multiplying set of interior holes. After a few hundred
  runs you're looking at 10⁵–10⁶ vertices. At ~22 bytes per `[-122.123456,45.123456]` coordinate
  pair, **200k vertices is ~4.4 MB of GeoJSON that must be re-shipped whenever the fog is
  rendered** — an order of magnitude worse than the H3 blob.
- **Union cost and fragility.** Turf's `union` is backed by polygon-clipping / JSTS. Unioning a
  million-vertex multipolygon is seconds-to-minutes of CPU in Lambda, and topology exceptions on
  degenerate geometry (a runner doing an out-and-back on the same sidewalk produces exactly the
  self-touching case that breaks robust-predicates implementations) are a well-known failure
  mode. A crash mid-union corrupts the one authoritative artifact.
- **Not idempotent.** Re-processing the same run must be a no-op. With a cell set it trivially is
  (set union). With polygon union, floating-point union of a shape with itself does *not*
  reliably return the identical shape, so replays drift.
- **No answer to the routing question.** "What's unexplored near here" requires a geometric
  difference against a giant polygon — far more expensive than a hash-set lookup.

**Verdict: reject as the storage model.** It is, however, a fine *rendering* technique applied to
a *single* run's trace for the "here's today's route" view, and turf is worth having as a
dependency for that plus distance/bbox/simplify utilities.

### 1.5 Raster / bitmap tiles

Store, per web-mercator tile, a 256×256 1-bit mask of explored pixels.

| Zoom | m/pixel @ 45°N | Tile edge | Tile area | 1-bit mask size |
|---:|---:|---:|---:|---:|
| 14 | 6.76 m | 1,730 m | 2.99 km² | 8 KiB |
| 15 | 3.38 m | 865 m | 0.75 km² | 8 KiB |
| **16** | **1.69 m** | **432 m** | **0.187 km²** | **8 KiB** |
| 17 | 0.85 m | 216 m | 0.047 km² | 8 KiB |

A 200 km² metro at z16 is ~1,070 tiles ≈ 8.8 MB raw, but sparse 1-bit masks PNG/gzip 20–50×, so
realistically a few hundred KB. Storage is genuinely fine.

**Update characteristics are the problem.** Every new run touches ~20–40 z16 tiles and each one
is a **read → decode → OR-in the new pixels → encode → write** cycle. That's fine at 4 runs/week,
but:

- Concurrent writes need locking or a single-writer queue (trivial here — one user).
- Backfilling or changing the reveal radius means regenerating every tile from raw traces.
- **"% explored of a neighborhood" becomes pixel counting** against a rasterized polygon mask —
  doable, ugly.
- **It contributes nothing to route planning.** You'd need a second representation anyway.
- Zoom-out requires generating a mipmap pyramid (z16 → z15 → … ) with a chosen downsample rule.

**Verdict:** the strongest of the rejected options, and the right answer if the fog needed
sub-10-metre fidelity. It doesn't. H3 res 10 or 11 gives comparable visual fidelity with a model
that also does routing and stats.

### 1.6 Street-segment matching (Wandrer / CityStrides model)

This is what the two mature products in this space actually do.

**Wandrer.earth** builds a road network from OpenStreetMap and map-matches Strava GPS traces onto
it, reducing every activity to *completed fractions of ways*: "0–100% of Main Street, 25–72% of
Spring Street." Its `segments` table stores `(user_id, osm_id, completed_ranges, geometry)`, and
it renders the traveled portion with PostGIS `ST_LineSubstring()` over the OSM way geometry and
the `completed_ranges` column. You get credit for a road only once, so progress requires new
territory. (<https://news.wandrer.earth/2026/01/30/wandrer-untraveled-roads.html>,
<https://wandrer.earth/faq>)

**CityStrides** uses a coarser node-based model: OSM nodes are the atoms, streets are collections
of nodes, and you complete a street by visiting its nodes. This is simpler but notoriously
brittle — when OSM contributors add nodes to a way, previously-complete streets revert to
incomplete. (<https://community.citystrides.com/t/about-the-node-street-and-city-data/19802>)

**Prefer the Wandrer fractional-range model over the CityStrides node model.** It is more robust
to OSM edits and gives real percentages.

**What map-matching costs:**

- **Engine.** The standard open-source answer is **Valhalla's Meili**. `POST /trace_attributes`
  returns per-edge metadata for the matched route including `way_id` — the OSM way ID — plus
  `matched_points` with confidence scores. (<https://valhalla.github.io/valhalla/api/map-matching/api-reference/>,
  <https://valhalla.github.io/valhalla/meili/>) Alternatives: OSRM's `/match` service, GraphHopper's
  map-matching, or rolling your own HMM.
- **Data.** A Geofabrik regional `.osm.pbf` extract (<https://download.geofabrik.de/>) imported
  with `osm2pgsql` or `osm2pgrouting`. A US-state extract is 200 MB–1.5 GB of PBF; a
  metro-sized extract is tens of MB.
- **Compute.** Valhalla needs its routing tiles built once (minutes-to-an-hour for a metro
  extract, GBs of RAM for larger regions) and then ~50–200 ms per matched activity. **This does
  not fit a 512 MB / 15-minute Lambda comfortably for anything larger than a metro extract.**
  Options: (a) build tiles for just the user's metro and ship them in a container-image Lambda
  (10 GB image limit — plenty for one metro); (b) run Valhalla in Fargate on demand; (c) use a
  hosted matcher (Mapbox Map Matching API — free tier ~100k requests/month, which at 208 runs/year
  is comically ample); (d) **skip real map-matching entirely** and do a cheap PostGIS
  nearest-way snap, which is much less accurate at intersections and on parallel paths but is a
  handful of `ST_ClosestPoint` / `ST_LineLocatePoint` calls.
- **Accuracy tax.** Map-matching *will* be wrong sometimes — parallel service roads, overpasses,
  GPS urban-canyon drift. If matching is your *only* representation, those errors visibly erase
  the user's accomplishments. This is the strongest argument for the hybrid: **H3 is ground truth
  for the fog; segments are a derived, best-effort layer for stats and routing.**

**Relevance to routing:** decisive. The routing feature is an *arc orienteering problem* — find a
closed walk of length ≤ L maximizing collected profit on edges, where profit = "unrun." This is
literally the Orienteering Arc Routing Problem / Prize-Collecting ARP from the OR literature
(NP-hard; see the arc-orienteering cycle-trip-planning work at
<https://www.sciencedirect.com/science/article/abs/pii/S1366554514000751>). You cannot pose it
against a hex grid — you need a *graph with edges*. So segment matching isn't optional if you
want good routes; it's the substrate.

---

## 2. Volume math (the most important input)

**Assumptions:** 4 runs/week × 52 = **208 runs/year**, average **5.5 miles** = 8,851 m, so
**~1,841 km/year** and **~9,205 km over 5 years**. Reveal radius R = 50 m.

### Worst case: zero route overlap

| Res | 1 year | 5 years | 5-yr raw IDs (8 B) | 5-yr @100 B/row |
|---:|---:|---:|---:|---:|
| 8 | 2,727 | 13,630 | 0.11 MB | 1.4 MB |
| 9 | 8,298 | 41,485 | 0.33 MB | 4.1 MB |
| **10** | **29,559** | **147,782** | **1.18 MB** | **14.8 MB** |
| 11 | 131,465 | 657,289 | 5.26 MB | 65.7 MB |
| 12 | 720,719 | 3,603,448 | 28.8 MB | 360 MB |
| 13 | 4,517,341 | 22,585,874 | 181 MB | 2.26 GB |

### Realistic case: heavy overlap

Zero overlap is physically impossible for a home-based runner. Sanity bound: everything within a
5-mile radius of home is π·(8.047 km)² = **203 km²**. At res 10 that entire disk is only
**13,291 cells**. Even if the user explores an area three times that (commutes, races, travel) the
5-year total lands around **20,000–50,000 res-10 cells**.

For reference, area → cell counts:

| Area | res 9 | res 10 | res 11 |
|---:|---:|---:|---:|
| 50 km² (small town / dense neighborhood) | 475 | 3,323 | 23,260 |
| 200 km² (5-mile radius disk) | 1,899 | 13,291 | 93,041 |
| 1,000 km² (large metro) | 9,494 | 66,456 | 465,203 |

### The conclusion

**Worst case 5 years at res 10: 1.2 MB of cell IDs. Realistic: under 400 KB.**

Sorted 64-bit H3 IDs in a local area share their high bits, so **delta encoding + varint gets you
to ~2–3 bytes per cell**, and gzip on top. Even the pessimistic 148k-cell figure compresses to
roughly **300–450 KB over the wire**. At res 11 it's still ~1.5–2 MB.

**Architectural consequence: ship the entire explored set to the client.** One HTTP GET at app
load. Then every one of the five query patterns below is an in-memory operation on a
`Set<string>` (or a sorted `BigUint64Array`) with zero network round-trips, zero server cost, and
instant pan/zoom. This is not a scaling compromise — at this data volume it is strictly better
than any server-side approach.

**Per-run write volume:** ~80–130 res-10 cells. At DynamoDB's $0.625 per million write request
units, a *year* of runs (208 × 130 ≈ 27,000 writes) costs **1.7 cents** before the free tier
zeroes it out.

**Raw trace storage** (keep these — they're the source of truth and let you re-derive everything
if you change resolution): a Strava-encoded polyline for an 8.8 km run at 1 Hz is roughly 30–60 KB
uncompressed, ~10–20 KB gzipped. 208/year × 5 years × 40 KB ≈ **40 MB.** Put them in S3 at
$0.023/GB-month = **$0.001/month.** Store them. Always store them.

---

## 3. Storage options

### 3.1 DynamoDB (recommended)

**Pricing (us-east-1, 2026):** on-demand $0.625 per million write request units, $0.125 per
million read request units, $0.25/GB-month storage (Standard). **Always-free tier: 25 GB
storage + 25 WCU + 25 RCU**, which AWS confirmed remains in the "Always Free" category after the
July 15 2025 Free Tier overhaul — no expiry, no credit dependency.
(<https://www.cloudzero.com/blog/dynamodb-pricing/>,
<https://spot.rackspace.com/blog/aws-free-tier>)

**Why it fits:** Amplify Gen 2's `defineData` is DynamoDB + AppSync by default, so this is the
zero-friction path — typed models, auto-generated GraphQL, per-user auth rules, real-time
subscriptions, no VPC. And our entire 5-year dataset is ~15 MB, i.e. 0.06% of the free tier.

**The H3 hierarchy is exactly the partition key you want.** A cell's parent is a bit-mask away, so:

```
PK = "U#<userId>#R6#<res6ParentCellId>"     # ~36 km² per partition at res 6
SK = "<res10CellId>"                        # the actual explored cell
```

A viewport query becomes: `polygonToCells(viewportBBox, 6)` → typically 1–20 res-6 parents → one
`Query` per parent, each returning at most a few thousand items. Res 6 (36.13 km² average cell)
is the right partition granularity: a full metro is ~28 partitions, and a partition holds at most
~2,400 explored res-10 cells (36.13 km² / 15,047 m²) — well under DynamoDB's 10 GB partition
limit with room to spare, and small enough that a `Query` is one page.

**Caveats:** no spatial operators, so any real geometry work (ST_Intersects, buffers, route graph)
must happen in Lambda or client-side. No joins — the segment-matching feature is awkward here.
Watch GSIs; each one duplicates writes and storage.

**Estimated monthly cost: $0.00.**

### 3.2 Postgres + PostGIS on Aurora Serverless v2

**Scale-to-zero: yes, verified for 2026.** Set `MinCapacity=0` in
`ServerlessV2ScalingConfiguration` along with `SecondsUntilAutoPause` (min 300 s, default 300 s,
max 86,400 s). Requires Aurora PostgreSQL ≥ 16.3 / 15.7 / 14.12 / 13.15 (or Aurora MySQL ≥ 3.08).
While paused, instance charges are zero; **storage still bills.** Resume is ~15 s typical, and
**>30 s if paused more than 24 hours** (deeper sleep, roughly a reboot).
(<https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html>)

**Things that silently prevent auto-pause** — read this list carefully, it's where the money goes:

- **Any** user-initiated open connection. A forgotten psql session or a connection-pooling app
  server pins it awake indefinitely.
- **An associated RDS Proxy** keeps a connection open to every instance → never pauses. This is a
  trap, because RDS Proxy is the standard advice for Lambda + RDS.
- Logical replication / binlog replication enabled.
- Being the primary of an Aurora Global Database; zero-ETL to Redshift; Babelfish T-SQL port
  activity.
- Frequent Lambda/Data API polling — anything hitting it more often than the pause interval.

Also: `pg_cron` jobs **do not** wake a paused instance and are silently skipped; autovacuum gets
cancelled at pause time.

**Real cost math.** Aurora Standard is ~$0.12/ACU-hour; on resume the instance comes back at ~2
ACU and scales from there. A hobby app browsed a few times a day with a 300 s pause interval
realistically stays awake 15–40 hours/month → **$3.60–$9.60 compute**, plus storage at
$0.10/GB-month (trivial here), plus I/O at $0.20/million (or switch to I/O-Optimized at
$0.156/ACU-hr with no I/O charges), plus backup storage. **Call it $5–15/month.** And Aurora
requires a VPC — if your Lambdas need both VPC access and internet (e.g. the Strava API) you
either add VPC endpoints or a **NAT Gateway at ~$32/month**, which would dwarf everything else.
(<https://aws.amazon.com/rds/aurora/pricing/>)

**What you'd get for that money:** PostGIS (`ST_LineSubstring`, `ST_LineLocatePoint`,
`ST_ClosestPoint`, GiST indexes), **`h3-pg` available as a managed extension on both RDS and
Aurora PostgreSQL — updated to 4.2.3** (<https://aws.amazon.com/about-aws/whats-new/2023/12/amazon-aurora-postgresql-h3-pg-geospatial-indexing/>),
and optionally **pgRouting** for the route-planning graph. That is genuinely the *best-tool* answer
for the segment/routing half of the project.

**Verdict:** overkill for the fog. Justifiable *only* if you commit to the full Wandrer-style
segment model. If you go this way, **use Neon instead** (below) until cost stops mattering.

### 3.3 Neon / Supabase (external Postgres)

**Neon free tier (2026):** up to 100 projects, 0.5 GB storage per project, 100 compute-hours per
project/month, autoscaling, scale-to-zero after **5 minutes idle with a ~few-hundred-millisecond
resume** (vs Aurora's 15–30 s), and **PostGIS is among the 80+ supported extensions**. No credit
card. (<https://neon.com/pricing>)

**Amplify supports this directly**: Gen 2 has first-class integration to connect a Data API to an
existing PostgreSQL/MySQL database, and the docs explicitly name Neon as a supported external
host, with real-time subscriptions and fine-grained authorization on top.
(<https://docs.amplify.aws/react/build-a-backend/data/connect-to-existing-data-sources/connect-postgres-mysql-database/>)

0.5 GB is 30× our 5-year fog dataset. It is *not* enough to hold a full OSM road-network import
for a large region — budget separately for that (either a paid tier, or keep the OSM graph in S3
+ DuckDB, §3.4). **This is the best option if you want SQL.** Caveat: it's a non-AWS dependency
with its own outage surface, and `h3-pg` availability on Neon is unconfirmed — verify before
relying on it (you can always compute H3 in JS and store `BIGINT`s).

### 3.4 Embedded / edge: SQLite, libSQL/Turso, DuckDB

- **SQLite / `better-sqlite3@13.0.3`** — a 15 MB database is nothing. The problem is *where it
  lives*: Lambda's filesystem is ephemeral, so you'd sync to/from S3 (or EFS) on every invocation.
  Workable for a single-writer app but you're hand-rolling durability. SpatiaLite adds geometry
  but isn't packaged for Lambda out of the box.
- **Turso / libSQL** (`@libsql/client@0.17.4`) — free tier: 100 databases, 5 GB total storage,
  500M monthly rows read, 10M monthly rows written. **Vastly more than this app needs, at $0.**
  Embedded replicas give zero-latency local reads with async sync to the cloud. Genuinely
  attractive. Downsides: no PostGIS-equivalent spatial functions, no H3 extension, another non-AWS
  vendor, and Turso's platform has churned repeatedly (the SQLite-rewrite-in-Rust pivot). For a
  project where the recommendation is already "keep it in the client," it doesn't add much.
  (<https://turso.tech/pricing>)
- **DuckDB** (`@duckdb/node-api@1.5.5-r.4`, `duckdb@1.4.4`) — has both a first-party **`spatial`**
  extension and a community **`h3`** extension (`isaacbrodsky/h3-duckdb`), and can query Parquet
  directly from S3. This is an *excellent* fit for the **offline/analytics half**: keep the OSM
  road network as Parquet in S3, and run "which ways within 8 km of home are unrun" as a DuckDB
  query in a Lambda with zero database to pay for. It is not an OLTP store — don't use it for the
  live app state. (<https://duckdb.org/community_extensions/extensions/h3>)

### 3.5 Cost comparison, 1–5 users

| Option | Fixed monthly | Realistic monthly | Spatial functions | Amplify fit | Verdict |
|---|---:|---:|---|---|---|
| **DynamoDB + S3 + Lambda** | $0 | **$0.00–0.10** | None (do it in JS) | Native | **Pick this** |
| Neon free tier | $0 | **$0.00** | PostGIS ✓ | Supported (external SQL) | Best SQL option |
| Turso free tier | $0 | $0.00 | None | Manual | Fine, adds little |
| Aurora Serverless v2 (min 0 ACU) | storage only | **$5–15** (+$32 if NAT) | PostGIS + h3-pg + pgRouting ✓ | Native | Only if you need the full routing stack |
| RDS `db.t4g.micro` always-on | ~$12–15 | ~$15–20 | PostGIS + h3-pg ✓ | Supported | Simpler than Aurora, no cold start, no free lunch |
| S3-only (precomputed blobs) | $0 | ~$0.001 | N/A | Native | Use *alongside* DynamoDB |

---

## 4. Query patterns

Given the volume conclusion (§2), **(a), (c), (d) and (e) are all solved client-side or in a
single Lambda over an in-memory set.** Concretely:

### (a) Render fog for the current viewport at varying zoom

**Client-side, from the downloaded blob.** Decode `explored.bin` into a `Set<string>` of res-10
cell IDs once at load (~150k entries max; `Set` construction is ~50 ms).

Rendering technique: the fog is a **dark polygon covering the world with the explored area as
interior rings**. Build it as:

```js
import { cellsToMultiPolygon, polygonToCells, cellToParent } from 'h3-js';

// 1. which cells are in view?
const visible = viewportCells.filter(c => exploredSet.has(c));
// 2. outline them (GeoJSON-order = [lng,lat])
const holes = cellsToMultiPolygon(visible, true);
// 3. one giant dark rect + holes -> a single MapLibre fill layer
const fog = { type:'Polygon', coordinates: [WORLD_RING, ...holes.flat()] };
```

`cellsToMultiPolygon` already dissolves shared edges, so a contiguous explored blob yields one
smooth outline rather than a honeycomb of hexagons — this is what makes the fog look organic. Feed
the result to MapLibre as a GeoJSON source and update it on `moveend`.

At low zoom, substitute parent cells (§6). **No network call. No server. Instant.**

### (b) % explored of a named region

Needs region boundaries (OSM admin relations, or a neighborhood GeoJSON like Zillow's or a city
open-data portal). Then:

```
total    = polygonToCells(regionBoundary, 10).length
explored = polygonToCells(regionBoundary, 10).filter(c => exploredSet.has(c)).length
pct      = explored / total
```

At res 10 a 200 km² city is 13,291 cells — this runs in milliseconds in the browser. **Precompute
and cache the denominator** per region (it never changes); recompute the numerator on each new
run.

*Caveat worth designing around:* hex-area-explored is a misleading metric for a runner, because
most of a city's area is buildings and back yards you can never run. **"% of streets" (from the
segment model) is the number the user actually wants**, and it's the metric Wandrer built its
whole product on. Use H3 % for "territory," OSM-way-length % for "streets," and label them
distinctly.

### (c) Unexplored areas within N miles of a start point

Two levels:

**Cheap (hex heat map, ship this first):**
```js
const home = latLngToCell(lat, lng, 10);
const k = Math.round(radiusMeters / (75.86 * Math.SQRT2 /* ≈131 m spacing */));
const disk = gridDisk(home, k);              // 2,977 cells for a 4 km radius
const unexplored = disk.filter(c => !exploredSet.has(c));
```
A 2.5-mile radius (half a 5-mile out-and-back) is `k=31` → **2,977 cells**, a sub-millisecond
filter. Cluster the unexplored cells (e.g. by res-8 parent) and surface the densest clusters as
"unexplored zones near you." This alone is a genuinely useful feature and requires **no OSM data
at all.**

**Real (actual routes):** requires the OSM graph. Load ways within the radius (~10k–20k way
segments for an 8 km radius in a US metro), assign each edge a profit = `unrun_fraction ×
length`, and solve the loop-constrained arc orienteering problem heuristically. Practical
approach for a hobby app: greedy/GRASP construction (repeatedly extend toward the highest
profit-per-metre reachable unrun edge) + 2-opt, with a shortest-path return leg to close the
loop, run in a Lambda for a few seconds. Do **not** attempt exact optimization; it's NP-hard.

### (d) Incremental insert with dedup

Set semantics make this free and idempotent:

```
newCells = unique(cellsFromTrace(gpsPoints, res=10, k))
delta    = newCells \ exploredSet         // set difference
```
Write only `delta` to DynamoDB (conditional put on `attribute_not_exists(SK)` if you want
belt-and-braces), append `newCells` to a per-run record, regenerate `explored.bin` in S3.
**Replaying the same run is a guaranteed no-op** — which matters, because Strava webhooks
redeliver.

### (e) "New territory discovered" count for XP

Literally `delta.length` from (d). One res-10 cell ≈ 15,047 m² ≈ 1.5 hectares — a nice XP unit.
Store it on the run record so the number is stable and auditable rather than recomputed. A
first-ever run down a new street yields ~80–130 new cells; the same run repeated yields 0. That
diminishing-returns curve **is** the game mechanic, and it falls out of the data model for free.

---

## 5. Aggregation for zoom-out

The problem barely exists at this volume — 150k cells is not "a million cells" — but do this
anyway because it's cheap and it keeps the low-zoom view from looking like static:

**Precomputed parent-resolution aggregates.** On each ingest, for every new res-10 cell walk up
`cellToParent(cell, r)` for r ∈ {8, 7, 6} and increment a counter:

```
PK = "U#<userId>#AGG#<res>"
SK = "<parentCellId>"
attrs: { exploredChildren: 412, totalChildren: 2401, fraction: 0.17 }
```

`cellToChildrenSize(parent, 10)` gives the exact denominator (7^(10−r), so 343 for res 7, 2,401
for res 6 — note H3's parent/child relationship is approximate in area, so treat `fraction` as an
opacity hint, not a statistic). Then:

| Map zoom | Render at |
|---|---|
| ≥ 15 | res 10 cells (exact) |
| 12–14 | res 8 parents, opacity = fraction |
| 9–11 | res 7 parents |
| ≤ 8 | res 6 parents |

Rendering partially-explored parents as **partial opacity** rather than binary is what makes
zoom-out read correctly — a city you've run 20% of shows as a dim glow, not a solid block.

**`compactCells`** is the other lever: it losslessly replaces any 7 sibling cells with their
parent, mixing resolutions in one array. Great for *transport* (it shrinks the S3 blob for
saturated neighborhoods) but remember the result is mixed-resolution — call `uncompactCells(arr,
10)` before doing set membership tests.

**Server-side vector tiles** (`geojson-vt@4.0.3` + `vt-pbf@3.1.3` in a Lambda, or a **PMTiles v3**
archive on S3 served via HTTP range requests with `pmtiles@4.5.0`) are the correct answer at
100× this scale, and PMTiles is a genuinely elegant serverless pattern — one file, one bucket, no
tile server (<https://docs.protomaps.com/pmtiles/>). **But it is unnecessary here and adds a
regeneration step to every ingest.** File it under "if the fog ever gets big," and note that
PMTiles is separately worth using for the *basemap* if you want to avoid Mapbox/Maptiler API keys.

---

## 6. Libraries (versions verified 2026-08-30 against the npm registry)

| Package | Latest | Published | Use |
|---|---|---|---|
| **`h3-js`** | **4.5.0** | 2026-07-01 | Core. WASM-compiled H3 v4, works in browser + Lambda |
| `@turf/turf` | 7.4.0 | 2026-08-03 | `along`, `length`, `bbox`, `simplify`, single-run buffers. Import sub-packages (`@turf/buffer`) to keep the bundle small |
| `maplibre-gl` | 6.6.0 | 2026-08-24 | Map rendering. No API key, no Mapbox billing |
| `deck.gl` | 9.3.11 | 2026-08-28 | Has a first-class `H3HexagonLayer` / `H3ClusterLayer` — GPU-rendered hexes, worth it if the GeoJSON approach stutters |
| `@mapbox/polyline` | 1.2.1 | 2023-09-14 | Decode Strava's encoded polylines (stable, not abandoned) |
| `pmtiles` | 4.5.0 | 2026-08-10 | Only if you self-host basemap tiles |
| `geojson-vt` | 4.0.3 | 2026-05-14 | Only if you ever need server-side vector tiles |
| `@duckdb/node-api` | 1.5.5-r.4 | 2026-08-11 | OSM/Parquet analytics in Lambda (+ `spatial` and `h3` extensions) |
| `ngeohash` | 0.6.4 | 2026-07-25 | Listed for completeness — not recommended |
| `@radarlabs/s2` | 0.0.8 | 2026-07-07 | Listed for completeness — not recommended |

**h3-js v4 API names** (v3 names were renamed wholesale; make sure any tutorial you follow is v4):
`latLngToCell`, `cellToLatLng`, `cellToBoundary`, `gridDisk`, `gridRingUnsafe`, `gridDistance`,
`gridPathCells`, `cellToParent`, `cellToChildren`, `cellToChildrenSize`, `polygonToCells`,
`polygonToCellsExperimental`, `cellsToMultiPolygon`, `compactCells`, `uncompactCells`, `cellArea`,
`edgeLength`, `getResolution`.

### Where the work runs

| Work | Where | Why |
|---|---|---|
| Decode polyline → H3 cells → diff → write | **Lambda** (Strava webhook handler) | Once per run. Trust boundary: never let the client claim XP |
| Regenerate `explored.bin` + parent aggregates | **Same Lambda**, after the write | ~150k cells is <100 ms of work |
| Fog rendering, viewport filtering, % stats, "unexplored near me" heat map | **Client** | Whole dataset is already in memory. Zero latency, zero cost |
| Map-matching to OSM ways | **Lambda (container image) or Fargate** | Needs Valhalla tiles / a big OSM extract. Batch, async, not on the request path |
| Route optimization | **Lambda**, a few seconds, async with a spinner | NP-hard heuristic over a local subgraph |
| OSM road-network analytics | **DuckDB over Parquet in S3**, in Lambda | No database to pay for |

**One rule:** compute cells **server-side at ingest** and treat the stored set as authoritative.
If the client computes cells, a user can trivially fabricate territory and XP. (With 1–5 trusted
users this is theoretical, but the cost of doing it right is zero.)

---

## 7. Proposed schema sketch

### DynamoDB (single-table, Amplify Gen 2 style)

```
Table: LostSoles
  PK (S), SK (S)

# ---- Raw run record (source of truth; never delete) ----
PK: USER#<uid>                       SK: RUN#<isoDate>#<stravaActivityId>
  { distanceM, durationS, startLatLng, polylineS3Key,
    cellCount: 118, newCellCount: 41, xpAwarded: 410,
    res: 10, processedAt }

# ---- Explored cells, partitioned by res-6 parent ----
PK: USER#<uid>#CELLS#<res6ParentId>  SK: <res10CellId>
  { firstSeenRunId, firstSeenAt, visitCount }
  # ~36 km² per partition; ≤ ~2,400 items per partition
  # Viewport query: polygonToCells(bbox, 6) -> 1..20 Query calls

# ---- Zoom-out aggregates (recomputed on each ingest) ----
PK: USER#<uid>#AGG#<res>             SK: <parentCellId>     # res ∈ {6,7,8}
  { exploredChildren, totalChildren, fraction }

# ---- Region progress (city / neighborhood) ----
PK: USER#<uid>#REGION                SK: <regionId>
  { name, totalCellsRes10, exploredCellsRes10, pct,
    totalWayMeters, ranWayMeters, streetPct, updatedAt }

# ---- OSM segment progress (Wandrer model; phase 2) ----
PK: USER#<uid>#WAY                   SK: <osmWayId>
  { completedRanges: [[0.0,0.42],[0.61,1.0]],  # fractions along the way
    lengthM, ranM, firstRunId }
```

### S3 layout

```
s3://lost-soles-data/
  users/<uid>/traces/<activityId>.polyline.gz     # raw, immutable, ~15 KB
  users/<uid>/explored-r10.bin                    # delta-varint cell IDs, gzipped (~300-450 KB)
  users/<uid>/explored-agg.json                   # parent-cell fractions for zoom-out
  osm/<region>/ways.parquet                       # geometry + length, for DuckDB
  osm/<region>/valhalla-tiles.tar                 # if self-hosting map matching
```

### PostGIS variant (if you go SQL — Neon or Aurora)

```sql
CREATE EXTENSION postgis;
CREATE EXTENSION h3;          -- h3-pg 4.2.3, managed on RDS/Aurora PostgreSQL

CREATE TABLE explored_cell (
  user_id     uuid    NOT NULL,
  cell        h3index NOT NULL,          -- res 10
  first_run   bigint  NOT NULL,
  first_seen  timestamptz NOT NULL,
  visits      int     NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, cell)
);
CREATE INDEX ON explored_cell (user_id, h3_cell_to_parent(cell, 8));

-- Wandrer-style fractional segment completion
CREATE TABLE osm_way (
  way_id   bigint PRIMARY KEY,
  name     text,
  highway  text,
  length_m double precision,
  geom     geometry(LineString, 4326)
);
CREATE INDEX ON osm_way USING GIST (geom);

CREATE TABLE user_way_progress (
  user_id   uuid   NOT NULL,
  way_id    bigint NOT NULL REFERENCES osm_way,
  ranges    numrange[] NOT NULL,      -- e.g. {[0,0.42],[0.61,1]}
  ran_m     double precision NOT NULL,
  PRIMARY KEY (user_id, way_id)
);

-- Render only the traveled portions (this is the Wandrer trick)
SELECT ST_LineSubstring(w.geom, lower(r), upper(r))
FROM user_way_progress p
JOIN osm_way w USING (way_id), unnest(p.ranges) AS r
WHERE p.user_id = $1 AND w.geom && ST_MakeEnvelope($2,$3,$4,$5,4326);
```

---

## 8. Suggested build order

1. **H3 res 10 cell set in DynamoDB + client-side fog.** This is the whole core mechanic and it is
   maybe two days of work. `polyline decode → latLngToCell → set diff → write → cellsToMultiPolygon
   → MapLibre`. No OSM, no map-matching, no tile server.
2. **Parent aggregates for zoom-out** + "new territory" XP counter. Both are ~20 lines.
3. **"Unexplored zones near me"** via `gridDisk` + filter. A real, useful feature with zero new
   infrastructure — ship this and see whether it's already good enough before doing (4).
4. **OSM segment matching** for real street percentages and real routes. This is the expensive
   half: OSM import, Valhalla or a hosted matcher, and probably the point where you add Neon.
5. **Actual route optimization** (arc orienteering heuristic). Last, and only if (3) proved
   insufficient.

**Two decisions to lock in now, because they're expensive to change later:**

- **Store the raw GPS traces forever, in S3.** They cost $0.001/month and they are the only thing
  that lets you change resolution, change the reveal radius, or re-derive segment matches later.
- **Pick res 10 and never mix resolutions in the canonical store.** Derived aggregates at other
  resolutions are fine; a heterogeneous canonical set is a permanent source of bugs.

---

## Sources

- H3 cell statistics table — <https://h3geo.org/docs/core-library/restable/>
- h3-js on npm (4.5.0) — <https://www.npmjs.com/package/h3-js>
- DuckDB H3 community extension — <https://duckdb.org/community_extensions/extensions/h3>
- Aurora Serverless v2 auto-pause / scale to zero — <https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html>
- Aurora Serverless v2 scale-to-zero announcement — <https://aws.amazon.com/about-aws/whats-new/2024/11/amazon-aurora-serverless-v2-scaling-zero-capacity>
- Aurora pricing — <https://aws.amazon.com/rds/aurora/pricing/>
- h3-pg on Aurora PostgreSQL — <https://aws.amazon.com/about-aws/whats-new/2023/12/amazon-aurora-postgresql-h3-pg-geospatial-indexing/>
- h3-pg on RDS PostgreSQL — <https://aws.amazon.com/about-aws/whats-new/2023/09/amazon-rds-postgresql-h3-pg-geospatial-indexing>
- DynamoDB pricing 2026 — <https://www.cloudzero.com/blog/dynamodb-pricing/>
- AWS Free Tier after the July 2025 overhaul — <https://spot.rackspace.com/blog/aws-free-tier>
- Amplify Gen 2 — connect to existing PostgreSQL/MySQL — <https://docs.amplify.aws/react/build-a-backend/data/connect-to-existing-data-sources/connect-postgres-mysql-database/>
- Neon pricing / free tier — <https://neon.com/pricing>
- Turso pricing / free tier — <https://turso.tech/pricing>
- Wandrer — evolution of the untraveled roads feature — <https://news.wandrer.earth/2026/01/30/wandrer-untraveled-roads.html>
- Wandrer FAQ — <https://wandrer.earth/faq>
- CityStrides node/street/city data — <https://community.citystrides.com/t/about-the-node-street-and-city-data/19802>
- Valhalla Map Matching API reference — <https://valhalla.github.io/valhalla/api/map-matching/api-reference/>
- Valhalla Meili overview — <https://valhalla.github.io/valhalla/meili/>
- Arc orienteering for cycle trip planning — <https://www.sciencedirect.com/science/article/abs/pii/S1366554514000751>
- PMTiles concepts — <https://docs.protomaps.com/pmtiles/>
- Geofabrik OSM extracts — <https://download.geofabrik.de/>
- osm2pgsql — <https://osm2pgsql.org/>
