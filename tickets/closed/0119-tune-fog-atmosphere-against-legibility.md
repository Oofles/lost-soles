---
id: 119
slug: tune-fog-atmosphere-against-legibility
title: Tune the fog atmosphere against atlas legibility — time-boxed
type: feature
priority: med
status: closed
size: m
capability: 08-map-and-fog-renderer
depends_on: [56]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-28T03:36:37Z
closed: 2026-09-28T12:29:56Z
---

## Description

**Split out of 0056 during backlog validation (2026-08-30).** 0056 bundled two different kinds of
work: *does the composite pass render correctly* (objectively testable — a triangle is drawn, the
mask is sampled, uniforms are wired, `smoothstep` behaves) and *does the fog look right* (taste,
iterative, no passing test). Mixing them means the aesthetic half expands to fill whatever time the
correctness half leaves, and the ticket can never be honestly called done.

0056 now owns correctness and ships the v1 uniform values as specified. **This ticket owns the
taste pass, and it is time-boxed.**

The constraint that decides every argument here is **D-051: legibility is non-negotiable, and
atmosphere may never cost it.** When a value makes the fog more beautiful and street names harder
to read inside revealed territory, the value is wrong. That is not a trade-off to balance; it is a
rule with a direction.

Tune within the ranges 0056 establishes: `u_noiseAmp`, `u_rimAmt`, `u_fogDeep`, `u_fogEdge`,
`u_rimGlow`, `u_maxOpacity`. Ship **atlas-leaning** values (`09-roadmap.md` §2.3) — capability `15`
adds the adventure mode later by changing numbers, not code.

`u_maxOpacity` stays below 1.0. Fully opaque fog reads as a hole punched in the map; a hint of the
world showing through reads as mist. Do not "fix" this by raising it to 1.

## Acceptance criteria

- [x] Final uniform values are committed as named constants with a one-line rationale each.
      *(`V1_FOG_DEEP` … `V1_RIM_AMT` in `lib/fog/fog-uniforms.ts`.)*
- [x] Values are recorded in `docs/capabilities/08-map-and-fog-renderer.md` so capability `15` starts
      from them rather than re-deriving.
- [x] `u_maxOpacity < 1.0`, with the reason in a comment. *(0.90.)*
- [x] A before/after screenshot pair at z16 over revealed ground is attached to the ticket.
      *(`docs/capabilities/assets/0119/`: before, after, and the fog-off baseline.)*
- [x] **Legibility regression check**: street names inside revealed territory are no less readable
      than with the fog layer disabled entirely. If they are, the tuning is wrong regardless of how
      it looks. *(Measured and looked at. See Operator validation.)*
- [x] The time-box was respected, or the overrun is recorded with what remained unresolved.
      *(About 1h45m. Two things the range cannot fix are filed as `0210` and `0211`.)*

## Notes

**Time-box: 2 hours.** When it expires, ship the best values reached and file a follow-up if they
are not right yet. This is the ticket most likely to silently consume a day — `09-roadmap.md` §8.1
flags capability `08` as the most likely to overrun, and unbounded aesthetic iteration is the
mechanism by which that happens.

Tune on the **target phone in daylight**, not on a desktop monitor indoors. Values chosen on a
bright calibrated display at night are consistently too subtle outdoors — which is where this app
is actually used. **Superseded by D-240** — see the 2026-09-14 note below.

### 2026-09-14, from `0199` — three things that change this ticket's starting assumptions

**1. The per-level step in noise coarseness is LIKED, and must not be tuned away.** D-243 quantised
the lattice frequency to powers of two to stop the mist boiling during a zoom. The price was
supposed to be a visible step in apparent coarseness at each whole zoom level — 184–368 px across a
level, 256 px at each boundary — and the operator was asked whether it read badly. It does not:

> *"The boiling is gone on a zoom. Overall it's so much smoother than it was before, and the clean
> distinctions between zoom levels look great."*

So the octave-weighting fix that would smooth that step (weight the fBm octaves by
`frac(log2(rawScale))` — near-free on the GPU, and the classic answer) is **not a debt this ticket
should pay off.** Applying it would remove something the operator values. D-243 carries the same
note as a dated outcome. If tuning makes the step objectionable, that is a finding worth reporting,
not a licence to smooth it away.

**2. The `0056` measurements below were recorded against a field nobody had seen move.** They
predate `0199`, so *"too smooth to read as ragged"* was judged on a field that was stable only when
the camera was still and re-randomised every frame of a zoom. Re-judge before trusting them.

**3. The phone instruction above is dead.** D-240 removed the phone from this project's validation
surface entirely, and D-227 had already made the desktop browser the viewing surface. The
"daylight, not a calibrated display at night" *reasoning* was sound and no longer has a device to
apply to — whoever takes this should decide what it means on a desktop and say so, rather than
silently dropping it. (`0208` is the same stale assumption in `09-roadmap.md` §9.5.)

### 2026-09-10, from `0056` — two measurements to start from rather than rediscover

`0056` shipped the composite and rendered it to a PNG against a stand-in parchment basemap
(`node tools/fog-harness/render-png.mjs tmp/out.png <V1|ATLAS|ADVENTURE> <half-width-m>`). Two
things it found, both arithmetic rather than taste, so this ticket does not have to find them by
eye:

1. **The warm rim is invisible at the value that ships.** §4.3 calls it *"the single detail that
   sells the effect"*. At `u_rimAmt = 0.08` it contributes **+10/255** at its peak — measurable
   (harness probe C1) and not perceptible against the luminance step it sits on. At adventure's
   0.30 it reads clearly as a parchment-coloured band. The renders are the comparison; the honest
   summary is that 0.08 buys a hairline that is not there.

2. **`u_noiseAmp` cannot produce a ragged edge on its own, at any value in §5.2's range.** The
   noise displaces the boundary by `amp/2 x (1 - FALLOFF_INNER) x radius` — D-231's own formula —
   which is **2 m** at 0.10 and **6 m** at 0.30. The reveal ramp it has to roughen is
   `(REVEAL_HI - REVEAL_LO) x (1 - FALLOFF_INNER) x radius` = **17 m** wide. A 2 m wobble on a 17 m
   gradient is invisible; 6 m is subtle. So §4.3's *"ragged, organic mist edge instead of a smooth
   blurred blob"* is a promise about the RATIO of those two numbers, and raising `u_noiseAmp` alone
   moves it slowly. The other lever is `FALLOFF_INNER`, and **D-231 raised it to 0.60 to kill the
   neighbour seam** — so lowering it to buy raggedness trades one artefact for the other and is a
   design decision, not a tuning knob. Check `SEAM_FLOOR` before touching it.

Also worth knowing: the edge treatment is **scale dependent**. Both numbers above are ground
metres, so the wobble is a couple of pixels at a neighbourhood zoom and tens of pixels zoomed in.
Tune at the zoom the map is actually used at.

## Operator validation

**Rewritten 2026-09-28 for the desktop (D-240, as the 2026-09-14 note asked).** The original asked
for the phone outdoors in direct sunlight. Its reasoning was that values chosen on a bright display
come out too subtle. On the desktop that becomes one rule: **a detail counts only if it reads at a
glance at normal size, without zooming the screenshot.** Operator agreed to this translation before
work started.

What was checked, all at z16 over the real basemap with labels, rendered by
`tools/fog-harness/tune.mjs` in headless Chromium (SwiftShader) at DPR 1:

1. **Street names inside revealed ground: no regression.**
   - *Measured:* against the fog-off render, pixels more than 6 px inside revealed ground change by
     at most 2/255 under every variant tried.
   - *Measured:* the fogged fraction of the frame is 62.3–62.4% for all of them, so `noiseAmp` 0.25
     does not eat into revealed ground.
   - *Seen:* labels that straddle the frontier ("West Robinson Street") are cut by the fog. That is
     §4.4's layer order (fog above symbols), not these values, and it is identical in V1.
2. **Unexplored ground is still dark, not greyed out:** yes at 0.90 opacity. It now also shows a
   faint ghost of its streets and labels, which is a D-051 gain.
3. **The edge reads as drifting mist:** **no**, it reads as disc outlines at every in-range value.
   Filed as `0211`.
4. **Pan for 20 s:** not re-run. No motion code changed, D-233/D-243 cover it in the suite, and the
   operator confirmed the zoom behaviour on `0199`.

**Operator, 2026-09-28, desktop:** reviewed the six-variant frontier sheet and the 2x rim sheet, and
chose R: *"take R as-is, file both follow-ups"*.

## Resolution

**Shipped R: `maxOpacity` 0.90, `fogEdge` (0.27,0.29,0.35), `noiseAmp` 0.25, `rimAmt` 0.30;
`fogDeep` and `rimGlow` unchanged.** All values are inside §5.2's ranges, and the new test asserts
that. `SEAM_FLOOR` still holds, because it is derived from adventure's 0.30.

### Files

- `lib/fog/fog-uniforms.ts`: `V1` is no longer derived from `ATLAS`/`ADVENTURE`. It is built from
  six `V1_*` constants, each with its reason, and the header is rewritten to match.
- `lib/fog/fog-uniforms.test.ts`, `lib/fog/composite.test.ts`: the new values. The "hybrid of
  atlas and adventure" assertion became an "inside the range on every scalar" assertion, which is
  the constraint that actually binds this ticket.
- `tools/fog-harness/tune.mjs` and `tune-harness.js` (new), plus a README section. This is the real
  basemap with labels, the shipped layer, and the route above the fog.
- `docs/capabilities/08-map-and-fog-renderer.md`: the values table, the two findings, and the
  desktop translation of "daylight".
- `docs/05-fog-of-war.md` §4.3: a note that the single rendering ships 0.90 while §5.2's 0.94 stays
  adventure's value. `docs/INDEX.md` regenerated.
- `docs/capabilities/assets/0119/`: three PNGs of the synthetic loop.

### What went wrong

**Most of the time-box went on the harness, not the tuning.** The existing harnesses draw on a
stand-in background with no labels, so they could not answer the legibility question. Getting the
real map into a headless screenshot hit four walls in a row, each producing the same flat grey
frame with no error:
- MapLibre's module worker would not start its message loop from `file://`.
- Serving over `127.0.0.1` together with `--virtual-time-budget` hung.
- The inlined 2 MB bundle broke the HTML tokenizer.
- Sprite and glyph decoding stalled under virtual time, so `load` never fired.

Driving Chromium over the DevTools protocol in real time fixed the last one. All four are written
down in the README so capability 15 does not pay for them again.

### Findings, filed rather than fixed

- **`0210`: the rim cannot be seen in range.** It is scaled by the boundary's own alpha. The value
  that makes it visible (0.60) is out of range, and it reads grey on the stock basemap.
- **`0211`: the edge reads as disc outlines.** This is `0056`'s ratio problem. The lever is D-231's
  `FALLOFF_INNER`, which is a design decision.

Both are in capability 15 so they do not gate `08`'s audit. They are about atmosphere, and that is
15's business.

### Decisions

No new `D-xxx`. This is tuning inside ranges the design already set. The honoured constraints are
D-051 (legibility), D-243 (per-level step kept) and D-231 (`FALLOFF_INNER` untouched).
