---
id: 212
slug: 09-roadmap-phone-validation-outside-9-5
title: 09-roadmap.md still assumes validation on the phone outside §9.5
type: chore
priority: low
status: open
size: s
capability: 12-post-run-moment
depends_on: []
blocked_by: []
source: agent
created: 2026-09-28T13:20:29Z
---

## Description

`0208` corrected `09-roadmap.md` §9.5 to name the **desktop browser** as the validation surface
(D-240, following D-227). Its criterion 5 kept that edit to §9.5 and required every other phone
assumption in the doc to be listed and left for a follow-up. This is that follow-up. Found
2026-09-28 by grepping `09-roadmap.md` for `phone|Android|device`:

1. **§3, capability `08`, row 8**: *"Perf harness against the §6.4 budget on a real mid-range
   Android phone"*. D-240 dropped the phone run for `0059`, which ran on the desktop.
2. **§3, capability `08`, Done when**: *"the §6.3 frame budget is met on the actual phone,
   measured, not assumed."* Same decision. Capability `08`'s drift audit will meet this line.
3. **§3, capability `12`, Done when**: *"the sequence runs in 8.4 s ± 0.3 s on the real phone"*.
   After D-240 this is measured on the desktop.
4. **§9.5's fourth row**, which `0208` deliberately left as it was: *"The `06-ui-ux.md` §9.6
   reality-check table passes: sunlight, one-handed reach, sweaty thumbs."* That table is premised
   on a phone held outdoors. D-227 records that `06-ui-ux.md` itself has this stale premise. This
   row needs a decision, not a respelling: drop it, restate it for the desktop, or keep it as an
   in-use observation the operator raises (D-240's framing).

**Not stale**, so leave these alone: every capture-side reference (the quick-capture tile, GPSLogger,
Health Connect, *"a run finished on the phone appears on the map"* in §9.4). D-124 and D-227 keep
the phone as the **capture** device, and those lines are about capture.

## Acceptance criteria

- [ ] Items 1–3 name the desktop browser and cite D-240, keeping D-124's capture role where the
      line mentions it.
- [ ] Item 4 is resolved by an explicit choice the operator agrees to, and recorded in the doc.
- [ ] Capture-side references are unchanged.
- [ ] `docs/INDEX.md` (and `docs/.index-summaries.json` if a summary quotes the old wording) is
      regenerated.

## Notes

Filed by the agent from `0208`, 2026-09-28. Placed in capability `12` because `0208`'s Notes
expected `09-roadmap.md` to be reopened when capability `12` brings the post-run sequence into
scope. Filing it under `08` would also have added an open ticket in front of `08`'s drift audit
for a doc edit that can wait. Item 2 is worth raising **during** that audit rather than after it.

Related: `0208`, `0059`, D-124, D-227, D-240.

## Operator validation

None: a design-doc correction with no runtime behaviour. The check is a review of the diff against
D-240.
