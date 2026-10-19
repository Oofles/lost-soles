# 15-two-map-modes-and-cold-territory

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`15-two-map-modes-and-cold-territory\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (5)

- `0097` — Fork @protomaps/basemaps light into the parchment style, in two variants *(colours reverted to stock, D-373)*
- `0098` — The atlas / adventure toggle — uniforms, style variants, 320 ms cross-fade
- `0099` — What the modes may NOT differ in — revealed set and geometry parity, enforced
- `0100` — Cold territory wash, atlas mode only, on a different perceptual channel
- `0101` — Map controls, gestures, and inspecting a past run over the fog

## Design notes

_Filled in at the DESIGN step, before TICKET-WRITE._

### `0097` — the basemap, sampled

Forked from `@protomaps/basemaps@5.7.2`, flavour `light` (`lib/basemap-style.ts`). **Both variants
paint the stock `light` colours unchanged (D-373).** A parchment recolouring through `--map-*`
tokens shipped first and was rejected by the operator — it read as a filter over the map, and the
fog already carries the atmosphere — so D-373 supersedes D-053's parchment ground and D-369. What
the fork still owns is structure: adventure's reduced label density, and atlas's labels and
0.5-opacity road-fill copies above the fog (D-368). D-053's refusal of a *dark* basemap stands: the
stock ground is light and nearly neutral, so the fog does the darkening.

The values below are the stock flavour's, sRGB → CIELAB (D65), the metric D-371 fixes;
`basemap-style.test.ts` re-asserts the thresholds on every build. They are identical in both
variants, since the variants no longer differ in colour.

| Sample | sRGB | L\* | C\* | CIELAB sat. | HSV sat. | HSL sat. |
|---|---|---|---|---|---|---|
| Ground (`earth`, the land fill) | 226, 223, 218 | **88.9** | 2.8 | **3.1%** | 3.5% | 12.1% |
| Background (where no tile is loaded) | 204, 204, 204 | **82.0** | 0.0 | **0.0%** | 0.0% | 0.0% |

Both pass the criterion: L\* ≥ 80 and CIELAB saturation ≤ 25%. Water (`#80deea`, L\* 83.3, 32.7%)
is not ground and the criterion does not bind it.

**The saturation metric is CIELAB saturation, C\* / √(C\*² + L\*²), with HSV reported beside it.
HSL was rejected** (operator, `0097`, D-371): HSL saturation divides by `1 − |2L − 1|`, which goes
to zero near white, so any faintly tinted near-white reads as strongly saturated — the parchment
ground `--parch-100` measured 58% under HSL while looking almost neutral.

The parchment version's water-vs-trace ΔE table and its "paper grain not built" note are gone with
the parchment (D-373): stock water is cyan, not an ink wash, and there is no paper to grain.

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

