---
id: 25
slug: domain-activity-contract
title: src/domain/activity.ts - Activity, Trace, GeoPoint, ActivityKind, transcribed from the canonical contract
type: feature
priority: high
status: open
size: m
capability: 04-domain-contract-and-rules
depends_on: [12]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-08-31T21:28:45Z
---

## Description

Land the domain boundary. **Nothing that touches an activity may be written before this file
exists.**

Transcribe `docs/contracts/ingestion-contract.md` §2 **exactly** into `src/domain/activity.ts`:
`SourceId`, `ActivityKind`, `GeoPoint`, `Trace`, `RawArchiveRef`, `SourceRef`, `WorkoutSet`,
`Activity`, `NormalizedIngest`. **That file wins over `01-architecture.md` §3 and
`03-integrations.md` §1 wherever they differ (D-140).** Do not reconcile them again; do not
invent variants; do not "improve" a field name.

The resolutions that will feel wrong if you have only read the other two docs, and are correct:

- `SourceId` is a **closed union widened with `(string & {})`** — enumerated for documentation
  value, widened so adding a source never edits the domain (D-100).
- `GeoPoint.t` is **absolute epoch milliseconds, UTC** — never seconds-since-start. Strava's
  `time` stream is relative and **the adapter converts**. Converting down is trivial; recovering
  up is not.
- **Three time fields**: `startedAt` (ISO 8601 with a real `Z`), `startedAtLocal` (naive local
  wall clock, **no offset, no `Z`**), and `timezone` (bare IANA id or `null`, never a
  `"(GMT-07:00) "`-prefixed string). An offset is not a timezone: it loses DST, so "which day did
  I run" breaks twice a year. **All game-day bucketing uses `startedAtLocal`.**
- `activityId` is `sha256(\`${userId}:${source}:${externalId}\`)` — deterministic, so re-ingest is
  idempotent for free. Not a ULID: a ULID mints a duplicate on every webhook replay, and Strava
  retries 3x. `revision` still tracks source-side edits.
- `SourceRef.externalId` is **always a string**, because vendor ids are int64 and `JSON.parse`
  silently corrupts them past 2^53.
- `Activity` carries `kind` (what it physically was) and **never `skill`** (a game decision that
  will change). The kind-to-skill map lives in the game layer.
- `Trace` carries all four of `gaps`, `simplified`, `bbox`, `pointCount`. `gaps` stops the
  renderer drawing a corridor through a tunnel and stops distance summing across a pause.
  `simplified` is a **standing guard against the `summary_polyline` trap** (D-121.4).
- `traceRef: null` and `hasTrace: false` are **normal outcomes** — treadmill, manual, strength —
  not error states.

## Acceptance criteria

- [x] `src/domain/activity.ts` exports every type in contract §2 with identical names and
      identical field names.
- [x] `tsc --noEmit` passes and `grep -n ": any\|<any>\| as any" src/domain/` returns nothing.
- [x] A lint rule or CI grep fails the build on `any` anywhere under `src/domain/`.
- [x] `SourceId` accepts an unlisted string literal without a type error (the `(string & {})`
      widening actually works, verified by a compile-time test).
- [x] `Activity` has exactly three time fields and **no** `startedAtOffset` or single
      ISO-with-offset field.
- [x] `GeoPoint.t` is documented in-file as absolute epoch milliseconds.
- [x] A `computeActivityId(userId, source, externalId)` helper exists, is pure, and a unit test
      asserts the same three inputs always produce the same id and that changing any one input
      changes it.
- [x] `Activity` has no `skill` field and no import from any game/rules module.
- [x] `src/domain/` imports nothing from `src/adapters/` (dependency direction test).
- [x] The file header points at `docs/contracts/ingestion-contract.md` as the authority (D-140).

## Notes

Transcription, not design. If something in the contract looks wrong while writing this, **file a
ticket against the contract**; do not fix it in the transcription. A domain that quietly disagrees
with the contract is worse than either one being wrong, because the disagreement is invisible.

`WorkoutSet` and `Activity.sets` are carried from day one even though D-062 defers the sets UI
from the MVP — the model carries them, the UI does not render them yet.

## Operator validation

None — this is a type-only module with no runtime behaviour and nothing on screen. The visible
proof arrives at 0037, when a real Strava run becomes an `Activity` whose local start date is the
day the operator actually ran. Verified here only by `tsc` and the tests above.

## Resolution

**The contract contradicted itself, and that had to be settled before a line could be transcribed.**

`src/domain/activity.ts` is **byte-identical to contract §2** — verified by diff, and now by a
standing test.

**The blocker, found on the first attempt**

Transcribing §2 exactly fails `scripts/check-boundaries.mjs`, on both tiers. §2 puts `"strava"` in
the `SourceId` union inside `src/domain/`; §5.1 says a grep for `strava` over `src/domain` must
return **nothing**.

Researched rather than guessed at, and the finding was decisive: **the grep was never satisfiable in
its own document.** `01-architecture.md` §3 defines T1 — and **220 lines earlier, in the same
section** — declares `AdapterId` with `| "strava"` living in `src/domain/activity.ts`, annotated
*"an opaque tag; the domain never branches on it."* Neither contradiction came from the
reconciliation. Both were latent from the day they were written, and only surfaced when someone
first tried to write the file.

Settled with the operator as **D-167**: the rule is about **dependency**, not **vocabulary**. Fixed
in `contracts/ingestion-contract.md` §5.1 and `01-architecture.md` §3 T1 **before** the domain file
was written, per this ticket's own instruction that a contract problem is surfaced and not repaired
inside the copy.

**Files touched**

- `src/domain/activity.ts` — the transcription. Types only; emits no runtime code.
- `src/domain/activity-id.ts` — `computeActivityId`. **Deliberately not in `activity.ts`**, so
  importing an `Activity` type can never drag `node:crypto` into a client bundle. The contract does
  not say where the helper lives; this is a judgement call, recorded in the file so it is not undone
  by accident.
- `src/domain/activity.types.test.ts` — compile-time assertions.
- `src/domain/activity-id.test.ts` — determinism, and the formula itself.
- `src/domain/contract-drift.test.ts` — drift + dependency direction.
- `scripts/check-boundaries.mjs` — D-167 narrowing, 29 self-test cases.
- `eslint.config.mjs` — two scoped overrides.
- `docs/contracts/ingestion-contract.md`, `docs/01-architecture.md`, `docs/decisions/DECISIONS.md`.

**Every guard was proven to fail before being trusted**

Today's recurring lesson — a check that passes proves nothing until it has been seen to fail — so
each assertion was broken deliberately:

| Deliberate break | Result |
|---|---|
| add `startedAtOffset` (the shape conflict #3 rejects) | typecheck fails |
| add a `skill` field (conflict #7) | typecheck fails |
| drop the `(string & {})` widening | typecheck fails, 3 errors |
| remove `Trace.gaps` (conflict #5) | typecheck fails |
| make `traceRef` non-nullable | typecheck fails, 2 errors |
| rename one field (`elapsedS` → `elapsedSeconds`) | drift test fails |
| import from `../adapters/` | dependency test fails |
| `const x: any = 1` in `src/domain` | ESLint **error** |

**Two decisions worth stating**

- **The `any` rule is an `error`, not an inherited warning.** `next/typescript` already sets
  `no-explicit-any`, but at severity *warn* — it only fails the build because `npm run lint` passes
  `--max-warnings 0` (D-164). That is a guarantee resting on an unrelated flag. Chosen over the
  criterion's grep because a grep both over-fires (a comment saying "any") and under-fires
  (`Array<any>`, generic defaults, spacing). The rule reads types; the grep reads letters. The grep
  was run anyway for criterion 2 and returns nothing.
- **Both a drift test and behavioural tests, because they do different jobs.** 0123 established that
  "matches the spec verbatim" verifies transcription, not correctness, and inherits every defect the
  spec has — which is precisely what happened here with §5.1. So `contract-drift.test.ts` proves the
  copy is faithful; `activity.types.test.ts` proves the copied types behave as the contract's
  *reasoning* requires. Either alone would be the failure 0123 documented. The drift test also
  asserts it compared >2,000 characters, so it cannot pass vacuously on an extractor returning "".

**What went wrong along the way**

1. **I deviated from the contract's comment text in four places** while first drafting, pre-emptively
   avoiding the boundary grep — then found those lines are inside block comments, which the check
   already skips. Unnecessary, and exactly the "do not improve it" the ticket forbids. Reverted to
   the contract's exact wording and confirmed by diff.
2. **A fixture key collision silently deleted a test.** My new `src/domain/activity.ts` self-test
   case overwrote the existing one of the same name in an object literal — removing the canonical
   "a Strava import in the domain must fire" case while the suite still reported green. Caught by
   reading the output rather than the summary line. Both cases now exist under distinct keys.
3. **The boundary check then caught my own tests** using `"strava"` as sample data. D-167 had just
   been written with the explicit trigger *"if a fourth narrowing is needed, replace the mechanism."*
   So the tests were changed, not the check — and the domain's own tests naming a vendor was poor
   hygiene regardless. The rule held against its own author within the hour.

**Left alone deliberately:** `dedupeKey` is typed but has no derivation. The contract defines it as a
"composite natural key for CROSS-source dedupe" without specifying a formula, and inventing one here
would be design, not transcription. It belongs with the first adapter that needs it.

## Operator validation

**None — as the ticket states.** This is a type-only module plus a pure function; there is no screen
and no runtime behaviour to look at. Asserting otherwise would be theatre.

What stands in its place, all machine-checked and all runnable by you:

- `npx vitest run src/domain` — 18 tests.
- `npm run typecheck` — carries every compile-time assertion.
- `diff` of `src/domain/activity.ts` against contract §2 — byte-identical, and now a standing test.
- The full gate passes: 61 tests, plus all five check scripts and their self-tests.

The visible proof arrives at **0037**, when a real run becomes an `Activity` whose local start date
is the day you actually ran. That is the criterion that matters for the three-time-field design, and
it cannot be checked until an adapter exists.
