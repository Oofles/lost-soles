---
id: 285
slug: a-quiet-jump-to-control-lists-the-regions-the-operator-has-r
title: A quiet jump-to control lists the regions the operator has run in
type: feature
priority: low
status: open
size: s
capability: 15-two-map-modes-and-cold-territory
depends_on: [284]
blocked_by: []
source: agent
created: 2026-10-16T15:35:14Z
started: 2026-10-19T15:53:10Z
---

## Description

With street maps outside Florida (`0284`), the operator's territory is spread over several areas
hundreds of kilometres apart, and finding one means a long pan or zoom-out. The operator asked for
"a quick jump-to per state that's not too intrusive".

A small control on the map pane lists the regions the operator has actually run in. Choosing one
moves the camera to the territory there.

## Acceptance criteria

- [ ] The region list is derived from the operator's own data (activity starts or the explored
      set, clustered), never a hard-coded list of states. A new area appears with no code change.
- [ ] The control is closed by default and sits with the other map-pane controls (D-313): one
      40px button. It is mouse and keyboard operable (D-253), with arrow keys and Enter in the list
      and Esc to close.
- [ ] Choosing a region frames that region's territory (its explored-cell bounds) without changing
      the mode, and the stored camera then updates as it does after any pan (D-249).
- [ ] With only one region the control does not appear at all.
- [ ] Region labels come from the basemap's place names (D-302). With no name, a plain fallback such
      as the coordinate area; never an error.

## Notes

Filed by the orchestrator after `0177`'s import, at the operator's request (2026-10-16). It depends
on `0284`: jumping to an area with no streets is not worth building first.

**Settle with the operator before building (D-152):** the region granularity (state, metro
cluster, or N km clusters), and whether the list is ordered by most recent run or by amount of
ground. "Per state" was the operator's phrase; a cluster rule may read better where one state
holds two far-apart areas, as Arkansas does today.

## Operator validation

- (operator) On the desktop browser, open the control, jump between regions, and judge whether it
  is quiet enough when closed and quick enough when open.
