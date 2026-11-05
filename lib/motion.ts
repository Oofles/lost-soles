/**
 * `06-ui-ux.md` §8.7 — the motion scale, for the places that need it as a NUMBER (a MapLibre camera
 * call takes milliseconds and an easing function, not a CSS custom property). CSS uses the matching
 * `--motion-*` / `--ease-standard` tokens in `app/tokens.css`; the two must agree.
 *
 * Five durations; nothing else is invented at the component level. The post-run sequence (§3.2) is
 * exempt and keeps its own beat timings (D-338). Ticket `0280`.
 */
export const MOTION_MS = {
  /** State changes: chip selection, button press, scrim fade. */
  state: 120,
  /** Exits and dismissals. */
  exit: 200,
  /** Sheet entry; the atlas ↔ adventure cross-fade. */
  sheet: 320,
  /** The reveal wipe; the level-up card's gold border. */
  reveal: 400,
  /** The long slot: a level-up card's full cycle, the plinth pulse, a camera fly across the map. */
  long: 1400,
} as const

/**
 * `cubic-bezier(0.2, 0, 0, 1)` — §8.7's one easing, solved for y at x = t. Same bisection as
 * `easeInOut` in `lib/map-mode.ts`, on the standard curve's control points.
 */
export function easeStandard(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const x1 = 0.2
  const x2 = 0
  const bx = (u: number) => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u
  const by = (u: number) => 3 * (1 - u) * u * u + u * u * u // y1 = 0, y2 = 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (bx(mid) < t) lo = mid
    else hi = mid
  }
  return by((lo + hi) / 2)
}
