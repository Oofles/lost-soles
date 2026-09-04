---
id: 27
slug: boundary-ci-tests
title: The four boundary CI tests (T1-T4) that prove the D-100 adapter boundary holds
type: chore
priority: high
status: closed
size: m
capability: 04-domain-contract-and-rules
depends_on: [13, 26]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-04T00:48:52Z
closed: 2026-09-04T01:11:56Z
---

## Description

`docs/contracts/ingestion-contract.md` §5 lists the checks that make D-100 a property rather than
a promise. Wire them into the PR gate from 0013 so they run on every push and every PR, and so a
violation is a **red build**, not a code-review comment.

**T1 — no vendor identifiers outside the adapter directory.**
`grep -ri strava src/domain src/pipeline` returns **nothing**. Extend to the whole tree except
`src/adapters/strava/`, `__fixtures__/` and tests: any case-insensitive `strava` identifier
outside that directory fails the build (D-100, D-121.1). This is the check that stops the
boundary rotting one convenient import at a time.

**T2 — swapping the primary source touches one directory plus one registry line.**
Assert structurally: every import of `src/adapters/strava/**` in the repo comes from inside that
directory or from `src/adapters/registry.ts`. A deleted-adapter simulation (type-check with the
directory's exports stubbed to `never`) must fail **only** in `registry.ts`.

> **SPLIT 2026-09-03 → `0156`.** Only the importer scan was buildable here; it shipped in `0026`
> as `src/adapters/registry.test.ts` and this ticket wires it into the gate. The **deleted-adapter
> simulation** needs an adapter directory to delete, and none exists — `src/adapters/strava/`
> arrives in capability `05`. Moved to `0156`, `depends_on: [36]`.

**T3 — cross-adapter equivalence.** → **MOVED TO `0155`.**

> **SPLIT 2026-09-03 → `0155`, because T3 could not be built in ANY ordering of this backlog.**
> It needs an H3 res-10 projection. That is `0045` (`traceToCells`), which `depends_on: [25, 36]`;
> and `0036` `depends_on: [27]` — this ticket. So `0027 → 0036 → 0045 → what 0027 needed`. A
> cycle, not a priority call. `h3-js` is not a dependency of the project either.
>
> `0155` carries T3 in full with `depends_on: [45]`, which is the first point it becomes possible.
> It is a **split, not a drop** — this ticket's own Notes predicted the drop and argued against it,
> and that argument is reproduced there.

**T4 — `normalize()` is pure.**
A harness that invokes any adapter's `normalize()` with `globalThis.fetch`, the AWS SDK,
`Date.now`, `new Date()`, `Math.random` and `crypto.randomUUID` all stubbed to **throw**, and
asserts it still returns a correct `NormalizedIngest`. This harness is consumed by 0036 and by
the rebuild drill in capability `16`; it is the reason the drill can run after Strava access is
gone.

Contract §5 also names a **fidelity floor** (points-per-km above a threshold, to catch silent
source-side decimation before it permanently corrupts the map). That check needs real fixtures and
therefore ships with 0038 — reference it here so it is not lost.

## Acceptance criteria

- [x] ~~T1-T4~~ **T1, T2 and T4** run in the GitHub Actions PR gate **and** in `amplify.yml`, so
      a push to `main` cannot bypass them. *(Amended: T3 moved to `0155` — see the Description.
      T1 is `check-boundaries.mjs`, already in both; T2 and T4 are vitest tests, carried by
      `npm test`, which both gates run.)*
- [x] T1 fails the build when a file containing `Strava` is added under `src/domain/`; a
      deliberate temporary commit proves it goes red, and the proof is recorded in this ticket's
      Resolution. *(PR #1, gate run `33823905449` — red at the `D-100 boundary` step, closed
      unmerged, branch deleted. Full detail in the operator-validation section below.)*
- [x] T1's allowlist is exactly `src/adapters/<source>/` and `src/adapters/registry.ts` — no
      per-file exceptions. *(Amended, D-188: ~~`__fixtures__/` and test files~~. Exempting test
      files would undo a guarantee `0025` explicitly relies on — "the domain's own tests should
      not name a vendor, and `check-boundaries.mjs` enforces that" — and an adapter's own tests
      are already exempt by directory. `__fixtures__/` does not exist yet and is added by `0038`,
      which creates it; an allowlist entry for a non-existent path is dead config. `registry.ts`
      is required by `01-architecture.md` §3 T2 and was omitted from the original list.)*
- [x] T2 identifies every importer of the strava directory and fails if any is not
      `registry.ts`. *(Shipped in `0026` as `src/adapters/registry.test.ts`; it discovers adapter
      directories rather than naming one, so it already covers whatever adapter lands next. This
      ticket confirms it runs in both gates and gave it a failure message naming D-100/D-121.1.)*
- [x] ~~T3 runs two adapters over one physical run and asserts equal H3 res-10 cell sets within a
      stated tolerance; the tolerance is a named constant with a comment justifying its value.~~
      **MOVED TO `0155`** — unbuildable here, see the Description. Carried over verbatim, plus two
      further criteria on what the tolerance must and must not absorb.
- [x] ~~T3 is not skipped, not `.todo`, and fails if either adapter is removed.~~
      **MOVED TO `0155`.**
- [x] T4 stubs fetch, the AWS SDK, both clock sources and both RNG sources to throw, and passes.
- [x] T4 is exported as a reusable helper that any adapter's test can call with one line.
- [x] Each test's failure message names the decision it is protecting (D-100 / D-121.1 / D-140),
      so a future reader knows why it exists before deciding to delete it.

## Notes

The point of T1 is that it is stupid and mechanical. Resist making it clever: a grep that
understands context is a grep that can be argued with, and this one must not be arguable.

T3 is the test most likely to be dropped as "we only have one adapter". Do not drop it. The whole
D-121 bet is that the Strava adapter is replaceable, and a cell-set equivalence harness that
already exists is the difference between a one-week migration and a rewrite.

## Resolution

**Files added**

- `src/adapters/normalize-purity.ts` — T4. The purity harness, exported (not inlined into a test)
  because `0036` and the capability `16` rebuild drill both call it.
- `src/adapters/normalize-purity.test.ts` — 14 tests, one adapter built to trip each trap.

**Files amended**

- `src/adapters/registry.test.ts` — T2's importer scan now fails with a message naming
  D-100/D-121.1 (criterion 9).
- `scripts/check-boundaries.mjs` — T1's failure output now names D-121.1 and what it buys, not
  just "boundary violation" (criterion 9).
- `docs/decisions/DECISIONS.md` — **D-188**.

**Tickets filed** — `0155` (T3) and `0156` (T2's deleted-adapter simulation).

---

**This ticket was `size: m` and was not.** Even the three-quarters that were buildable ran past the
2h target, and a quarter of it was not buildable at all. Recorded rather than glossed: `size` is an
input to session planning, and a ticket that lies about its size costs the session that trusts it.

**T3 could not be built in any ordering of this backlog.** It asserts two adapters yield the same
H3 res-10 cell set. That needs `traceToCells` — `0045`, which `depends_on: [25, 36]` — and `0036`
`depends_on: [27]`, this ticket. So `0027` → `0036` → `0045` → what `0027` needed. `h3-js` is not a
dependency of the project either. A **cycle, not a priority call**, which is why it became `0155`
with `depends_on: [45]` rather than being struck off with a promise to remember. This ticket's own
Notes predicted the drop and argued against it; that argument is reproduced in `0155`.

**T2 had two halves and only one was buildable.** The importer scan shipped in `0026` and needed
only a failure message here. The deleted-adapter simulation needs an adapter directory to delete,
so it became `0156` (`depends_on: [36]`). Worth stating why the scan alone is not enough, since T2
now reads as done: the scan reads *import statements*, so it cannot see a hand-duplicated
structural type, an `as` cast to an adapter-owned shape, or a string branch on a source id. The
deletion simulation catches those by construction — it asks the compiler what breaks.

**T4's design decision that matters.** `new Date(someString)` is deliberately **not** trapped; only
the zero-argument `new Date()` and `Date.now()` are. Parsing a source's timestamp is exactly what
`normalize()` is for, and a harness that forbids it is one adapters route around — a harness that
gets routed around protects nothing. Implemented as a `Proxy` rather than a subclass:
`ConstructorParameters<DateConstructor>` resolves to the last overload, so a subclass constructor
cannot be typed to observe a zero-argument call at all. The Proxy sees the real `argArray` and
keeps `instanceof Date`, the statics and the prototype chain intact.

**T4 also runs `normalize()` twice and compares.** No global trap can see a module-level counter, a
cache, or a mutated input `Buffer` — nothing is reached *for*, the function simply remembers. Two
calls with identical arguments returning different results catches that class, and the rebuild
drill depends on exactly this property: replay the archive, get the same activity back.

**D-188 — criterion 3 was wrong and is amended, not implemented.** It asked for an allowlist of
"`src/adapters/strava/`, `__fixtures__/` and test files". Exempting test files would undo a
guarantee `0025` explicitly built on — its own test says *"the domain's own tests should not name a
vendor, and `check-boundaries.mjs` enforces that"* — and D-100 is about dependency, which a test
expresses as readily as a module. An adapter's own tests are already exempt by directory.
`__fixtures__/` does not exist and is created by `0038`; an allowlist entry for a non-existent path
is dead config. The criterion also omitted `registry.ts`, which `01-architecture.md` §3 T2 requires.

**What went wrong.**

1. **The `tickets` workflow went red on the interim push** (run `33823885563`). Hand-editing the
   criteria checkboxes changed `acceptance.checked` from 0 to 8, and `tickets/index.json` is
   committed (D-159) — so `index` must be re-run after any hand-edit to a ticket body. The script
   regenerates it on `create` and on `close`, which is precisely why the gap between them is easy
   to miss. Folded into this close commit.
2. **The same mistake one commit earlier, in a different file**: `0026`'s close amended three
   design docs and did not regenerate `docs/INDEX.md`, whose line ranges all shifted. The gate
   caught it (run `33803324639`), fixed in `0026: regenerate docs/INDEX.md`. Two generated-artefact
   misses in two commits is a pattern, not bad luck — **both are `--check` steps over committed
   generated files, and neither runs in the pre-commit hook.** Not filed as a ticket: it is a
   change to `0011`'s hook and belongs to that owner, not to this ticket's scope.
3. **Writing this Resolution corrupted the ticket on the first attempt.** The criterion-2 text
   quoted the literal string `## Operator validation`, so the script's `index()` anchor matched
   inside the acceptance-criteria list and truncated `## Notes` and the `## Resolution` heading.
   `validate` caught it immediately (`missing-section`), and the file was restored from `HEAD` and
   rebuilt with the heading quoted differently. A section-appending edit anchored on a heading
   string is only safe while no body text quotes that heading.
4. `gh run list --branch` does not exist in this `gh` version. A poll loop built on it matched
   nothing and burned a 10-minute timeout without ever reporting — failing *silently*, which is the
   same shape as a green test that asserts nothing.

**Deliberately not done.** `amplify.yml`'s comment still reads "carries the T1-T4 boundary tests as
they land", which remains true: T3 lands via `0155` into the same `npm test`. No edit needed.

## Operator validation

**None required of the operator.** CI infrastructure with no user-visible surface. The original
text asked the operator to watch the gate go red and screenshot it — under D-181 that is the
agent's to run, and it was run.

**The red build — criterion 2, and the only part that could not be proven locally.**

| | |
|---|---|
| PR | `Oofles/lost-soles#1` — *PROOF ONLY, DO NOT MERGE* |
| Run | `33823905449` (`gate`, trigger `pull_request`) |
| Seeded | `src/domain/__t1_proof.ts` with `stravaId` and `summary_polyline` |
| Result | **failed** at `D-100 boundary — no Strava type outside the adapter` |
| Steps before it | `typecheck` ✓ `lint` ✓ `test` ✓ `D-100 boundary check self-test` ✓ |
| Steps after it | not reached |
| Cleanup | closed **unmerged**, branch deleted, `origin` pruned — `main` never held the file |

The step ordering is what makes this proof worth anything: everything before the boundary check
passed, so the build went red **because of the seeded violation** and not incidentally. A locally
verified `exit 1` could never show the gate is wired to fail the build — only that the script
works. Done on a throwaway branch rather than on `main`: `gate.yml` already triggers on
`pull_request`, so the real CI path was exercised without a knowingly broken commit in `main`'s
history or a burned Amplify deploy cycle. D-150's no-branches rule governs ordinary work; this was
a one-off CI proof, and the operator approved the approach before it was run.

**Everything else, locally on this machine (Node 22, WSL2) and again on `main` by the gate:**

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint at `--max-warnings 0` | `npm run lint` | exit 0 |
| Full suite | `npm test` | 20 files, 312 passed, 1 skipped |
| T4 alone | `npx vitest run src/adapters/normalize-purity.test.ts` | 14 passed |
| T1 clean | `node scripts/check-boundaries.mjs` | exit 0 |
| T1 self-test | `node scripts/check-boundaries.mjs --self-test` | 29 cases passed |
| T1 on a seeded violation | same, with `src/domain/__probe.ts` present | **exit 1**, naming D-100 and D-121.1 |
| Docs index | `node scripts/build-index.mjs --check` | up to date |
| Gate on `main` | run `33823885457` | **success** |

**T4's harness was verified to FAIL, not only to pass.** Seven adapters, one per trap — `fetch`,
`new Date()`, `Date.now`, `Math.random`, `performance.now`, `crypto.randomUUID`,
`crypto.getRandomValues` — plus a module-level counter caught by the double-call determinism check,
plus assertions that every global is restored **on the throwing path**. A harness that leaks its
traps on failure poisons every test that runs after it, and the resulting failures point anywhere
but at the harness. A purity check that green-lights an impure adapter is worse than no check at
all, because it gets cited as evidence.
