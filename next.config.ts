import type { NextConfig } from "next"

// Path aliases are declared in tsconfig.json and NOWHERE else (01-architecture.md §5).
// The existing devaultsecurity repo declares them twice and they have drifted; do not
// reintroduce that here.

/**
 * THE HOME COORDINATE, INLINED AT BUILD TIME. Ticket 0053.
 *
 * `lib/map-home.ts` reads these in a server component. In the App Router that is a
 * RUNTIME read of `process.env` — Next only statically replaces `NEXT_PUBLIC_*` on its
 * own — and **Amplify's SSR compute does not carry the app's environment variables.**
 * Set at app level and then again at branch level, `process.env.LOST_SOLES_HOME_LAT`
 * was still undefined at request time, so the map opened on the extract-wide fallback
 * instead of the operator's neighbourhood. Both were verified against the live site, in
 * that order, before this.
 *
 * `env` here makes Next replace the reference with the value during the build, which
 * Amplify's build container *does* have. The cost is that changing the coordinate needs
 * a rebuild rather than a variable edit — acceptable for a value that changes when the
 * operator moves house.
 *
 * ─── WHY THIS DOES NOT LEAK ──────────────────────────────────────────────────
 *
 * Static replacement happens wherever the reference appears, so this WOULD reach a
 * client bundle if a client component ever read it. Only `lib/map-home.ts` does, and it
 * is server-only (it imports `next/headers`). Two things keep it that way: the value is
 * deliberately NOT `NEXT_PUBLIC_`-prefixed, and `0053`'s smoke test asserts the
 * signed-out payload of `/` carries no coordinate — the assertion that would fail if
 * someone moved the read into a client component.
 *
 * The session gate in `lib/map-home.ts` is unaffected: it runs at request time, so a
 * signed-out request still gets `null`. Build-time inlining changes where the value
 * comes from, not who is allowed to receive it. See D-199 and 08 §7.2 for why that
 * distinction is load-bearing in a public repo.
 */
const homeEnv = Object.fromEntries(
  (["LOST_SOLES_HOME_LAT", "LOST_SOLES_HOME_LNG", "LOST_SOLES_HOME_ZOOM"] as const)
    .map((key) => [key, process.env[key]])
    // An absent variable must stay absent rather than become the string "undefined",
    // which is finite-checked to NaN by map-home.ts but would read as configured.
    .filter(([, value]) => typeof value === "string" && value !== ""),
) as Record<string, string>

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: homeEnv,
}

export default nextConfig
