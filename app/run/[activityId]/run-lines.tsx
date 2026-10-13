import type { CSSProperties } from "react"

/**
 * BEATS 4 AND 5'S TWO LINES. Ticket `0083`. `06-ui-ux.md` §3.2.
 *
 * One component each, drawn twice: on the sequence's panel while the beats play (with `opacity`
 * driven by `beat45.ts`), and in the end state, where they simply are. Same markup both times, so the
 * line the panel faded in is the line the end state keeps.
 */

/** §8.4: Spectral, with `0082`'s Georgia fallback until `0255` self-hosts the face. */
const SERIF = "Spectral, Georgia, 'Times New Roman', serif"

/** Spectral Italic 17sp, `--ink-700`, centred, 22dp of air above and below. */
const chronicle: CSSProperties = {
  margin: "22px 0",
  fontFamily: SERIF,
  fontStyle: "italic",
  fontSize: "17px",
  lineHeight: 1.45,
  textAlign: "center",
  color: "var(--text-chronicle)",
}

export function ChronicleLine({ text, opacity }: { text: string; opacity?: number }) {
  return (
    <p data-slot="chronicle-line" style={opacity === undefined ? chronicle : { ...chronicle, opacity }}>
      {text}
    </p>
  )
}

/**
 * `--ink-500` (`--text-muted`), 14sp, a small hollow diamond. Quiet by construction: one colour, no
 * hover state that shouts, no badge, no count — and nothing to remember, so nothing to repeat.
 */
const frontierButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "baseline",
  gap: ".5rem",
  padding: ".25rem 0",
  border: "none",
  background: "none",
  color: "var(--text-muted)",
  font: "inherit",
  fontSize: "14px",
  textAlign: "left",
  cursor: "pointer",
}

export function FrontierLine({
  text,
  onSelect,
  opacity,
}: {
  /** `null` when there is nothing to name: no explored set yet, or no unclaimed ground nearby. */
  text: string | null
  onSelect?: () => void
  opacity?: number
}) {
  return (
    <p data-slot="frontier-line" style={{ margin: 0, ...(opacity === undefined ? {} : { opacity }) }}>
      {text ? (
        <button type="button" style={frontierButton} onClick={onSelect}>
          <span aria-hidden="true">◇</span>
          {text}
        </button>
      ) : null}
    </p>
  )
}
