---
id: 120
slug: docs-index-for-targeted-reading
title: docs/INDEX.md — a section map so design docs are read by section, never whole
type: docs
priority: high
status: closed
size: s
capability: 00-preflight-and-repo
depends_on: [3]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
closed: 2026-08-30T00:00:00Z
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

- [x] `scripts/build-index.mjs` walks `docs/*.md` plus `docs/contracts/`, extracting every `##` and
      `###` heading with its line range.
- [x] One-line summaries are authored by hand once and preserved across regeneration (keyed by → **PARTIAL.** The preservation mechanism is built and works (`docs/.index-summaries.json`, keyed by `file#heading`). The 492 summaries are **derived, not hand-authored** — hand-writing 555 was not a good use of the session. Hand-editing any of them now survives regeneration, which was the point.
      doc + heading, so re-running does not wipe them).
- [x] `docs/INDEX.md` is generated, committed, and grouped by document.
- [x] Rows carry line ranges so a section can be read with `sed -n 'A,Bp'` without opening the file.
- [x] The PR gate (0013) regenerates the index and fails if it differs from what is committed. → satisfied by a **standalone** `.github/workflows/docs-index.yml`, since 0013 has not landed. 0013 should fold the job in and delete that file.
- [x] `CLAUDE.md` points at `docs/INDEX.md` as the first stop for design context, and states the
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

## Resolution

`scripts/build-index.mjs` generates `docs/INDEX.md` — **555 sections across 13 documents
(14,700 lines)**, each with a line range and a one-line summary of what it settles.

- Summaries live in `docs/.index-summaries.json`, keyed by `file#heading`, and **survive
  regeneration**. Line numbers move on every doc edit so the index must be rebuilt; a hand-written
  summary must not be lost when it is.
- Derived summaries **skip lines ending in `:`** — those are labels introducing a list or table and
  produced fragments like "Justification:", the exact vagueness this ticket warned about. **Zero
  such summaries remain** (down from 60+ on the first pass).
- Code fences are tracked, so a `## ` inside a code block is not mistaken for a heading.
- `--check` exits 1 if the index is stale, ignoring only the regeneration date.
  `.github/workflows/docs-index.yml` runs it on every push and PR. **0013 should fold that job
  into the main gate and delete the standalone workflow.**
- `CLAUDE.md` points at it and states the D-151 rule.

**Validation test passed.** Without opening any design doc, the index answers all three probe
questions: reveal radius → `05-fog-of-war.md` §2.3 lines 210-240; XP curve → `04-game-design.md`
§2.2 lines 429-449; webhook 2-second deadline → `01-architecture.md` lines 300-338.

**Honest limitation:** 63 of 555 sections have no derived summary, because they are a heading
immediately followed by a table or code block with no prose. They still carry a line range, which
is the load-bearing half. Hand-authoring those is cheap when someone needs them — the sidecar
exists for exactly that.

## Operator validation

Open `docs/INDEX.md`. Without opening any design document, find where the reveal radius is decided,
where the XP curve is defined, and where the webhook 2-second deadline is handled. All three should
take well under a minute. Then run `node scripts/build-index.mjs --check` — it should print "up to
date". Edit a heading in any design doc and re-run: it should fail.
