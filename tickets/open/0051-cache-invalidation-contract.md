---
id: 51
slug: cache-invalidation-contract
title: Cache invalidation contract between the ingest Lambda and the browser
type: feature
priority: high
status: open
size: m
capability: 07-fog-projection-and-cells
depends_on: [49]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

`02-data-model.md` §6.4 and `05-fog-of-war.md` §7.3. **`generation` is the only cache key**, and
this ticket makes the two sides of that contract explicit and testable.

**The writer's ordering obligation, in one line: bump `generation` and write the new blobs BEFORE
writing the new `manifest.json`.** The manifest PUT is the commit point and is a single atomic S3
operation. A crash before it leaves orphan blobs, which are harmless and garbage-collected. A crash
after it would point clients at an object that does not exist. There is no third possibility.

Object layout and cache headers:

```
users/<uid>/manifest.json                          Cache-Control: no-cache        (only mutable object)
users/<uid>/explored/explored-r10.<gen>.bin        public, max-age=31536000, immutable
users/<uid>/explored/explored-agg.<gen>.json       immutable
users/<uid>/explored/explored-lastrun-r10.<gen>.bin immutable
users/<uid>/deltas/<fromGen>-<toGen>.bin           immutable, GC'd after ~20 generations
```

`<gen>` in the name is what makes `immutable` safe: a generation is never rewritten, so no cache
anywhere — browser, IndexedDB, CloudFront — can be wrong, and nothing ever needs purging.

Delta objects, `LSFD`: magic, version, `res = 10`, `fromGen` u64, `toGen` u64, `addedCount` u32,
then ascending delta-varint ids. **Adds only. There is no removal opcode and there must never be
one.** D-020 makes the set append-only, and a client that cannot express a removal cannot be
tricked into un-revealing ground by a malformed payload.

Deltas are garbage-collected at ~20 generations; `manifest.deltasFrom` tells the client when the
chain no longer reaches it. A client closed for a month takes the full 300 KB immutable GET, and
that is the correct outcome.

Trigger order for a client that is already open: AppSync subscription on the generation counter →
revalidate the manifest on `visibilitychange`/`focus` → a manual sync affordance. **Never a
timer.** Background polling is exactly the upkeep D-013 rejects. At this milestone only the second
and third exist in practice; wire the mirror to `Profile.exploredGeneration` now so `14` can add
the subscription without touching the writer.

## Acceptance criteria

- [ ] Writer emits, in order: blobs → generation bump → `manifest.json`. A fault-injection test
      killing the writer between blob PUT and manifest PUT leaves clients on the previous
      generation, still rendering correctly.
- [ ] `manifest.json` carries `{generation, res, cellCount, updatedAt, cells, agg, lastRun,
      deltasFrom}` exactly.
- [ ] Cache-Control headers are as tabulated; a test fetches each object and asserts the header.
- [ ] `deltas/<fromGen>-<toGen>.bin` is written on every generation bump and decodes to exactly the
      cells added in that run.
- [ ] The delta format has no removal opcode; a decoder test asserts unknown opcodes are rejected
      rather than skipped.
- [ ] Delta GC keeps ~20 generations and updates `manifest.deltasFrom` accordingly.
- [ ] `Profile.exploredGeneration` is mirrored after the manifest PUT; a repair path fixes the
      mirror if it disagrees, and a test asserts the manifest wins.
- [ ] `generation` monotonicity holds across a simulated full rebuild (I-11).
- [ ] The capability doc states the boot sequence as an obligation: read IndexedDB and render
      immediately, fetch the manifest in parallel, then 304 / delta chain / full fetch.

## Notes

**Stale is always safe, structurally, not by luck.** The set is append-only (D-020), so a stale
cache can only be *missing the newest run* — never *wrong about revealed ground*. That is what
licenses rendering before the network resolves (0054). A design where territory could be removed
could not do this, and this is the single biggest thing D-020 buys the client.

Version skew: if `manifest.res !== 10` or the blob's `version` byte is unknown, the client discards
its cache and **refuses to render** rather than guessing. A silent mis-parse of cell ids looks like
territory teleporting, which is indistinguishable from data loss to the user.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

1. With the map open on the phone, Sync from a second device (or trigger the pipeline directly).
   Background the phone app, then bring it back to the foreground: the new territory appears
   without a reload.
2. In Chrome DevTools on the phone (remote debugging), confirm the `manifest.json` request is a
   304 with a few hundred bytes, and that no `.bin` is refetched when nothing changed.
3. Turn airplane mode on and reload the app. The map must still render the previously explored
   territory from IndexedDB, immediately, with no blank frame.
