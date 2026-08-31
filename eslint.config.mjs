import { FlatCompat } from "@eslint/eslintrc"

const compat = new FlatCompat({ baseDirectory: import.meta.dirname })

const config = [
  {
    ignores: [
      ".next/**",
      ".amplify/**",
      "node_modules/**",
      "next-env.d.ts",
      // The ticket tooling predates this package.json and is linted by its own
      // node:test suite (D-160). Bringing it under the app's ESLint config is a
      // separate decision, not a side effect of project init.
      ".claude/**",
      "scripts/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
]

export default config
