---
id: 297
slug: cold-territory-at-coarse-zooms
title: Show cold territory at coarse zooms
type: design
priority: low
status: closed
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-20T13:32:52Z
closed: 2026-10-26T20:04:30Z
---


## Description

`0100`'s cold wash is clipped by `smoothstep(0.0, 0.25, coverage - 0.75)` (D-147), so it only
paints where mask coverage exceeds 0.75. Below z14 the discs are coarse parents (res 10, 9, 8…,
D-390), and a sparsely explored parent rarely reaches 0.75 coverage, so cold ground mostly
disappears when zoomed out — exactly the zoom at which someone plans a Saturday route across a
region. Decide whether cold territory should read at coarse zooms, and how, without breaking the
clip rule's guarantee that cold never touches the frontier.

## Acceptance criteria

- [x] A decision is recorded (`D-xxx`) on whether cold ground shows below z14, and by what rule.
      D-452: it does not; the existing clip stands.
- [x] (Not applicable: D-452 chose not to show it.) If it does, the chosen rule keeps cold ground two cell-widths (at that bucket) inside the
      drawn edge, with a shader test as `0100` has.

## Options considered

- Leave it: cold is a z14+ planning aid; at coarse zooms the frontier is the whole story.
- Scale the clip threshold per bucket, so a coarse parent's interior can wash.
- Wash coarse parents only when every child is cold *and* coverage passes a lower bucket-specific
  floor.

## Open questions

- Does the operator plan routes zoomed out, or always at street zoom? *Answered by the decision:
  cold ground is a street-zoom reading (D-452).*

## Notes

Filed by the orchestrator from `0100`'s report (wave 15.3, 2026-10-20). Filed in `18` rather than
`15` so it does not hold capability 15's audit; it is an enhancement, not a defect of `0100`.

## Operator validation

**None owed.** The decision keeps the shipped behaviour, so no pixel changed and nothing was
deployed. The original check ("is cold ground visible at z12–z13") now has a known, intended answer:
mostly no. `0100`'s shader test for the two-cell-width clip still guards the rule that stands.

## Resolution

**Decided by the operator, 2026-10-26, at wave 18.5's planning: option 1, "leave it" (D-452).**

The orchestrator offered three routes: have an agent investigate and propose options, record
"cold stays hidden below z14", or hold the ticket. The operator chose to record it. Cold ground
answers whether a street is worth 50% again, which is a street-zoom question. Lowering the clip
threshold per bucket (option 2) or adding a coarse-only floor (option 3) would both loosen the
guarantee that keeps cold off the frontier (D-147), for a reading nobody had asked for at region
scale. A region-scale "neglected ground" view, if ever wanted, is its own design.

No code changed. Files touched: `docs/decisions/DECISIONS.md` (D-452), `docs/05-fog-of-war.md`
§8.5's settled note.
