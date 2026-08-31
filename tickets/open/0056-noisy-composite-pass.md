---
id: 56
slug: noisy-composite-pass
title: Pass 2 — noisy composite: fBm-perturbed smoothstep with a warm rim glow
type: feature
priority: high
status: open
size: m
capability: 08-map-and-fog-renderer
depends_on: [55]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The `render` pass: **one full-screen triangle** (not a quad — a triangle avoids the diagonal seam
and one vertex of work) into MapLibre's framebuffer, in the translucent pass, sampling the half-res
`R8` coverage mask from 0055.

Fog opacity is `smoothstep` across a threshold **perturbed by animated 3-octave value-noise fBm**,
plus a warm rim glow at the boundary. `05-fog-of-war.md` §4.3 carries the shader sketch; follow it.

Uniforms and their v1 values:

```
u_fogDeep    vec3(0.035, 0.045, 0.075)   near-black blue
u_fogEdge    vec3(0.22,  0.24,  0.30)    lit mist
u_rimGlow    vec3(0.85,  0.70,  0.42)    warm parchment
u_maxOpacity 0.94    never 1.0 — a hint of the world showing through reads as mist, not as a hole
u_noiseAmp   0.10    atlas   (0.30 is adventure mode, capability 15)
u_rimAmt     0.08    atlas   (0.30 is adventure mode, capability 15)
```

**The taste pass is 0119, not this ticket.** Split out during backlog validation: this ticket owns
*correctness* — the triangle draws, the mask samples, the uniforms are wired, `smoothstep` behaves —
and ships the v1 values below as given. Iterating on how the fog *looks* happens in 0119, which is
time-boxed. Do not tune here; it has no passing test and will consume the session.

**Ship atlas-leaning values.** D-051 makes legibility non-negotiable and D-052's adventure
atmosphere is not; one rendering, tuned toward atlas legibility, is what §2.3 says the milestone
carries. The uniforms are parameterised now so capability `15` adds the second mode by changing
numbers, not code — but do not build a mode switcher here.

`u_maxOpacity` at 0.94 rather than 1.0 is not a rounding artefact. Fully opaque fog reads as a hole
punched in the map; 6% transmission reads as weather.

Animation: drive repaints with `requestAnimationFrame` → `map.triggerRepaint()`, **capped at
30 fps**. Drifting mist gains nothing from 60 and it halves the battery cost. Pause entirely when
`document.hidden`. `matchMedia('(prefers-reduced-motion: reduce)')` stops the rAF loop and renders
statically at `u_time = 0`; expose the same switch as a manual battery-saver toggle.

Budget: ~40 ALU per fragment, **1–2 ms** on a mid-range phone at DPR ≤ 2. If it misses, the ordered
levers are (a) mask scale to 0.35×, (b) animation to 20 fps, (c) fBm to 2 octaves — decided in
advance so tuning does not become an open-ended search.

**This is the ticket with no natural stopping point** (`09-roadmap.md` §7.3). "The mist boundary
reads as weather, not as a honeycomb" is not a passing test. Time-box the taste iteration: the
numbers above are the starting point and R4's bounds are the guardrails; anything beyond a session
of tuning gets filed as a separate polish ticket rather than held open.

## Acceptance criteria

- [ ] Full-screen triangle in `render`, sampling the half-res mask; correct alpha blending against
      MapLibre's framebuffer, with GL state restored afterwards.
- [ ] 3-octave value-noise fBm perturbs the `smoothstep` threshold; octave count is a `#define` so
      the (c) lever is one edit.
- [ ] Warm rim glow appears at the coverage boundary and nowhere else — a test image asserts the
      glow band is absent well inside revealed territory.
- [ ] `u_maxOpacity = 0.94`; fully-fogged pixels still show a trace of the basemap.
- [ ] All eight uniforms are named constants in one module, with the atlas/adventure pairs noted.
- [ ] rAF loop is capped at 30 fps and pauses on `document.hidden`; a test asserts zero repaints
      while hidden.
- [ ] `prefers-reduced-motion: reduce` renders statically at `u_time = 0` with no rAF loop.
- [ ] Composite pass measured under 2 ms on the target phone (recorded; the hard gate is 0059).
- [ ] No shimmer at the boundary while panning — the noise is sampled in a stable space, not in
      screen space that slides under the camera.

## Notes

The half-res mask means the composite samples a texture at half the drawing-buffer resolution.
Bilinear sampling plus the noise perturbation is what hides that; a hard threshold on a half-res
mask would alias visibly. Do not "fix" edge softness by raising the mask resolution — that spends
the frame budget on the wrong pass.

Screen-space noise is the classic mistake here: it looks fine on a still map and crawls
distractingly the moment you pan, which is the exact defect the operator validation below is
written to catch.

## Operator validation

1. On the 6.8in Android phone at zoom 14, in sunlight, over the edge of your explored territory:
   **street names inside revealed ground must remain readable**, and the fog edge must not shimmer.
   If names inside revealed territory are hard to read, `u_maxOpacity` or the rim glow is bleeding
   inward and D-051 is violated — that is a blocker, not a nit.
2. Pan slowly across the fog boundary for 20 seconds. The mist must drift gently; it must **not**
   crawl or sparkle in step with your finger. Crawling means the noise is in screen space.
3. Hold the phone still for a minute. The drift should be barely perceptible — atmosphere, not
   animation. If it reads as motion, `u_noiseAmp` is too high for atlas mode.
4. Enable "Remove animations" in Android accessibility settings and reload. The fog must be
   completely static and still look correct — not flat grey, not fully opaque.
5. Look at a lake or park polygon half-covered by fog. The boundary must read as weather, with no
   visible 120° corners anywhere along it.
