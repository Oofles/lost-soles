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

- [ ] `LSFG` decode round-trips the 150k-cell fixture from 0049 to the identical sorted set.
- [ ] Both representations are built: sorted `BigUint64Array` and `Set`; a test asserts they agree.
- [ ] IndexedDB stores the **decoded** array keyed `{uid, generation}`; a warm start does no
      LEB128 parsing (asserted by instrumenting the decoder).
- [ ] Cache keeps the current generation and one previous; older entries are evicted.
- [ ] Boot renders from cache before the manifest response arrives; a test with the network delayed
      2 s asserts a first paint of real territory well before then.
- [ ] Manifest 304 path fetches no `.bin`.
- [ ] Delta chain applies in order with `fromGen` validation; a mismatch falls back to a full fetch.
- [ ] `res !== 10` or unknown `version` → cache discarded, render refused, a visible message.
- [ ] `applyDelta` invalidates only the touched res-6 parents, asserted by a spy on the bucket
      invalidator.
- [ ] Decode of a 150k fixture completes in under ~150 ms on the target phone; the number is
      recorded.

## Notes

`explored-lastrun-r10.<gen>.bin` is **not** fetched here. The fog does not need it — revealed is
permanent — and it roughly doubles the payload. It is lazy-loaded by the cold-territory overlay in
capability `15` (D-133/D-147), which does not exist at this milestone.

0055 is deliberately built and spiked *before* this ticket lands, against a hard-coded array of a
few hundred cells (`09-roadmap.md` §8.2). If `gl.MAX` on a half-res `R8` FBO fails on the target
phone, that must be known in session one of `08`, not session five.

## Operator validation

1. On the Android phone with the app already used once, enable airplane mode and open the map.
   Territory appears immediately from IndexedDB — there must be no blank-then-populate flash.
2. Turn the network back on with the app in the foreground. Nothing visibly re-renders or flickers;
   in remote DevTools the manifest request is a 304.
3. Sync a new run from another device while the map is open, then focus the phone app. The new
   territory appears within a second or two and only the new area changes — the rest of the map
   must not visibly rebuild.
