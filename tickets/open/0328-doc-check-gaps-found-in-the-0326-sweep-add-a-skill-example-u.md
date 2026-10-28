---
id: 328
slug: doc-check-gaps-found-in-the-0326-sweep-add-a-skill-example-u
title: Doc-check gaps found in the 0326 sweep: add-a-skill example unparsed, doc-schema test pinned to v2, stale resource.ts header
type: chore
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-28T03:39:03Z
started: 2026-10-28T15:10:12Z
---

## Description

Three small code-side gaps that `0326`'s doc-only rule kept out of scope (wave 18.9, D-465):

1. `04-game-design.md` §1.3's "Adding a workout type is exactly this diff" example had drifted
   until it would fail the validator, and nothing noticed: `src/rules/doc-schema.test.ts` parses only
   the section's first yaml block, and `check-doc-ruleset.mjs` does not read it at all. `0326` fixed the
   example and checked it by hand with a throwaway script against `validateRuleSet`.
2. `src/rules/doc-schema.test.ts` compares against `loadRuleSet(2)` while its comment says "the
   newest version". Harmless today, because v3's scoring fields equal v2's.
3. `amplify/data/resource.ts`'s header comment says "five defineData models plus three raw CDK"
   tables. It is six and five (D-456, D-465).

## Acceptance criteria

- [x] A test parses §1.3's add-a-skill example, appends its row to the newest bundled ruleset as
      v(N+1), and asserts `validateRuleSet` returns zero errors. Removing a required field from the
      example makes it fail (checked once, by hand or with a mutation case in the test).
- [x] `doc-schema.test.ts` compares against the newest bundled ruleset, found the way the loader
      finds it rather than as a literal, or its comment is corrected to say why v2 is pinned.
- [x] The `resource.ts` header comment states the real counts.

## Notes

Keep it to the test and the comment. If the doc example needs to change to pass, that is a finding
for the Resolution, not a reason to loosen the validator.

## Operator validation

None owed. Tests and a comment; the suite is the check.

D-123 trigger checked? none.

## Resolution

**Files touched**

- `src/rules/doc-schema.test.ts`: section-extraction split into `section13()` and
  `yamlBlockAfter()`; the existing schema-excerpt tests are unchanged except that they now compare
  against `NEWEST` (the max key of `BUNDLED_RULES`, the same map the ingest worker scores from)
  instead of `loadRuleSet(2)`, and the "not in rules/xp-rules-v1.yaml" message names the version
  actually loaded. New `describe` block for the add-a-skill example: it finds the yaml block under
  the "**Adding a workout type is exactly this diff**" paragraph, appends its rows to a clone of
  the newest ruleset with `version: NEWEST + 1`, and asserts `validateRuleSet` returns `[]`. It also
  asserts the rows are new (no id already ships), and runs a mutation case per field
  (`enabled`, `introducedIn`, `revealsGround`, the three D-465 found missing): each removal makes
  `validateRuleSet` return errors. The test never names the example's skill id, so it needs no
  per-skill code (D-031/D-141).
- `amplify/data/resource.ts`: header now says six `defineData` models and five raw CDK tables,
  citing D-456 and D-465. Counted from the code, not from the decisions: six `.model({` calls in
  `resource.ts` (lines 103, 262, 296, 337, 417, 516) and five `new Table(` in `amplify/backend.ts`
  (CaptureGuard, SourceAccount, OAuthState, IngestReceipt, ExploredCell).
- `docs/04-game-design.md` §1.3, two lines. The D-465 amendment's last sentence ("Nothing in CI
  parses this block yet…") was made false by this ticket and now says the test parses it. The
  schema excerpt's first comment line said `rules/xp-rules-v2.yaml`, and the test now checks it
  against the newest version, so it says "The newest rules/xp-rules-vN.yaml". Both are finding-level
  doc corrections that this ticket's own change caused. No example content changed: the add-a-skill
  example passed the validator as D-465 left it, so the validator was not loosened and the example
  did not need a fix.

**Decisions**

- Newest version is `Math.max(...Object.keys(BUNDLED_RULES).map(Number))`, the same expression
  `shipped-rulesets.test.ts` uses. The loader (`load.ts`) takes a version number and has no
  "newest" helper; `BUNDLED_RULES` is how the worker finds the versions it can score, so that is
  "the way the loader finds it". No new export was added to `load.ts`, which keeps the change to the test.
- v3 is now the comparison target. The scoring fields the excerpt test compares are identical in
  v2 and v3 (v3 adds only a treadmill exercise under Vigil, and `exercises` is not a compared field),
  so the switch changed no assertion outcome.
- The example's `introducedIn: 4` is kept as written. It validates while it is ≤ N+1, so a future
  v4 keeps it green (appended as v5). If a v4 ships with a different row, the prose's "v4" wording
  goes stale but the test will not catch that. That is prose, not schema, and it is out of scope.

**Verification**: all amplify.yml build-phase guards pass, including
`check-secret-storage --require-literals` (run with AWS_APP_ID/AWS_BRANCH set, read-only) and the
post-build `check-prerender-no-cell-data`, `check-third-party-origins` and
`check-bundle-leak --require-literals` re-run after `npm run build`. `npm run typecheck`,
`npm run lint`, `npx vitest run` (276 files, 4560 passed, 1 skipped) and `npm run build` also pass.
`doc-schema.test.ts` has 12 tests (7 existing, 5 new).
