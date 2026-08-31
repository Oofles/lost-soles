---
id: 77
slug: gold-leaf-and-contrast-compliance
title: Gold-leaf and contrast compliance on the skills panel (D-148)
type: feature
priority: med
status: open
size: s
capability: 11-skills-panel
depends_on: [73, 74, 75]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

**D-148: gold leaf is a FILL and a RULE, never body text.** Gold on parchment measures about
**2.1:1** — it is a beautiful surface and an unreadable typeface. The decision states the three
constraints that follow:

1. **Gold is a fill and a rule.** Progress-bar fills, tile borders, hairlines, the crest, the
   milestone wipe — yes. Labels, numbers, sentences — no.
2. **Gold type only at ≥ 24sp, or on navy.** The Total Level headline and a 24sp tile level may
   be gold *if* the contrast against their actual background passes; body copy, section labels,
   skill names, unit labels and the `NEXT` line may not.
3. **All floating chrome is opaque.** No translucent app bar, no scrim-blurred pinned header, no
   semi-transparent sheet header. Translucency over a parchment texture is how a passing contrast
   ratio becomes a failing one at a random scroll position.

This ticket audits `/skills` and `/skills/:skillId` against the `06-ui-ux.md` §8 tokens and fixes
what fails. It is the last ticket in the capability on purpose: it audits finished screens.

The panel's colour system also carries meaning (0075 rule 5): activity bars `--gold-500`, meta
bars `--verdigris-500`. Those two must remain distinguishable **and** each must pass against the
tile background — a tint that carries information cannot be the only carrier if it fails contrast
for a colour-vision-deficient reader, so the section headings and the sheet stay as the
non-colour path.

## Acceptance criteria

- [ ] An automated contrast check runs over the `/skills` and `/skills/:skillId` token pairs and
      fails the build on any text below **4.5:1** (or 3:1 for text ≥ 24sp / bold ≥ 18.66sp).
- [ ] No gold token is used as a text colour below 24sp anywhere on either screen.
- [ ] Any gold text at ≥ 24sp sits on navy, or passes 3:1 against its actual background —
      measured against the rendered background, including the parchment texture's darkest and
      lightest sampled points, not the flat token.
- [ ] Skill names, unit labels, section headings, the `NEXT` line and all sheet body copy use ink
      tokens, never gold.
- [ ] The pinned header, the app bar and the sheet header are **fully opaque**; a test asserts no
      alpha < 1 and no backdrop blur on floating chrome.
- [ ] Progress-bar fills use `--gold-500` (activity) and `--verdigris-500` (meta), and both pass
      3:1 against the tile background as non-text meaningful graphics.
- [ ] The activity/meta distinction is **not colour-only**: section headings remain, and the
      distinction is announced to assistive technology.
- [ ] The screens are checked at the system's largest font scale and in dark ambient conditions
      with the device at minimum brightness; nothing becomes unreadable and nothing clips.
- [ ] Level figures use tabular figures and remain legible at 24sp on the tile.
- [ ] Any exception found and accepted is recorded in the ticket's resolution with its measured
      ratio, so it is a decision rather than an oversight.

## Notes

The trap this decision protects against is that gold *looks* right in a mockup on a bright desk
monitor and fails on a phone held at arm's length in a stairwell after a run — which is the only
context this app is actually used in. Measure it on the device, not in the design tool.

Opaque chrome is a bigger visual compromise than it sounds like and it is still the right call:
a translucent pinned header over a scrolling grid has a *different* contrast ratio at every
scroll offset, so it cannot be verified at all.

## Operator validation

On **`/skills`** on the **Pixel 8 Pro**, at **minimum screen brightness, outdoors at dusk, held
at arm's length, straight after a run**: read every skill name and every level. Anything you have
to squint at, tilt the phone for, or shade with your hand fails. Scroll the grid under the pinned
header and confirm the header's text never changes legibility as content passes behind it — if it
does, the header is not opaque. Repeat with the system font scale at maximum and confirm nothing
clips or overlaps.
