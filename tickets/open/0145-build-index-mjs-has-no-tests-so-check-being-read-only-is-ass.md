---
id: 145
slug: build-index-mjs-has-no-tests-so-check-being-read-only-is-ass
title: build-index.mjs has no tests, so --check being read-only is asserted by nothing
type: chore
priority: low
status: open
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-02T02:08:41Z
started: 2026-10-02T01:07:48Z
---

## Description

`scripts/build-index.mjs` has no test file. It is 142 lines carrying several properties that are
easy to break and impossible to notice breaking:

- **`--check` is read-only** (D-178, ticket `0140`). It wrote `docs/.index-summaries.json` on every
  run until 0140 moved the write below the branch. Nothing asserts it stays below.
- **Fenced blocks are not headings.** `## Acceptance criteria` at `07-ticketsmith.md:463` is an
  *example* inside a ```` ```markdown ```` block and must not be indexed. This is load-bearing:
  `07` and `TICKET_FORMAT.md` are full of example ticket bodies, and indexing them would fill the
  index with phantom sections pointing into code blocks.
- **Section ranges end at the next heading of the same or higher level**, which is what makes a
  `sed -n` from the index land on the right lines.
- **Hand-written summaries survive regeneration** via the sidecar, which is the entire reason the
  sidecar exists.
- **The regeneration date is excluded from the comparison**, or `--check` would fail every day.

Filed from `0140`'s Resolution, where the absence was named rather than quietly accepted. This is
the same shape as `0125` (the pre-commit hook had no test) and `0137` (the hook's gate was a
pipeline, not a predicate): a script that guards something, guarded by nothing itself. `0140` fixed
a real defect in this file and could not add a regression test for it, which is the argument for
this ticket rather than a bigger one.

**Priority is `low` deliberately.** The blast radius is a documentation index, not the map or the
XP ledger — a regression here misleads a session rather than corrupting data. It should be done
when capability `01` is next open, not ahead of anything that touches the build.

## Acceptance criteria

- [x] A test file exists for `build-index.mjs` and runs in `npm test`, so it rides both CI surfaces.
- [x] `--check` is asserted **read-only**: run it against a fixture tree and assert
      `docs/.index-summaries.json` is byte-identical afterwards. This is the D-178 regression.
- [x] A heading inside a fenced code block is asserted **not** to be indexed, using a fixture that
      contains one — the `07:463` case, reduced.
- [x] Section ranges are asserted to end at the next heading of the same or higher level, including
      the case where a `###` is followed by a `##`.
- [x] A hand-written sidecar summary is asserted to survive a regeneration that moves its line
      numbers.
- [x] The tests run against a **fixture directory**, not against `docs/` — a test that reads the
      real docs changes meaning every time a document is edited, which is how a test becomes noise
      and then gets deleted.

## Notes

Related: `0120` (created the index), `0140` (fixed the staleness and made `--check` read-only,
D-177/D-178), `0125` and `0137` (the same "the guard has no guard" shape, twice).

If a general fixture harness for `scripts/*.mjs` suggests itself while doing this, say so rather
than building it here — `check-boundaries.mjs`, `check-design-tokens.mjs` and
`check-bundle-leak.mjs` all carry their own `--self-test` instead, and whether that pattern or
vitest is right for this script is worth one paragraph in the Resolution.

## Resolution

**Files touched**
- `scripts/build-index.mjs` — one change for testability: a `--root <dir>` flag that replaces the
  repo root (default unchanged). Without it the script can only read the real `docs/`, which the
  last criterion forbids. Nothing else in the script moved.
- `scripts/build-index.test.mjs` — new, 5 tests, picked up by the existing `**/*.test.mjs` include
  in `vitest.config.ts`, so it runs in `npm test` on both CI surfaces with no config change.

**What each test asserts** (all run the script as a child process against a temp fixture tree
holding `docs/` and `docs/contracts/`):
1. `--check` is read-only **even when it fails**: the fixture is made stale with a new section, so
   the sidecar the script builds in memory differs from disk — the exact state in which the
   pre-0140 ordering wrote it. `INDEX.md` and `.index-summaries.json` are compared byte-for-byte.
2. `--check` passes on a fresh index whose `regenerated` date has been rewritten to 1999.
3. A ```` ```markdown ```` fence holding `## Acceptance criteria` (07:463, reduced) yields no index
   row and no sidecar key, and the `###` after the fence closes is still indexed.
4. Ranges: `## Alpha` 3-10 spans its `###`; `### Alpha child` 7-10 ends before the following `##`
   (the `###`→`##` case); the last `##` and `###` run to end of file.
5. A hand-written sidecar summary survives a regeneration after three lines are inserted above
   it; the range moves 11-23 → 15-27 and the summary does not.

**Proved the tests bite, not just pass.** Two mutations, both reverted: (a) restoring the pre-0140
sidecar write above the `--check` branch turns test 1 red, and only test 1; (b) commenting out
`if (inFence) return;` turns tests 3, 4 and 5 red. A test suite that only ever ran green against
the fixed code would not have shown it can catch the defect it was filed for.

**`--self-test` vs vitest** (the paragraph Notes asked for). The `check-*` scripts carry
`--self-test` because they run in the Amplify build container, where proving the guard works
*in place* is the point, and their properties are pure functions of input text. `build-index.mjs`
is different: every property this ticket cares about is a **file-system side effect** (what is
on disk after `--check`, what the sidecar holds after a regenerate), which a child process plus a
temp directory tests naturally and an in-process self-test can only simulate. So vitest is right
here, as it was for `pre-commit-hook.test.mjs` (0125), which has the same shape. No general fixture
harness for `scripts/*.mjs` suggested itself: the fixture is ~5 lines (`mkdtemp`, two `mkdir`s,
writes), and two test files that each need one are not yet the pattern that justifies one.

Nothing went wrong in the build; the tests passed first run, which is why the mutation step
mattered.

## Operator validation

**None — and correctly so.** Test-only work on a documentation generator, no rendered surface,
nothing deployed. Verified by the agent, 2026-10-01:
- `npx vitest run scripts/build-index.test.mjs` — 5/5 pass.
- Both mutations above go red as described, then the file is restored (`git diff` shows only the
  `--root` change).
- `npm test` — 135 files, 2526 passed, 1 skipped.
- `node scripts/build-index.mjs --check` against the real repo — "docs/INDEX.md is up to date.",
  and `git status` shows no change to `docs/`, i.e. `--root` did not alter the default path.
