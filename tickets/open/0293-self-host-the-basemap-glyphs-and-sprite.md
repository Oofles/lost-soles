---
id: 293
slug: self-host-the-basemap-glyphs-and-sprite
title: Self-host the basemap glyphs and sprite
type: chore
priority: med
status: open
size: s
capability: 18-mvp-hardening
depends_on: [97]
blocked_by: []
source: agent
created: 2026-10-19T13:44:41Z
---

## Description

The parchment basemap (`0097`) still loads its glyphs (fonts for labels) and sprite (icons) from
`protomaps.github.io`. That breaks `06-ui-ux.md` §9.5's "no third-party requests at runtime", and
predates `0097`. Without them, labels vanish on a cold cache or offline. Adventure's paper grain
(05 §5.2) also needs our own sprite, so it was not built in `0097`.

## Acceptance criteria

- [ ] Glyph PBFs and the sprite the style references are served from this project's own origin or the tiles CloudFront distribution (D-226), never a third party.
- [ ] A test fails if the built style names `protomaps.github.io` or any other third-party host.
- [ ] Labels render in both variants on the deployed app with the browser's network panel showing no third-party font or sprite request.

## Notes

Proposed by the `0097` agent (wave 1 of capability 15). Upstream: `@protomaps/basemaps` 5.7.2.
Only the font stacks and sprite the fork actually uses need hosting.

## Operator validation

Desktop browser: labels in adventure and `?basemap=atlas` look the same as before the change.
