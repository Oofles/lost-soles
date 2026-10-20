---
id: 297
slug: cold-territory-at-coarse-zooms
title: Show cold territory at coarse zooms
type: design
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-20T13:32:52Z
---


## Description

`0100`'s cold wash is clipped by `smoothstep(0.0, 0.25, coverage - 0.75)` (D-147), so it only
paints where mask coverage exceeds 0.75. Below z14 the discs are coarse parents (res 10, 9, 8…,
D-390), and a sparsely explored parent rarely reaches 0.75 coverage, so cold ground mostly
disappears when zoomed out — exactly the zoom at which someone plans a Saturday route across a
region. Decide whether cold territory should read at coarse zooms, and how, without breaking the
clip rule's guarantee that cold never touches the frontier.

## Acceptance criteria

- [ ] A decision is recorded (`D-xxx`) on whether cold ground shows below z14, and by what rule.
- [ ] If it does, the chosen rule keeps cold ground two cell-widths (at that bucket) inside the
      drawn edge, with a shader test as `0100` has.

## Options considered

- Leave it: cold is a z14+ planning aid; at coarse zooms the frontier is the whole story.
- Scale the clip threshold per bucket, so a coarse parent's interior can wash.
- Wash coarse parents only when every child is cold *and* coverage passes a lower bucket-specific
  floor.

## Open questions

- Does the operator plan routes zoomed out, or always at street zoom?

## Notes

Filed by the orchestrator from `0100`'s report (wave 15.3, 2026-10-20). Filed in `18` rather than
`15` so it does not hold capability 15's audit; it is an enhancement, not a defect of `0100`.

## Operator validation

Desktop browser, atlas, at z12–z13 over ground last run 6+ months ago: is cold ground visible and
still clearly separate from the frontier?
