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

- [ ] A test file exists for `build-index.mjs` and runs in `npm test`, so it rides both CI surfaces.
- [ ] `--check` is asserted **read-only**: run it against a fixture tree and assert
      `docs/.index-summaries.json` is byte-identical afterwards. This is the D-178 regression.
- [ ] A heading inside a fenced code block is asserted **not** to be indexed, using a fixture that
      contains one — the `07:463` case, reduced.
- [ ] Section ranges are asserted to end at the next heading of the same or higher level, including
      the case where a `###` is followed by a `##`.
- [ ] A hand-written sidecar summary is asserted to survive a regeneration that moves its line
      numbers.
- [ ] The tests run against a **fixture directory**, not against `docs/` — a test that reads the
      real docs changes meaning every time a document is edited, which is how a test becomes noise
      and then gets deleted.

## Notes

Related: `0120` (created the index), `0140` (fixed the staleness and made `--check` read-only,
D-177/D-178), `0125` and `0137` (the same "the guard has no guard" shape, twice).

If a general fixture harness for `scripts/*.mjs` suggests itself while doing this, say so rather
than building it here — `check-boundaries.mjs`, `check-design-tokens.mjs` and
`check-bundle-leak.mjs` all carry their own `--self-test` instead, and whether that pattern or
vitest is right for this script is worth one paragraph in the Resolution.

## Operator validation

None expected — test-only work on a documentation generator, with no rendered surface and no
deployed behaviour. The proof is the tests themselves and `npm test` staying green.
