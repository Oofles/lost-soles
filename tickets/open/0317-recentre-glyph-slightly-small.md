---
id: 317
slug: recentre-glyph-slightly-small
title: The ⌖ recentre glyph is slightly small inside its button
type: chore
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: operator
created: 2026-10-26T13:41:13Z
started: 2026-10-26T20:52:53Z
---

## Description

The operator's perceptual check for `0112` (2026-10-26, desktop browser, deployed app): the `⌖`
recentre control renders as a crosshair, correctly, but the glyph sits small inside its 40×40 button
and should be slightly larger. `.map-control` sets `font-size: 18px` for every map control
(`components/map/map-controls.tsx`, `MAP_CONTROLS_CSS`); `⌖` reads smaller at that size than
fit-to-territory's `⤢` does.

## Acceptance criteria

- [x] The `⌖` glyph is enlarged inside its button. The button stays 40×40 (D-313), and the other
      map controls' glyphs are unchanged.
- [x] (operator) In the desktop browser, `⌖` reads at a comparable visual weight to `⤢` beside it.
      — verified 2026-10-26: the operator judged 22px against the 18–24px comparison and chose
      24px ("24px looks great"). Shipped at 24px.

## Notes

Cosmetic. Scope it to the `⌖` span (e.g. a class on that span), not `.map-control`, so the other
glyphs don't move. Touches the same `MAP_CONTROLS_CSS` as `0314`, so it may land in a later wave.

2026-10-26, from `0314`'s agent: the zoom harness renders `⌖` as a missing-glyph box, because the
self-hosted fonts in `app/fonts` lack the character (see
`docs/capabilities/assets/0112/home-1280x800-200pct.png`, second control in the top row). In a real
browser a system fallback font draws it, possibly at a different size, which may be the cause of
"slightly small". Check the font coverage before resizing the span.

## Operator validation

The (operator) criterion above, on the desktop browser.

## Resolution

**Cause, from font coverage first (as the Notes asked).** Neither `⌖` (U+2316) nor `⤢` (U+2922) is in
the self-hosted Inter Latin subset in `app/fonts`, so both glyphs come from a system fallback font. On
the operator's desktop (Windows) only three installed fonts carry either character: Segoe UI Symbol,
Cambria and Cambria Math (`fc-list :charset=…` over `C:\Windows\Fonts`). Rendering the control row in
headless Chromium with Inter plus Segoe UI Symbol as the fallback, `CSS.getPlatformFontsForNode`
reports **Segoe UI Symbol for both glyphs**; Inter draws neither (an Inter-only span shows the
missing-glyph box). At 18px Segoe UI Symbol's `⌖` actually has the larger ink box (≈12×13 px against
`⤢`'s ≈10×10) but it is a hairline circle-and-cross, so it reads lighter and smaller than the arrow.
That is the "slightly small". It is not a missing-glyph or wrong-font problem, so a scoped size bump
is the fix the ticket expected. An inline SVG or a font subset would change the design, and neither
was needed.

**Change.** `components/map/map-controls.tsx`: the `⌖` span gets `className="recentre-glyph"`, and
`MAP_CONTROLS_CSS` gains one rule, `.map-control .recentre-glyph { font-size: 22px; }`. `.map-control`
is untouched: 40×40 (D-313) and 18px for every other glyph. I compared 18, 20, 21, 22 and 24px beside
`⤢` at 18. At 22px the crosshair matches the arrow's visual weight and stays well inside the button
(ink ≈15×16 px in 40). At 24px it starts to dominate the row. The comment above `MAP_CONTROLS_CSS`
records why.

**Test.** `components/map/map-controls-css.test.ts` (new) pins `.map-control` at 40×40/18px and checks
that the only other `font-size` in the sheet is the recentre glyph's 22px. A later change that moves
every glyph, or the button, fails it.

**Decisions.** None new. No design doc gives a glyph size (06 §2.2 rows 6 and 8 give only the 40×40
box), so no doc drift.

**Caveat for the perceptual check.** The fallback is the browser's choice. Chrome/Edge on Windows map
these blocks to Segoe UI Symbol, which is what was measured. Firefox, or a machine without Segoe UI
Symbol, may pick Cambria Math, whose crosshair is drawn differently.

**Operator change after deploy (2026-10-26).** The agent shipped 22px, because at 24px it judged the
crosshair began to dominate the row. Shown the comparison render and the deployed 22px, the operator
chose 24px. The orchestrator changed the rule and its test to 24px
(`components/map/map-controls.tsx`, `components/map/map-controls-css.test.ts`). `.map-control`
stays 40×40 at 18px, and the other glyphs are unchanged.

**Orchestrator, commit record (2026-10-26).** The 24px change has no `0317:` commit. Its own commit was blocked by the stale-index check, unnoticed, and the next commit (`5b3c652`, "tickets: defer 0319, start 0318, 0320") swept it in with `git add -A`. That commit deployed as Amplify job 435 (SUCCEED). History was already pushed, so it was left as is and recorded here.

**Smoke test, after job 435:** the deployed client chunk contains `recentre-glyph { font-size: 24px; }`.
