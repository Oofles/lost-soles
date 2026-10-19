---
id: 294
slug: retune-the-trace-web-s-ink-apart-from-the-parchment-water-wa
title: Retune the trace web's ink apart from the parchment water wash
type: design
priority: med
status: closed
size: s
capability: 15-two-map-modes-and-cold-territory
depends_on: [97]
blocked_by: []
source: agent
created: 2026-10-19T13:44:46Z
closed: 2026-10-19T14:35:37Z
---

## Description

D-369 builds the parchment basemap from the parchment and ink ramps only, and water is an
`--ink-300` wash. The permanent trace web (`0085`, D-299) is `--trace-line`, which is also
`--ink-300`. The `0097` agent measured ΔE 1.6–3.0 between a worn trace (wear ≥ 0.44) and the water
wash: indistinguishable where a route runs along a shore or crosses a bridge. D-299 gave the trace
its own token precisely so capability 15's parchment pass could retune it.

## Acceptance criteria

- [x] Closed as declined, with a `## Resolution` recording the decision (D-373), and moved to
      `closed/` rather than deleted. The original criteria are preserved verbatim in `## Resolution`.

## Options considered

None taken: declined (D-373). Retuning `--trace-line` or the water token were the two halves.

## Open questions

- None: the premise is gone.

## Notes

Proposed by the `0097` agent. Distinct from `0197`, which judges the run route's amber pairing, not
the trace web. Table of measured ΔE: `docs/capabilities/15-two-map-modes-and-cold-territory.md`.

## Operator validation

None: declined before any work. The operator's verdict that retired its premise was given on the
deployed `0097` parchment fork, desktop browser, 2026-10-19 (D-373).

## Resolution

**Declined 2026-10-19. Recorded as D-373.** Filed from `0097`'s first build, where water was an
`--ink-300` wash (D-369) and so nearly matched the trace web's `--trace-line` (ΔE 1.6–3.0). The
operator withdrew the parchment colouring the same day: the basemap keeps the stock Protomaps `light`
colours, whose water is blue, so the collision this ticket measured no longer exists. If a trace is
ever lost against stock water in real use, that is a fresh ticket with its own measurement.

Original acceptance criteria, verbatim:

- (original) `--trace-line` (or the water token, if that is the better half to move) is retuned so a worn trace is distinguishable from water at every wear step, with the ΔE recorded in the capability doc.
- (original) Still inside 06 §8.2's ramps (D-369), and the D-299 overlap steps still read as one line darkening, not a second colour.
- (original) (operator) On the desktop browser, a trace along water reads as a trace in both variants. 
