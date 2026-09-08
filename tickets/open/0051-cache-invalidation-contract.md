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
started: 2026-09-08T14:18:19Z
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

Delta objects, `LSFD` (named `deltas/<toGen>.bin` as shipped — see D-220): magic, version,
`res = 10`, `fromGen` u64, `toGen` u64, `addedCount` u32,
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

- [x] Writer emits, in order: blobs → generation bump → `manifest.json`. A fault-injection test
      killing the writer between blob PUT and manifest PUT leaves clients on the previous
      generation, still rendering correctly.
      **Amended on the order** — the bump comes FIRST, not between the blobs and the manifest,
      because `<gen>` is in three of the filenames and nothing can be written until it is
      allocated. `02` §6.4's actual obligation is *"bump `generation` and write the new blobs
      before writing the new `manifest.json`"*, which is what ships. The fault-injection test
      asserts all three halves: the manifest is byte-identical afterwards, the blob it still
      names decodes with the right `cellCount`, and the orphaned generation exists unreferenced.
      A second test drives the redelivery and shows the dead run's ground is not lost.
- [x] `manifest.json` carries `{generation, res, cellCount, updatedAt, cells, agg, lastRun,
      deltasFrom}` exactly. *Asserted as a sorted key list, so an added field fails too.*
- [x] Cache-Control headers are as tabulated; a test fetches each object and asserts the header.
      *Unit test on all five objects, plus read back off real S3 in the smoke run.*
- [x] `deltas/<toGen>.bin` is written on every generation bump and decodes to exactly the
      cells added in that run.
      **Amended, and this is the ticket's real finding** — the documented
      `deltas/<fromGen>-<toGen>.bin` cannot be built by the client that needs it: a client knows
      only its own cached generation, the `from` end. The single hop the manifest spells out
      works by accident; *"chain multiple deltas"* (§6.5) never could. D-219's counter made it
      worse by burning generations, so `from + 1` is wrong exactly when concurrency happened.
      Named by `toGen`, the chain walks backwards from the manifest reading each hop's header.
      D-220; `02` §6.1/§6.5 and `05` §7.3/§7.4 amended.
- [x] The delta format has no removal opcode; a decoder test asserts unknown opcodes are rejected
      rather than skipped.
      *The format has no opcode field at all, which is the strongest form of the claim: the body
      is nothing but ascending gaps, asserted byte-for-byte against independently-computed
      varints. The nearest thing to an unknown opcode is the `reserved` header byte, which every
      decoder previously SKIPPED — a byte a future payload could carry an instruction in, read by
      an old client that ignores it. It is now rejected in all three formats.*
- [x] Delta GC keeps ~20 generations and updates `manifest.deltasFrom` accordingly.
      *Arithmetic, not a listing: the range `(previousGeneration − 20, generation − 20]`, which
      covers burned generations with a harmless no-op delete and keeps GC O(1) on the hot path.
      `deltasFrom` is `generation − 20`, not `previousGeneration`. 22 real publishes in the smoke
      run watched generations 1 and 2 fall out and 3..22 survive.*
- [x] `Profile.exploredGeneration` is mirrored after the manifest PUT; a repair path fixes the
      mirror if it disagrees, and a test asserts the manifest wins.
      **Amended on the wiring** — T1 `Profile` does not exist (`amplify/data/resource.ts` has
      `Activity` and `0012`'s placeholder; T1 arrives with the XP engine). The mirror and the
      repair are built, tested and called; they take the table as a dependency and answer
      `"no-table"` today. The smoke run wired them to a real throwaway T1 and exercised both
      directions. Ticket `0182` is the one line that turns it on.
- [x] `generation` monotonicity holds across a simulated full rebuild (I-11).
      *And the test found something better than it asserted: a drill that SKIPS §8.3 step 7 does
      not strand clients silently — `encodeDeltaBlob`'s own `toGen > fromGen` check refuses the
      publish and nothing is written. See the Resolution.*
- [x] The capability doc states the boot sequence as an obligation: read IndexedDB and render
      immediately, fetch the manifest in parallel, then 304 / delta chain / full fetch.

## Notes

**Stale is always safe, structurally, not by luck.** The set is append-only (D-020), so a stale
cache can only be *missing the newest run* — never *wrong about revealed ground*. That is what
licenses rendering before the network resolves (0054). A design where territory could be removed
could not do this, and this is the single biggest thing D-020 buys the client.

Version skew: if `manifest.res !== 10` or the blob's `version` byte is unknown, the client discards
its cache and **refuses to render** rather than guessing. A silent mis-parse of cell ids looks like
territory teleporting, which is indistinguishable from data loss to the user.

### What the ticket's author asked for (kept as context, answered in `## Operator validation` below)

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

## Resolution

The contract, both halves, made testable. Most of what this ticket asked for `0049` had already
built; what was left was the housekeeping that runs *after* the commit point, one finding that
invalidated a documented object name, and the boot sequence written down as an obligation.

### The delta object could not be fetched by the client that needs it

`02` §6.1 and `05` §7.3 both name it `deltas/<fromGen>-<toGen>.bin`, and §6.5 tells the client to
*"chain multiple deltas when several generations behind."* **A client knows exactly one of those
two numbers** — its own cached generation, the `from` end. For the single hop the manifest spells
out (`deltasFrom` → `generation`) both ends are given and it works by accident. The chain never
could.

And **D-219 made it worse rather than exposing something old.** Before last ticket's manifest CAS,
generations would have been contiguous and `toGen = fromGen + 1` would have walked the chain by
arithmetic. The counter burns a number whenever a worker loses the race, so 41 → 42 → 44 is
reachable and the guess is wrong exactly when concurrency happened.

**Named by `toGen`, the walk needs nothing but the manifest** — fetch the delta for
`manifest.generation`, read `fromGen` from the header, repeat. Gaps are invisible because the walk
follows what was written rather than what the numbers imply. `fromGen` stays where it already was;
only the key changed. **D-220**, with `02` §6.1/§6.5 and `05` §7.3/§7.4 amended.

`readDeltaChain` ships server-side as the executable proof that the objects are walkable at all —
a rename back to a two-ended key breaks a function here rather than breaking a browser three
tickets later. The client's own implementation is `0054`'s.

### Delta GC is arithmetic, and needs no listing

The naive GC lists the prefix, which would mean `s3:ListBucket` — a bucket-level grant, and those
cannot be prefix-scoped the way object-level ones can, so it would let the worker enumerate every
user's blobs. The alternative, walking the chain to find what to drop, is ~20 sequential GETs per
publish with 19 of them no-ops.

Instead the GC deletes the range `(previousGeneration − 20, generation − 20]`. One key in the
ordinary case; a range rather than a single number because the counter can skip, and deleting only
`generation − 20` would step over a gap and leak everything inside it. A key naming a burned
generation simply does not exist and the delete is a no-op — erring that way makes the retained
chain slightly **longer** than 20 hops, never shorter.

`deltasFrom` follows: `generation − 20`, not `previousGeneration`. A client cached exactly there
finds every hop above it; one cached a step lower is correctly told to take the full blob.

### Everything after the manifest PUT is forbidden from failing the publish

GC and the mirror both run past the commit point, and both return outcomes rather than throwing.
The reason is specific: the receipt is still `PROCESSING` at that moment, so a throw sends the
message back — and **the redelivery would allocate a fresh generation and republish a
byte-identical map. Forever, on every attempt.** An orphaned delta and a missed push are cheap;
that loop is not. `RegenerateResult` carries `deltasExpired` and `mirrored` so neither is
swallowed silently.

### The mirror is built and wired to nothing, deliberately

T1 `Profile` does not exist — `amplify/data/resource.ts` carries `Activity` and `0012`'s
placeholder, and T1 arrives with the XP engine, which owns `totalXp`, `totalLevel` and the
transaction that writes them. Creating a nine-attribute T1 here to hold one integer would have
handed capabilities 08 and 09 a schema they did not choose.

So `explored-mirror.ts` ships complete and answers `"no-table"`, the shape D-217 chose for the
ruleset. Ticket `0182` is the one line that turns it on.

Two details worth keeping when it is wired:

- **The write is conditional, and the manifest's CAS does not cover this.** Publishes are
  serialised by `IfMatch`; these writes are not. Worker A can publish 42, be descheduled, and
  mirror after worker B published and mirrored 43. `exploredGeneration < :g` makes the mirror
  monotonic on its own terms.
- **`repairGenerationMirror` never reads the Profile's value.** It takes the authoritative number
  as an argument and lets the conditional write *be* the comparison — so there is no branch in
  which the Profile wins, because there is no branch at all. A repair that read both sides and
  reconciled them would need one.

### The reserved byte is now refused, in all three formats

Criterion 5 asks that *"unknown opcodes are rejected rather than skipped."* The format has no
opcode field, which is the stronger claim — the body is nothing but ascending gaps, asserted
byte-for-byte against independently computed varints. But every decoder was **skipping** the
reserved header byte, and a byte a decoder skips is a byte a future payload can carry an
instruction in, read by an old client that ignores it. Refusing it is what makes `05` §7.4's *"there
must never be one"* enforceable: any future meaning for that byte now needs a `version` bump, which
every decoder already rejects outright.

### A finding the test made rather than confirmed

Criterion 8 asked for monotonicity across a simulated rebuild. Writing the negative case — a drill
that skips `02` §8.3 step 7 — showed the system does **not** strand clients silently: with an empty
counter returning 1 against a manifest at 412, `encodeDeltaBlob` is asked for a hop from 412 to 1
and throws on its own `toGen > fromGen` check. Nothing is published. That check was written for the
delta format's sake; it turns out to be the last line of defence for I-11, and the test now says so.

### Files

**New:** `src/pipeline/explored-mirror.ts` (`mirrorGeneration`, `repairGenerationMirror`),
`src/pipeline/explored-mirror.test.ts` (15).
**Modified:** `explored-blob-store.ts` — the delta rename, `expiringDeltaGenerations`,
`expireDeltas`, `readDeltaChain`, `deltasFrom`, and the two post-commit calls;
`src/domain/explored-blob.ts` — the reserved-byte refusal; `amplify/backend.ts` — the
`ExpireExploredDeltas` grant; the handler passes `mirror`.
**Docs:** `02` §6.1/§6.5/§7 tables and `05` §7.3/§7.4 renamed;
`docs/capabilities/07-fog-projection-and-cells.md` gained the boot sequence as an obligation;
D-220 recorded.

### The one grant this ticket took

`s3:DeleteObject` on `users/*/deltas/*` — narrower than the prefix it GCs within, and in a
statement of its own so folding it into the read/write grant cannot happen silently. `0049`
predicted it and set the bar: *"Delta GC (`0051`) is the first thing that will want
`s3:DeleteObject` here, and it can argue for it in its own diff."* The argument is that nothing
under `users/` is a system of record (§1.1), the bucket is versioned, and
`s3:DeleteObjectVersion` is denied bucket-wide — so the worst case is a client taking one 300 KB
immutable GET, and never data loss. `raw/*` keeps its absolute rule (I-3) and the synth test now
asserts both separately.

## Operator validation

**Nothing here needs the operator.** Everything was reachable with `AWS_PROFILE=devault` and was
run (D-181).

### Automated

- **1,450 tests, 73 files.** New: `explored-mirror.test.ts` (15), plus 17 in
  `explored-blob-store.test.ts` (retention, chain walk, fault injection, rebuild monotonicity,
  mirror plumbing), 4 in `explored-blob.test.ts` (the reserved byte and the absent opcode), and 3
  reworked IAM assertions across the two synth suites.
- `npm run typecheck`, `npm run lint` clean. All seven gate scripts pass, and the four that carry
  a `--self-test` pass that too.

### Live smoke test — 11/11, real DynamoDB and real S3

Throwaway table, throwaway Profile table and throwaway bucket, driving the **shipped** code, all
deleted afterwards. `LostSolesExploredCell` confirmed still at 0 items and the production
`users/` prefix confirmed empty after the run.

| # | What it proved |
|---|---|
| 1 | Four real publishes, then a three-hop backwards walk returning `[1→2, 2→3, 3→4]` in application order |
| 2 | The object really is at `deltas/4.bin` on S3, decodes, and carries the immutable cache header |
| 3 | A client already current gets an empty chain rather than a refetch |
| 4 | **22 real publishes**: generations 1 and 2 expired, 3..22 survive, `deltasFrom` = 2 |
| 5 | A client at `deltasFrom` walks all 20 hops; one step below is refused |
| 6 | The mirror wrote `exploredGeneration` into a real T1-shaped table, equal to `manifest.generation` |
| 7 | A real `ConditionalCheckFailedException` reported as `"stale"`, never thrown |
| 8 | A repair against a mirror ahead of the manifest left the manifest's number authoritative |
| 9 | `"no-table"` returned without touching DynamoDB |
| 10 | A drill setting the counter forward published above the pre-drill generation; the same call refused a lower target |

### Carried forward

Nothing new. The items `0049` left stand, and this ticket adds no operator step of its own — the
one thing worth a human eye is in `0182`: after the mirror is wired, confirm that nothing the user
can see changed.
