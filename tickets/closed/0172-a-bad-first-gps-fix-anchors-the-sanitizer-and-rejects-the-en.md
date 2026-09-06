---
id: 172
slug: a-bad-first-gps-fix-anchors-the-sanitizer-and-rejects-the-en
title: A bad first GPS fix anchors the sanitizer and rejects the entire trace behind it
type: bug
priority: med
status: closed
size: s
capability: 05-strava-adapter
depends_on: []
blocked_by: []
source: agent
created: 2026-09-06T00:45:43Z
closed: 2026-09-06T04:44:08Z
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

- [x] A trace whose FIRST fix is an outlier keeps the real track and drops the outlier,
      rather than the reverse.
- [x] The fix does not weaken the ordinary case: a mid-trace 400 m jump still drops exactly
      the offending fix and keeps both neighbours, and a clean trace is still untouched.
- [x] `sanitize.test.ts`'s existing "loses the whole trace to a bad FIRST fix" test is
      inverted rather than deleted — it becomes the regression test.
- [x] Whatever heuristic is chosen is a named constant with its reasoning, like the gate it
      sits beside, and `03-integrations.md` §2.2 is amended to describe it (D-153).
      — `ANCHOR_CORROBORATION_LOOKAHEAD = 1`. The Notes predicted option (1) *"is the only
      one that needs no new constant"*, and that was very nearly right: the lookahead DEPTH
      is the single tunable, so it is named rather than inlined as a `2` and a `[2]`, and
      the comment says why raising it is not free.
- [x] Any activity already ingested with an implausible `rejectedPoints` ratio is
      re-normalized from the archive, and the ticket records how many there were.
      — **Zero, and verifiably so: nothing has ever been ingested.** There is no `Activity`
      table (`amplify/data/resource.ts` is still the skeleton — *"the real models arrive with
      capabilities 04-06"*), no raw-archive bucket among the ten in the account, and the
      pipeline that would write either is ticket `0039`, still gated on this capability's
      audit. Checked rather than assumed; see Operator validation.

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

## Resolution

**Files touched:** `src/adapters/strava/sanitize.ts` (the fix), `sanitize.test.ts` (the
inverted regression test plus six more), `docs/03-integrations.md` §2.2, `DECISIONS.md`
(**D-201**), `docs/INDEX.md`.

**The fix is Notes option (1), unchanged after measuring.** A fix earns the anchor by being
corroborated, and one plausible step is corroboration: `p0 -> p1` plausible → start at `p0`;
implausible but `p1 -> p2` plausible → `p0` is the outlier, discard it; neither plausible →
fall back to §2.2 as written. **The third branch is the one worth defending.** When nothing
is corroborated the evidence does not name a culprit, and guessing there would trade a known
behaviour for an arbitrary one.

**The Notes were very nearly right that this needs no constant.** The lookahead *depth* is
the one tunable, so `ANCHOR_CORROBORATION_LOOKAHEAD = 1` is named rather than left as a bare
`2` and a `[2]` in the code. Depth 1 is not just the cheap option: it can discard at most the
FIRST fix, which bounds the cost of being wrong at exactly one point. A deeper lookahead can
discard a genuine start — a run that begins with a sprint out of a doorway looks, from far
enough away, like a lead-in of noise.

**I measured the damage rather than restating the ticket's estimate, and the ticket
overstates it for long traces.** A 400 m cold fix against the 12.5 m/s gate rejects roughly
`400 / 12.5 = 32` seconds of trace, because the anchor stays put while each successive fix is
further away in *time* — so the implied speed falls back under the gate on its own. The whole
trace is lost only when the trace is shorter than that, which is what the 10-point
reproduction is. On the real 2,537-point capture: 31 fixes lost before, 1 after. That does not
make it less of a bug — 31 fixes is 31 seconds of unrevealed ground plus a manufactured break
— but "the entire trace is rejected" is the short-trace case, not the general one.

**Fixed in `sanitize.ts` rather than per adapter**, as the Notes argue: every "compare
against the previous accepted value" filter has this weakness at its boundary, so D-112
(GPSLogger) and D-113 (Health Connect) inherit it the moment they share this file.

**Criterion 5 turned out to be vacuous, and I checked rather than assumed.** There are no
already-ingested activities to re-normalize: no `Activity` table exists, no raw-archive
bucket exists, and the pipeline that writes either is `0039` — still gated on this
capability's audit. Recorded as a verified zero, not waved away.

**What this fix is NOT validated against.** Sweeping 53 real activities found exactly **one**
bad first fix in six years of data (`19831578054`, 12.7 m/s at index 1), and it is a marginal
fix rather than a 400 m cold start — either reading costs one point there, so the fix is not
what rescues it. The severe case is real and well understood, but it has not yet occurred on
this account, so the 400 m evidence is an injection into a real trace rather than an
observation. Said plainly because a test built from an injected fault is weaker evidence than
one built from a captured one, and this repo has been bitten by that distinction before
(`0165`).

## Operator validation

**No operator step is required, and the reason is a verified fact rather than a judgement.**
This ticket reserved one thing for the operator: *"if any already-ingested activity turns out
to have a high `rejectedPoints` ratio, the operator is the only one who can say whether the
re-normalized route looks like the run they actually did."* **Nothing has ever been
ingested**, so there is no route to look at.

Verified by the agent with the `devault` profile:

| Check | Result |
|---|---|
| `aws dynamodb list-tables` | 5 tables: two `DeploySmokeTest`, `LostSolesCaptureGuard`, `LostSolesOAuthState`, `LostSolesSourceAccount`. **No activity table.** |
| `aws s3 ls` | 15 buckets, **no raw archive** among them. |
| `amplify/data/resource.ts` | Still the skeleton — *"the real models (Activity, …) arrive with capabilities 04-06"*. |

**Smoke test — the fix against real captured traces**, not against synthetic ones:

| Case | Before (§2.2 as written) | After (D-201) |
|---|---|---|
| Real 2,537-point trace, 400 m cold fix injected at index 0 | kept **2,506**, rejected 31 | kept **2,536**, rejected 1, breaks 0 — **30 fixes recovered**, anchor moved to index 1 |
| The same trace, clean | kept 2,537, rejected 0 | **identical** — anchor index 0, the ordinary branch |
| The same trace, 400 m jump at index 1200 | 1 rejected, 1 break | **1 rejected, 1 break** — unchanged, as criterion 2 requires |

**All five real captured fixtures re-normalized** through the patched sanitizer:
`real-run-outdoor` 2,537 points / 0 rejected · `real-run-dst-boundary` 3,114 / 0 ·
`real-run-signal-loss` 3,145 / **8 rejected, 7 gaps** (the genuine GPS jumps this fixture was
captured for) · the two GPS-less fixtures unchanged at 0.

**Local gate:** `npm test` **877 passed, 1 skipped, 43 files** · `npm run typecheck` clean ·
`npm run lint --max-warnings 0` clean · `check-boundaries` and `check-fixture-geography`
clean · `build-index --check` up to date.

