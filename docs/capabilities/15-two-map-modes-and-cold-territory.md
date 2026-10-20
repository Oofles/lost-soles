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

### `0099` — what the modes may not differ in, measured

05 §5.4: neither mode changes what is revealed, and neither changes scoring. The proof has four
parts. Each one has a sabotage case that must fail.

| | What is proved | Where | Sabotage |
|---|---|---|---|
| Mask parity | The coverage mask (the 0.5× offscreen buffer that decides what is revealed) is **bit-identical** in atlas, adventure, mid-fade and back. Checked at z12, z15.25 and z17.75, through the real `swapBasemap` + `setPalette` on a real Map, with the mask redrawn fresh in each mode. | `tools/fog-harness/run-mode-swap.mjs` | A ⅛-mask-pixel camera move changes 4,763 / 7,741 / 23,107 bytes |
| Same GL calls | The mask pass makes the same calls in every mode. A mode change never re-runs it; only the composite redraws. | `lib/fog/mode-parity.test.ts` (`npm test`) | A 0.01-zoom camera change gives a different call stream |
| No mode argument | No parameter of the cell-selection or `revealScale` paths is, or contains, a mode, a palette or `"atlas"`/`"adventure"`, per the TypeScript checker. None of those modules imports anything that defines one. | `lib/fog/mode-parity.test.ts` | A `look: "atlas" \| "adventure"` parameter added to `cullBucket` fails it. `FogMaskLayer`'s constructor is caught by the same walker. |
| Name boundary | The mode's identifiers appear only in the renderer, the toggle and the run-moment seam. A hit in `src/`, `amplify/` or the rest of `app/` and `lib/` fails the build. | `scripts/check-mode-boundary.mjs` (Amplify + gate) | 17 self-test cases; no exemptions (`0296`) |

Mask hashes from the harness run (FNV-1a over RGBA, 640×400). Each row was equal across adventure,
atlas, mid-fade and back to adventure:

| Zoom | Mask hash | Revealed / fogged / edge px |
|---|---|---|
| z12 | `ceff5b97` | 15,183 / 225,587 / 15,230 |
| z15.25 | `7d8bfde6` | 122,032 / 126,000 / 7,968 |
| z17.75 | `a9ac8d89` | 23,644 / 195,641 / 36,715 |

**The ghost grid** (05 §5.3, criterion 4). Nothing is explored, so every pixel is fog at
`u_maxOpacity`, and every label is hidden. Δ = mean luminance of road pixels minus mean luminance of
the ground between them, high-passed (13 px box) so that the fBm's large blotches cancel. Measured on
the same frames, 8-bit luma (`tools/fog-harness/mode-parity-shots.mjs`, stock `light` ground, D-373):

| `u_maxOpacity` | z15 Δ | z16 Δ |
|---|---|---|
| atlas 0.55 (road copy above fog, D-368) | 43.92 | 40.87 |
| adventure 0.90 (shipped) | **1.98** | **1.85** |
| adventure 0.94 (the ceiling) | **1.19** | **1.11** |
| sabotage: 1.0 | −0.01 | −0.01 |

At the ceiling the street grid still shows through, and at 1.0 it is gone. This is the margin that
D-051 rests on in adventure: about one grey level at the ceiling, two at the shipped value.

**Street-name legibility** (criterion 5, roadmap §9.5). This covers the `roads_labels*` layers at
z15–z16 over the synthetic downtown loop. Each label is measured as the WCAG ratio of its letters'
solid core (the darkest tenth of its glyph pixels) against the median of the 2 px ring around them
in the shipped frame, which is the halo plus the ground just past it. Rows give the median, with p10
and the label count in brackets. "No fog" is the stock map.

| Mode | Ground | z15 | z16 |
|---|---|---|---|
| atlas | no fog (stock) | 2.03:1 (1.94, n 59) | 2.01:1 (1.95, n 29) |
| atlas | revealed | **2.03:1 — 1.00× stock** | **2.01:1 — 1.00× stock** |
| atlas | unexplored (names above fog, D-368) | **1.55:1 — 0.77× stock** (1.43, n 62) | **1.46:1 — 0.73× stock** (1.37, n 29) |
| adventure | no fog (stock) | 2.05:1 (1.93, n 34) | 2.01:1 (1.94, n 22) |
| adventure | revealed | **2.05:1 — 1.00× stock** | **2.01:1 — 1.00× stock** |
| adventure | unexplored (names under fog, by design) | 1.22:1 (n 1 detectable) | 1.12:1 (n 6 detectable) |

- **Revealed ground is identical to the stock map in both modes.** The fog takes nothing there. Both
  modes' street names on known ground read exactly as the unfogged basemap does.
- **Atlas keeps street names over unexplored ground, at about three-quarters of stock contrast.**
  The stock `light` halo is thin. The fog darkens what lies just past it, so the ring the eye reads
  against is darker than on open ground. No design doc sets a floor for this number, so it is
  recorded here as a finding (ticket `0099`'s Resolution) and not judged.
- **Adventure hides names over unexplored ground, by design** (05 §5.3). Its D-051 guarantee is the
  ghost grid above, not the names.
- The stock map itself measures about 2:1 by this method. Its label fill `#938a8d` on a `#ffffff`
  halo is 3.4:1 by colour. A street-name glyph at this size is mostly antialiased edge, and its
  solid core never reaches the full fill colour.

**The same viewport in each mode** (criterion 6). z16, the synthetic loop, with each mode reached
through the toggle's own swap from the other. The revealed ground is the same in both frames:

![atlas, z16](assets/0099/z16-atlas.png)

![adventure, z16](assets/0099/z16-adventure.png)

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

*Written at the capability audit, 2026-10-20.*

**Thirteen tickets against five planned.** All five planned tickets shipped. The other eight came
from two sources:

- **The operator's verdicts on the deployed map (six).**
  - `0210`: the rim could not be seen at any value in its range.
  - `0211`: the edge read as disc outlines.
  - `0284`: the basemap covered only Florida.
  - `0285`: a jump-to control.
  - `0254`: beat 1 hands back to the saved mode.
  - `0296`: the dead `mapMode` column.
- **Declined before work (two).** `0197` and `0294` were tuning tickets against the parchment
  basemap, and D-373 retired their premise.

Work ran 2026-10-18 to 2026-10-20. Three tickets ran serially (`0097`, `0211`, `0284`), then three
waves of two or three tickets each: about six sessions, against the two or three that D-151's pace
implies for five tickets. The overrun is almost entirely the perception loop. This capability is
judged by eye, and three of its designs (the parchment ground, the rim, the edge) were only found
wrong once they were deployed and looked at.

**What the design got right, non-obviously.**
- **05 §5.4's parity rule.** Neither mode may change what is revealed. Because it was made
  bit-checkable (`0099`'s mask hash), `0100` could add a whole channel and a third pass to the mask
  and prove in one harness run that coverage did not move.
- **D-147's channel split.** The frontier is warm luminance and cold ground is cool desaturation,
  clipped apart. The operator told them apart at a glance on the first deployed version, with no
  tuning ticket.
- **The modes differ only in uniforms (§5.2).** That made the 320 ms cross-fade a lerp, with no
  second render path to keep in sync.

**What it got wrong.**
- **The parchment basemap (D-053).** The operator rejected it on sight: it read as a filter over
  the map. The fog alone carries the atmosphere (D-373).
- **The rim values.** The 0.08/0.30 rim was invisible at every value in its range (`0210`).
- **The edge.** `u_noiseAmp` alone cannot make a ragged edge; it needed a warp (`0211`, D-372).
- **The cost of the cold wash.** "One uniform on the GPU" was wrong. A saturation shift needs a
  frame copy (D-391).
- **Two preferences nobody needed.** 02 T1 planned `mapMode` and `showColdTerritory` as Profile
  columns. The mode is per-device localStorage and the wash is always on in atlas, so both columns
  are dead (`0296`, `0299`).
- **The coach mark.** 06 §4.6 specified one that a one-user app does not need (D-394).

**§2 divergences.** Three readers re-read the 18 cited sections in parallel. As in `10`–`14`, most
of the drift was decisions taken in the capability that had not reached every section they
changed:
- D-391's `RGBA8` mask and frame copy against 05 §4, §4.2, §5.1 and 06 §4.6.
- D-392's month-4 onset against 06 §4.6, D-133 and D-147.
- D-373's stock colours against 06 §3.2 and §4.6, and D-053.
- `0210`'s rim against 06 §4.6 and the 09 roadmap row.
- D-389's route against 08 §2.4 C-3 and 02 S-5.
- 05 §1.1, §8.5 and §9.7, which still called cold territory an unsettled, opt-in proposal.

The DESIGN pass in this audit amended all of them, with supersede markers on D-053, D-133 and
D-147. Two findings were not covered by any decision:
- **design-was-wrong:** the coach mark was never built and is dropped (D-394, operator).
- **code-was-wrong:** `Profile.showColdTerritory` is a dead column (D-395, operator). Filed as
  `0299`.

**§3.** Every shipped ticket has the operator's dated desktop report, and the infrastructure
tickets also have a smoke test. `0197` and `0294` are honestly *none*, because they were declined.

**§4 and §5.** No cell re-fogged (5211 → 5211) and no XP fell. The project's own AWS spend for
October is about $1.90 to date, $1.23 of it the planned KMS key. Amplify's $15.87 is account-wide,
across ten apps, and outside this project (D-361). There is no NAT gateway.

**What the next capability should do differently.** When a ticket records a decision that changes
a design claim, grep every doc for the claim's distinctive term (`R8`, `parchment`, `opt-in`,
`one uniform`), not only the sections the ticket cites. `0100` amended the two sections it cited
and missed six others that said the opposite. This is a habit, not tooling: a close-time
doc-drift check was declined (the audit's DESIGN pass is that check), and this audit shows the
pass still catches the misses.

## Audit — 2026-10-20 (`tickets.mjs audit --record`)

**Verdict: PASS.** Mechanical half: 12 passed, 0 failed, 0 n/a. See AUDIT.md §1, §4, §5.

**Filed by this audit, and therefore excluded from `capability-tickets-closed`:** `0299` Drop the dead Profile.showColdTerritory column. This capability passed with work outstanding — its own code-was-wrong findings, filed as AUDIT.md §2 directs and listed under Divergences below, not forgotten.

**Divergences (2 of a budget of 3):**

1. **design-was-wrong** — `D-394` — 06 §4.6's first-open atlas coach mark was never built; dropped — the wash reads unaided
2. **code-was-wrong** — `0299` — Profile.showColdTerritory is a dead column; atlas always paints the wash (D-395)

- `typecheck` — **pass** — npm run typecheck
- `lint` — **pass** — npm run lint
- `unit-tests` — **pass** — npm run test
- `script-tests` — **pass** — node --test tickets.test.mjs
- `invariant-sweep` — **pass** — 18/30 invariants cited by a test name, none lost. Ratchet only: the remaining 12 are not due until 0116 sets "complete": true in docs/capabilities/invariant-citations.json, which makes this row all-or-nothing
- `boundary-greps` — **pass** — check-boundaries.mjs clean
- `vigil-test` — **pass** — src/rules/registry-delta.test.ts, app/skills/vigil-peer.test.tsx
- `validate` — **pass** — 0 errors across open/ and closed/
- `fog-no-refog` — **pass** — 1 baselined user(s): cells 5211 → 5211, gen 269 → 269 — none lower (docs/capabilities/regression-baseline.json)
- `xp-not-lower` — **pass** — 1 baselined user(s), 10 skill(s): cartography 26678/L27, constitution 11077/L20, might 80/L4, roving 1017/L9, vigil 660/L8, wayfaring 31482/L29 — none lower (docs/capabilities/regression-baseline.json)
- `blocked-by-closed` — **pass** — no blocked_by points at a closed ticket
- `capability-tickets-closed` — **pass** — 13 closed; 1 filed by this audit (0299)

<!-- audit-record {"capability":"15-two-map-modes-and-cold-territory","audited":"2026-10-20T17:03:12Z","verdict":"pass","mechanical":{"pass":12,"fail":0,"na":0},"divergences":2,"filed":["0299"]} -->
