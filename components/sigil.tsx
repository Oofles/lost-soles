import SIGILS from "@/rules/sigils.json"

/**
 * A skill's sigil. Ticket 0073, `06-ui-ux.md` §8.6.
 *
 * The marks are DATA, in `rules/sigils.json`, keyed by skill id: this file names no skill (I-25),
 * so a new workout type's sigil is a new JSON entry and an empty `.tsx` diff (D-031, 0072).
 *
 * A skill with no entry draws the FALLBACK SEAL — two concentric rings — rather than failing the
 * tile. A missing sigil is a cosmetic gap, never a broken panel.
 *
 * Monoline, stroked at 1.5 on a 24-unit box, no fills, `currentColor` (§8.6). Decorative: the
 * skill's name is always printed beside it, so it is hidden from assistive technology.
 */

const BOX = SIGILS.viewBox
const MARKS: Readonly<Record<string, readonly string[]>> = SIGILS.sigils

/** The seal a skill without a sigil wears. */
export const FALLBACK_SEAL: readonly string[] = [
  "M3 12 A 9 9 0 1 0 21 12 A 9 9 0 1 0 3 12",
  "M7.5 12 A 4.5 4.5 0 1 0 16.5 12 A 4.5 4.5 0 1 0 7.5 12",
]

/** The crest: Total Level's mark (`✦` in §5.2), drawn rather than typed so it matches the sigils. */
export const CREST: readonly string[] = ["M12 2.5 L14 10 L21.5 12 L14 14 L12 21.5 L10 14 L2.5 12 L10 10 Z"]

/** The paths for `skillId`, or the fallback seal. */
export function sigilPaths(skillId: string): readonly string[] {
  return Object.hasOwn(MARKS, skillId) ? MARKS[skillId]! : FALLBACK_SEAL
}

export function Mark({ paths, size = 28 }: { paths: readonly string[]; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${BOX} ${BOX}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}

export function Sigil({ skillId, size }: { skillId: string; size?: number }) {
  return <Mark paths={sigilPaths(skillId)} size={size} />
}
