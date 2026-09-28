---
id: 206
slug: swc-miscompiles-this-privatemethod-prop-into-a-weakset-get-a
title: SWC miscompiles this.#privateMethod().prop++ into a WeakSet .get — a production-only crash no test can see
type: bug
priority: high
status: open
size: s
capability: 00-preflight-and-repo
depends_on: []
blocked_by: []
source: agent
created: 2026-09-11T15:45:12Z
started: 2026-09-28T02:02:23Z
---

## Description

`0059` shipped this line, and it crashed the deployed app while passing every gate:

```ts
cameraEvent(): void {
  this.#current().cameraEvents++          // #current() is a private METHOD
}
```

**It works in vitest, in esbuild, and in `next dev`. It throws only in the production bundle.**

SWC downlevels `#private` to `WeakMap`s, and a private *method* to a `WeakSet` brand plus a plain
function. Reading one is meant to go through `_class_private_method_get(receiver, brand, fn)`, which
only ever calls `brand.has(receiver)`. But an **update expression** (`++`) anywhere in the member
chain routes the private-name access through `_class_extract_field_descriptor(receiver, map,
"update")` instead:

```js
function i(e,a,t){ if(!a.has(e)) throw TypeError("attempted to "+t+" private field on non-instance"); return a.get(e) }
```

`a` is the `WeakSet`. `.has` passes — the instance *is* branded — and then `.get` does not exist.

What reaches the operator is this, from inside MapLibre's `move` handler, with nothing recognisable
in the stack:

```
TypeError: a.get is not a function
    at i (646-….js:15:54950)
    at r (646-….js:15:35441)
    at B.cameraEvent (app/page-….js:1:3017)
    at aC.aI (…)            ← FogViewportController's #camera
    at on.jumpTo (…)
```

Three other call sites of `#current()` in the same class compiled correctly. The **only** difference
was the `++`. Confirmed by reading the shipped chunk before and after:

```
before   { '(0,m._)(this,I,': 3, '(0,f._)(this,I)': 1 }     ← f = the "update" helper
after    { '(0,m._)(this,I,': 4, '(0,p._)(this,I)': 1 }     ← p = the constructor's brand install
```

The fix in `0059` was to hoist to a local, which `cullEnd` already did for readability and was
accidentally immune for that reason.

**Why this deserves a gate rather than a comment.** Every automated check this project has passed:
`tsc`, `eslint`, 2,074 unit tests, six guard scripts, `next build`, and two headless browser
harnesses — because all of them run esbuild or vitest, neither of which downlevels private methods
this way. The only thing that caught it was the operator opening the page, and the only reason the
stack was legible at all is that `0059` had just added `try/catch` around the run. A bug class that
is invisible to every gate and costs a deploy round-trip to find is exactly what a gate is for.

## Acceptance criteria

- [x] A check fails on `this.#method().prop++` (and `--`, `+=`, and friends) anywhere under `lib/`,
      `components/`, `src/` and `app/`, and passes on the hoisted-local form.
- [x] It runs in the GitHub gate and in the Amplify build container — plain node, no dependencies,
      no ripgrep (D-163).
- [x] `--self-test` proves it FIRES on a real violation, in the shape every other check here uses.
- [x] The reasoning is in the script's header, not only in this ticket.
- [x] The upstream SWC issue is searched for, and filed with the minimal repro if it does not exist.
      Record the issue URL here either way.

## Steps to reproduce

1. Add `class A { #m(){return {n:0}}; go(){ this.#m().n++ } }` to a client component.
2. `npm run build`
3. Grep the emitted chunk: the private-name access uses the field-descriptor helper, not
   `_class_private_method_get`. Calling `go()` in a browser throws `a.get is not a function`.

## Expected vs actual

**Expected:** `this.#m().n++` reads the private method through the brand check and increments the
returned object's property.

**Actual:** it reads the brand `WeakSet` as if it were a field `WeakMap` and throws.

## Notes

**The source-level detector is already written** — this grep found exactly one instance repo-wide,
which was the bug:

```
grep -rnE '#[A-Za-z_][\w]*\([^)]*\)\.[A-Za-z_][\w.]*(\+\+|--|\s*[-+*/|&^]?=[^=])' \
  --include=*.ts --include=*.tsx lib components src app
```

**A bundle-level detector is possible but is NOT the one to build.** The signature is a 2-argument
field-helper call on an identifier assigned `new WeakSet`. Scanning the minified output for it
produced ~30 hits, essentially all false positives: webpack concatenates modules into one file and
minified names are per-module, so a `WeakSet` named `I` in one module makes every `WeakMap` named `I`
in every other module look guilty. Scope any such check to a single module's scope or do not write it.

Consider also whether the SWC version can simply be raised — check the release notes before writing
the grep, because a fixed compiler is worth more than a gate against a fixed compiler. If it is fixed
upstream, keep the gate anyway: it costs nothing and the failure mode is invisible.

## Operator validation

None — a build gate. `node scripts/<name>.mjs --self-test` is the evidence, and it must prove the
check FIRES on a real violation as well as passing on correct code.

## Resolution

**Upgrading does not fix it.** Measured before writing the gate, as the Notes asked: the SWC bundled
with next 15.5.24 **and** standalone `@swc/core` 1.16.2 (latest at the time) both produce the crash,
byte-for-byte the same behaviour. Targets es2015–es2021 fail; es2022 (no downlevel) is fine. So no
version bump was worth filing.

**The bug is wider than the ticket described**, measured with a 12-case matrix run through both
compilers (in the session scratchpad, not the repo):

- Fails: `this.#m().n++`, `++this.#m().n`, `--`, `this.#m().a.n++`, `this.#m().g().n++`,
  `this.#m()[0]++`, `other.#m().n++` (**any receiver**, not just `this`), `(this.#m()).n++`.
  A **static** private method, `A.#s().n++`, fails too, with a different error
  (`_s is not defined`).
- Compiles correctly today: `+=`, `**=`, `||=`, `??=`, plain `=`, and the hoisted local.

The criterion asked for `+=` and friends as well, and the ticket's grep also matched plain `=`. **All
assignment operators are gated anyway.** They go through the same read-modify-write area of the
transform, the hoisted form always works, and the repo has no legitimate use to protect. The header
says which forms are *measured* crashes and which are gated as a precaution, so no one mistakes the
second group for the first.

**Files**
- `scripts/check-private-method-update.mjs` (new). Plain node, no dependencies, ~0.1s over the tree.
  It is not a line grep. The ticket's grep **hits the explanatory comment above the fix in
  `lib/fog/perf/collector.ts:377`**, so a grep-based gate would have failed on day one against the
  very comment that documents the bug. The script first blanks comments, strings, template text
  (keeping `${…}` code) and regex literals, preserving offsets. It then walks the member chain on
  each side of every `++`/`--` and before every assignment operator, and fires if that chain
  contains `#name(`. The walk only joins segments through `.`/`?.`, calls and indexes, so
  `if (this.#ok()) counter.n++` is not a hit. A quoted string that reaches a newline is abandoned,
  so an apostrophe in JSX text costs at most one line of accuracy rather than the rest of the file.
  Scans `lib/ components/ src/ app/`, `.ts .tsx .mts .js .jsx .mjs`.
- `.github/workflows/gate.yml`: `--self-test`, then the scan, placed after the deck.gl check with
  the reasoning in a comment.
- `amplify.yml`: the same two commands in the pre-build list (the lock, D-163), after the deck.gl
  check.

**Upstream.** Searched swc-project/swc issues under nine phrasings (the error text, the helper names,
"private method ++", "update expression", and others) and found nothing matching. Filed
**https://github.com/swc-project/swc/issues/12427** with the 5-line repro, the shape matrix, the
affected targets and the workaround, with the operator's go-ahead. The URL is in the script header.

**No new D-xxx.** This is a gate against a compiler bug and settles no design question.

## Operator validation

None needed from the operator; this is a build gate with nothing to look at. Verified by the agent:

- `node scripts/check-private-method-update.mjs --self-test` passed: **19 violations fired**
  (including 0059's exact shipped line) and **18 correct forms passed** (including 0059's hoisted
  fix, a violation inside a line comment, a block comment, a single- and double-quoted string, a
  template literal and a regex literal, plus `==`/`>=`/`<=`/`!=`/`=>`, `if (this.#ok()) x.n++`, and
  `total += this.#m().n`).
- `node scripts/check-private-method-update.mjs` on the real tree: clean, exit 0.
- **Mutation test on the real tree:** put 0059's original `this.#current().cameraEvents++` back into
  `lib/fog/perf/collector.ts`. The scan reported `lib/fog/perf/collector.ts:396` and exited 1 in
  0.094s. Restored with `git checkout`.
- Both YAML files parse after the edit. The first real exercise of the gate.yml step is this push's
  Actions run, and of the amplify.yml step the next Amplify build.

