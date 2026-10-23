import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { NextConfig } from "next"

import { ALL_PATHS, securityHeaders, type CspOutputs } from "./lib/security-headers"

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

/**
 * BUILD INFO, INLINED AT BUILD TIME. Ticket 0089: `/settings` shows the version and
 * commit, because "which build is deployed" is the first question of every bug report.
 *
 * The same reason as the home coordinate: Amplify's SSR compute has no runtime
 * environment, so the value has to be in the bundle. The sha is Amplify's
 * `AWS_COMMIT_ID` (set in the build container; "HEAD" on a manual deploy, which says
 * nothing), falling back to `git rev-parse` for a local build. Neither is a secret —
 * the repo is public and the sha is in its history — so `lib/build-info.ts` may read
 * these anywhere.
 */
function commitSha(): string {
  const fromAmplify = process.env.AWS_COMMIT_ID
  if (fromAmplify && /^[0-9a-f]{7,40}$/i.test(fromAmplify)) return fromAmplify
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
  } catch {
    return "unknown"
  }
}

const buildEnv = {
  LOST_SOLES_BUILD_VERSION: (
    JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string }
  ).version,
  LOST_SOLES_BUILD_SHA: commitSha(),
}

/**
 * SECURITY HEADERS ON EVERY RESPONSE. Ticket 0143, 08 §5.3; the policy and its reasoning are in
 * `lib/security-headers.ts`. Set HERE rather than in `middleware.ts` because the middleware
 * matcher skips `_next/static`, `/maplibre/` and `/basemap-assets/`, and HSTS and nosniff belong
 * on those too; with no nonce (D-441) nothing varies per request.
 *
 * The CSP names the AppSync, tiles and Cognito origins from `amplify_outputs.json`, read at build
 * time like the home coordinate above. CI builds against the example file, so its CSP names the
 * example hosts; a real deploy builds after `pipeline-deploy` has written the real one.
 */
const amplifyOutputs = JSON.parse(readFileSync(join(process.cwd(), "amplify_outputs.json"), "utf8")) as CspOutputs

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { ...homeEnv, ...buildEnv },
  async headers() {
    return [
      {
        source: ALL_PATHS,
        headers: securityHeaders(amplifyOutputs, { dev: process.env.NODE_ENV === "development" }),
      },
    ]
  },
}

export default nextConfig
