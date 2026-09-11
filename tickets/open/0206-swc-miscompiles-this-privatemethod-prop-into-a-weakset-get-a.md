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

- [ ] A check fails on `this.#method().prop++` (and `--`, `+=`, and friends) anywhere under `lib/`,
      `components/`, `src/` and `app/`, and passes on the hoisted-local form.
- [ ] It runs in the GitHub gate and in the Amplify build container — plain node, no dependencies,
      no ripgrep (D-163).
- [ ] `--self-test` proves it FIRES on a real violation, in the shape every other check here uses.
- [ ] The reasoning is in the script's header, not only in this ticket.
- [ ] The upstream SWC issue is searched for, and filed with the minimal repro if it does not exist.
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
