---
id: 255
slug: self-host-spectral-and-inter-so-8-4-s-type-actually-renders
title: Self-host Spectral and Inter, so §8.4's type actually renders
type: feature
priority: med
status: closed
size: s
capability: 12-post-run-moment
depends_on: []
blocked_by: []
source: agent
created: 2026-10-13T21:04:35Z
started: 2026-10-14T15:09:07Z
closed: 2026-10-14T15:13:58Z
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

- [x] Spectral (600, and 400 italic for the chronicle line) and Inter (400, 500, 600) are served from
      this origin; a page load makes no request to any font CDN.
- [x] `--font-serif` and `--font-sans` tokens exist in `tokens.css`; `body` uses `--font-sans`.
- [x] The level-up card (`components/level-up-card.tsx`) uses `--font-serif` in place of its inline
      stack.
- [x] Tabular figures still apply everywhere `font-variant-numeric: tabular-nums` is set (both
      families support `tnum`).
- [x] *(widened 2026-10-14, operator's call)* Every other role §8.4 gives to Spectral uses
      `--font-serif` at weight 600: the Total Level number and the skill-level numbers on `/skills`
      tiles, the route titles (`/skills`, `/log`, `/run/:id`, `/settings`, the stubs), the skill
      sheet heading and the run ledger's heading — and the chronicle line (`run-lines.tsx`) drops its
      inline stack for the token.

## Notes

Found while closing `0082` (D-297): the card's Spectral was falling back to Georgia. Filed here
rather than widening `0082`. Font licences are OFL, so the files can be committed.

## Resolution

**Scope widened at the operator's direction (2026-10-14).** The ticket as filed covered only `body`
and the level-up card. Asked whether to file the remaining §8.4 Spectral roles separately, the
operator chose to fold them in. The fifth acceptance criterion records that.

**Files**
- `app/fonts/`: five Latin-subset `.woff2` files from Fontsource 5.3.0 (Spectral 600 and 400 italic;
  Inter 400, 500 and 600), plus each family's OFL text. Only the cuts §8.4 uses ship, about 117 KB
  in total.
- `app/layout.tsx`: two `next/font/local` instances with `variable` (`--font-spectral`,
  `--font-inter`) and `display: swap`, applied as classes on `<html>`. next/font adds size-adjusted
  fallback faces, so the swap does not shift layout. `local` rather than `google`, so the build
  fetches nothing either. Amplify's build container does not depend on Google being reachable.
- `app/tokens.css`: `--font-serif` and `--font-sans`, built on those variables with system fallbacks.
  A component test with no layout still gets a sane stack. `body` uses `--font-sans`.
- Spectral 600 via `var(--font-serif)`: the level-up card (its `SERIF` constant is now the token), the
  chronicle line (`run-lines.tsx`, same change), the tile skill levels and the Total Level number in
  `skills-panel.tsx`, the route titles (`/skills`, `/log`, `/run/:id`, both `/settings` branches,
  `components/stub.tsx`), both skill-sheet headings, and the run ledger's `RETURN FROM THE FOG`.
  Every tracked Spectral title is uppercase, which is §8.4's one allowed case.
- `app/skills/skills-panel.test.tsx`: the tabular-figures markup assertion now also pins the serif.

**Checked rather than assumed**
- `tnum` survives Fontsource's subsetting. I checked all five files with fontkit: Inter's digits go
  from nine advance widths to one under `tnum`, and Spectral's are tabular by default. The fourth
  criterion holds without any change.
- **Left alone on purpose:** section rules (`ACTIVITY`/`META`/`NEXT`) and `/settings`' card `h2`s,
  which §8.4 gives to Inter. The skill sheet's inline "Level N" is not the tile role. The ledger's
  `Total Level <strong>` line is a ledger row. Nothing else renders a tier name today.
- Only Latin subsets ship. Text outside Latin, such as an imported activity name, falls back to the
  system face. That is acceptable for a single English-speaking user.

## Operator validation

**Smoke test (agent, done).** `next build` on a clean copy, then `next start`:
- The CSS has five `@font-face` rules, all `src:url(/_next/static/media/…woff2)`. Each one returns
  `200 font/woff2` from the same origin.
- `/` renders `<html class="__variable_… __variable_…">`, and the stylesheet defines `--font-spectral`
  and `--font-inter`.
- No `src`/`href` in the page points to any external host. No `fonts.googleapis`, `gstatic`,
  `jsdelivr` or `unpkg` string appears anywhere in `.next/static` or `.next/server`.
- Every `amplify.yml` guard passes, including bundle-leak and home-not-in-client after the build.
  tsc and lint are clean. vitest: 3208 passed, plus the 158 CDK tests in the real repo.

**Perception check (operator, desktop browser; pending).** Open `/run/:id` → Relive. Is the level-up
card's name and number set in Spectral, and does it read well on the scrim? Does the chronicle line
read as Spectral italic? Do `/skills` (serif tile numbers and Total Level, serif `SKILLS` title) and
`/log` still read cleanly with Inter for everything else?

**Operator, desktop browser — verified 2026-10-15 (at the `12` audit): all perceptual checks above good.**
