---
id: 172
slug: a-bad-first-gps-fix-anchors-the-sanitizer-and-rejects-the-en
title: A bad first GPS fix anchors the sanitizer and rejects the entire trace behind it
type: bug
priority: med
status: open
size: s
capability: 05-strava-adapter
depends_on: []
blocked_by: []
source: agent
created: 2026-09-06T00:45:43Z
---

## Description

`03-integrations.md` §2.2's sanitation algorithm anchors on *"the previous **accepted**
point"*, and the first fix of a trace is always accepted because there is nothing to compare
it against. So a cold-start fix that is 400 m off becomes the anchor, and every genuine fix
behind it looks impossible relative to it — **the entire trace is rejected**, one point at a
time, and the activity ends up with a single point or none at all.

A cold GPS fix hundreds of metres out is the ordinary behaviour of a watch that has been
indoors, which makes this the *first* run after a break rather than an exotic case.

**This is §2.2's algorithm implemented exactly as specified**, and it was implemented that
way on purpose in `0037` rather than quietly improved — a sanitizer that silently diverges
from the document that justifies it is worse than one with a known bound. The behaviour is
asserted in `sanitize.test.ts` ("loses the whole trace to a bad FIRST fix, which is why
rejected is reported") so it is a recorded fact rather than a surprise.

**What ships today as mitigation.** `SourceRef.meta.rejectedPoints` carries the count
(D-197), so a trace that lost 98% of its fixes is loud rather than silently empty. That
turns a silent data-loss bug into a visible one; it does not fix it.

**Why it is not urgent.** Under-revealing is recoverable and over-revealing is not (D-020) —
this fails in the safe direction, and the raw payload is archived immutably (D-101), so any
affected activity can be re-normalized from the archive once this is fixed. Nothing is lost
permanently. But the operator would see a run with no map and no explanation.

## Acceptance criteria

- [ ] A trace whose FIRST fix is an outlier keeps the real track and drops the outlier,
      rather than the reverse.
- [ ] The fix does not weaken the ordinary case: a mid-trace 400 m jump still drops exactly
      the offending fix and keeps both neighbours, and a clean trace is still untouched.
- [ ] `sanitize.test.ts`'s existing "loses the whole trace to a bad FIRST fix" test is
      inverted rather than deleted — it becomes the regression test.
- [ ] Whatever heuristic is chosen is a named constant with its reasoning, like the gate it
      sits beside, and `03-integrations.md` §2.2 is amended to describe it (D-153).
- [ ] Any activity already ingested with an implausible `rejectedPoints` ratio is
      re-normalized from the archive, and the ticket records how many there were.

## Steps to reproduce

1. Build a 10-point track at walking pace.
2. Move point 0 by 400 m.
3. `sanitizeTracePoints(points, "run")` returns `{ points: [the bad fix], rejected: 9 }`.

## Expected vs actual

**Expected:** one bad fix costs one fix.

**Actual:** one bad fix at index 0 costs the whole trace, and the surviving point is the
wrong one.

## Notes

Three candidate shapes, none of them expensive:

1. **Anchor on the first PLAUSIBLE PAIR.** Look ahead: if fix 0 → 1 is implausible but
   1 → 2 is fine, fix 0 was the outlier, not fix 1. Cheap, local, and it fixes the exact
   case without touching the steady state.
2. **Re-anchor after N consecutive rejections.** If the gate rejects several in a row, the
   anchor is more likely wrong than the stream is. Simple, but N is a magic number and it
   would also re-anchor on a genuine long tunnel.
3. **Median-of-first-k start.** Take the first few fixes and start from their spatial
   median. More robust, more machinery, and it can move the recorded start of the run.

(1) looks best and is the only one that needs no new constant.

Worth noting the general shape: any "compare against the previous accepted value" filter has
this weakness at its boundary, so whichever adapter lands next (D-112 GPSLogger, D-113 Health
Connect) inherits it if the sanitizer is shared. That argues for fixing it in
`sanitize.ts` rather than per adapter.

## Operator validation

**One thing genuinely needs the operator, and only after a fix.** If any already-ingested
activity turns out to have a high `rejectedPoints` ratio, the operator is the only one who
can say whether the re-normalized route looks like the run they actually did — the agent can
verify the point count recovered, not that the shape is right.

Everything before that is a smoke test: querying stored activities for the ratio, and
re-running `normalize` over the archived bytes, are both scriptable with AWS credentials.
