---
id: 255
slug: self-host-spectral-and-inter-so-8-4-s-type-actually-renders
title: Self-host Spectral and Inter, so §8.4's type actually renders
type: feature
priority: med
status: open
size: s
capability: 12-post-run-moment
depends_on: []
blocked_by: []
source: agent
created: 2026-10-13T21:04:35Z
---

## Description

`06-ui-ux.md` §8.4 fixes two families, both **self-hosted**: Spectral (display numerals, level
headings, tier names, the chronicle line) and Inter (all UI). Nothing in the app loads either.
`app/layout.tsx` has no font setup, `tokens.css` has no `@font-face`, and every page renders in the
browser's default sans.

`0082`'s level-up card names Spectral with a Georgia fallback, so today it renders in Georgia.
`0083`'s chronicle line is specified as Spectral Italic 17sp and will hit the same gap.

Ship the two families self-hosted (`next/font/local` or `@font-face` over files in `public/`, no
third-party CDN: §4.8 and `0113`'s "no third-party requests at runtime"). Expose them as tokens, and
set Inter as the body face and Spectral where §8.4 assigns it.

## Acceptance criteria

- [ ] Spectral (600, and 400 italic for the chronicle line) and Inter (400, 500, 600) are served from
      this origin; a page load makes no request to any font CDN.
- [ ] `--font-serif` and `--font-sans` tokens exist in `tokens.css`; `body` uses `--font-sans`.
- [ ] The level-up card (`components/level-up-card.tsx`) uses `--font-serif` in place of its inline
      stack.
- [ ] Tabular figures still apply everywhere `font-variant-numeric: tabular-nums` is set (both
      families support `tnum`).

## Notes

Found while closing `0082` (D-297): the card's Spectral was falling back to Georgia. Filed here
rather than widening `0082`. Font licences are OFL, so the files can be committed.

## Operator validation

In the desktop browser, open `/run/:id` → Relive: is the level-up card's name and number set in
Spectral and does it read well on the scrim; do `/skills` and `/log` still read cleanly in Inter?
