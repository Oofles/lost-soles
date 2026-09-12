---
id: 208
slug: 09-roadmap-md-9-5-still-names-the-android-phone-that-d-240-r
title: 09-roadmap.md §9.5 still names the Android phone that D-240 removed
type: chore
priority: low
status: open
size: s
capability: 08-map-and-fog-renderer
depends_on: []
blocked_by: []
source: agent
created: 2026-09-12T16:38:36Z
---

## Description

`09-roadmap.md` §9.5 — *"the product, on the actual device"* — opens by requiring the checks be run
on **"the user's own Android phone (D-124), not a simulator"**. **D-240 removed the phone from this
project's validation surface entirely**, and D-227 had already made the desktop browser the viewing
surface before that.

So the doc now instructs something a decision forbids. `0059` ran §9.5's table on the desktop and
recorded the divergence on its own criterion rather than editing the roadmap mid-ticket, which is
the right call for a ticket that must not widen — but it leaves the contradiction sitting in the
design doc, where the next reader meets it with no context.

**This is a documentation correction, not a change of behaviour.** Nothing about how §9.5 is run
changes; what changes is that the doc says what is actually done.

Two of §9.5's six rows are also out of scope until later capabilities, and `0059` recorded that too:
the post-run sequence does not exist yet (capability `12`) and D-148's gold/chrome rules belong to
capability `13`. Whether §9.5 should mark those rows itself, or whether that stays a per-milestone
judgement, is the one open question here — the amendment should not quietly turn a six-row table
into a four-row one for every future milestone.

D-124 is *not* being superseded: it is about which device the operator actually carries, and it
remains true. What D-240 changed is which device this project *validates on*. The amendment must
keep that distinction rather than deleting the D-124 reference.

## Acceptance criteria

- [ ] §9.5's preamble names the **desktop browser** as the validation surface, cites **D-240**, and
      no longer instructs the operator to use a phone.
- [ ] The D-124 reference survives in a form that still says what it says — the operator's own
      Android phone is the target device — without implying validation happens there.
- [ ] The two out-of-scope-until-later rows are handled explicitly, one way or the other, with the
      choice stated in the doc rather than left to the reader.
- [ ] `docs/INDEX.md` is regenerated if §9.5's line numbers move.
- [ ] No other section of `09-roadmap.md` is edited. If one is found to have the same phone
      assumption, it is listed in `## Notes` and left for a follow-up rather than folded in.

## Notes

Filed by the agent from `0059` on 2026-09-12, at the point the operator signed off §9.5's table on
the desktop. `0059`'s criterion 10 carries the same note and points here.

Related decisions, in the order they moved the line: **D-124** (the operator's device is an Android
phone) → **D-227** (the desktop browser is the viewing surface for validation) → **D-229** (operator
validation is perception only, and no constructed scenarios) → **D-240** (there is no phone run for
`0059`; the Pixel 10 Pro is not the mid-range Android §6.3's budget was written for).

Low priority deliberately: the contradiction misleads a reader but blocks nothing, and `09-roadmap.md`
will be opened anyway when capability `12` brings the post-run sequence into scope. Worth doing then
if not before.

## Operator validation

None — a design-doc correction with no runtime behaviour. The check is that §9.5 reads correctly and
agrees with D-240, which is a review of the diff rather than something to observe on a screen.
