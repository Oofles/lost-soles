---
id: 99
slug: mode-parity-invariant-tests
title: What the modes may NOT differ in — revealed set and geometry parity, enforced
type: chore
priority: high
status: open
size: m
capability: 15-two-map-modes-and-cold-territory
depends_on: [98]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

`05-fog-of-war.md` §5.4 states two prohibitions. This ticket turns them from prose into failing
tests, because a mode toggle that quietly changes what is revealed is the single worst bug this
capability can ship.

1. **Neither mode changes what is revealed.** Both render the same cell set at the same
   `revealScale`. A toggle must never look like territory appearing or disappearing.
2. **Neither mode changes scoring.** The modes are a uniform and style-layer switch, client-side,
   with **no path back to §3** — no read of a mode flag anywhere in projection, XP, or ingest.

And the constraint above both of them: **D-051 is non-negotiable and binds both modes. The map
must remain a real, legible street map; atmosphere may never cost legibility.** Adventure mode is
allowed to be atmospheric; it is not allowed to be unusable. The way D-051 survives adventure mode
is structural, not a matter of taste (05 §5.3): `u_maxOpacity` capped at 0.94 means fully fogged
ground still shows a ghost of its street grid — **adventure hides names, not geometry.**

## Acceptance criteria

- [ ] A test renders the same fixture explored set in both modes to an offscreen buffer and
      asserts the **coverage mask is bit-identical** between modes at three zooms (the mask is
      computed before any mode uniform is applied; if the assertion is not bit-identical, the
      mode flag has leaked into mask generation).
- [ ] The renderer's cell-selection and `revealScale` code paths take **no mode argument** —
      asserted by a signature test, so it is impossible rather than merely untrue.
- [ ] `grep -r` for the mode flag / mode enum identifier outside the renderer and the UI toggle
      returns nothing, and **that grep fails the build** — no occurrence in projection, XP,
      ingest, or any Lambda.
- [ ] `u_maxOpacity < 1.0` is asserted for every mode; a screenshot test at max fog shows non-zero
      road-geometry luminance variance inside fully unexplored ground (the ghost grid is present).
- [ ] Street-name legibility in **both** modes at planning zoom (z15–z16) is verified by a
      contrast measurement of label glyphs against their local background, recorded in the
      capability doc for each mode (§9.5 of the roadmap requires this box).
- [ ] A screenshot of each mode over the same viewport is pasted into
      `docs/capabilities/15-two-map-modes-and-cold-territory.md`, and the revealed set in the two
      images is visibly identical.

## Notes

The bit-identical mask assertion is the whole ticket. Everything else is a guard on a way that
assertion could be made true by accident and then broken later.

Do not "fix" a parity failure by clamping a uniform. If the masks differ, a mode value has reached
the mask stage and the fix is to move it, not to compensate for it.

This ticket is also where the roadmap's capability done-condition — *both modes render the
identical revealed set* — is actually discharged.

## Operator validation

On the Android phone, on `/`, at z15 over a neighbourhood you know: read three street names aloud
in adventure mode, then long-press and read the same three in atlas. Both must be readable without
zooming. Then find the edge of your territory and toggle repeatedly while watching one specific
fogged block — if any block flickers between revealed and unrevealed, stop and reopen this ticket.
