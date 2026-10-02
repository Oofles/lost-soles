---
id: 204
slug: check-design-tokens-reads-typescript-private-fields-as-hex-c
title: check-design-tokens reads TypeScript private fields as hex colours — this.#acc() is '#acc'
type: bug
priority: low
status: closed
size: s
capability: 00-preflight-and-repo
depends_on: []
blocked_by: []
source: agent
created: 2026-09-11T14:05:49Z
closed: 2026-10-02T01:32:09Z
---

## Description

`scripts/check-design-tokens.mjs` fires on TypeScript **private class members** whose name happens to
be 3, 4, 6 or 8 hex letters. `0059` hit it on a method called `#acc`:

```
  lib/fog/perf/collector.ts:337
    const culls = this.#acc().culls
    raw hex outside app/tokens.css — reference a semantic token (§8.3)
```

The guard's `COLOUR_START` is `(?<![\w}])#` — *"a `#` that opens a value rather than separating two
segments of a key"*. In `this.#acc()` the `#` is preceded by a **dot**, which is not a word character
and not `}`, so the narrowing 0146 added does not cover it. `acc` is three hex digits and `\b` holds
before the `(`, so it matches `ANY_HEX` exactly.

This repository uses `#private` fields heavily — `explored-set.ts`, `zoom-buckets.ts`,
`mask-layer.ts`, `viewport-controller.ts` and `collector.ts` all do — so the collision set is every
field or method named with hex letters only: `#acc`, `#added`, `#face`, `#cafe`, `#dec`, `#bed`,
`#fade`, `#decade`. It will recur.

## Acceptance criteria

- [x] `this.#acc()`, `#acc(): T {`, `#face`, `#added` and `this.#fff` do not fire.
- [x] Everything §8.3 actually bans still fires: `'#C9A227'`, `#000`, `#ffffff`, `= '#0B1020'`,
      `color: #abc`, and a hex in a template literal.
- [x] The `--self-test` proves both directions, in the shape the file already uses — a guard that
      cannot fail is a decoration, and one that fires on correct code gets disabled.
- [x] The narrowing is written up in the file's existing "WHAT IS A COLOUR" comment, beside 0146's,
      with the reasoning rather than only the pattern.

## Steps to reproduce

1. Add `class X { #acc() { return 1 }; y() { return this.#acc() } }` to any `.ts` file under `lib/`.
2. `node scripts/check-design-tokens.mjs`

## Expected vs actual

**Expected:** exit 0. A private member is not a colour.

**Actual:** `raw hex outside app/tokens.css` on every line mentioning it.

## Notes

Two narrowings look sufficient and neither weakens the real rule, because **no CSS colour is ever
preceded by `.` or followed by `(`**:

- `#` not preceded by `.` — covers `this.#acc()`.
- the hex run not followed by `(` — covers the declaration `#acc(): Accumulator {`.

Prefer that to an extension or directory exemption: the file's own header rules those out, and
rightly — either would silently stop scanning real components.

`0059` renamed its method to `#current()` rather than adding five `design-tokens:allow` lines. That
is a dodge either way, and the guard's own header says why it matters: *"A guard that has to be
dodged is a guard that gets disabled."* Hence this ticket rather than a quiet rename.

## Resolution

**Files touched:** `scripts/check-design-tokens.mjs` only.

The fix is three narrowings, all in the regex and all at token level. A line-level exemption would
have hidden `#face = '#C9A227'`. They are numbered 3–5 in a new "WHAT IS A COLOUR, AND WHAT IS A
PRIVATE CLASS MEMBER (ticket 0204)" block beside 0146's, each with its reasoning:

3. **`#` not preceded by `.`.** `COLOUR_START` became `(?<![\w}.])#`. This covers `this.#acc()`,
   `this.#fff` and `other?.#bed`.
4. **The run is not followed by `\s*(`.** This covers the declaration `#acc(): Accumulator {`.
5. **A private-field declaration is not a colour.** This covers a `#` that starts its line, after
   indentation and optional `static`/`readonly`/`override`/`declare`/`accessor`, with `?`/`!` and
   then `:` or `=` after the name. Examples: `#face = 0`, `readonly #face: Face`.

**Decision made inside the ticket's scope.** The Notes proposed only narrowings 3 and 4. Criterion 1
also names bare `#face` and `#added`, and a bare `#face` on its own is the 4-digit colour `#face`. The
only TypeScript place it appears without a `.` before it or a `(` after it is a field declaration.
So I added narrowing 5, which keys on that shape. The `:`/`=` after the name is what separates it
from a CSS value continued onto its own line (`    #0B1020;`), which still fires. The one CSS shape
it exempts is an id selector like `#abc:hover`, which is not a colour either. `#added` is five
letters and never matched (0146's narrowing 1). It has a fixture anyway because the criterion
names it.

**Known limitation:** narrowing 5 is line-anchored. A second declaration packed onto the same line
(`x = 1; static readonly #cafe: …`) still fires. A self-test case records this on purpose, as the
cheaper side to err on.

**Tests:** 18 self-test cases were added; the self-test now has 40, all passing.
- *Must pass:* 0059's line verbatim, the method declaration, four field-declaration shapes
  (including `static readonly`), `this.#fff` (so the ABSOLUTE rule is narrowed too), `?.#bed`
  and `#added`.
- *Must fire:* `color: #abc;`, a template literal, `'#000'`, `#ffffff`, `= '#0B1020'`, a
  declaration whose value is a colour, a CSS continuation line and the packed declaration.

**Proved the fixtures can fail:** I spliced the new fixtures onto the HEAD version of the file. The
self-test failed 7 cases, exactly the member and declaration ones, and every must-fire case still
fired. The ticket's repro (`class X { #acc() … this.#acc() }` in `lib/`) now exits 0 on the real
tree. The probe file was removed.

No new `D-xxx`: this extends 0146's narrowing under the rationale already recorded there.

## Operator validation

**Smoke test, run by the agent.** `node scripts/check-design-tokens.mjs --self-test` passes 40
cases, including every real-colour must-fire case. The real-tree check is clean. On the old regex,
the new fixtures fail 7 cases, so they can catch the bug.

Original instruction: None — a build gate with a self-test. `node scripts/check-design-tokens.mjs --self-test` is the
evidence, and it must prove the check still FIRES on a real violation.
