# R7 — Novelty-Seeking Route Planning

**Status:** Research / planning phase. No code exists.
**Date:** 2026-08-30
**Scope:** Given a start point (usually home) and an approximate target distance, suggest running routes that maximise *new* territory (streets/hexes never run) and return to the start.

---

## 1. RECOMMENDATION

### TL;DR

| Decision | Choice |
|---|---|
| **Routing engine (v1)** | **openrouteservice (ORS)** hosted free API — `foot-walking` profile, built-in `round_trip` option. Fallback/secondary: **Stadia Maps** (hosted Valhalla). |
| **Map matching** | **Stadia Maps Valhalla `trace_attributes`** (returns OSM `way_id` per matched edge). Free tier covers us ~100×. |
| **Hosting** | **Lambda only.** No routing container, no EC2, no Fargate. Precomputed graph artifacts (v2 only) live in S3 and are loaded by Lambda. |
| **MVP algorithm** | **Generate-and-score.** Fire 20–30 cheap candidate loops at the hosted router (seeded `round_trip` + triangle-waypoint loops biased toward unexplored-dense areas), score each returned polyline against our own explored-data, return the top 3. |
| **Monthly cost** | **$0.00–$0.50 incremental.** Everything sits inside always-free tiers. The only real spend is a few cents of S3 in v2. |
| **Build cost** | **Cheap.** v1 is roughly 300–500 lines: a candidate generator, an HTTP client with a rate-limiter, and a scorer. It is one of the cheapest high-value features in the whole project. |

### Why this shape

The single most important insight from this research: **you do not need a custom-weighted router to build a novelty router.** The naive framing — "make explored streets expensive, unexplored streets cheap, then ask a router for a loop" — is the *correct* framing mathematically, but it is the expensive one operationally. No hosted routing API accepts arbitrary per-edge penalties from your own data (see §3.5), so taking that path forces you into self-hosting a Java/C++ routing engine on always-on infrastructure, which alone costs 3–12×/month more than the entire rest of the app.

The cheap path inverts it: **let a generic router propose many routes, and do the novelty scoring yourself.** Scoring is nearly free, because we already own the explored-territory data (H3 cells and/or matched OSM way IDs — R-fog-of-war). Turning a returned polyline into a novelty score is a `h3.latlng_to_cell()` sweep over the geometry, or a way-ID set intersection. Microseconds. So we can afford to generate 30 candidates and keep the best 3, and the quality of the result is governed by how well we *bias the candidate generation*, not by how clever the router is.

This "sample, route, score, rank" approach is explicitly what the task brief calls the "pragmatic MVP", and the research says: **yes, it is good enough, and it should be the permanent architecture, not a stopgap.** v2 improves the search inside the same architecture rather than replacing it.

### Monthly cost breakdown

| Item | Cost |
|---|---|
| openrouteservice free API key (2,000 directions/day, 40/min) | $0 |
| Stadia Maps free tier (200,000 credits/mo = 10,000 routing *or* map-match requests) | $0 |
| AWS Lambda (always-free: 1M requests + 400,000 GB-s/mo) | $0 |
| S3 storage for cached per-metro graph artifacts (v2 only, ~50–200 MB) | ~$0.005/mo |
| S3/Lambda data transfer at 1–5 users | ~$0.00 |
| **Total** | **≈ $0** |

For comparison, the rejected alternatives: a `t4g.small` (2 GB, the minimum realistic size for a self-hosted GraphHopper on a US-state extract) is ~**$12/mo** on-demand; `t4g.nano` at ~**$3/mo** has only 0.5 GB RAM and cannot hold a state-sized graph. Fargate/App Runner "scale to zero" still costs more than $0 and adds 30–90 s cold-start pain on a routing container. GraphHopper's paid Basic plan is **€69/mo**. All of these are 10–100× the budget for a feature that free tiers cover completely.

### The one thing to get right early

Store explored territory as **`(osm_way_id, [range_start, range_end] fractions)`** — this is exactly Wandrer's data model (§2.1) and it is the natural input to novelty scoring. H3 hexes are great for the *visual* fog of war, but they are a blunt instrument for routing: a 100 m hex can be "explored" because you ran one street through it while three other streets in it are untouched. Score with way IDs; render fog with hexes.

---

## 2. Prior art

### 2.1 Wandrer.earth — the closest thing to this feature that ships

Wandrer is the strongest reference. It is a bike/run "cover every road" game built on Strava, and in 2026 it shipped exactly the routing features we are contemplating.

**Data model.** Wandrer boils every activity down to *"completed portions of roads"* — `0–100% of Main Street, 25–72% of Spring Street`. Its backend is PostgreSQL + PostGIS. Originally there was a `segments` table (`user_id, osm_id, completed_ranges, geometry`), using `ST_LineSubstring()` against reference OSM road geometries to materialise the traveled portion. That table grew past **100 GB** and was eventually deleted — once tile rendering moved off-database, rows could be reduced to just `(osm_way_id, completed_ranges)`, because *untraveled = the inverse of traveled*, so it never needs storing.
→ Source: [The evolution of Wandrer's 'untraveled roads' feature](https://news.wandrer.earth/2026/01/30/wandrer-untraveled-roads.html)

**Rendering.** Serving untraveled roads as GeoJSON is impossible at scale ("As of December 9, 2025, planet Earth has 76 million kilometers of bikable roads. Even for the most dedicated of cyclists, 99% of roads on the planet will be 'untraveled'"). Wandrer moved to **Mapbox Vector Tiles**, generated with **[tippecanoe](https://github.com/felt/tippecanoe)** on a separate high-CPU Hetzner box, and served from a cheap VPS. Untraveled tiles are computed *on demand* — fetch user's traveled data for the tile, fetch raw OSM geometries for the tile, subtract, encode — with a 5-minute cache, and only rendered at **zoom ≥ 11**. At one point they served ~400,000 vector tile archives from a **$10/month server**. They call out PMTiles, GeoParquet and DuckDB as the modern alternatives.
→ Directly relevant to the fog-of-war rendering work in another research thread, and confirms "zoom-gate the expensive layer" as a survival tactic.

**Routing — "100% routing" (April 2026).** A **Chinese Postman Problem** solver: cover every road in a drawn/selected area. Crucially, *it does not solve to optimality*: "implemented in a way that doesn't necessarily produce the optimal/shortest route, but rather that it produces a 'plausible' route: something similar to what a human would do… not striving for optimal means that generating routes for bigger areas becomes more feasible." Rule of thumb given: a 100% route runs **25–33% longer than the total road distance** in the area (10 km of road ⇒ 12–13 km of travel). Outputs GPX + a text cuesheet. Paid tier, desktop only.
→ Source: ["100% routing" is live](https://news.wandrer.earth/2026/04/02/chinese-postman-routing.html)

**Routing — "A→B routing" (April 2026).** This is *our feature*. Set a start point, an end point, and a **total desired distance** (it computes the shortest A→B distance and uses that as a floor), pick activity type, and it generates **several route options with labels**, maximising new roads along the way. GPX + cuesheet export.
→ Source: [A->B routing is live](https://news.wandrer.earth/2026/04/10/a-b-routing.html)

**Lessons to steal:**
1. Set A = B and you have loop novelty routing. Our feature is a specialisation of theirs.
2. **Return multiple labelled options, not one answer.** They explicitly do this because "everyone is going to have different ideas about the kind of routes they want."
3. **Explicitly give up on optimality.** The product author, who could have solved this exactly, chose "plausible" over "optimal" for tractability. That is a very strong signal for our MVP.
4. Ship a **cuesheet** alongside GPX. They *recommend* the cuesheet over the GPX, because machine-generated novelty routes double back on themselves and are confusing to follow. They also added a "play the sequence" animation for the same reason. This is a real UX finding we would otherwise learn the hard way.
5. Their own warning: "The algorithms can make mistakes, but oftentimes there is a method to their madness. Following a machine's instructions can feel weird."

Pricing context: Wandrer Pro went from $30 → **$40/year** in May 2026; free accounts sync only 50 past activities.

### 2.2 CityStrides — the node-based shortcut

CityStrides models each OSM street as **a handful of representative "nodes"** rather than a full polyline, explicitly "to save storage and computational power". A street counts as complete when all (default 90%; "Hard Mode" = 100%) of its nodes are visited or closely passed. Nodes at intersections belong to multiple streets, so running an intersection credits every street meeting there.

It ships a **Node Hunter route planner** behind a $5/mo (or $50/yr) Supporter tier, oriented at "route toward your nearest uncompleted street".

**Assessment for us:** the node model is a legitimate cheap alternative to fractional-range matching — matching a GPS trace to points is far easier than matching to line segments. But it has documented pathologies: "one may complete short streets if they are only represented by crossing nodes at their ends," and node selection produces "quirky edge cases and mistakes". Given we want *distance-of-new-road* as a routing reward (not a binary street-complete flag), Wandrer's fractional model is the better fit. Consider the node model only if map matching proves too painful.
→ Sources: [CityStrides supporter features](https://citystrides.com/supporter-features), [community thread on nodes at intersections](https://community.citystrides.com/t/nodes-at-intersections-but-not-mid-block/21885/2)

### 2.3 Motera — direct competitor, worth knowing about

**[Motera](https://www.motera.app/)** is a gamified running app that does *literally* the Lost Soles core mechanic: "Fog of War hides streets you have never run before. As you explore your city on foot, the map is revealed." Plus territory capture by running loops and neighbourhood leaderboards. Full gameplay on the free tier. It does **not** appear to offer novelty-optimising route *generation*, which remains the differentiator.

### 2.4 Loop / round-trip route generators

| Product | Open? | API? | Free tier | Notes |
|---|---|---|---|---|
| **GraphHopper** `algorithm=round_trip` | **Yes** — Apache 2.0, in the OSS core (`Router.routeRoundTrip`, requires a non-CH "FlexSolver") | Yes (hosted Directions API) | 500 credits/day; a round trip costs **2 credits** ⇒ **250 loops/day** | Params: `round_trip.distance` (default 10,000 m), `round_trip.seed`, plus `heading` to force initial direction. See §4.1. |
| **openrouteservice** `options.round_trip` | **Yes** — GIScience/openrouteservice, a GraphHopper fork | Yes (HeiGIT hosted) | **2,000 directions/day, 40/min sliding window** | Params: `length` (m, "preferred value"), `points` (more points ⇒ more circular), `seed`. Round-trip capped at **100 km**. |
| **Valhalla / Stadia Maps** | **Yes** — Apache 2.0 | Yes (Stadia, Mapbox, others) | Stadia: 200k credits/mo, routing = 20 credits ⇒ **10,000 req/mo**, non-commercial | No native round-trip; has `optimized_route` (TSP over given waypoints) which we can use for triangle loops. |
| **OSRM** | **Yes** — BSD-2-Clause | Self-host only (demo server is not for production) | n/a | Has a `trip` service (TSP) and `match` service. No round-trip generator. |
| **Mapbox Directions** | No | Yes | 100,000 directions/mo free; then $2.00/1K (100k–500k) | No round-trip. Proprietary terms; results can't be stored freely. |
| **Strava Routes** | No | Route builder is web/app only; `routemaster` endpoint is undocumented/unofficial | See §6.3 — Strava API now requires a **$11.99/mo subscription** | Has loop generation in the UI but not exposed. |
| **Komoot** | No | **No public API.** Terra's Komoot integration is deprecated. | n/a | Only unofficial scrapers. Not usable. |
| **RouteLoops / Footpath** | No | No | Footpath free to draw, **$24/yr Elite** to export | Footpath is finger-draw + snap-to-road, not generation. Nothing to integrate with. |

**Conclusion:** ORS and GraphHopper are the only engines with a *native* round-trip generator, and ORS's free tier is 8× more generous in loops/day. ORS wins v1.

### 2.5 Existing open-source projects for "route over unvisited streets"

There is **no** mature open-source project that does what we want. Reuse is not available. What exists:

- **[Hermanoid/wandrer_planner](https://github.com/Hermanoid/wandrer_planner)** — the closest match in intent. Python + NetworkX, tried A* (found it exponential for this TSP-like problem), moved to **Ant Colony Optimization** over an "Exploration Graph" where *paths* are nodes, with a scoring function that rewards newly-traveled km and penalises over-distance and out-of-region travel. **Status: "unfortunately backburner", incomplete**, and the author notes Wandrer's creator built the official version. Read it for the scoring-function design; don't depend on it.
- **[matejker/everystreet](https://github.com/matejker/everystreet)** — clean OSMnx-based Chinese Postman implementation for the `#everystreet` challenge. Good reference for OSMnx graph handling and Eulerisation.
- **[solipsia/RunEveryStreet](https://github.com/solipsia/RunEveryStreet)**, **[adamreidsmith/Chinese-Postman-Route-Creater](https://github.com/adamreidsmith/Chinese-Postman-Route-Creater)**, **[verso-optim/pOSMan](https://github.com/verso-optim/pOSMan)** — more CPP-over-OSM solvers, various maturity.
- **[codereport/city-strides-hacking](https://github.com/codereport/city-strides-hacking)** — Python scripts that build optimal routes for CityStrides node collection.

**Important distinction:** every one of these solves the **Chinese Postman Problem** — *cover all edges, minimise distance*. Our problem is the **dual**: *fixed distance budget, maximise reward collected*. That is the **Orienteering Problem** (§5). CPP code is not directly reusable, but the graph-prep and Eulerisation halves are.

---

## 3. Routing engines

### 3.1 Comparison for a foot/running profile

| | GraphHopper | Valhalla | OSRM | openrouteservice | Mapbox Directions |
|---|---|---|---|---|---|
| **Licence** | Apache 2.0 | Apache 2.0 | BSD-2-Clause | GPLv3 (backend) | Proprietary |
| **Self-host** | Yes (Java/JVM) | Yes (C++) | Yes (C++) | Yes (Java, GH fork) | No |
| **Hosted API** | Yes | via Stadia/Mapbox | no official | Yes (HeiGIT) | Yes |
| **Foot profile** | `foot`, `hike` (with `hike_rating` / `sac_scale` support) | `pedestrian` | `foot` profile (Lua) | `foot-walking`, `foot-hiking` | `walking` |
| **Native round-trip** | **Yes** (`algorithm=round_trip`) | No (has `optimized_route`) | No (has `trip`/TSP) | **Yes** (`options.round_trip`) | No |
| **Map matching** | Yes (paid plans only on hosted) | **Yes — Meili, returns OSM way IDs** | Yes (`match` service) | No (has `snap`) | Yes |
| **Per-request cost tuning** | **Best-in-class** — `custom_model` JSON | Good — JSON costing options, but *no per-edge* | **Worst** — Lua profile is compiled in | Inherits GH-era options + `avoid_polygons` | Minimal |
| **Arbitrary per-edge penalties from our data** | Only via build-time encoded values or per-request polygon `areas` | No (`cost_polygons` is a proposal, not implemented) | Only via `osrm-customize` + segment-speed CSV | Only via `avoid_polygons` (hard, and area-capped) | No |

### 3.2 Self-hosting footprint

Planet-scale numbers (from a 2026 comparison and GraphHopper's own docs):

| | RAM (planet) | Disk (planet) | Preprocessing (country-sized ~300 MB pbf) |
|---|---|---|---|
| OSRM | ~55 GB | ~50 GB | ~5 min |
| GraphHopper | 40–60 GB JVM heap | ~40 GB | 8–12 min |
| Valhalla | tile-based, moderate | ~100 GB | 15–20 min |

GraphHopper's own guidance: parsing planet + building the base graph needs **~60 GB RAM / ~3 h**; setting `graph.dataaccess.default_type: MMAP` drops that to **31 GB but blows import time out to 3 days**, and "importing OSM data requires more memory than actually running the server". For regional extracts the forum guidance is "several gigabytes of RAM and disk".
→ Sources: [Pi Stack engine comparison](https://www.pistack.xyz/posts/2026-04-25-graphhopper-vs-osrm-vs-valhalla-self-hosted-routing-engines-guide-2026/), [GraphHopper deploy docs](https://github.com/graphhopper/graphhopper/blob/master/docs/core/deploy.md), [GH forum: memory errors and requirements](https://discuss.graphhopper.com/t/memory-errors-and-requirements/9071)

**Can any of them run in a Lambda?** Not sensibly.
- All three are long-lived servers that mmap or heap-load a prepared graph. Lambda's 10 GB memory ceiling is technically enough for a metro extract, but the graph would be re-loaded on every cold start (tens of seconds), and Lambda has no shared warm cache across concurrent invocations.
- Container image Lambda + a metro-sized graph is *possible* (image limit 10 GB), and you could get maybe 2–10 s cold starts for a small extract. But it is a lot of machinery to save $0, since hosted free tiers already cover our volume.
- **Verdict: do not run a routing engine in Lambda. Do not run one at all in v1.**

**Persistent container / EC2 sizing (if v2 ever needs it):**
- `t4g.nano` (0.5 GB, ~$3/mo): too small for GraphHopper on a state extract. Possibly viable for OSRM on a *city*-sized foot extract.
- `t4g.small` (2 GB, ~$12/mo on-demand): realistic GraphHopper minimum for a state extract. **This exceeds the "few dollars a month" budget on its own.**
- Fargate scale-to-zero: at $0.04048/vCPU-hour, a task that runs a few minutes a week is cents — but cold-starting a routing container that must load a graph makes every request 30–90 s. Bad UX for an interactive feature.

### 3.3 Hosted API pricing & free tiers (the numbers that matter)

**openrouteservice (HeiGIT)** — free Standard key.
- **Directions: 2,000 requests/day**, minutely limit of **40 requests in any rolling 60 s** (403 on daily, 429 on minutely).
- Foot profiles: max route distance 6,000 km. **Alternative & round-trip: max 100 km.** `avoid_polygons`: max **200 km²** area and **20 km** extent, and routes with avoid-areas capped at 150 km. Up to 50 waypoints per route. Isochrones: 5 locations, up to 120 km range. **Snap: 5,000 locations per request.**
- Free, requires attribution, no SLA, intended for non-commercial/limited use.
→ [API Restrictions](https://openrouteservice.org/restrictions/), [Routing options / round-trip](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/routing-options)

**GraphHopper Directions API.**
| Plan | €/mo | Credits/day | Map Matching |
|---|---|---|---|
| Free | 0 | 500 | ✗ |
| Basic | 69 | 5,000 | ✓ (150 locs) |
| Standard | 199 | 15,000 | ✓ (500 locs) |
| Premium | 479 | 50,000 | ✓ (700 locs) |

Credit costs: a routing request with 2–10 locations = **1 credit**; **round trip = 2 credits**; alternatives = +1; `optimize=true` = ×10; **map matching = `locations ÷ 50`, min 1 credit**; isochrone = 2 credits/minute explored, min 10.
⇒ Free tier gives **250 round trips/day**, and **no map matching at all**.
→ [Pricing](https://www.graphhopper.com/pricing/), [What is one credit?](https://support.graphhopper.com/support/solutions/articles/44000718211-what-is-one-credit-)

**Stadia Maps (hosted Valhalla).**
- **Free: 200,000 credits/month**, hard cap, no overage, **non-commercial only**, no credit card.
- **Routing = 20 credits/request. Map matching = 20 credits/request.** ⇒ **10,000 routes or map-matches per month, free.**
- Limits: 50 locations/route; **pedestrian max distance 250 km**; matrix 625 elements (standard tiers).
- Paid: Starter $20/mo (1M credits), Standard $80/mo (7.5M), Professional $250/mo (25M).
→ [Pricing](https://stadiamaps.com/pricing/), [Service limits](https://docs.stadiamaps.com/limits/)

**Mapbox.** 100,000 directions/mo free, then $2.00/1K (100k–500k), $1.60/1K (500k–1M). Map Matching bills per 1,000 requests on the same model. Generous, but proprietary terms and no round-trip generator. Not needed.

### 3.4 The key question: can any engine take a per-edge cost bias from our data?

**Short answer: not from a hosted API, and only awkwardly when self-hosted.** This is the finding that shapes the whole design.

**GraphHopper `custom_model` — the most promising, and still not enough.**
It is genuinely powerful and *is* accepted per-request. From the OSS docs: "with flex- and hybrid mode it is even possible to define the custom model on a per-request basis"; on `/route` POST with `ch.disable=true`, you send a `custom_model` field. The hosted API confirms "you can specify a different custom model in every request." It expresses `speed`, `priority` and `distance_influence` via `if / else_if / else` rules with `multiply_by` and `limit_to`, over encoded values like `road_class`, `surface`, `max_speed`, `hike_rating`.

Three mechanisms exist for injecting *our own* data:

1. **`areas`** (per-request). You attach a GeoJSON FeatureCollection of **Polygons** to the custom model and reference them with an `in_<id>` predicate:
   ```json
   { "priority": [ {"if": "in_explored1", "multiply_by": "0.2"} ],
     "areas": { "type": "FeatureCollection", "features": [
        {"type":"Feature","id":"explored1","properties":{},
         "geometry":{"type":"Polygon","coordinates":[[ ... ]]}} ] } }
   ```
   This *does* give per-request, data-driven soft penalties, and `priority` affects weight only (not travel time), which is exactly the semantics we want. **But:** only a single Polygon per area (no MultiPolygon), and the hosted API enforces **"Custom model cannot use more than 100,000 characters"** — you must "reduce the precision of the coordinates or reduce the number of points per polygon." Explored territory is thousands of thin street ribbons, not a handful of blobs. You could approximate with H3 hex polygons, but each hexagon costs ~7 coordinate pairs ≈ 150 chars, so you fit only a few hundred hexes, and A* performance degrades with many area predicates. **Workable for coarse "avoid this whole neighbourhood I've done to death" biasing; not workable for street-level novelty.**

2. **`custom_areas.directory`** (build-time). Feed GraphHopper a GeoJSON file at import; every edge gets its matching areas exposed to tag parsers, so you can create custom encoded values. GraphHopper uses this internally for country-level data. **Server-side and static** — a per-user novelty layer would require a per-user graph import.

3. **Custom encoded values** (build-time). The docs show `{"if": "true", "limit_to": "my_precalculated_value"}` with a warning that dynamic values "correlate strongly with the response time of A-star requests (i.e. when CH and LM are disabled)". GraphHopper devs explicitly recommend this over subclassing: *"It is highly recommended to use the custom model and e.g. custom EncodedValues instead of subclassing classes"*, and suggest you may need to "create an EncodedValue containing the edge ID" to let clients reference specific roads. **This is the technically correct answer** — bake an `explored` encoded value into the graph — but it means a graph rebuild per user (or per user per refresh), on infrastructure we've decided not to run.
→ Sources: [custom-models.md](https://github.com/graphhopper/graphhopper/blob/master/docs/core/custom-models.md), [profiles.md](https://github.com/graphhopper/graphhopper/blob/master/docs/core/profiles.md), [api-doc.md](https://github.com/graphhopper/graphhopper/blob/master/docs/web/api-doc.md), [GH forum: user/request specific edge weighting](https://discuss.graphhopper.com/t/user-request-specific-edge-weighting/6661)

**Valhalla — no.** Costing options are per-request JSON but operate on *edge classes*, not individual edges. `exclude_polygons` is a **hard exclusion**, not a bias, and has known bugs (edges within polygon bins not registered, edge-range handling). `exclude_locations` snaps to the nearest road and removes the **entire way**. A `cost_polygons` proposal ("a cost factor per polygon that the cost of an edge is multiplied with") exists as [issue #5268](https://github.com/valhalla/valhalla/issues/5268) but is **not implemented**. Valhalla is the wrong tool for novelty weighting; it is the right tool for map matching.

**OSRM — surprisingly, yes, but only self-hosted.** With the **MLD** pipeline you run `osrm-extract` → `osrm-partition` **once**, then re-run **`osrm-customize` with a `--segment-speed-file` CSV repeatedly without re-partitioning**. The CSV lists `osm_node_a,osm_node_b,speed[,rate]` per direction. Since OSRM's routing metric is the *rate*, you can encode "explored streets are slow/expensive" directly. `osrm-customize` is dramatically faster than CH re-contraction. **This is a genuinely viable per-user custom weighting mechanism** — but it needs a persistent OSRM process (restart or `osrm-datastore` reload after each customize), i.e. always-on infrastructure. File it under "v3 if the novelty routing ever becomes the product".
→ [OSRM Traffic wiki](https://github.com/Project-OSRM/osrm-backend/wiki/Traffic), [command-line tools](https://project-osrm.org/docs/v26.4.0/tools)

**openrouteservice — partially.** It inherits GraphHopper-lineage flexibility plus `avoid_polygons`, but the hosted free instance caps avoid-areas at **200 km² / 20 km extent** and drops max route distance to 150 km when they're used. Enough to steer away from one over-run neighbourhood; not enough for street-level.

**Bottom line:** the "cost bias" route is real but is gated behind self-hosting. Our design deliberately routes around it by moving the novelty logic out of the router and into the scorer.

---

## 4. The street network data

### 4.1 Getting OSM

**Geofabrik extracts** ([download.geofabrik.de](https://download.geofabrik.de/)) — free, updated daily, `.osm.pbf`. Real sizes as of research date:

| Extract | `.osm.pbf` |
|---|---|
| Vermont | 43.7 MB |
| Rhode Island | 49.7 MB |
| Oregon | 241 MB |
| Massachusetts | 295 MB |
| Illinois | 341 MB |
| Washington | 345 MB |
| Colorado | 362 MB |
| New York | 472 MB |
| Texas | 683 MB |
| California | 1.2 GB |
| North America | 18.0 GB |

**Metro-area sizing.** A metro is a fraction of a state. After filtering to walkable ways (`highway=` residential / footway / path / living_street / pedestrian / service / track / cycleway / tertiary / secondary, minus motorways and `foot=no`) the graph is small: published OSMnx figures put Paris at ~40,198 nodes / 58,727 links, Berlin at ~27,979 vertices / 72,956 edges, a fine-grained (50 m max edge) Manhattan at ~22,483 nodes. **A metro-scale walking graph is comfortably 50k–500k edges.** As CSR arrays plus per-edge attributes (length, way_id, class, explored flag), that is single-digit to low-tens of MB — **fits in Lambda memory trivially, loads from S3 in well under a second.**

**Tooling.**
- **[pyrosm](https://pyrosm.readthedocs.io/)** — fastest PBF → GeoDataFrame path; best for whole-extract batch prep.
- **[OSMnx](https://geoffboeing.com/2016/11/osmnx-python-street-networks/)** — most ergonomic; `network_type="walk"`, graph simplification that merges segments between intersections. Best for a named place / point+radius. Pulls from Overpass, so it is rate-limited and unsuitable for bulk.
- **osmium-tool** — for clipping a state PBF down to a metro bbox before parsing.
- **Overpass API** — great for ad-hoc queries and small areas; **never** for bulk or for anything on a request path (it is a shared free service with strict fair-use).
- **[BBBike extract service](https://extract.bbbike.org/)** — arbitrary user-defined bbox, emailed as PBF, up to 512 MB. **This is the right tool for "user travelled somewhere new"** — one-off custom metro extracts without downloading a whole state.
- **ORS `/export` endpoint** — dumps the actual routing graph (nodes + edges + weights) for a bbox. Interesting, but capped at **10 km² (standard) / 50 km² (collaborative)**, so only useful for small neighbourhood-scale work.

**Storage cost.** Even 20 metro extracts of processed graph artifacts at 50 MB each = 1 GB in S3 ≈ **$0.023/month**. Storage is a non-issue; do not over-engineer this.

**Licensing.** OSM is **ODbL**. Attribution ("© OpenStreetMap contributors") on every map view is mandatory. Derived explored-segment data used privately is fine; publicly distributing a derived *database* would trigger share-alike. For a 1–5 user personal app this is a footer line, not an architectural constraint.

### 4.2 Map matching (GPS trace → OSM way IDs)

This is the input that makes everything else possible: we must know *which street segments have actually been run*.

**Recommended: Valhalla Meili via Stadia Maps `trace_attributes`.**
- Returns per-matched-edge metadata **including `way_id` — the OSM way ID** — plus shape, matched_points, admins. Exactly the data Wandrer's model needs.
- Caveat from the docs: the returned attributes are *Valhalla routing attributes, not raw OSM tags*; to get base tags you take the way IDs and query OSM/Overpass separately. Fine — we'll have the OSM extract anyway.
- **Accuracy guidance**: works best with good GPS (urban canyons hurt), and **trace point density between 1/second and 1/10 seconds**. Denser or sparser degrades results. A typical watch GPX at 1 Hz is ideal; decimate long runs to ~1 point/3–5 s to stay under request limits.
- **Cost: 20 credits = 1 request** on Stadia. At 5 users × ~20 runs/month = **100 requests/month against a 10,000/month free allowance**. Effectively free forever, with ~100× headroom.
→ [Valhalla Map Matching API reference](https://valhalla.github.io/valhalla/api/map-matching/api-reference/), [Meili walkthrough](https://towardsdatascience.com/map-matching-done-right-using-valhallas-meili-f635ebd17053/)

**Alternatives ranked:**
1. **Self-hosted Valhalla Meili** — same quality, $0 API cost, but needs a container. Good as a *batch* job (a Fargate task that wakes, matches a backlog, exits) if we ever exceed the free tier. We won't.
2. **OSRM `match` service** — solid HMM matcher, self-host only, returns OSM node IDs (way IDs need extra work).
3. **GraphHopper map matching** — good, but **not on the free hosted plan** (needs €69/mo Basic). Available in the OSS core if self-hosting.
4. **ORS `/snap`** — accepts **5,000 locations per request**, snaps each to the nearest road. This is a *nearest-way heuristic*, not true HMM matching: it will happily snap you to the parallel service road or the wrong side of a divided highway, and it has no topological continuity constraint. **But it's free, one request per run, and 80–90% right on residential streets.** Perfectly acceptable as a v0 stopgap or a fallback if Stadia is down.
5. **Roll-your-own nearest-way** — with a local R-tree over the metro extract plus a simple "snap, then require consecutive matches to be topologically adjacent" filter, you get most of the way there for $0 and no external dependency. Worth ~100 lines if we want zero third-party coupling on the ingest path. Known failure modes: parallel roads, bridges/tunnels, and dense urban cores.

**Accuracy expectation:** a proper HMM matcher (Meili/OSRM) on 1 Hz consumer-GPS data in suburban/residential terrain gets **~95%+** of segments right. Dense downtown with tall buildings drops noticeably. Nearest-way heuristics land around 80–90% in suburbs and degrade badly downtown. For a *game*, occasional mis-credits are tolerable — plan a manual "I didn't run that" correction affordance rather than chasing perfect matching.

**Cost per run: $0.** Both the recommended path and every fallback sit inside free tiers at our volume.

### 4.3 Handling travel to new places

The user explicitly likes running in new places, including while travelling. Two regimes:

**With hosted routing (v1): nothing to do.** ORS and Stadia both serve the whole planet. The user can land in a city they've never visited and get novelty routes immediately — every street there is unexplored by definition, so even an unbiased loop scores 100% new. **This is a strong, under-appreciated argument for the hosted-API v1: it works globally on day one.**

**With local graph artifacts (v2 scoring/search): lazy per-region.** Do **not** download the planet (18 GB just for North America). Instead:
1. Maintain a small registry of "prepared areas" (bbox + S3 key + build date).
2. On a route request, check whether the start point falls inside a prepared area.
3. If not, return v1-quality results immediately (hosted round-trip + hex-level scoring, which needs no local graph) and enqueue a background "prepare this area" job.
4. The prepare job pulls a Geofabrik region (or a BBBike custom bbox), clips to a ~30 km box around the point, builds the walking graph, writes the artifact to S3.
5. Expire artifacts after N months of non-use.

Realistically a user has 1 home metro plus a handful of travel destinations per year. **This registry will hold fewer than 20 entries.** Do not build a tiling system for it.

---

## 5. The algorithm

### 5.1 Problem statement

Find a **closed walk** from node *S* with length **L ± tolerance** that **maximises the total length of previously-unrun edges traversed**, subject to profile constraints.

This is a **Prize-Collecting / Orienteering Problem** — specifically an **arc-routing** orienteering variant (reward lives on edges, not nodes) with a **closed-walk** rather than simple-cycle requirement (revisiting is allowed but earns nothing the second time). It is NP-hard. It is the *dual* of the Chinese Postman Problem that all the existing open-source projects solve: CPP fixes coverage and minimises distance; we fix distance and maximise coverage.

Two structural properties make it much friendlier than the general OP:
- **Reward is submodular** — running a street twice pays once. This kills naive "just make explored streets cheap and run Dijkstra" approaches, because the router will happily traverse the same delicious unexplored street repeatedly.
- **We have a hard distance budget and a fixed depot.** That prunes the search space enormously — everything of interest lies within a disc of radius ≈ L/2 of home, and practically within L/3.

### 5.2 Practical heuristics at our scale

**GraphHopper's own round-trip heuristic** is the reference point for "cheapest thing that works". From the GraphHopper devs: it is *"a simple heuristic based on 'points in a circle'"*, and *"there is no paper we used to implement this"*. They first tried computing alternative routes and traversing one forward and one back, but the circle-points approach worked better. Practically: pick one or more pseudo-random waypoints at roughly `distance/3` from the start in a seeded direction, route through them, and return. `round_trip.seed` re-rolls the randomness; `heading` forces the initial bearing. ORS's `points` parameter is the same idea — more points ⇒ more circular.
→ [GH forum: details on round trip calculation](https://discuss.graphhopper.com/t/details-on-round-trip-calculation/3514)

**The literature** (for v2) converges on a small set of methods that solve OP/TOP instances of a few hundred nodes to near-optimality in **seconds**:
- **GRASP / greedy randomised construction + local search** — build by repeatedly inserting the node with the best `reward / insertion-cost` ratio, then improve.
- **2-opt and Or-opt** — the standard tour improvement moves; the generalised-OP literature uses 2-opt to shorten the tour, freeing budget to insert more unrouted vertices.
- **Iterated Local Search (ILS)** — perturb (remove a random chunk, reinsert greedily) + local search, keep if better. Simple, robust, easy to time-box. **This is the recommended v2 solver.**
- **Simulated Annealing** and **multi-start SA** — competitive with exact solvers on OP-with-time-windows variants.
- **Tabu search with adaptive memory**, **memetic/ACO algorithms** — better solutions, much more code. Not worth it here.
→ Survey: [A survey of the orienteering problem (arXiv 2512.16865)](https://arxiv.org/html/2512.16865v1); see also the TOP metaheuristics literature and [MDPI SA for the Set Orienteering Problem](https://www.mdpi.com/2227-7390/12/19/3089).

**The key trick that makes v2 tractable: solve on a contracted graph.** Never run the metaheuristic on the raw 300k-edge street graph. Instead:
1. Cluster unexplored edges (H3 res 8–9 works well) and pick **~200–500 "anchor" nodes** at cluster centroids within the L/2 disc, each carrying a reward = metres of unrun street nearby.
2. Run **~500 Dijkstras** (one per anchor, plus home) on the raw graph to get an anchor-to-anchor **distance matrix**. At ~50–200 ms each on a metro graph with `scipy.sparse.csgraph`, that's **25–100 s, once**, and it is **cacheable per user per area** (invalidate when explored data changes materially — say, weekly, or after N new runs).
3. Solve the orienteering problem on the tiny 500-node complete graph with GRASP+ILS: **well under 1 second**.
4. Expand the chosen anchor sequence back to a real route via the router (or via stored shortest paths).

### 5.3 Handling constraints

| Constraint | Mechanism |
|---|---|
| **Target distance ±10%** | v1: filter candidates whose returned distance falls outside the band. v2: hard budget inside the ILS; reject infeasible insertions. Always show the actual distance prominently. |
| **Return to start** | Closed by construction (round-trip) or by the final leg back to the depot. |
| **Avoid highways / motorways** | The `foot-walking` / `pedestrian` profile already excludes them. Belt-and-braces in a GH custom model: `{"if": "road_class == MOTORWAY \|\| road_class == TRUNK", "multiply_by": 0}`. |
| **Prefer sidewalks / footways / parks** | ORS `foot-walking` prefers these natively. v2 custom weighting: boost `highway=footway/path/living_street`, `sidewalk=both/left/right`, `surface` preferences, `lit=yes` for dark hours. |
| **Avoid dangerous roads** | Penalise high `max_speed` + absent `sidewalk` tags. Add a **user blocklist** of way IDs ("never route me down this again") — cheap, and covers all the local knowledge no tag captures. |
| **Elevation** | ORS/GH support elevation; expose as a soft preference. Low priority. |
| **No excessive backtracking** | Penalise repeated traversal in the scorer (reward is already submodular, so a route that doubles back scores no extra novelty — this mostly handles itself). |

### 5.4 Expected compute time & Lambda fit

| Step | Time | Fits in Lambda? |
|---|---|---|
| v1: 25 hosted route calls, 8-way parallel | **~2–4 s** (each call 200–400 ms) | Yes, easily |
| v1: novelty scoring of 25 polylines (H3 sweep or way-ID intersection) | **< 50 ms** | Yes |
| v2: load metro graph artifact from S3 | **< 1 s** | Yes |
| v2: ~500 anchor Dijkstras (one-off, cached) | **25–100 s** | Yes — but run it as a **background/async** Lambda, not on the request path |
| v2: GRASP + ILS on the 500-node contracted graph | **< 1 s** | Yes |
| v2: expand anchor sequence to a full route | **~1 s** | Yes |

**Lambda's 15-minute timeout is not the binding constraint — API Gateway's 29-second integration timeout is.** v1 fits comfortably. For v2, put the anchor-matrix build behind an async job (SQS/EventBridge → Lambda, or Step Functions) and have the interactive request either use a cached matrix or fall back to v1 behaviour.

### 5.5 Is the "good enough" MVP actually good enough?

**Yes — and here is the argument.**

1. **The router's job is easy; the scorer's job is the product.** Novelty is measured against data we own, so we can generate cheaply and judge accurately. A user cannot tell whether the route they got was optimal; they can only tell whether it took them somewhere new. A 25-candidate sample from a biased generator will nearly always contain a route within a few percent of the achievable novelty, because in a residential grid there are *many* near-equivalent good answers.
2. **The person who could most easily have built the optimal version chose not to.** Wandrer's author explicitly built "plausible, not optimal" and shipped multiple labelled options for the user to pick between.
3. **Bias beats optimisation at this scale.** The difference between a random loop and a loop aimed at the unexplored-densest sector is enormous; the difference between a good heuristic loop and the true optimum is small. Spend the effort on candidate *generation* bias, not on the solver.
4. **Diminishing returns are real.** In a mostly-unexplored area every route is ~100% new and the optimiser is irrelevant. Optimisation only matters in the endgame, when the user has run most of their neighbourhood — which is exactly when v2 pays for itself, and exactly when we'll know whether we need it.

The honest caveat: **v1 will get noticeably worse as a neighbourhood approaches completion**, because randomly-seeded loops will increasingly return routes that are mostly-explored. That's the trigger to build v2 — not a reason to build it first.

---

## 6. Serverless feasibility on AWS

### 6.1 Recommended deployment

```
Amplify (React SPA, map UI)
   │
   ├── POST /routes/suggest  ──► API Gateway ──► Lambda "route-planner"  (Python or Node, 512–1024 MB, ~10 s)
   │                                                 ├─► ORS /v2/directions/foot-walking   (round_trip, N seeds)
   │                                                 ├─► ORS /v2/directions/foot-walking   (triangle waypoints)
   │                                                 ├─► DynamoDB: user explored way-IDs / H3 set
   │                                                 └─► (v2) S3: cached metro graph + anchor matrix
   │
   ├── (ingest) Strava webhook / GPX upload ──► Lambda "ingest" ──► Stadia trace_attributes ──► DynamoDB
   │
   └── (v2, async) EventBridge ──► Lambda "prepare-area" (up to 15 min) ──► S3 artifact
```

**Everything is Lambda. There is no persistent compute anywhere in this design.**

### 6.2 Real monthly cost

| Component | Usage at 1–5 users | Cost |
|---|---|---|
| Lambda invocations | maybe 2,000/mo vs **1,000,000 always-free** | $0 |
| Lambda GB-seconds | ~1,000 GB-s/mo vs **400,000 always-free** | $0 |
| API Gateway HTTP API | ~2,000 req/mo ($1.00/million) | ~$0.002 |
| ORS free key | ~500 calls/mo vs 60,000/mo allowance | $0 |
| Stadia free tier | ~100 map-matches/mo vs 10,000/mo | $0 |
| S3 (v2 graph artifacts, ~1 GB) | $0.023/GB-mo | ~$0.02 |
| DynamoDB on-demand | trivial | ~$0 |
| **Total incremental for this feature** | | **≈ $0.03/month** |

Note on the AWS free tier: AWS replaced the 12-month trial with a credit-based Free/Paid plan model on **15 July 2025** (new accounts get $100, up to $200 after onboarding tasks, expiring after 6 months). **The "Always Free" allowances were not removed** — Lambda's 1M requests + 400,000 GB-s/month remain permanently free and do not consume credits or the 6-month clock. Accounts created before that date keep the legacy free tier.
→ [AWS Free Tier in 2026](https://infratally.com/articles/aws-free-tier-2026/)

### 6.3 Rejected options and why

| Option | Monthly | Verdict |
|---|---|---|
| **t4g.nano always-on EC2** | ~$3.02 | 0.5 GB RAM cannot hold a GraphHopper graph for a state extract. Might run OSRM on a city extract. **Rejected: consumes the entire budget to replace something that is free.** |
| **t4g.small always-on EC2** | ~$12 | Realistic GraphHopper minimum. **Rejected: 4× over budget.** |
| **Fargate scale-to-zero** | ~$1–3 + cold starts | $0.04048/vCPU-hour is cheap for our duty cycle, but a routing container must load its graph on every cold start → 30–90 s first-request latency. **Rejected for interactive use; acceptable for a batch map-matching job if we ever outgrow Stadia.** |
| **App Runner** | min ~$5 (provisioned memory billed even when idle) | **Rejected.** |
| **Routing engine bundled into a Lambda container image** | ~$0 | Technically feasible for a metro extract under the 10 GB image limit, but multi-second cold starts, per-region image builds, and a lot of ops work to save $0. **Rejected — revisit only if hosted APIs become unavailable.** |
| **GraphHopper Basic hosted plan** | €69 | **Rejected: 20× over budget.** |
| **Mapbox** | $0 within 100k/mo | Would work, but proprietary terms, no round-trip generator, and no advantage over ORS. **Rejected.** |

**The headline finding for §5 of the brief is confirmed: for 1–5 users making a few requests a week, hosted APIs are not "cheaper than self-hosting" — they are free, and self-hosting costs 3–12× the entire project budget.**

### 6.4 Risks with the hosted-API choice

- **ORS free tier has no SLA** and is run by a research institute (HeiGIT) on donations. It can be slow or down. **Mitigation: put both ORS and Stadia behind a single `RoutingProvider` interface from day one** — it's a 3-method interface (`route(points)`, `roundTrip(start, distance, seed)`, `matchTrace(points)`) and it means an engine swap is an afternoon, not a rewrite.
- **Non-commercial terms.** Stadia's free tier explicitly forbids commercial use; ORS's free key is intended for non-commercial/limited use. Fine for a personal project; a blocker if Lost Soles is ever monetised. Stadia Starter is $20/mo at that point.
- **Attribution is mandatory** for both OSM data and ORS. Put it in the map footer.
- **Rate limits shape the algorithm.** ORS's **40 requests per rolling 60 s** means a 25-candidate plan is one comfortable batch but two concurrent plan requests will 429. Implement a token-bucket limiter and a small retry-with-backoff.

---

## 7. UX considerations

### 7.1 Presenting a route

- **Map + novelty overlay.** Draw the suggested route with **new segments in a bright colour and already-run segments dimmed**. This is the single most important visual: it shows *why* this route was suggested. Wandrer's before/after image (GPS trace red, credited road blue, untraveled black) is the model.
- **Headline stats:** total distance, **new distance** and **% new** (the actual objective), estimated time, elevation gain.
- **Multiple labelled options.** Return **3** with distinguishing labels ("Most new streets", "Closest to 5 mi", "Fewest turns" / "Quietest"). Wandrer does exactly this because preferences vary. Cheap for us — we already generated 25 candidates.
- **Turn list / cuesheet.** Wandrer *recommends the cuesheet over the GPX* for these routes. Novelty routes cross themselves and do things that look wrong; a numbered cue list is what makes them followable.
- **A "play the route" animation.** Wandrer added this specifically because self-crossing routes are hard to read as a static line. Small feature, disproportionate clarity win.
- **Set expectations.** Borrow Wandrer's honest framing: the algorithm can make mistakes, and following a machine's route "can feel weird". Let the user drag a waypoint or delete a leg and re-route.

### 7.2 Getting the route onto a watch

- **GPX is the lingua franca.** Generate `<trk>`/`<rte>` GPX from the returned geometry — trivial, no library needed. Offer TCX too if targeting older Garmin devices (TCX carries course points/turn cues; GPX 1.1 with extensions is generally enough for modern watches).
- **Garmin path:** Garmin Connect → **Training & Planning → Courses → Import** (accepts third-party `.gpx`, `.fit`, `.tcx`), save as a course, **Send to Device**, sync, then Navigation → Courses on the watch. Note the important gotcha: it must go through the *Courses* importer, **not** the activity uploader.
- **Strava path:** Strava accepts GPX/FIT/TCX. **Caution — Strava's API changed materially in 2026.** On **1 June 2026** Strava announced that Standard-tier API access requires an active **Strava subscription ($11.99/mo US)**, effective 1 June for new developers and **30 June 2026** for existing ones (with 3 free months for eligible existing developers). Rate limits remain 200 req/15 min and 2,000/day. Extended Access and official device integrations (Garmin, Apple) are exempt. This affects the *whole* project's ingest strategy, not just this feature — **flag it as a cross-cutting risk and prefer direct GPX/FIT upload as the primary ingest path**, with Strava as an optional convenience.
  → [Strava API pricing in 2026](https://appsforstrava.com/blog/strava-developer-program-changes-2026)
- **Simplest reliable delivery:** a download button that hands the user a `.gpx`, plus a shareable link. Don't build device integrations in v1.

### 7.3 Tracking planned vs actual

Yes, and it's nearly free given the rest of the architecture:

1. Store the planned route as an ordered list of `(way_id, range)` segments — the same representation as explored territory.
2. After the run is ingested and map-matched, intersect **planned segments ∩ actually-run segments**.
3. Report **adherence %** ("you covered 87% of the planned route") and **novelty delivered vs promised** ("planned 4.2 km new, you got 3.8 km").
4. This makes a great game loop: *plan → run → see the fog lift exactly where you aimed it*. It also gives free telemetry on suggestion quality — if adherence is consistently low, the routes are bad (or unsafe, or unrunnable), and that's a signal worth logging.
5. Bonus: segments the user ran that *weren't* planned are still credited normally — never penalise improvisation.

---

## 8. Phased implementation

### Phase 0 — Prerequisites (belongs to other research threads, but blocks this one)
- Explored territory stored as **`(osm_way_id, completed_ranges[])` per user**, plus H3 cells for rendering.
- GPX/FIT ingest → map matching (Stadia `trace_attributes`) → explored-segment updates.
- A `RoutingProvider` interface abstracting ORS / Stadia / future self-hosted.

### Phase 1 — "Dumb but useful" v1

**Goal:** the user types "5 miles from home" and gets 3 routes, at least one of which feels genuinely new.

1. **Candidate generation** (~25 candidates, 8-way parallel):
   - **~10 seeded round-trips** — ORS `foot-walking` with `options.round_trip = {length: L, points: 3..5, seed: k}` for k = 0..9.
   - **~15 triangle loops** — sample 2 waypoints from unexplored-dense H3 cells at radius ≈ `L/3.4` from home, spread across bearings, and route `home → P1 → P2 → home` as an ordinary multi-point directions call. Weight the sampling by metres-of-unrun-street per cell so the loops aim at the good stuff.
2. **Scoring.** For each returned polyline: densify to ~10 m, map each point to an H3 cell (and, if segment data is ready, snap to way IDs), sum **unique new distance**. Score = `new_metres − λ·|actual_distance − L|`, with a hard reject outside ±15%.
3. **Dedupe.** Discard candidates sharing > 60% of their geometry with a higher-scoring one (compute over H3 cell sets — cheap).
4. **Return top 3** with labels, stats, and the new/old colour split.
5. **Export.** GPX download + turn list from the router's instruction output.

**Effort:** ~300–500 lines plus UI. **Cost: $0.** **Works globally on day one.**

**Deliberately *not* in v1:** custom edge weighting, a local OSM graph, any self-hosted engine, elevation preferences, safety scoring.

### Phase 1.5 — Cheap wins (do these before considering v2)
- **Bias the round-trip seeds by bearing.** Compute the compass sector with the highest unexplored density within L/2 and use ORS's directional randomisation / `heading` to aim there. Probably the single highest-value-per-line improvement in the whole feature.
- **User way-blocklist** ("never send me down this road again") — reject candidates that touch blocked ways.
- **Remember rejections.** If the user dismisses a suggestion, downweight its geometry for a while.
- **Planned-vs-actual adherence** reporting (§7.3).
- **"Surprise me"** — drop the distance constraint band to ±25% and return the single most novel route. Users who like new places will often take the deal.

### Phase 2 — "Smarter" v2 (build only when v1 visibly degrades)

**Trigger:** the user's home area is > ~50% explored and v1 candidates start scoring under ~40% new.

1. **Offline area prep** (background Lambda, or even the dev machine): Geofabrik/BBBike extract → osmium clip to a ~30 km box → pyrosm/OSMnx walking graph → simplify → serialise as CSR + edge attributes → **S3**. ~10–50 MB per metro.
2. **Anchor selection & matrix**: cluster unrun edges at H3 res 8–9, pick 200–500 anchors within L/2, run scipy `csgraph` Dijkstra from each. Cache the matrix in S3/DynamoDB keyed by `(user, area, explored-data-version)`. **25–100 s, async, weekly-ish refresh.**
3. **Solver**: GRASP construction (best `reward / marginal-distance` insertion) + **Iterated Local Search** with 2-opt and Or-opt moves, hard distance budget, **submodular reward** (a segment pays once). Time-boxed to ~2 s. Return the top 3 *diverse* solutions from the ILS pool, not the top 3 by score.
4. **Expansion**: turn the anchor sequence into a real route via the hosted router (multi-waypoint call) so we get proper geometry and turn instructions for free.
5. **Constraint layer**: elevation preference, `lit=yes` for early/late runs, sidewalk/surface preferences, blocklist as a hard constraint.

**Effort:** meaningfully larger — a week or two. **Still $0/month**, because everything remains Lambda + S3.

### Phase 3 — only if this becomes the product
Self-hosted **OSRM MLD** with per-user `osrm-customize` segment-weight updates (§3.4), giving true per-edge novelty weighting inside the router. Requires an always-on instance (~$12/mo). Alternatively self-hosted **GraphHopper** with an `explored` custom encoded value baked in per user. **Do not do this for 1–5 users.**

---

## 9. Open questions

1. **Segment-level vs hex-level scoring in v1.** Hex scoring is available immediately and needs no map matching; segment scoring is more accurate but depends on the ingest pipeline being done. Recommend: build the scorer against an interface, start with hexes, swap in way IDs when ready.
2. **How much does ORS's `foot-walking` profile actually respect sidewalks and paths in the target metro?** Worth a manual spot-check with real local routes before committing — profile quality varies a lot by how well the area is tagged.
3. **Round-trip quality from ORS specifically.** ORS's implementation descends from GraphHopper's "points in a circle" heuristic; verify empirically that seeds produce genuinely *different* loops rather than minor variations. If not, lean harder on the triangle-waypoint generator.
4. **Does the user want loops, or is out-and-back / point-to-point-with-a-lift acceptable?** Loops are the hard case; if out-and-back is acceptable sometimes, the problem gets dramatically easier.
5. **Strava dependency.** The June 2026 $11.99/mo API subscription requirement is a cross-cutting project risk. Confirm whether the user already subscribes; if not, design GPX/FIT upload as the primary ingest path.

---

## 10. Sources

**Prior art**
- [Wandrer: The evolution of the 'untraveled roads' feature](https://news.wandrer.earth/2026/01/30/wandrer-untraveled-roads.html)
- [Wandrer: "100% routing" is live (Chinese Postman)](https://news.wandrer.earth/2026/04/02/chinese-postman-routing.html)
- [Wandrer: A->B routing is live](https://news.wandrer.earth/2026/04/10/a-b-routing.html)
- [Wandrer FAQ](https://wandrer.earth/faq)
- [CityStrides supporter features](https://citystrides.com/supporter-features) · [Nodes at intersections thread](https://community.citystrides.com/t/nodes-at-intersections-but-not-mid-block/21885/2)
- [Motera](https://www.motera.app/)
- [Wandrer vs CityStrides (Apps for Strava)](https://appsforstrava.com/blog/wandrer-vs-citystrides)
- [Hermanoid/wandrer_planner](https://github.com/Hermanoid/wandrer_planner) · [matejker/everystreet](https://github.com/matejker/everystreet) · [solipsia/RunEveryStreet](https://github.com/solipsia/RunEveryStreet) · [adamreidsmith/Chinese-Postman-Route-Creater](https://github.com/adamreidsmith/Chinese-Postman-Route-Creater) · [verso-optim/pOSMan](https://github.com/verso-optim/pOSMan) · [codereport/city-strides-hacking](https://github.com/codereport/city-strides-hacking)

**Routing engines**
- [GraphHopper custom-models.md](https://github.com/graphhopper/graphhopper/blob/master/docs/core/custom-models.md) · [profiles.md](https://github.com/graphhopper/graphhopper/blob/master/docs/core/profiles.md) · [web/api-doc.md](https://github.com/graphhopper/graphhopper/blob/master/docs/web/api-doc.md) · [deploy.md](https://github.com/graphhopper/graphhopper/blob/master/docs/core/deploy.md)
- [GraphHopper Directions API custom model docs](https://docs.graphhopper.com/openapi/custom-model)
- [GH forum: details on round trip calculation](https://discuss.graphhopper.com/t/details-on-round-trip-calculation/3514) · [user/request specific edge weighting](https://discuss.graphhopper.com/t/user-request-specific-edge-weighting/6661) · [avoid/include large amounts of POIs](https://discuss.graphhopper.com/t/avoid-or-include-a-large-amount-of-pois-in-route-planning/9611/7) · [memory errors and requirements](https://discuss.graphhopper.com/t/memory-errors-and-requirements/9071)
- [GraphHopper pricing](https://www.graphhopper.com/pricing/) · [What is one credit?](https://support.graphhopper.com/support/solutions/articles/44000718211-what-is-one-credit-)
- [openrouteservice API restrictions](https://openrouteservice.org/restrictions/) · [routing options (round_trip)](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/routing-options) · [GIScience/openrouteservice](https://github.com/GIScience/openrouteservice)
- [Valhalla](https://github.com/valhalla/valhalla) · [Map Matching API reference](https://valhalla.github.io/valhalla/api/map-matching/api-reference/) · [issue #5268: move from exclude_polygons to cost_polygons](https://github.com/valhalla/valhalla/issues/5268) · [issue #4659: exclude_polygons bugs](https://github.com/valhalla/valhalla/issues/4659)
- [Stadia Maps pricing](https://stadiamaps.com/pricing/) · [service limits](https://docs.stadiamaps.com/limits/) · [getting the best routes with Valhalla](https://docs.stadiamaps.com/guides/getting-the-best-routes-with-valhalla-turn-by-turn-directions-apis/)
- [OSRM Traffic wiki (segment-speed-file / osrm-customize)](https://github.com/Project-OSRM/osrm-backend/wiki/Traffic) · [OSRM command-line tools](https://project-osrm.org/docs/v26.4.0/tools)
- [GraphHopper vs OSRM vs Valhalla, 2026](https://www.pistack.xyz/posts/2026-04-25-graphhopper-vs-osrm-vs-valhalla-self-hosted-routing-engines-guide-2026/)

**Data & tooling**
- [Geofabrik downloads](https://download.geofabrik.de/) · [US extracts](https://download.geofabrik.de/north-america/us.html) · [BBBike extract service](https://extract.bbbike.org/)
- [pyrosm](https://pyrosm.readthedocs.io/) · [OSMnx](https://geoffboeing.com/2016/11/osmnx-python-street-networks/) · [tippecanoe](https://github.com/felt/tippecanoe)
- [Map Matching with Valhalla's Meili (walkthrough)](https://towardsdatascience.com/map-matching-done-right-using-valhallas-meili-f635ebd17053/)

**Algorithms**
- [A survey of the orienteering problem (arXiv 2512.16865)](https://arxiv.org/html/2512.16865v1)
- [Heuristic approaches for a new variant of the Team Orienteering Problem (arXiv 2507.06012)](https://arxiv.org/pdf/2507.06012)
- [Simulated Annealing for the Set Orienteering Problem (MDPI)](https://www.mdpi.com/2227-7390/12/19/3089)
- [Chinese postman problem (Wikipedia)](https://en.wikipedia.org/wiki/Chinese_postman_problem)

**AWS & export**
- [AWS Free Tier in 2026: what changed](https://infratally.com/articles/aws-free-tier-2026/) · [AWS Lambda pricing 2026](https://go-cloud.io/aws-lambda-pricing/) · [EC2 pricing 2026](https://go-cloud.io/amazon-ec2-pricing/)
- [Strava developer program changes 2026](https://appsforstrava.com/blog/strava-developer-program-changes-2026) · [Strava API developer guide](https://appsforstrava.com/developers/)
- [Importing GPX/TCX as Garmin Connect courses](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/124012/how-to-import-gpx-or-tcx-files-as-courses-in-garmin-connect)
