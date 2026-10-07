import type { RuleSkill } from "./schema"

/**
 * THE KINDS THE RULES KNOW: every kind an enabled activity row matches on. Read off the registry
 * rather than off `ActivityKind`, because a kind no row matches would score nothing — and accepting
 * it would let an override quietly zero a run while saying it had been corrected.
 *
 * Pure and SDK-free (`0244`), so the run page's kind control offers exactly the set
 * `rescoreKind` accepts, from the same rows, with no `switch` on a kind (D-031).
 */
export function knownKinds(registry: { skills: readonly RuleSkill[] }): ReadonlySet<string> {
  const out = new Set<string>()
  for (const s of registry.skills) {
    if (s.kind !== "activity" || !s.enabled) continue
    for (const k of s.match?.kinds ?? []) out.add(k)
  }
  return out
}
