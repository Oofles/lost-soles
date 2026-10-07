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
started: 2026-10-07T23:16:45Z
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

- [x] An automated contrast check runs over the `/skills` and `/skills/:skillId` token pairs and
      fails the build on any text below **4.5:1** (or 3:1 for text ≥ 24sp / bold ≥ 18.66sp).
- [x] No gold token is used as a text colour below 24sp anywhere on either screen.
- [x] Any gold text at ≥ 24sp sits on navy, or passes 3:1 against its actual background —
      measured against the rendered background, including the parchment texture's darkest and
      lightest sampled points, not the flat token.
- [x] Skill names, unit labels, section headings, the `NEXT` line and all sheet body copy use ink
      tokens, never gold.
- [x] The pinned header, the app bar and the sheet header are **fully opaque**; a test asserts no
      alpha < 1 and no backdrop blur on floating chrome.
- [x] Progress-bar fills use ~~`--gold-500`~~ `--gold-700` *(D-291 — `--gold-500` measures 2.24:1
      and cannot satisfy the rest of this criterion)* (activity) and `--verdigris-500` (meta), and both pass
      3:1 against the tile background as non-text meaningful graphics.
- [x] The activity/meta distinction is **not colour-only**: section headings remain, and the
      distinction is announced to assistive technology.
- [x] The screens are checked at 200% browser zoom and the browser's largest font size; nothing becomes unreadable and nothing clips.
- [x] Level figures use tabular figures and remain legible at 24sp on the tile.
- [x] Any exception found and accepted is recorded in the ticket's resolution with its measured
      ratio, so it is a decision rather than an oversight.

## Notes

The trap this decision protects against is that gold *looks* right in a mockup on a bright desk
monitor ~~and fails on a phone held at arm's length in a stairwell after a run — which is the only
context this app is actually used in~~ *(D-251, 0215)*. Measure it on the rendered page in the
desktop browser, not in the design tool.

Opaque chrome is a bigger visual compromise than it sounds like and it is still the right call:
a translucent pinned header over a scrolling grid has a *different* contrast ratio at every
scroll offset, so it cannot be verified at all.

## Resolution

**Files.** `scripts/check-contrast.mjs` (new) · `app/skills/contrast.test.tsx` (new) ·
`app/tokens.css` · `app/skills/skill-sheet.tsx` · `app/skills/skills-panel.tsx` ·
`.github/workflows/gate.yml` · `amplify.yml` · `docs/06-ui-ux.md` §5.3 rule 5 and §8.3 ·
`docs/decisions/DECISIONS.md` (D-291).

**The check is two halves, because neither alone proves the criterion.**
- `scripts/check-contrast.mjs` parses `app/tokens.css`, resolves the semantic layer through its
  `var()` chains in **both themes** (and fails if the media-query and `[data-theme=dark]` dark
  blocks ever disagree), and measures a *declared* list of the pairs the two screens draw: three
  text tokens on `--bg` / `--surface` / `--surface-raised` at 4.5:1, both progress fills and the
  crest as graphics at 3:1. 28 pairs; any shortfall exits 1. `--self-test` proves it rejects
  `--gold-500` on parchment as text (2.07:1). Wired into the GitHub gate **and** `amplify.yml`
  (D-163: the Amplify run is the lock). No large-text pair is declared, because no gold text
  ships at any size — the 3:1 large-text threshold exists in the script but nothing uses it.
- `app/skills/contrast.test.tsx` holds the other half: that the screens draw ONLY declared pairs.
  It parses both screens' static markup (panel with every section, sheet for an activity and a
  meta skill with `ON THE MAP` populated), walks every text run with the colour, background and
  font size it actually inherits, and asserts each run is a measured pair, gold only ≥ 24px,
  every gold-coloured element owns no text, nothing below 12px, the pinned header and the dialog
  have token backgrounds that resolve to alpha 1 in both themes, and no `backdrop-filter`,
  `opacity`, `rgba`/`hsla` or `transparent` appears anywhere in either screen. Mutation-checked:
  putting `→ fly to` back in `--accent-text` and adding a backdrop blur to the dialog fails four
  tests with the right messages.

**What was wrong, and the fixes.**
- **This ticket's own criterion 6 was unsatisfiable.** It asked for `--gold-500` activity bars
  *and* 3:1 against the tile; `--gold-500` on `--parch-50` is **2.24:1**. The checker found it on
  its first run. Asked the operator (D-152): retune light `--progress-activity` to `--gold-700`
  (**3.95:1**) — **D-291**, criterion amended in place with a strike-through. ΔE76 gold-700 vs
  verdigris-500 is 58.5, and 52–53 under simulated protan/deutan/tritan (Machado 2009) — still
  clearly separable. Reach: `/log`'s post-save bar uses the same token and inherits it. The Total
  Level rung bar in the pinned header is an activity-tinted `Bar` too, so it darkened with it.
- `skill-sheet.tsx` `ON THE MAP`: `◈` and `→ fly to` were `--accent-text` (gold-700) at 16px — gold
  type below 24sp. Now `--text-secondary` (glyph, also `aria-hidden`) and `--text-primary` with an
  underline, so the button still reads as an action without colour. The section ships empty
  (D-290), so this was latent rather than visible.
- Tile accessible names now carry the kind — `Wayfaring, level 15, activity skill` — so the
  activity/meta distinction reaches assistive technology even for an Untrained tile, which sits
  outside the `ACTIVITY`/`META` regions. The headings stay.

**Already compliant, verified rather than changed:** the pinned header was `var(--bg)` (opaque); the
sheet is `var(--surface-raised)` (opaque) over a translucent `--scrim` — the scrim is the backdrop,
not floating chrome, and no text sits on it; tile levels were 24px `tabular-nums` `--text-primary`;
the crest is a stroked SVG in `--accent-text`, a mark not type, measured as a graphic at 3.95:1.
Dark theme: every pair passes, lowest `--text-muted` on `--surface-raised` at 5.02:1.

**Accepted exceptions, with ratios (criterion 10):**
- **No parchment texture exists to sample.** Criterion 3 asks for the texture's darkest and lightest
  sampled points; every surface on both screens is a flat token fill, so the flat token is the
  rendered background (confirmed by computed style in Chromium). The script's header says a texture,
  when one lands, joins `BACKGROUNDS` as its sampled extremes.
- `--text-muted` on `--bg` (light) is **4.81:1** — the floor §8.3 already names; passes, noted
  because it is the closest margin on either screen.
- The bar *track* (`--line`, translucent) is not measured against the fill; the criterion and WCAG
  1.4.11 measure the fill against the adjacent tile, which it passes.

**Went wrong on the way:** the first token edit silently missed (a Python `replace` keyed on a `}`
that was not adjacent), so the first test run still saw 2.24:1 — caught by the test, fixed with an
exact edit. The markup walker initially treated `<path>` as void while React writes `</path>`, which
popped the stack early and attributed sheet text to the scrim; fixed by pushing on everything not
written `/>`.

## Operator validation

**Agent, headless Chromium over CDP, 2026-10-07 (WSL)** — `tmp/0077/drive.mjs`: the shipped
`SkillsPanel` + `SkillSheet` bundled over the live SkillState/ledger from 0074, with the current
`tokens.css`. Cases: panel at 100%, 200% zoom, largest font (24px default) at 100% and 200%, dark;
sheet at 100%, 200% + largest font, dark. In **every** case: no horizontal scroll; no text element
overflowing its box or its tile; the pinned header and dialog compute `opacity: 1`, `backdrop-filter:
none`, opaque backgrounds (`rgb(245,237,217)` / `rgb(251,246,233)` light, `rgb(11,16,32)` /
`rgb(26,34,55)` dark); minimum text 12px (18px at largest font); tile level `24px tabular-nums
rgb(20,22,28)` (36px at largest font); bar fills compute to `rgb(151,118,26)` (gold-700) and
`rgb(62,124,114)` (verdigris-500) light, `gold-300`/`verdigris-300` dark. The header's computed
background is the same opaque value at every scroll offset. Screenshots read cleanly at 200% +
largest font — every name and level legible, nothing clipped.
`node scripts/check-contrast.mjs` → 28 pairs pass; full suite 2,926 passed.

**Operator, desktop browser — pending.** In the desktop browser, on **`/skills`**: read every skill name and every level; anything you
have to squint at fails. Scroll the grid under the pinned
header and confirm the header's text never changes legibility as content passes behind it — if it
does, the header is not opaque. Repeat at 200% zoom and confirm nothing
clips or overlaps.
