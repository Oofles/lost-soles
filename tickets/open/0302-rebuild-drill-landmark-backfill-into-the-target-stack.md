---
id: 302
slug: rebuild-drill-landmark-backfill-into-the-target-stack
title: Rebuild drill: landmark backfill into the target stack
type: feature
priority: med
status: open
size: s
capability: 16-rebuild-drill
depends_on: []
blocked_by: []
source: agent
created: 2026-10-21T03:53:25Z
---

## Description

§8.3 step 6 (D-307) runs tools/landmarks/backfill-landmarks.ts after the XP replay, but that tool is hard-wired to the live tables, so a stack rebuilt by the drill (0103, D-406) would have no landmarks. Make the backfill accept the drill's target parameter and run it as part of the drill's step 6. Found by 0103.

## Acceptance criteria

- [ ] `tools/landmarks/backfill-landmarks.ts` accepts the drill's target (D-406) and writes only to
      the target's tables, refusing live names the same way the drill does.
- [ ] The drill's `--phase=rebuild` runs the backfill after step 6, before step 8.
- [ ] A test asserts a drill into an in-memory target produces the same landmark set as the live
      backfill over the same fixture history.

## Notes

Found by `0103` (wave 16.2). Should land before `0105` runs the drill for real, or `0105`'s rebuilt stack will have no landmarks.

## Operator validation

Smoke test, agent's to run: the in-memory rehearsal from `0103`, with the landmark count compared against the live `Landmark` table. No perceptual check.
