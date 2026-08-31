import { defineConfig } from "vitest/config"
import tsconfigPaths from "vite-tsconfig-paths"

// The alias `@/*` is declared ONCE, in tsconfig.json (01-architecture.md §5 — the
// existing devaultsecurity repo declares its aliases twice and they have drifted).
// This plugin is what lets vitest read that same declaration instead of restating it.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", ".amplify/**", ".claude/**"],
  },
})
