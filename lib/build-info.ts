/**
 * Which build is this. Ticket 0089.
 *
 * Both values are inlined by `next.config.ts` at build time (Amplify's SSR compute has
 * no runtime environment). Outside a Next build — vitest, a script — they are absent,
 * and the screen says so rather than inventing a version.
 */
export interface BuildInfo {
  version: string
  sha: string
  shortSha: string
}

export function buildInfo(
  env: { version?: string; sha?: string } = {
    version: process.env.LOST_SOLES_BUILD_VERSION,
    sha: process.env.LOST_SOLES_BUILD_SHA,
  },
): BuildInfo {
  const version = env.version && env.version !== "" ? env.version : "dev"
  const sha = env.sha && env.sha !== "" ? env.sha : "unknown"
  return { version, sha, shortSha: /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7) : sha }
}
