---
id: 197
slug: re-judge-the-run-polyline-s-legibility-against-the-parchment
title: Re-judge the run polyline's legibility against the parchment basemap
type: design
priority: low
status: open
size: s
capability: 15-two-map-modes-and-cold-territory
depends_on: []
blocked_by: []
source: agent
created: 2026-09-11T00:25:31Z
---

## Description

`0057` shipped §4.4's route pairing — `--route-glow` (`#ffb347`) under `--route-line` (`#fff2d0`)
— and the operator's verdict on the **stock** basemap was:

> *"a little hard to see with the light colored amber on white/gray of the map. However, I kind of
> like it since it's not too obtrusive."*

**That is the expected reading and it was correct not to act on it then.** §4.4 chose those two
colours to survive **parchment** and dark fog; `09-roadmap.md` §2.3 calls the stock Protomaps
`light` ground *"present but ugly"* on purpose, because colour work must never delay the reveal.
Judging a pairing against a background that is being replaced is how a palette drifts, and the
ticket that introduced them says in so many words not to retune.

This capability is where the right ground finally exists. **Look again, once, with parchment under
it** — and then either confirm the pairing or change it deliberately.

The two values live in `app/tokens.css` as `--lantern-500` and `--route-core`, carrying `0016`'s
comment *"FIXED BY 05-fog-of-war.md §4.4. DO NOT RETUNE."* If this ticket does retune them, that
comment and §4.4 both have to move with the code — the D-153 rule: either the code changes or the
doc changes, never neither.

## Options considered

**1. Confirm the pairing unchanged.** The likeliest outcome and the cheapest. `#ffb347` under
`#fff2d0` was specified *for* parchment; the only reason it has never been seen against parchment
is that the fork had not landed. If it reads well, this ticket costs one line in §4.4 saying so.

**2. Raise the core's contrast, keep the glow.** If the line still disappears, the core is the half
to move — it is the thing the eye tracks. Constraint: §4.4 rules out pure white explicitly ("blows
out on parchment"), so this is a walk toward `--parch-50` rather than to `#ffffff`, which
`check-design-tokens.mjs` bans outright anyway.

**3. Deepen the glow's amber.** Moves `--lantern-500` toward `--gold-500`. Risk: `--gold-500` is
the app's progress/level-up signal (`06-ui-ux.md` §8.2) and the route is not a progress bar. Two
things the same colour is how a palette stops meaning anything.

**4. Widen or darken-outline the core.** Rejected in advance unless 2 and 3 both fail — §4.4's
2.5 px is what keeps the line reading as a trace rather than as a drawn road, and an outline is a
third layer for a problem two are meant to solve.

## Acceptance criteria

- [ ] The route is looked at on the parchment basemap, at a zoom where the line crosses from
      revealed ground onto fogged ground in the same frame.
- [ ] **(operator)** A verdict is recorded: the pairing is confirmed as-is, or changed.
- [ ] If changed: `app/tokens.css`, `05-fog-of-war.md` §4.4 and `0016`'s "DO NOT RETUNE" comment
      are updated together, with a `D-xxx` recording why the original values did not survive their
      intended background.
- [ ] If confirmed: §4.4 gains one line saying the pairing was re-checked against parchment and
      held, so a third session does not re-open it.

## Notes

**Not a bug report.** `0057`'s operator validation records the observation and the reasoning for
deferring it; this ticket exists so the look is scheduled rather than remembered.

The glow is doing a second job the core cannot: making the line *findable* at a glance. If the
pairing does change, that division of labour is the constraint — a thin bright thread with no halo
fails the "findable at arm's length" test even when its contrast measures well.

`0085`'s permanent trace layer is a **different** visual (faint sepia, `--ink-300` at 0.28) and is
not in scope here.

## Open questions

- **Does the verdict differ between the two map modes?** §5 gives adventure and atlas different
  fog treatments, and §5.4 lists what the modes are *not* allowed to differ in. If the route needs
  a different colour per mode, that is a §5.4 question before it is a palette question.
- **Is the dark theme genuinely out of scope?** `0057` deliberately left `--route-glow` and
  `--route-line` out of both dark blocks, on §8.3's rule that the dark theme does not darken the
  map. The night-parchment basemap variant is this capability's, so that decision gets its first
  real test here rather than in `0057`.
- **Whose judgement settles it?** Contrast can be measured; *"not too obtrusive"* cannot. The
  operator already likes the current restraint, and a re-tune that wins a contrast check while
  losing that is a worse map.

## Operator validation

TODO — this ticket is almost entirely an operator judgement; the section is written when it is
worked, against whatever the parchment fork actually looks like.
