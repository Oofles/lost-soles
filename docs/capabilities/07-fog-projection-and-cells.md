# 07-fog-projection-and-cells

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`07-fog-projection-and-cells\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (7)

- `0045` — domain/fog.ts — traceToCells, a pure trace → H3 res-10 cell Set
- `0046` — REVEAL_R_M = 65 m exact-radius filter and corridor fill
- `0047` — ExploredCell writes — firstRunAt via min, lastRunAt via max, outside the ingest transaction
- `0048` — Discovery classification — new / re-armed (>6mo, 50%) / cooled (<6mo, 0%)
- `0049` — explored-r10.bin generation, aggregates, and the manifest generation counter
- `0050` — Same-run edge cases, out-of-order and backfilled activities, score-time idempotency
- `0051` — Cache invalidation contract between the ingest Lambda and the browser

## Design notes

### The cache-invalidation contract (ticket `0051`)

`02-data-model.md` §6.4 and `05-fog-of-war.md` §7.3 own this. Restated here as the **obligation**
each side carries, because a contract written only as a description is one both halves can drift
from independently.

**`generation` is the only cache key.** Everything else follows from that.

#### What the writer must do, in this order

1. **Allocate** a generation — an atomic `ADD` on T6's counter item (D-218). Never a
   read-modify-write on the manifest: two workers for one user would name one `immutable` object
   twice.
2. **Write every `<gen>`-named object** — the set, the sidecar, the aggregate, the delta — with
   `Cache-Control: public, max-age=31536000, immutable`.
3. **PUT `manifest.json` last, conditionally** (`IfMatch` on the ETag its merge base was read
   from; `IfNoneMatch: "*"` on a first publish, D-219), with `Cache-Control: no-cache`.
   **This is the commit point.** A crash before it leaves orphan blobs, which are harmless. A
   crash after it would point clients at an object that does not exist — and cannot happen,
   because the PUT is a single atomic S3 operation.
4. **Then, and only then, housekeeping that may not fail the publish**: expire deltas outside the
   ~20-generation window, and mirror `generation` into `Profile.exploredGeneration`. Both run
   after the commit point, so both return outcomes rather than throwing. A throw here would send
   the message back for redelivery, and the redelivery would allocate a fresh generation and
   republish a byte-identical map — forever.

#### What the client must do, in this order

1. **Read IndexedDB (`{uid, generation}`, storing the DECODED array) and render immediately.**
   Do not wait for the network. This is an obligation, not an optimisation.
2. **Fetch `manifest.json` in parallel.**
3. `manifest.generation === cached.generation` → **done, nothing else is fetched.** One 304. This
   is the common case.
4. `cached.generation >= manifest.deltasFrom` → **walk the delta chain backwards**: fetch
   `deltas/<manifest.generation>.bin`, read its `fromGen` from the header, repeat until it
   matches the cached generation. Apply the hops oldest-first, validating
   `fromGen === state.generation` before each. Any missing hop → fall through to 5.
5. Otherwise → **fetch the full `.bin` and replace the cache.**

**Why step 1 is safe, and it is structural rather than lucky.** The set is append-only (D-020),
so a stale cache can only ever be *missing the newest run* — never *wrong about revealed ground*.
That is the single biggest thing D-020 buys the client, and a design in which territory could be
removed could not render before the network at all.

**Version skew is a refusal, not a best effort.** If `manifest.res !== 10` or a blob's `version`
byte is unknown, the client discards its cache and refuses to render. A silent mis-parse of cell
ids looks like territory teleporting, which is indistinguishable from data loss to the user. Every
decoder in `src/domain/explored-blob.ts` enforces this, including on the reserved byte — a byte a
decoder skips is a byte a future payload could carry an instruction in.

**Adds only, in every direction.** The delta format has no removal opcode and must never have one:
a client that cannot express a removal cannot be tricked into un-revealing ground by a malformed
payload. The same structural argument `02` §4.7 makes about there being no un-award code path.

#### Triggers for a client that is already open

AppSync subscription on the generation counter → revalidate the manifest on
`visibilitychange`/`focus` → a manual sync affordance. **Never a timer**; background polling is
exactly the upkeep D-013 rejects. At this milestone only the second and third exist in practice —
the mirror that feeds the subscription is built and wired to nothing, because T1 `Profile` arrives
with capability 09 (ticket `0182`).

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

