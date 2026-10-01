/**
 * THE SOFT CAP — diminishing returns on one session's reps or seconds. Ticket 0218.
 *
 * `04-game-design.md` §3.5, *"Soft cap on rep/duration skills"*, verbatim:
 *
 * ```
 * effective(n, S) = min(n, S)
 *                 + 0.50 × clamp(n − S,   0, S)
 *                 + 0.25 × clamp(n − 2S,  0, 4S)
 * ```
 *
 * Full rate to `S`, half rate to `2S`, quarter rate to `6S`, nothing after: the most any one
 * activity can be worth is `2.5 × S`. A huge session (2S) still earns 1.5× a normal one; a
 * typo (5,000 pushups) is bounded instead of dwarfing a year of running. No dialog, no
 * rejection (D-013).
 *
 * `S` is the row's `softCapUnits`, and `null` means no cap at all — every distance row, where
 * an ultramarathon is paid in full. The three rates and two breakpoints are the FORMULA, one
 * curve for every capped skill like D-130's one level curve; no per-skill number is here
 * (D-031). The cap is per ACTIVITY ("within a session", §3.5), never per game day.
 *
 * Pure. Nothing is rounded: integer XP happens once, at ledger write time (I-19).
 */

/** `effective(n, S)`. `softCapUnits: null` is the identity. */
export function softCap(units: number, softCapUnits: number | null): number {
  if (softCapUnits === null) return units
  if (!(softCapUnits > 0) || !Number.isFinite(softCapUnits)) {
    throw new Error(`softCapUnits must be a positive finite number or null, got ${softCapUnits}`)
  }
  const S = softCapUnits
  return Math.min(units, S) + 0.5 * clamp(units - S, 0, S) + 0.25 * clamp(units - 2 * S, 0, 4 * S)
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi)
}
