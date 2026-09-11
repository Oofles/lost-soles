---
id: 205
slug: npm-run-lint-fails-after-npm-run-build-eslint-scans-the-gene
title: npm run lint fails after npm run build — eslint scans the generated public/maplibre worker
type: bug
priority: low
status: closed
size: s
capability: 00-preflight-and-repo
depends_on: []
blocked_by: []
source: agent
created: 2026-09-11T14:10:53Z
closed: 2026-09-11T14:54:31Z
---

## Description

`npm run build` runs `prebuild`, which is `scripts/copy-maplibre-worker.mjs` — it writes
`public/maplibre/maplibre-gl-worker.js` and `maplibre-gl-shared.js`, both minified vendor bundles.
`eslint.config.mjs` does not ignore them, so the next `npm run lint` reports **~700 warnings** on two
files nobody wrote, and `--max-warnings 0` turns that into a failing gate:

```
  5:8558   warning  Expected an assignment or function call and instead saw an expression
  5:13128  warning  'e' is defined but never used
  ... x ~700, all at line 5 of a minified file
```

`public/maplibre/` is gitignored (`.gitignore:53`), so a fresh clone lints clean and **CI never sees
it** — `gate.yml` runs `npm run lint` at line 71 and `npm run build` at line 206, in that order. It
only bites locally, and only after a build.

That makes it exactly the kind of failure that erodes a gate: the first time it happens you assume
you broke something, and the second time you learn to skip `npm run lint`.

## Acceptance criteria

**Superseded — this ticket closes as a duplicate of `0188` and ships no change.** The criteria below
are `0188`'s to meet; they are struck here rather than deleted so the duplicate's scope stays
readable next to its resolution.

- [x] ~~`npm run build && npm run lint` exits 0 on a clean tree.~~ → `0188`
- [x] ~~The ignore covers what `copy-maplibre-worker.mjs` actually writes, and the two files stay in
      step.~~ → `0188`, which also covers `check-design-tokens.mjs`
- [x] ~~Nothing in `public/` that a human wrote becomes unlintable as a side effect.~~ → `0188`

## Steps to reproduce

1. `npm run build`
2. `npm run lint`

## Expected vs actual

**Expected:** exit 0. Generated vendor code is not this project's code.

**Actual:** ~700 warnings from `public/maplibre/*.js`, and `--max-warnings 0` fails.

## Notes

Found during `0059`, which runs a production build as part of its own verification. Pre-existing
since `0053` shipped `copy-maplibre-worker.mjs`; it has been invisible because the CI order hides it
and because a build is not part of the normal per-ticket loop.

The obvious fix is an `ignores` entry for `public/maplibre/**` in `eslint.config.mjs`. Prefer keying
it to the same constant the copy script uses if there is one, so the two cannot drift.

## Operator validation

None — a local tooling gate, and it closes as a duplicate rather than as work. See `## Resolution`.

## Resolution

**Closed as a duplicate of `0188`, which was filed two days earlier (2026-09-09) and is strictly
better.** No code changed.

`0188` covers everything here and two things it misses: it also names
`scripts/check-design-tokens.mjs`, which fails on the same two files for the same reason and which I
hit in this session as well without connecting the two, and it explains why `0142` deriving its scan
roots from disk is correct and must not be reverted. It also has the right warning count (1,090; I
estimated ~700 from a truncated log).

**Why the duplicate happened, since that is the part worth recording.** I filed this from a failing
gate without first searching the backlog for the symptom — `tickets.mjs next --all` lists 0188 by
almost exactly this title. Two minutes of looking would have replaced this ticket with a note. The
cost is not the wasted id; it is that a backlog with two entries for one bug reads as two bugs.

Nothing here is worth merging into `0188`: this ticket's only additions are a re-confirmation on
2026-09-11 and the `gate.yml` line numbers (lint at 71, build at 206), both of which `0188` already
states in substance.
