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

**The design was right, and unusually so — one divergence across nine tickets and six documents.**
That is the lowest count of any capability audited so far, and the reason is visible in the docs
themselves: `05-fog-of-war.md` §2.2 and §2.3 carry inline amendment blocks from `0045`, `0046` and
`0180` (D-212, D-215, D-216, D-222), written *at the time the code disagreed with them* rather than
recovered at audit. **The doc was maintained as a working surface, not consulted as a monument.**
Every constant matched on inspection — `REVEAL_R_M = 65`, `MAX_ACC_M = 50`, the dwell pair, the
split pair, `DENSIFY_STEP_M = 30`, `SIX_MONTHS_MS`, the three credit values — and so did the step
order of `traceToCells`, the manifest's conditional-PUT protocol and T3's `traceRejectCounts`.

**The one divergence is the shape worth remembering.** §3.1's definitions block listed three
credit constants; the code has four. `CREDIT_DEFERRED` was `0050`'s, fully specified in §3.4 and
in `02` T3 — so the *document* was correct and its *summary* was not. What makes it worth a
divergence rather than a shrug: `CREDIT_DEFERRED = 0.0` and `CREDIT_COOLED = 0.0` are the same
number, so no test, no type and no downstream consumer could ever have caught the omission. **A
summary that drifts from the body it summarises is invisible to every mechanical check there is**,
and §3.1 is exactly where a reader goes for the vocabulary. Same family as `02` §3.2's missing
`unitMultipliers`, found in the `04` re-audit four hours earlier, and a second argument for `0162`.

**What went wrong was the instrument, not the work.** `fog-no-refog` — the AUDIT.md §4 row that
carries **D-020 and I-7, this capability's entire promise** — reported *"no explored blob or fog
pipeline exists yet — activates with capability 07"* **during capability 07's own audit**, with
seven `src/pipeline/explored-*.ts` modules and 6,600 lines on disk. It is a literal `NA()`
constant that reads nothing and can never return anything else (`0184`). The check that ought to
have been this capability's headline was the one thing in the table that could not run, so §4 was
performed by hand instead: `rebuildFromTable` produces a blob byte-identical to the incremental
path, and `explored-cells.ts` emits no `DeleteItem` and no `REMOVE` on any path. Both green, both
by a human deciding to look.

**The pattern this capability closes on.** Four detectors were caught reporting something other
than the truth in a single day — `vigil-test` matched a filename, `invariant-sweep` matched any
`I-n` in any file (`0161`), the two §4 rows match nothing (`0184`), and `validate` reported an
unauditable capability as a *warning* while it gated eighteen tickets (`0185`). **Three could not
see; one saw and spoke quietly.** The instruction that caught every one of them is the same line
`04`'s reflection already carried — *read every `n/a` reason and check it against the repo* — and
it is now the highest-yield thirty seconds in the whole procedure. It should stay in AUDIT.md §1
whatever else changes.

**For the next capability (`08-map-and-fog-renderer`).** It is one of the three where the USE step
means an actual run with the build on the phone, and it is the first capability whose output only
exists on a screen. Everything `07` proved is invisible until `08` draws it, so budget for the
first genuine operator-validation dependency in the project: an audit here cannot be closed by the
agent alone, and `0049`'s Operator validation already names what is waiting for a human eye.

