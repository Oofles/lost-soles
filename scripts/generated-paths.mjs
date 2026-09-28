// Generated vendor output that lives INSIDE a source-shaped directory (ticket 0188).
//
// `.next/`, `.amplify/` and `node_modules/` are generated too, but every tool already
// knows them by name. What this list names is the category they don't: a directory the
// build writes into a place the tree-walkers otherwise treat as ours to check — today,
// MapLibre's minified worker copied into `public/` at prebuild (ticket 0053).
//
// Each entry is:
//   - GENERATED — written by a script at build time, never edited by hand;
//   - GITIGNORED — so CI, which lints before it builds (gate.yml), never sees it;
//   - VENDOR — not this project's code, so linting it or holding it to 06 §8.3's palette
//     rule is checking someone else's minifier.
//
// One list, read by every consumer: the script that WRITES the directory
// (copy-maplibre-worker.mjs), ESLint, and check-design-tokens.mjs. The next generated
// directory is a one-line change here, not a second instance of 0188.
//
// Entries are repo-relative directory paths, `/`-separated, no trailing slash. Keep them
// NARROW: `public/` as a whole stays covered, so a real source file added there is still
// checked.

export const GENERATED_VENDOR_DIRS = [
  // scripts/copy-maplibre-worker.mjs, at prebuild. `.gitignore` carries the same path.
  "public/maplibre",
]

/** True if a repo-relative, `/`-separated path is, or is inside, a generated vendor dir. */
export function isGeneratedVendor(rel) {
  return GENERATED_VENDOR_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`))
}
