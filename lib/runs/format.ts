/**
 * THE END STATE'S ROUTE STATS, AS TEXT. Ticket `0078`. `06-ui-ux.md` §3.3: *"route stats
 * (distance, duration, date, source)"*.
 *
 * Pure, so the page and its test format identically. The DATE is read from `startedAtLocal`, the
 * naive wall clock (I-13) — a 06:00 run in Denver is that morning's run, whatever UTC says.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** `2026-08-28T07:00:00` → `Thu 28 Aug 2026`. An unparseable value is returned as it came. */
export function runDate(startedAtLocal: string, opts: { year?: boolean } = { year: true }): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startedAtLocal)
  if (!m) return startedAtLocal
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const weekday = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]
  return `${weekday} ${d} ${MONTHS[mo - 1]}${opts.year === false ? "" : ` ${y}`}`
}

/** Metres → `8.40 km`. `null` for an activity with no distance (strength, a manual log). */
export function runDistance(distanceM: number | null): string | null {
  if (distanceM === null || !Number.isFinite(distanceM) || distanceM <= 0) return null
  return `${(distanceM / 1000).toFixed(2)} km`
}

/** Seconds → `42:10` or `1:02:03`. */
export function runDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const two = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${two(mm)}:${two(ss)}` : `${mm}:${two(ss)}`
}

/** An adapter id, for display: `manual` → `Manual`. Nothing branches on it (D-100). */
export function sourceLabel(source: string): string {
  return source ? source[0]!.toUpperCase() + source.slice(1) : source
}

/** `1143` → `1,143`. Fixed locale, so server and browser render the same digits. */
export function xpNumber(n: number): string {
  return n.toLocaleString("en-US")
}
