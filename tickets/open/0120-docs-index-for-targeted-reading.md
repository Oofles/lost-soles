---
id: 120
slug: docs-index-for-targeted-reading
title: docs/INDEX.md — a section map so design docs are read by section, never whole
type: docs
priority: high
status: open
size: s
capability: 00-preflight-and-repo
depends_on: [3]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The design set is ~13,000 lines across ten documents; `02-data-model.md` alone is 1,709.
Reading three of those whole costs most of a context window and leaves no room to actually work.
D-151 therefore forbids reading a design doc end to end — but that only works if finding the right
*section* is cheap. Right now it isn't: you have to open the file to find out what's in it.

Build `docs/INDEX.md`: one row per meaningful section across every design doc, with its
document, heading, line range, and a one-line summary of what it settles.

Generate it with a script (`scripts/build-index.mjs`) rather than by hand, so it cannot go stale —
line numbers move on every edit, and a section map that lies is worse than none.

## Acceptance criteria

- [ ] `scripts/build-index.mjs` walks `docs/*.md` plus `docs/contracts/`, extracting every `##` and
      `###` heading with its line range.
- [ ] One-line summaries are authored by hand once and preserved across regeneration (keyed by
      doc + heading, so re-running does not wipe them).
- [ ] `docs/INDEX.md` is generated, committed, and grouped by document.
- [ ] Rows carry line ranges so a section can be read with `sed -n 'A,Bp'` without opening the file.
- [ ] The PR gate (0013) regenerates the index and fails if it differs from what is committed.
- [ ] `CLAUDE.md` points at `docs/INDEX.md` as the first stop for design context, and states the
      D-151 rule: **read by section, never the whole document.**

## Notes

This is a small ticket with an outsized effect on every session that follows. It is placed in
capability `00` deliberately — it pays for itself by capability `02`.

Summaries should say what a section **settles**, not what it is about. "Defines the H3 projection"
is useless; "settles reveal radius at 65 m and why k=1 was rejected" is what makes the index worth
opening.

## Operator validation

Open `docs/INDEX.md` and, without opening any design doc, answer: where is the reveal radius
decided, where is the XP curve defined, and where does the webhook 2-second deadline get handled?
If the index cannot answer all three in under a minute, the summaries are too vague.
