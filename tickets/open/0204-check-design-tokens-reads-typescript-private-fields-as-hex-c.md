---
id: 204
slug: check-design-tokens-reads-typescript-private-fields-as-hex-c
title: check-design-tokens reads TypeScript private fields as hex colours — this.#acc() is '#acc'
type: bug
priority: low
status: open
size: s
capability: 00-preflight-and-repo
depends_on: []
blocked_by: []
source: agent
created: 2026-09-11T14:05:49Z
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

- [ ] `this.#acc()`, `#acc(): T {`, `#face`, `#added` and `this.#fff` do not fire.
- [ ] Everything §8.3 actually bans still fires: `'#C9A227'`, `#000`, `#ffffff`, `= '#0B1020'`,
      `color: #abc`, and a hex in a template literal.
- [ ] The `--self-test` proves both directions, in the shape the file already uses — a guard that
      cannot fail is a decoration, and one that fires on correct code gets disabled.
- [ ] The narrowing is written up in the file's existing "WHAT IS A COLOUR" comment, beside 0146's,
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

## Operator validation

None — a build gate with a self-test. `node scripts/check-design-tokens.mjs --self-test` is the
evidence, and it must prove the check still FIRES on a real violation.
