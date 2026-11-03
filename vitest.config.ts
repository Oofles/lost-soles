import { defineConfig } from "vitest/config"
import tsconfigPaths from "vite-tsconfig-paths"

// The alias `@/*` is declared ONCE, in tsconfig.json (01-architecture.md §5 — the
// existing devaultsecurity repo declares its aliases twice and they have drifted).
// This plugin is what lets vitest read that same declaration instead of restating it.

// .mjs is included so the check scripts in scripts/ can carry real tests. They are
// plain node by design — they run in the Amplify build container, which has no
// TypeScript — so their tests cannot be .ts either.
const INCLUDE = ["**/*.test.ts", "**/*.test.tsx", "**/*.test.mjs"]
// tmp/ is the gitignored per-ticket scratch directory (ticket 0250).
const EXCLUDE = ["node_modules/**", ".next/**", ".amplify/**", ".claude/**", "tmp/**"]

/**
 * Ticket 0149 split the suite into a "node" and an "edge" project, because `lib/auth/bearer.ts`
 * needed `aws-jwt-verify`'s browser build. Ticket 0332 (D-473) deleted the bearer path, so there is
 * one project again. It stays a named project so `--project node` keeps working.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  /**
   * Ticket 0032, the first .tsx test in the repo. `tsconfig.json` sets
   * `jsx: "preserve"` because Next does its own transform, which leaves esbuild
   * falling back to the CLASSIC runtime here — `React.createElement` against a
   * `React` that a server component never imports. The automatic runtime is what
   * Next itself compiles with, so this makes the test transform match the build
   * rather than introducing a second dialect.
   *
   * Ticket 0308: Vite 8 transforms with oxc, not esbuild, so the option moved
   * from `esbuild: { jsx: "automatic" }` to `oxc.jsx.runtime`. Same setting.
   */
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    /**
     * Ticket 0230. Every test file gets a private TMPDIR, removed after the file, so the CDK
     * synth suites stop leaking a 30-50 MB `cdk.out` into /tmp per suite. Global setup sweeps
     * what a killed run left and fails the run if a new `cdk.out*` appears in the real /tmp.
     * The project inherits these through `extends: true`. Rationale: scripts/vitest-tmpdir.mjs.
     */
    globalSetup: ["./scripts/vitest-global-setup.mjs"],
    setupFiles: ["./scripts/vitest-setup-tmpdir.mjs"],
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: INCLUDE,
          exclude: EXCLUDE,
        },
      },
    ],
  },
})
