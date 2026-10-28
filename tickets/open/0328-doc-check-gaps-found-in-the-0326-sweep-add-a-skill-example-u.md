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

- [ ] A test parses §1.3's add-a-skill example, appends its row to the newest bundled ruleset as
      v(N+1), and asserts `validateRuleSet` returns zero errors. Removing a required field from the
      example makes it fail (checked once, by hand or with a mutation case in the test).
- [ ] `doc-schema.test.ts` compares against the newest bundled ruleset, found the way the loader
      finds it rather than as a literal, or its comment is corrected to say why v2 is pinned.
- [ ] The `resource.ts` header comment states the real counts.

## Notes

Keep it to the test and the comment. If the doc example needs to change to pass, that is a finding
for the Resolution, not a reason to loosen the validator.

## Operator validation

None owed. Tests and a comment; the suite is the check.

D-123 trigger checked? none.
