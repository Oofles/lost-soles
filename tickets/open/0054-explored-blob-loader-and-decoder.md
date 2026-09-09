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
- [ ] **(operator)** Decode of a 150k fixture completes in under ~150 ms on the target phone; the
      number is recorded. *Marked `(operator)` during the ticket, not as written. There is no
      instrument here that can answer it: the claim is about D-124's mid-range Android and the
      agent has a laptop. The measurement itself is built and shipped — `?fog=debug` reports
      `parse` and `parse + Set build` in milliseconds against a cell count — so the operator's part
      is to read a number, not to construct one. D-227 defaults validation to the desktop browser;
      this is one of the cases it names as genuinely phone-specific, because "the phone remains the
      worst case even when it is not the common case".*

## Notes

`explored-lastrun-r10.<gen>.bin` is **not** fetched here. The fog does not need it — revealed is
permanent — and it roughly doubles the payload. It is lazy-loaded by the cold-territory overlay in
capability `15` (D-133/D-147), which does not exist at this milestone.

0055 is deliberately built and spiked *before* this ticket lands, against a hard-coded array of a
few hundred cells (`09-roadmap.md` §8.2). If `gl.MAX` on a half-res `R8` FBO fails on the target
phone, that must be known in session one of `08`, not session five.

## Resolution

**THE TICKET IS NOT CLOSED.** Criteria 1-9 are met and the code is committed; criterion 10 needs a
number only the operator's phone can produce. This section is written now rather than at close so
that the reasoning survives the context boundary — per `CLAUDE.md`, the Resolution *is* the handoff.
A later session reads the operator's number, ticks criterion 10, appends the result, and runs
`close`.

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
- **The SSR compute role has zero S3 statements today.** `aws iam get-role-policy` over both inline
  policies on `LostSolesAmplifyComputeRole` returns `[]` for every statement mentioning s3. So the
  grant added in `amplify/backend.ts` is genuinely load-bearing: before this deploy, `/api/fog`
  would fail on the first `GetObject`. Re-verify after the Amplify build lands.
- Gate scripts: `check-boundaries`, `check-fog-render-boundary`, `check-fog-hot-path`,
  `check-no-deckgl`, `check-skills`, `check-fixture-geography`, `check-adapter-deletion`,
  `check-bundle-leak` all pass. `check-design-tokens` passes on the project's own code (see `0188`).
  `check-auth-posture` still fails on `0181`, which is unrelated and already filed.

## Operator validation

**Restated for D-227** — the desktop browser is the primary viewing surface, so the first three
checks move there, where DevTools is at hand. Only the decode measurement stays on the phone,
because that is the one claim that is genuinely about the phone.

**There is no fog renderer yet** (`0055`–`0057`), so nothing draws a hexagon. What these checks read
is the `?fog=debug` readout — `phase`, `source`, `generation`, `cells`, `decode`, `deltas` — which is
the data half of every check below. The visual half ("no blank-then-populate flash", "only the new
area changes") is validated again when there is something to see.

**Note the current state of the data.** The bucket holds no `users/` objects at all — no activity has
completed `regenerateExplored` yet — so the readout will say `phase ready / source empty / cells 0`
until one has. That is the correct answer for a user who has not ingested a run, not a failure. The
delta check (3) needs an ingested run first.

1. **Desktop browser, `/?fog=debug`.** The readout appears top-right. Sign in, load once, then open
   DevTools → Network and reload: `/api/fog?since=<n>` should be a **304** on the second load, and
   no request to `/api/fog/blob/…` should appear at all.
2. **Desktop browser, offline.** With the app loaded once, tick DevTools → Network → *Offline* and
   reload. The readout must come up `source cache` with the same `generation` and `cells`, and a
   `note` saying it is offline. Nothing may say "refused".
3. **A run landing mid-session.** With the map open, sync a run from another device (or press Sync),
   then focus the tab. `generation` increments, `source` becomes `delta`, `cells` grows — and
   `decode` stays at its previous value, because a delta parses no `LSFG`.
4. **Android phone, `/?fog=debug` — the one phone-specific check.** Read the `decode` line and
   report both numbers and the cell count. Criterion 10 wants the parse + Set build under ~150 ms.
   *For reference, this machine reports 15.7 ms parse / 46.9 ms parse + Set build at 152,551 cells;
   `02` §6.3's estimate for a mid-range Android is ~50 ms, so the criterion has real headroom.*
