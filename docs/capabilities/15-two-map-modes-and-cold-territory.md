# 15-two-map-modes-and-cold-territory

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`15-two-map-modes-and-cold-territory\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (5)

- `0097` — Fork @protomaps/basemaps light into the parchment style, in two variants
- `0098` — The atlas / adventure toggle — uniforms, style variants, 320 ms cross-fade
- `0099` — What the modes may NOT differ in — revealed set and geometry parity, enforced
- `0100` — Cold territory wash, atlas mode only, on a different perceptual channel
- `0101` — Map controls, gestures, and inspecting a past run over the fog

## Design notes

_Filled in at the DESIGN step, before TICKET-WRITE._

### `0097` — the parchment basemap, sampled

Forked from `@protomaps/basemaps@5.7.2`, flavour `light` (`lib/basemap-style.ts`). Every colour is
a `--map-*` token in `app/tokens.css`, from the parchment and ink ramps only; adventure lays every
fill and line 30% toward `--map-tint-deep` (`--parch-300`) and never ages text. The values below are
computed from the shipped tokens by the same code the style uses, sRGB → CIELAB (D65), and
`basemap-style.test.ts` re-asserts the thresholds on every build.

| Sample | sRGB | L\* | C\* | CIELAB sat. | HSV sat. | HSL sat. |
|---|---|---|---|---|---|---|
| Atlas ground (`--map-ground`) | 245, 237, 217 | **93.9** | 10.7 | **11.3%** | 11.4% | 58.3% |
| Adventure ground (aged 30%) | 239, 229, 204 | **91.1** | 13.4 | **14.6%** | 14.6% | 52.2% |
| Atlas water (`--map-water` @ 0.70) | 192, 196, 201 | 79.0 | 3.0 | 3.8% | 4.5% | 7.7% |
| Adventure water (@ 0.50) | 204, 204, 199 | 81.9 | 2.6 | 3.2% | 2.5% | 4.7% |

Both grounds pass the criterion: L\* ≥ 80 and CIELAB saturation ≤ 25%. Water is not ground and
the criterion does not bind it: atlas water is 15 L\* below the ground, which is what "clearly
separated from land" asks for.

**The saturation metric is CIELAB saturation, C\* / √(C\*² + L\*²), with HSV reported beside it.
HSL was rejected** (operator, `0097`): HSL saturation divides by `1 − |2L − 1|`, which goes to zero
near white, so any faintly warm near-white reads as strongly saturated. The design's own ground,
`--parch-100`, is 58% under HSL, and `--parch-50` 69%, while looking almost neutral. A metric that
fails the palette 05 §5.1 was written around is measuring the formula, not the paper.

**Water against the trace web.** Water is an ink wash and the trace web is `--trace-line`
(`--ink-300`) at `wear` opacity, so they are the same ink at different strengths. ΔE76 between the
water fill and a trace on the same ground:

| | wear 0.28 (1 run) | 0.44 (3–4 runs) | 0.60 (9+ runs) |
|---|---|---|---|
| Atlas | 12.3 | 7.5 | **3.0** |
| Adventure | 6.3 | **1.6** | 2.9 |

A well-worn trace is as dark as water: the same colour. It rarely touches water (bridges, piers,
waterfront paths), and a 2px line reads differently from an area fill, but where it does, the
two can't be told apart. That is for `--trace-line`'s retune (D-299 named this capability for it;
`0197` already re-judges the route against the parchment).

**Not built:** adventure's "paper grain" (05 §5.2) needs a pattern image, and the sprite is still
upstream's, served from a third party. The dark theme's *night parchment* (06 §8.3) is not built either;
the `--map-*` tokens are absent from the dark blocks, as the route's are.

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

