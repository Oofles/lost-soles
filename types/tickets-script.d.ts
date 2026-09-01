/**
 * Types for `.claude/skills/tickets/scripts/tickets.mjs`, declared here rather than
 * in the script itself. Ticket 0018.
 *
 * That script is deliberately plain Node with no build step and no dependencies
 * (D-160) — it has to run before this package.json exists, and it is linted by its
 * own `node:test` suite rather than by the app's ESLint config. So it cannot carry
 * TypeScript, and `allowJs` is off.
 *
 * Only the surface `lib/tickets/capture-triage-contract.test.ts` actually uses is
 * declared. Declaring the whole module would be a second, drifting copy of an API
 * this repo already tests directly; this is a narrow window onto the one function
 * whose contract the capture endpoint depends on.
 */
declare module "*/tickets.mjs" {
  /**
   * The hand-rolled frontmatter parser. NOT a YAML parser, deliberately — it is
   * line-based and rejects anything that is not one flat `key: value` per line.
   * That strictness is exactly why the capture endpoint's output has to be tested
   * against it rather than merely against a YAML round-trip.
   */
  export function parse(
    raw: string,
    path?: string,
  ): {
    fm: Record<string, unknown> | null
    body: string
    order: string[]
    error: string | null
    path?: string
  }
}
