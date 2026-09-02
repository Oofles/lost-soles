import { defineConfig } from "vitest/config"
import tsconfigPaths from "vite-tsconfig-paths"

// The alias `@/*` is declared ONCE, in tsconfig.json (01-architecture.md §5 — the
// existing devaultsecurity repo declares its aliases twice and they have drifted).
// This plugin is what lets vitest read that same declaration instead of restating it.

// .mjs is included so the check scripts in scripts/ can carry real tests. They are
// plain node by design — they run in the Amplify build container, which has no
// TypeScript — so their tests cannot be .ts either.
const INCLUDE = ["**/*.test.ts", "**/*.test.tsx", "**/*.test.mjs"]
const EXCLUDE = ["node_modules/**", ".next/**", ".amplify/**", ".claude/**"]

/**
 * Ticket 0149. Two projects, because one file needs a different module resolution
 * from every other.
 *
 * `lib/auth/bearer.ts` ships to Next's EDGE runtime (middleware), where
 * `aws-jwt-verify` resolves its "browser" condition and verifies with SubtleCrypto
 * over global `fetch`. Under vitest's default node resolution it loads the Node
 * build instead, which calls `https.request` — so a test stubbing `fetch` stubs
 * nothing, the verifier reaches the REAL Cognito JWKS over the network, and every
 * rejection assertion passes for the wrong reason. 0149 hit exactly that: 14
 * rejection tests green while the two acceptance tests failed, which is the
 * signature of a suite proving nothing.
 *
 * `include`/`exclude` are set per project rather than inherited: a project that
 * `extends: true` and then narrows `include` does NOT narrow — the root value
 * wins, and both projects run every file. That doubled the suite before it was
 * caught here.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: INCLUDE,
          exclude: [...EXCLUDE, "lib/auth/bearer.test.ts"],
        },
      },
      {
        extends: true,
        resolve: { conditions: ["browser"] },
        ssr: { resolve: { conditions: ["browser"] } },
        test: {
          name: "edge",
          environment: "node",
          include: ["lib/auth/bearer.test.ts"],
          exclude: EXCLUDE,
          // Externalized dependencies are resolved by Node, which ignores Vite's
          // conditions — so the package must be inlined for "browser" to win.
          server: { deps: { inline: ["aws-jwt-verify"] } },
        },
      },
    ],
  },
})
