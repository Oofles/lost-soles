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

  {
    // Ticket 0025, criterion 3. `next/typescript` already sets no-explicit-any, but at
    // severity WARN — and it only fails the build because `npm run lint` passes
    // --max-warnings 0 (D-164). That is a real guard resting on an unrelated flag: drop
    // the flag and `any` silently becomes legal again. Stated as an ERROR here so the
    // domain's guarantee does not depend on a lint invocation detail.
    //
    // Chosen over a grep for ": any" because a grep both over-fires (a comment
    // mentioning any) and under-fires (Array<any>, generic defaults, spacing variants).
    // The rule reads types; the grep reads letters.
    //
    // src/pipeline is included pre-emptively, for the same reason the D-100 grep landed
    // while the domain was empty: a rule added after the leak has already failed.
    files: ["src/domain/**/*.ts", "src/domain/**/*.tsx", "src/pipeline/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  {
    // Ticket 0025. A compile-time assertion is a type alias whose ONLY consumer is
    // `tsc --noEmit`:
    //
    //   type _NoSkill = Expect<Equals<Extract<keyof Activity, "skill">, never>>
    //
    // Nothing references it at runtime, by design — if it stops holding, the TYPECHECK
    // fails. ESLint cannot see that and reports ten "defined but never used" warnings,
    // which --max-warnings 0 turns into a red build (D-164).
    //
    // Scoped to *.types.test.ts ONLY, and only to names prefixed `_`. Applying
    // varsIgnorePattern project-wide would re-open exactly the hole D-164 closed: an
    // unused variable anywhere becoming invisible again. The narrow escape hatch is the
    // point — a genuinely unused binding in any other file still fails.
    files: ["**/*.types.test.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { varsIgnorePattern: "^_" }],
    },
  },
]

export default config
