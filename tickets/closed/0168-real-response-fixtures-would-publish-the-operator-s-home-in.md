---
id: 168
slug: real-response-fixtures-would-publish-the-operator-s-home-in
title: Real-response fixtures would publish the operator's home in a public repo
type: bug
priority: high
status: closed
size: s
capability: 05-strava-adapter
depends_on: []
blocked_by: []
source: agent
created: 2026-09-05T00:53:57Z
closed: 2026-09-06T01:55:16Z
---

## Description

`github.com/Oofles/lost-soles` is a **public repository**. Ticket `0038` instructs:

> **Fixtures.** Capture **real** responses (**redacted of tokens, not of shape**) and commit them
> [...] Required set: 1. An outdoor run: detail + streams, **~2,700 `latlng` points**, with
> `original_size` intact.

"Redacted of tokens, not of shape" is explicit that the coordinates stay. Committing fixture 1
publishes ~2,700 GPS points of a real run by the only user of this system — which means the street
they start on, the street they finish on, and the route between. Fixture 7 (*"a trace containing a
real signal-loss jump — tunnel or urban canyon"*) has the same problem, and fixture 8 (a
DST-boundary activity) pins a date to a place.

**This is not a hypothetical exposure.** The connected account is a real person's, the traces are
their actual movements, and a public git repo is permanent, cloneable and indexed. `git rm` after
the fact does not help — the blob stays in history, and by then it has been fetched.

**Why the instruction reads reasonably and is still wrong.** `0038`'s reasoning is sound on its own
terms: contract §5 makes `normalize()` unit-testable from a checked-in fixture with zero mocking,
and after 2026 those responses may not be re-acquirable. Both are true. What the ticket never
considers is that the archive it is protecting against loss is exactly the data `08-security-privacy.md`
treats as the sensitive asset — and that this repo is the one place it must not go.

Note the asymmetry with the rest of the system: the raw archive lives in a private, versioned,
block-all-public-access S3 bucket with a delete-deny policy (§3.2), and the explored-cell set is
owner-scoped in AppSync. A fixture directory is the one place the same coordinates would be world
readable, and it is the one place nobody wrote a rule about.

Found while building `0035`, which needs a ~2,700-point stream fixture for its own criterion 5.
That ticket used a **synthetic** fixture and verified the real point count with a live smoke test
instead, which is the pattern this ticket should probably generalise.

## Acceptance criteria

- [x] `0038`'s fixture instruction is amended: real responses are captured for **shape**, and any
      `latlng` payload committed to this repo is **spatially transformed**, not merely
      token-redacted.
- [x] The chosen transformation preserves everything the tests actually assert — point COUNT,
      index alignment, equal stream lengths, the 1 Hz cadence, the signal-loss jump's magnitude,
      `original_size` — while placing the track somewhere that is not anywhere the operator has
      been. A fixed offset is NOT sufficient on its own: an offset track is still the operator's
      route shape, and a distinctive loop is identifying even when moved.
      — D-199 names that preservation list verbatim as the rule. The transformation goes
      **further** than the criterion asks: rigid relocate-and-rotate, which this ticket's Notes
      preferred, was rejected precisely because it keeps the route shape the criterion warns
      about. Coordinates are generated, not moved. `0038` is where the rule is executed at
      ~2,700 points.
- [x] A test or check asserts no committed fixture contains a coordinate within a generous radius
      of the operator's real activity area, so a future hand-added fixture cannot quietly reintroduce
      this.
- [x] The decision is recorded as a `D-xxx`, because "real fixtures, synthetic geometry" is a
      standing rule for every adapter that follows, not a one-off for Strava.
- [x] ~~`docs/08-security-privacy.md` gains a line naming the repository as a place trace data must
      never go — the omission that made `0038` read as reasonable.~~
      **AMENDED — the premise was false, and this is the ticket's main finding.** There was no
      omission. §7.2 already carried the row: *"Real GPS traces, GPX/FIT fixtures from actual
      runs, or a dump of `ExploredCell`"* → *"Test fixtures are **synthetic coordinates**"*, and
      it even predicted the failure — *"this is the repo-hygiene rule most likely to be broken by
      someone being helpful."* `0038` did not slip through a gap in `08`; it **contradicted `08`
      in writing**, and nothing existed that could notice.
      So what `08` gains is not a line but a **fourth scanning layer** (§7.3), plus the reason
      layers 1–3 were never going to catch this: they hunt credential shapes, and a GPS track is
      just numbers. §7.2's row is annotated with the repo's public URL and a pointer to the
      enforcement. Rewritten as: *`08` gains the enforcement its existing rule lacked.*

## Steps to reproduce

1. `gh api repos/Oofles/lost-soles --jq .visibility` → `public`.
2. Read `tickets/open/0038-*.md`, "Fixtures", required set item 1.

## Expected vs actual

**Expected:** committed test fixtures carry the *shape* of a real response and no real location.

**Actual:** as written, `0038` commits ~2,700 real GPS points of the operator's run to a public
repository, permanently.

## Notes

Three candidate transformations, for whoever picks this up:

1. **Capture real, then relocate and rotate** the whole track as a rigid body to open water or an
   uninhabited grid square. Preserves every metric property the tests assert; destroys the location.
   Rigid transform alone leaves the route SHAPE, which is why it is paired with relocation rather
   than offered instead of it.
2. **Synthesise from a real response's metadata** — take the real `original_size`, cadence and gap
   structure, generate coordinates along a synthetic path. Nothing real survives; slightly weaker as
   a "this is what Strava actually sends" artifact, which is the whole point of fixtures.
3. **Keep real fixtures out of git entirely** — private S3, fetched by CI. Strongest privacy,
   worst developer experience, and it breaks contract §5's "unit-testable with zero mocking".

(1) looks best: the fixtures stay real responses in every respect the code cares about.

**Do not treat this as blocking `0038` from starting** — it is a change to *how* fixtures are
captured, and the rate-limit backoff half of `0038` is untouched by it.

## Resolution

**Files touched**

| File | What |
|---|---|
| `scripts/check-fixture-geography.mjs` | **new** — the guard, plain node, no dependencies, with a 12-case `--self-test` |
| `.githooks/pre-commit` | **new layer 4** — runs the guard on staged fixtures, via `--staged` |
| `scripts/pre-commit-hook.test.mjs` | five layer-4 tests, incl. the index/worktree split and fail-closed-when-missing |
| `.github/workflows/gate.yml`, `amplify.yml` | self-test + check on both CI surfaces (D-163: alarm and lock) |
| `src/adapters/strava/normalize.test.ts` | the inline guard replaced by a call into the script, so the box is defined once |
| `src/adapters/strava/__fixtures__/run-continuous.json` | placeholder polylines replaced with real encoded synthetic geometry |
| `src/adapters/strava/__fixtures__/README.md` | rewritten around D-199 |
| `docs/decisions/DECISIONS.md` | **D-199** |
| `docs/08-security-privacy.md` | §7.2 row annotated; §7.3 becomes four layers |
| `docs/INDEX.md` | regenerated |
| `tickets/open/0038-*.md` | fixture instruction amended; unblocked |

**The finding, which is the reverse of the one the ticket was filed for.** This ticket was
written as *"`08` is missing a line, and that omission made `0038` read as reasonable."* `08`
was not missing a line. §7.2 already said *"Test fixtures are **synthetic coordinates**"* and
already predicted this exact break — *"the repo-hygiene rule most likely to be broken by someone
being helpful."* `0038` did not fall through a gap; it **contradicted a written security rule**,
and nothing in the repository could notice. So the fix is not prose. It is the fourth scanning
layer §7.3 lacked. Criterion 5 was amended rather than satisfied as written, and that amendment
is the most useful thing in this ticket.

**Why the ticket's own preferred transformation was rejected.** The Notes recommended option (1):
capture the real track, then relocate and rotate it as a rigid body. It is the higher-fidelity
option and it was the wrong one — a rigid transform preserves the **route shape**, and a route
shape is matchable against OpenStreetMap. The Notes half-see this (*"a distinctive loop is
identifying even when moved"*) and then propose it anyway on the grounds that relocation fixes
it. It does not: relocation moves the loop, it does not change it. Taking option (1) would also
have required amending §7.2, and amending a settled security rule to make a ticket easier is
what the working agreement forbids. Recorded as D-199, with the rejection.

**Three things the guard covers that the original test did not**, all found by writing it out
rather than by reasoning about it:

1. `detail.start_latlng` / `end_latlng`. The old guard read `streams.latlng.data` only, so a
   fixture could have passed it while publishing the operator's front door twice over in two
   scalar fields on the detail object.
2. Encoded `polyline` / `summary_polyline`. Not less of a location for being unreadable.
3. The walk is **structural, not path-based** — it finds coordinates wherever they sit. A guard
   keyed to `streams.latlng.data` goes quietly green the first time the envelope shape moves,
   and ticket `0039`'s archive layout moves it.

**What went wrong while building it.** The guard failed on its very first real run, on
`run-continuous.json`, which carried `"polyline": "omitted"` — a hand-written placeholder. Not a
leak. But nothing in a scanner can prove a string it cannot decode is harmless, and *"I could not
read it"* resolving to *"clean"* is D-176's failure class, which this repo has now been bitten by
in four separate tickets. So the check fails closed on an undecodable polyline, and the fixture
was given genuine encoded synthetic geometry instead — which required writing `encodePolyline`
next to the decoder, and made the fixture a **more** faithful copy of a real Strava response than
the placeholder was. A false positive that improved both the guard and the fixture.

**The index/worktree hole, closed.** The first version of layer 4 passed working-tree paths to
the scanner while layer 2 beside it reads staged content via `git show`. `git add` a real track,
repair the file on disk, commit — worktree clean, index dirty, and it is the index that becomes
history. Hence `--staged`, which addresses each path as `:<path>`. There is a test for it.

**Deliberately not done:** the ~2,700-point capture. This ticket settles *how* a fixture is
transformed; `0038` executes it. Its own Notes say not to treat it as blocking `0038` from
starting, and `0038` is now unblocked.

## Operator validation

**Smoke test, run by the agent (D-181) — a throwaway git repo with the real hook installed.**
Three cases, in `scratchpad/smoke`:

| Case | Result |
|---|---|
| Fixture holding a real track (Times Square — a public landmark, deliberately not a home) staged and committed | **BLOCKED.** `0 commits`. *"COMMIT BLOCKED: a staged fixture carries a real location"* |
| The same track staged, then the file repaired to Point Nemo on disk before committing | **BLOCKED.** `0 commits` — the scanner read the index, not the clean worktree |
| Synthetic Point Nemo geometry, staged properly | **COMMITTED.** `1 commit`; gitleaks also ran and passed |

**Also verified by the agent:**

- `node scripts/check-fixture-geography.mjs --self-test` — **12/12**, including that the
  empty-scan guard itself fires (a scan recognising zero coordinates is refused, not passed).
- `node scripts/check-fixture-geography.mjs` over the real tree — 45 coordinates across 12
  files, all inside the box. It **failed** the first time it was run, on the placeholder
  polylines; that is recorded above.
- `npm test` — **789 passed, 1 skipped, 41 files**, including 5 new layer-4 hook tests.
- `npm run typecheck`, `npm run lint` (`--max-warnings 0`), `node scripts/check-boundaries.mjs` —
  all clean.
- `node scripts/build-index.mjs --check` — `docs/INDEX.md` up to date after the §7.3 rename.

**The operator judgement this ticket asked for is no longer applicable, and that is the correct
outcome rather than a skipped step.** The ticket reserved one question for a human: *"whether the
transformed fixture's geometry is acceptable to publish — only the operator knows where they
actually run."* That question exists only under the rejected rigid-transform option, where the
committed geometry is derived from a real track and someone has to judge whether it is still
recognisable. Under D-199 nothing in a fixture is derived from any real track: the coordinates
are generated from scratch over open ocean, so there is no resemblance for the operator to
assess. The choice of transformation dissolved the question instead of answering it.

