---
id: 189
slug: d121-guard-fires-on-prose
title: The D-121 polyline guard fires on prose, not just on code
type: bug
priority: low
status: open
size: s
capability: 00-preflight-and-repo
depends_on: []
blocked_by: []
source: agent
created: 2026-09-10T01:26:56Z
---

## Description

**Found while writing ticket `0118`.** `src/adapters/strava/adapter.test.ts`'s D-121 guard has two
halves. The second — "nothing under the shipped tree may import the exempted privacy tooling" — is
implemented as a **substring search over the whole file body**:

```js
const reachesTooling = shippedFiles.filter((f) => {
  const body = readFileSync(f, "utf8")
  return PRIVACY_TOOLING.some((t) => body.includes(t.replace(/^scripts\//, "")))
})
```

So a shipped file that merely **names** one of those scripts in a comment fails the test, with an
assertion message that reads as a D-121 breach. `0118` hit this by explaining, in a comment, which
guard does and does not cover a hard-coded coordinate — prose that is useful precisely because it
names the guard.

The repo has already solved this elsewhere and the precedent is the argument:
`scripts/check-design-tokens.mjs` carves out comment lines explicitly, with the reasoning written
down — *"A comment naming a value (the contrast table, a `--ink-400 @ 0.35` note) is documentation,
not a leak."* The same sentence applies here verbatim.

**The first half of the guard is not in question.** `importers` is computed from real import
statements and stays as it is. Only the substring scan is wrong, and only for comments.

## Acceptance criteria

- [ ] The `reachesTooling` scan ignores comment lines (`//`, `*`, `/*`), matching
      `check-design-tokens.mjs`'s carve-out and for the reason it records.
- [ ] A shipped file that names a privacy-tooling script **in a comment** passes.
- [ ] A shipped file that `import`s or `require`s one, or names it in a string literal, still FAILS —
      asserted by a fixture, not by reasoning, because this guard protects a map that cannot re-fog.
- [ ] `lib/fog/spike-cells.ts`'s workaround comment is removed if that file still exists; if `0118`
      has already deleted it, say so in the Resolution instead.

## Steps to reproduce

1. Add `// see scripts/check-fixture-geography.mjs` to any non-test file under `lib/`.
2. `npx vitest run src/adapters/strava/adapter.test.ts`

## Expected vs actual

**Expected:** a comment naming the guard is documentation and passes.

**Actual:** `expected [ 'lib/fog/spike-cells.ts' ] to deeply equal []` — reported as a D-121 breach.

## Notes

Low priority and genuinely harmless today: the failure is loud, immediate, and the workaround is to
reword a comment. It is filed because the cost is paid in the wrong currency — a guard that has to be
dodged is a guard that gets disabled, which `.githooks/pre-commit` warns about in its own comment and
which `check-design-tokens.mjs` cites as the reason it was narrowed in ticket `0146`.

## Operator validation

None — a test-only change with no visible surface. The close is a smoke test: the new fixture must
fail the guard on an import and pass it on a comment, and the full suite must stay green.
