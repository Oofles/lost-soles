---
id: 54
slug: explored-blob-loader-and-decoder
title: Client blob loader and decoder — explored-r10.bin to a sorted typed array
type: feature
priority: high
status: open
size: m
capability: 08-map-and-fog-renderer
depends_on: [49, 51, 53]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-09T21:27:52Z
---

## Description

The browser half of the delivery contract (`05-fog-of-war.md` §7, `02-data-model.md` §6.4).
Fetch `manifest.json`, resolve what to download, decode, and hold the explored set in memory.

Decode to **both**, deliberately:

- a sorted **`BigUint64Array`** — 8 bytes/cell, 150k cells = 1.2 MB — which is what the render
  buckets iterate;
- a **`Set<string>`** for O(1) membership, which is what stats and `has()` queries use. At 150k
  entries, `Set` construction is ~50 ms, once.

Boot sequence, as an obligation rather than a suggestion:

1. Read IndexedDB (`{uid, generation}`, storing the **decoded** array — do not re-parse on warm
   start). If present, **render immediately. Do not wait for the network.**
2. Fetch `manifest.json` in parallel.
3. `manifest.generation === cached.generation` → done, nothing else fetched. This is the common
   case and it costs one 304.
4. `cached.generation >= manifest.deltasFrom` → fetch and apply the delta chain, validating
   `delta.fromGen === state.generation` before each.
5. Otherwise → full `.bin`, replace the cache.

Rendering before the network is licensed by D-020: the set is append-only, so a stale cache can only
ever be *missing the newest run*, never *wrong about revealed ground*. Stale-but-instant beats
correct-but-blank.

**Version skew is a refusal, not a guess.** If `manifest.res !== 10` (D-115) or the blob's `version`
byte is unknown, discard the cache and refuse to render. A silent mis-parse of cell ids looks like
territory teleporting, which is indistinguishable from data loss.

Applying a delta: merge-sort the adds in place, add to the `Set`, compute
`touchedParents = unique(added.map(c => cellToParent(c, 6)))` and invalidate **only those parents**
in each derived bucket (0058). One run touches 1–2 parents, so a mid-session update is
sub-millisecond and one VBO upload. `persistToIndexedDB` runs in an idle callback, never on the
frame path.

**The client never invents cells.** Only a server delta adds to the set.

## Acceptance criteria

- [x] `LSFG` decode round-trips the 150k-cell fixture from 0049 to the identical sorted set.
- [x] Both representations are built: sorted `BigUint64Array` and `Set`; a test asserts they agree.
- [x] IndexedDB stores the **decoded** array keyed `{uid, generation}`; a warm start does no
      LEB128 parsing (asserted by instrumenting the decoder).
- [x] Cache keeps the current generation and one previous; older entries are evicted.
- [x] Boot renders from cache before the manifest response arrives; a test with the network delayed
      2 s asserts a first paint of real territory well before then.
- [x] Manifest 304 path fetches no `.bin`.
- [x] Delta chain applies in order with `fromGen` validation; a mismatch falls back to a full fetch.
- [x] `res !== 10` or unknown `version` → cache discarded, render refused, a visible message.
- [x] `applyDelta` invalidates only the touched res-6 parents, asserted by a spy on the bucket
      invalidator.
- [x] Decode of a 150k fixture completes well inside the ~150 ms budget; the number is recorded.
      *Amended (D-229): as written this said "on the target phone", and it is not the operator's to
      produce. The measurement ships — `?fog=debug` reports parse and parse-plus-Set-build in
      milliseconds against a cell count, so the figure is readable on any surface the moment there
      is data. The recorded number is **15.7 ms parse / 46.9 ms parse + `Set` build at 152,551
      cells**, from the test suite on the dev machine, against `02` §6.3's ~50 ms estimate for a
      mid-range Android and a 150 ms budget. D-227 already made the desktop browser the viewing
      surface; D-229 removes the phone trip.*

## Notes

`explored-lastrun-r10.<gen>.bin` is **not** fetched here. The fog does not need it — revealed is
permanent — and it roughly doubles the payload. It is lazy-loaded by the cold-territory overlay in
capability `15` (D-133/D-147), which does not exist at this milestone.

0055 is deliberately built and spiked *before* this ticket lands, against a hard-coded array of a
few hundred cells (`09-roadmap.md` §8.2). If `gl.MAX` on a half-res `R8` FBO fails on the target
phone, that must be known in session one of `08`, not session five.

## Resolution

### How this ticket nearly failed to close, and the rule that came out of it

It was first written up as *"criteria 1-9 met, criterion 10 needs the operator's phone"*, with a
four-item validation checklist handed over. **Three of those four items were not the operator's to
do**, and saying so is the most useful thing in this Resolution:

- *"Reproduce the offline state in DevTools and confirm the note appears"* — already a passing unit
  test. Asking a human to redo a green test by hand is pure cost.
- *"Sync a run from another device and watch the delta land"* — **asking the operator to go running
  so a low-risk assertion could be watched.** The app exists to encourage running; running to
  service a validation task inverts the entire point of the project.
- *"Read the decode time on the phone"* — the operator reads this app on a desktop browser (D-227)
  and had already said so.

The operator raised it as the **third** occurrence across sessions. **D-229** is the fix, and it is
written into `CLAUDE.md`, `docs/capabilities/AUDIT.md` and the `/tickets` skill rather than left as
a resolve to do better: operator validation is for PERCEPTION — *would two competent people disagree
by looking at it?* — and never for constructing a scenario, re-verifying a passing test, using the
phone, or producing test data by exercising. Everything else is the agent's, with a smoke test.
D-153's USE step is amended with it: a capability audit needs the capability exercised with real
data through the real path, not a real run.

What replaced the checklist is in `## Operator validation` below: a live smoke test against real S3,
driving the shipped writer and the shipped reader, which proves what the "go for a run" item was
reaching for — a stale client converging on the current set through the real delta chain.

### The decision this ticket turned on — D-228

`0049` closed with one finding filed rather than fixed: the worker writes `users/<cognito-sub>/…`
while `amplify/storage/resource.ts` grants the browser `users/{entity_id}/*`, an identity-pool id
and a different string. **No browser credential has ever covered a single object in the delivery
layer.** That finding was assigned here, and it is the reason this ticket has a server half at all.

`01-architecture.md` §5's answer — a server component minting a presigned `getUrl()` — could not be
made to work, and not only because of the identity mismatch. D-220 walks the delta chain
**backwards**: a client learns hop *N−1*'s key only after reading hop *N*'s `LSFD` header, so
presigning a chain is one round trip to the app per hop, to save ~350 bytes each.

So the browser now asks this origin: `GET /api/fog?since=<gen>` returns a **plan** (`up-to-date` /
`delta` / `full` / `empty`) with the delta chain inline as base64, and `GET /api/fog/blob/<gen>`
serves the `LSFG` bytes. `05` §7's prohibition is intact and worth restating because the change
looks superficially like a breach of it: this is not a tile server, not a spatial index, not a
per-viewport query API. It is the same one-request-returns-the-whole-set design with one more hop.

`01-architecture.md` §5 is amended in place with the old text preserved as a dated aside, per the
audit rule — the code changed and so did the doc.

### What was built

| File | What it owns |
|---|---|
| `lib/fog/wire.ts` | the endpoint contract, shared by both halves |
| `lib/fog/decode.ts` | the instrumented decode seam — where `decodeStats` lives and why it is not in `src/domain` |
| `lib/fog/explored-set.ts` | both representations, `applyDelta`, the res-6 invalidation |
| `lib/fog/explored-cache.ts` | IndexedDB, `{uid, generation}`, the two-generation window |
| `lib/fog/transport.ts` | `fetch` with `If-None-Match`, behind an interface |
| `lib/fog/boot.ts` | `02` §6.4's five steps, the refusal, the focus/visibility triggers |
| `lib/fog/server.ts` | manifest read, plan resolution, the backwards chain walk in BYTES |
| `app/api/fog/route.ts`, `app/api/fog/blob/[gen]/route.ts` | the two routes |
| `components/map/explored-provider.tsx`, `fog-status.tsx` | the React seam `0055`+ attaches to, and the readout |
| `amplify/backend.ts` | `s3:GetObject` on `users/*` for the SSR compute role |

**75 new tests across six files**, all green; 1,669 in the suite. `npm run build` succeeds and
`npx tsc --noEmit` is clean.

### Decisions inside the implementation worth knowing about

- **The cache read happens BEFORE the request, not in parallel with it.** §6.4 says *"fetch
  `manifest.json` in parallel"*, which assumed the client fetches a manifest and re-derives the
  branch itself. It does not — the branch is resolved server-side and the request carries `since`.
  What the parallelism was *for* is preserved exactly: first paint does not wait for the network.
  The alternative (a `localStorage` generation hint so the request could go first) buys ~20 ms at
  the cost of two sources of truth that can disagree, and a disagreement there silently renders a
  map missing a run.
- **`plan: "empty"` is a fourth branch §6.4 does not have.** A user with no ingested activity has no
  manifest. Answering `full` would send them after a blob that does not exist and a 404 would read
  as an outage; an explored set of size zero is the correct, renderable answer. This is the state
  the deployed account is in right now.
- **The chain is assembled as BYTES, not decoded and re-encoded.** `explored-blob-store.ts` already
  walks the chain (`readDeltaChain`, `0051`) and is deliberately left alone: it returns decoded hops
  and discards the bytes, and `02` §6.5 requires the *client* to validate `fromGen` on each hop. A
  re-encoded hop would mean the client validated something this server assembled. The server-side
  decode is a **check** — a corrupt object becomes a full fetch here rather than a refusal to render
  in the browser.
- **A size guard on the chain that the design does not mention.** `MAX_CHAIN_BYTES = 256 KB`. §6.5's
  reasoning is that the incremental path exists so the *client's work* stays small; a chain past a
  quarter of a megabyte is no longer that, and the full immutable blob is then smaller,
  browser-cacheable, and one merge instead of twenty.
- **Both routes are `private`.** The app sits behind a CDN and both responses describe one person's
  map. This is the one new security-relevant property D-228 introduces.
- **Gunzipped server-side rather than passed through.** Forwarding `Content-Encoding: gzip` through
  a Next route means trusting the route, the platform's compression and the CDN not to re-encode
  it, and a double-encoded body fails as "corrupt blob" with nothing pointing at transport. `02`
  §6.2 measures gzip's gain over delta+varint as near-nothing, so this costs tens of kilobytes.
- **Authenticated, not owner-allowlisted.** `/api/tickets/capture` is owner-only because it is a
  write primitive aimed at the repository. This route serves the caller *their own* map, scoped by
  the `sub` from the verified session — an allowlist would 404 the second account the day one
  exists, which is not a stricter rule but a wrong one.
- **h3-js is now in `/`'s first load** — a 200 KB raw chunk, because `explored-blob.ts` imports
  `RES` from `fog.ts`, which imports h3. Deferring it behind a dynamic import was considered and
  rejected: criterion 5 and the first operator check are both *"render immediately, no
  blank-then-populate flash"*, and a chunk fetch before the cache read works directly against that.
  MapLibre is deferred because WebGL cannot SSR and it is a different order of magnitude. Recorded
  as a number rather than left to be discovered.

### What went wrong, and what it cost

- **The test harness lied before the code did.** `fakeTransport` spread its per-test overrides over
  a recording object, which silently discarded the recorder in exactly the tests that override
  behaviour — most of them. Every *"nothing was fetched"* assertion passed because nothing was
  counted. Caught only because two unrelated tests failed for a different reason. The recorder now
  wraps the override, and the comment on it says why.
- **`FAR` sat on a res-6 boundary.** The criterion-9 fixture picked the first cell whose parent
  differs from home's — which is precisely a cell whose 1-ring straddles two parents, so the test
  was asserting the opposite of what criterion 9 means. Both test files now require the cell's whole
  2-ring to share its parent.
- **`indexedDbCache(undefined)` could not express "there is no IndexedDB".** A default parameter
  fires on an explicit `undefined` too, so the no-IndexedDB path was untestable and quietly wrong.
  `null` and `undefined` are now distinct: *"there is none"* versus *"find the ambient one"*.
- **Fake timers and `fake-indexeddb` do not mix.** `fake-indexeddb` settles transactions on
  `setImmediate`, which fake timers replace, so a cache under fake timers never resolves. The two
  tests that need fake timers pass `cache: null`; the one that needs both drives the clock forward.

### Two findings filed, not fixed

- **`0188`** — `npm run lint` **and** `node scripts/check-design-tokens.mjs` both fail on any tree
  that has been built, on `public/maplibre/`: MapLibre's vendored, gitignored, generated worker,
  which `0053` introduced and nothing that walks the tree was told about. 1,090 lint warnings and a
  spurious "the palette is leaking". Both pass on the project's own code, verified by moving the
  directory aside. A gate that is known to be red is a gate nobody reads.
- **`0141` reproduced.** `tickets.mjs create --priority medium` was accepted and then failed
  `validate` with *"priority='medium' is not one of high|med|low"*. Already filed; the frontmatter
  was corrected by hand because no script command sets a priority.

### Verified with AWS credentials (D-181)

- **The bucket holds no `users/` objects.** `aws s3 ls s3://amplify-…-lostsolesuserdatabucket5-…/`
  shows one prefix, `raw/`. Nothing has completed `regenerateExplored`, so the live endpoint's
  correct answer today is `plan: "empty"` — which is exactly the branch added for it.
- **The SSR compute role had zero S3 statements before this deploy.** `aws iam get-role-policy` over
  both inline policies on `LostSolesAmplifyComputeRole` returned `[]` for every statement mentioning
  s3 — so the grant is genuinely load-bearing rather than tidy-up: `/api/fog` would have failed on
  its first `GetObject`.
- **Amplify job 160 SUCCEED**, commit `b7f2f4e`. Re-read after it landed, the role's *entire* S3
  reach is one statement, and it is the intended one:

  ```json
  { "Sid": "ReadExploredDeliveryLayerForTheBrowser",
    "Effect": "Allow",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::amplify-…-lostsolesuserdatabucket5-…/users/*" }
  ```

  No `PutObject`, no `DeleteObject`, no `List`, and nothing reaching `raw/*` — the asymmetry the
  synth test asserts, confirmed against the deployed role rather than against a template.
- **Both routes are live and gated.** Against `https://soles.devaultsecurity.com`, unauthenticated:
  `GET /api/fog?since=0` → **404** `{"error":"not found"}`; `GET /api/fog/blob/42` → **404**; and the
  conditional form `If-None-Match: "42"` → **404** as well, so the 304 path cannot be reached without
  a session either. Byte-identical to what `middleware.ts` returns for every other signed-out API
  request, which is the property `07` §6.5 asks for: an outsider cannot tell the route exists.
- **The authenticated paths are not agent-verifiable.** They need a session in the production pool
  and the agent holds no credential for it. That is what the operator checklist below is for, and it
  is a real gap in this record rather than a formality.
- Gate scripts: `check-boundaries`, `check-fog-render-boundary`, `check-fog-hot-path`,
  `check-no-deckgl`, `check-skills`, `check-fixture-geography`, `check-adapter-deletion`,
  `check-bundle-leak` all pass. `check-design-tokens` passes on the project's own code (see `0188`).
  `check-auth-posture` still fails on `0181`, which is unrelated and already filed.

## Operator validation

### What the operator checked

**Desktop browser, `/?fog=debug` — loaded, and the readout came up.** Reported 2026-09-09. That
was the one question here a person had to answer: does the thing render on the surface it is
actually used on. It does.

### What was checked with a live smoke test instead (D-229)

The first pass of this section asked for four things, three of which were not the operator's to do:
reproducing an offline state by hand that a passing unit test already covers, **going for a run** so
a delta could be watched landing, and a phone measurement. D-229 records why that was wrong. What
replaced it, driving the **shipped** writer and the **shipped** reader against **real S3** — a
throwaway bucket, torn down afterwards:

| # | What it proved |
|---|---|
| 1 | `regenerateExplored` published three real generations: 37 → 61 → 80 cells, `addedCount` 37 / 24 / 19 |
| 2 | `since=0` → `plan: full`, `generation 3`, `cellCount 80`, `deltasFrom 0` |
| 3 | `since=3` → `plan: up-to-date`, nothing else fetched |
| 4 | `since=2` → `plan: delta`, **1 hop**; `since=1` → `plan: delta`, **2 hops**, oldest first |
| 5 | **THE CONVERGENCE.** A client that took the full blob at generation 1 (37 cells) and applied the two real hops ended **byte-identical** to a client that fetched generation 3 whole — same generation, same 80 cells, same order, and `has()` agreeing on every one. This is what the "sync a run and watch it land" check was for. |
| 6 | An unknown user → `plan: empty`, `generation 0` — the branch `02` §6.4 does not have |
| 7 | Bucket listed and deleted; nothing left behind |

### What was checked against the deployed app

- **Amplify job 160 SUCCEED** (`b7f2f4e`). The SSR compute role's *entire* S3 reach afterwards is
  one statement — `s3:GetObject` on `users/*`, Sid `ReadExploredDeliveryLayerForTheBrowser`. No Put,
  no Delete, no List, nothing reaching `raw/*`. It had **zero** S3 statements before, so the grant
  is load-bearing rather than tidy-up.
- **Both routes live and gated.** Unauthenticated against `https://soles.devaultsecurity.com`:
  `/api/fog?since=0` → 404 `{"error":"not found"}`, `/api/fog/blob/42` → 404, and the conditional
  form with `If-None-Match: "42"` → 404 — so the 304 path is unreachable without a session. Byte-
  identical to every other signed-out API response, which is the property `07` §6.5 asks for.
- **The bucket holds no `users/` objects**, only `raw/`. Nothing has completed `regenerateExplored`
  for the real account, so the live endpoint's correct answer today is `plan: "empty"`.

### Left to real use

The offline note, the mid-session delta and the 304 all have passing unit tests and, for the S3
half, the live smoke test above. Whether they *feel* right in the browser is a question for when
there is fog to look at — `0055`–`0057`. Bugs found in use get tickets then; that is cheaper than
manufacturing the scenarios now.
