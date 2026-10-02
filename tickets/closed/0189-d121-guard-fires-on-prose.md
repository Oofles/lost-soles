---
id: 189
slug: d121-guard-fires-on-prose
title: The D-121 polyline guard fires on prose, not just on code
type: bug
priority: low
status: closed
size: s
capability: 00-preflight-and-repo
depends_on: []
blocked_by: []
source: agent
created: 2026-09-10T01:26:56Z
closed: 2026-10-02T01:13:38Z
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

- [x] The `reachesTooling` scan ignores comment lines (`//`, `*`, `/*`), matching
      `check-design-tokens.mjs`'s carve-out and for the reason it records.
- [x] A shipped file that names a privacy-tooling script **in a comment** passes.
- [x] A shipped file that `import`s or `require`s one, or names it in a string literal, still FAILS —
      asserted by a fixture, not by reasoning, because this guard protects a map that cannot re-fog.
- [x] `lib/fog/spike-cells.ts`'s workaround comment is removed if that file still exists; if `0118`
      has already deleted it, say so in the Resolution instead.
      — **discharged 2026-09-09: `0118` closed and deleted that file.** Nothing in the tree carries
      the workaround now, which also means **nothing currently reproduces this bug** — use the
      `## Steps to reproduce` below to recreate it before fixing.

## Steps to reproduce

1. Add `// see scripts/check-fixture-geography.mjs` to any non-test file under `lib/`.
2. `npx vitest run src/adapters/strava/adapter.test.ts`

## Expected vs actual

**Expected:** a comment naming the guard is documentation and passes.

**Actual:** `expected [ 'lib/fog/spike-cells.ts' ] to deeply equal []` — reported as a D-121 breach.

## Notes

**2026-09-09 — `0118` closed and took the triggering file with it.** The guard is still wrong in
exactly the way described; there is simply no file in the tree tripping it any more. That makes this
slightly *more* worth fixing rather than less: the next person to name one of those scripts in a
comment will hit a failure that reads as a D-121 breach, with nothing in the tree to suggest the
guard is the problem.

Low priority and genuinely harmless today: the failure is loud, immediate, and the workaround is to
reword a comment. It is filed because the cost is paid in the wrong currency — a guard that has to be
dodged is a guard that gets disabled, which `.githooks/pre-commit` warns about in its own comment and
which `check-design-tokens.mjs` cites as the reason it was narrowed in ticket `0146`.

## Resolution

**Files touched:** `src/adapters/strava/adapter.test.ts` only.

- The substring scan became a pure function, `reachesPrivacyTooling(body, tooling)`, declared at
  the top of the `no polyline decoder exists anywhere in this repository` describe. It splits the
  body into lines, drops comment lines using `check-design-tokens.mjs`'s regex minus `<!--`
  (`^\s*(\/\/|\*|\/\*)`; only ts/tsx/mjs/js are walked, so no HTML comments), and runs the old
  `includes` check on what remains. The real-tree scan calls it. `importers`, the first half, was
  not touched.
- **New fixture test** `counts code that names privacy tooling, but not a comment that does (0189)`:
  `//`, `/* */` and JSDoc ` * ` lines naming the script → not counted. A static `import`, a
  `require`, a string literal, and a dynamic `import()` with a trailing comment → counted.
- **Reproduced before fixing**, as the Notes asked. With the old code, appending
  `// see scripts/check-fixture-geography.mjs` to `lib/amplify-server.ts` failed with
  `expected [ 'lib/amplify-server.ts' ] to deeply equal []`. With the fix, the same line passes
  (47/47). Appending `export const x = "check-fixture-geography.mjs"` instead still fails with the
  same message. Both probes were reverted.
- **Deliberate limitation:** a trailing comment on a code line (`foo() // check-fixture-geography.mjs`)
  still fails, because the line is code. This is the same behaviour as `check-design-tokens.mjs`, and
  for this guard it is the safe direction. A block comment's *interior* line that doesn't start with
  `*` is also still scanned. Both cost at most a rewording; neither can let a real reference through.
- **Criterion 4:** `lib/fog/spike-cells.ts` was already deleted by `0118`, so there was no
  workaround comment to remove.
- No new decision. The carve-out applies existing precedent (`check-design-tokens.mjs`, ticket `0146`).

## Operator validation

**Smoke test, run by the agent (no visible surface, so no operator step).** A temporary comment probe in
`lib/amplify-server.ts` passes the guard, and a string-literal probe fails it with the D-121
assertion. The fixture test asserts both directions permanently. Full suite: 135 files, 2527 passed,
1 skipped. `tsc --noEmit` and `eslint` are clean.

Original instruction: None — a test-only change with no visible surface. The close is a smoke test: the new fixture must
fail the guard on an import and pass it on a comment, and the full suite must stay green.
