#!/usr/bin/env node
// THE INGEST HOT PATH MAY NOT REACH THE FULL-TABLE REBUILD.
// `02-data-model.md` §2.10, §5.1 (AP-16/AP-17) and §5.6; ticket 0049 criterion 6.
//
// §5.6 does not hedge: *"The one thing that could break this is a full-table `Query`
// (AP-16) on the ingest hot path. AP-16 is the repair path. Calling it from
// `process-activity` is a REVIEW-BLOCKING BUG."*
//
// The numbers behind that sentence: AP-15's `BatchGetItem` reads the 40-130 cells a run
// actually crossed for ~3-10 RRU. AP-16 reads every res-6 partition the user has ever
// touched — up to 24 MB, ~1,000-3,000 RRU — to answer a question the previous
// generation's blob already answers for one S3 GET. Both work. Only one of them still
// works when the map is five years old, and the map only ever grows (D-020).
//
// This is a TRANSITIVE import walk, not a grep for one line. A grep is satisfied by
// moving the import one file away, which is exactly how a hot path acquires an expensive
// dependency in practice: nobody writes `import { rebuildFromTable }` into the worker.
//
// THE OTHER HALF OF THIS GUARD IS IAM. `amplify/backend.ts` grants the worker's role
// `dynamodb:UpdateItem` and `BatchGetItem` on T6 and no `Query`, so even a mistaken import
// cannot execute. Two mechanisms, because §5.6 calls this the one thing that could break
// the five-year bill, and a build gate can be skipped while a missing action cannot.
//
// Plain node, no dependencies, no ripgrep — it runs in both the GitHub gate and the
// Amplify build container, which has no rg (D-163).
//
//   node scripts/check-fog-hot-path.mjs              check
//   node scripts/check-fog-hot-path.mjs --self-test  prove it FAILS on a real hit

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// Where ingest begins. Both, because the pipeline module is the one under the boundary
// rule and the handler is the one that actually runs — a rebuild wired in at the handler
// would be just as expensive and would not appear in the pipeline's import graph.
const ENTRY_POINTS = [
  "src/pipeline/process-activity.ts",
  "amplify/functions/process-activity/handler.ts",
];

// What the hot path must not reach, and why in the words a reader will need.
const FORBIDDEN = [
  {
    file: "src/pipeline/explored-rebuild.ts",
    why: "AP-16/AP-17, the full-table Query. 02 §5.6: calling it from process-activity is a review-blocking bug.",
  },
];

const EXTS = [".ts", ".tsx", ".mjs", ".js"];

// `import x from "…"`, `export … from "…"`, `import("…")`, `require("…")`. Type-only
// imports are included deliberately: `import type` costs nothing at runtime, but a hot
// path that has acquired a type dependency on the repair path is one refactor away from a
// value dependency, and the point of the gate is to make the coupling visible while it is
// still free to remove.
const SPECIFIER =
  /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']/g;

// Comments are stripped before matching. `explored-rebuild.ts` is named in prose by the
// files that must not import it — that is how a reader learns the rule — and a gate that
// fired on its own explanation would be a gate someone deletes. The same lesson
// `contract-drift.test.ts` learned on ticket 0048.
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function resolveSpecifier(spec, fromFile, base) {
  let candidate;
  if (spec.startsWith("@/")) candidate = join(base, spec.slice(2));
  else if (spec.startsWith(".")) candidate = resolve(dirname(fromFile), spec);
  else return undefined; // a bare package. Not ours to walk.

  for (const ext of ["", ...EXTS]) {
    const withExt = candidate + ext;
    if (existsSync(withExt) && statSync(withExt).isFile()) return withExt;
  }
  for (const ext of EXTS) {
    const asIndex = join(candidate, `index${ext}`);
    if (existsSync(asIndex)) return asIndex;
  }
  return undefined;
}

// Every file reachable from the entry points, with the shortest path that got there —
// so a violation is reported as a CHAIN and not just as a destination. "handler imports
// process-activity imports x imports explored-rebuild" is the actionable form.
function reachable(base = ROOT) {
  const seen = new Map();
  const queue = [];

  for (const entry of ENTRY_POINTS) {
    const full = join(base, entry);
    if (!existsSync(full)) continue;
    seen.set(full, [entry]);
    queue.push(full);
  }

  while (queue.length) {
    const file = queue.shift();
    const chain = seen.get(file);
    const src = codeOnly(readFileSync(file, "utf8"));
    SPECIFIER.lastIndex = 0;
    let m;
    while ((m = SPECIFIER.exec(src)) !== null) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec) continue;
      const target = resolveSpecifier(spec, file, base);
      if (target === undefined || seen.has(target)) continue;
      seen.set(target, [...chain, relative(base, target).split(sep).join("/")]);
      queue.push(target);
    }
  }
  return seen;
}

function scan(base = ROOT) {
  const graph = reachable(base);
  const hits = [];
  for (const rule of FORBIDDEN) {
    const full = join(base, rule.file);
    if (graph.has(full)) hits.push({ ...rule, chain: graph.get(full) });
  }
  return { hits, files: graph.size };
}

if (process.argv.includes("--self-test")) {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  // Assembled at runtime so this file's own source never contains a line that would trip
  // the very check it is testing — the trap ticket 0048's comment-stripper self-test fell
  // into twice.
  const IMPORT = (spec) => ['import { x }', "from", `"${spec}"`].join(" ");

  const CASES = [
    {
      name: "clean — the worker reaches the incremental writer and stops there",
      files: {
        "src/pipeline/process-activity.ts": IMPORT("./explored-blob-store"),
        "src/pipeline/explored-blob-store.ts": IMPORT("@/src/domain/explored-blob"),
        "src/domain/explored-blob.ts": "export const x = 1",
        "src/pipeline/explored-rebuild.ts": "export const rebuildFromTable = () => {}",
        "amplify/functions/process-activity/handler.ts": IMPORT("@/src/pipeline/process-activity"),
      },
      mustFire: false,
    },
    {
      name: "direct — the pipeline imports the rebuild",
      files: {
        "src/pipeline/process-activity.ts": IMPORT("./explored-rebuild"),
        "src/pipeline/explored-rebuild.ts": "export const rebuildFromTable = () => {}",
      },
      mustFire: true,
    },
    {
      name: "TRANSITIVE — two hops away, which a grep would miss",
      files: {
        "src/pipeline/process-activity.ts": IMPORT("./explored-blob-store"),
        "src/pipeline/explored-blob-store.ts": IMPORT("./helpers"),
        "src/pipeline/helpers.ts": IMPORT("@/src/pipeline/explored-rebuild"),
        "src/pipeline/explored-rebuild.ts": "export const rebuildFromTable = () => {}",
      },
      mustFire: true,
    },
    {
      name: "via the HANDLER, which is not under the pipeline's own boundary rule",
      files: {
        "src/pipeline/process-activity.ts": "export const processActivity = () => {}",
        "amplify/functions/process-activity/handler.ts": IMPORT("@/src/pipeline/explored-rebuild"),
        "src/pipeline/explored-rebuild.ts": "export const rebuildFromTable = () => {}",
      },
      mustFire: true,
    },
    {
      name: "a type-only import still counts",
      files: {
        "src/pipeline/process-activity.ts": ["import type { RebuildDeps }", "from", '"./explored-rebuild"'].join(" "),
        "src/pipeline/explored-rebuild.ts": "export interface RebuildDeps { x: 1 }",
      },
      mustFire: true,
    },
    {
      name: "a dynamic import counts too",
      files: {
        "src/pipeline/process-activity.ts": 'const m = await import("./explored-rebuild")',
        "src/pipeline/explored-rebuild.ts": "export const rebuildFromTable = () => {}",
      },
      mustFire: true,
    },
    {
      name: "PROSE naming the module does not fire — the rule must be explainable",
      files: {
        "src/pipeline/process-activity.ts":
          "// never import explored-rebuild here; see 02 §5.6\n/* from \"./explored-rebuild\" would be AP-16 */\nexport const x = 1",
        "src/pipeline/explored-rebuild.ts": "export const rebuildFromTable = () => {}",
      },
      mustFire: false,
    },
  ];

  let failed = 0;
  for (const testCase of CASES) {
    const base = mkdtempSync(join(tmpdir(), "foghot-"));
    try {
      for (const [rel, body] of Object.entries(testCase.files)) {
        const full = join(base, rel);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, `${body}\n`);
      }
      const { hits, files } = scan(base);
      const fired = hits.length > 0;
      const ok = fired === testCase.mustFire && files > 0;
      if (!ok) failed++;
      console.log(
        `  ${ok ? "ok" : "FAIL"}  ${testCase.mustFire ? "must fire " : "must pass"}  ${testCase.name}`,
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }

  if (failed) {
    console.error(`\n${failed} self-test case(s) failed — the fog hot-path gate is broken.`);
    process.exit(1);
  }
  console.log(
    `\nself-test: ${CASES.length} cases passed — the gate follows imports transitively, through the handler, and stays quiet when a file merely explains the rule.`,
  );
  process.exit(0);
}

const { hits, files } = scan();
if (files === 0) {
  console.error("FOG HOT PATH: reached 0 files — the entry points are wrong.");
  process.exit(1);
}

if (hits.length) {
  console.error("FOG HOT PATH VIOLATION — the ingest worker can reach the full-table rebuild:\n");
  for (const h of hits) {
    console.error(`  ${h.chain.join("\n    -> ")}`);
    console.error(`    ${h.why}\n`);
  }
  console.error(
    "The incremental path is 02 §2.10: GET the previous generation's blob and merge.\n" +
      "src/pipeline/explored-blob-store.ts is what ingest uses.",
  );
  process.exit(1);
}

console.log(`fog hot path: ${files} files reachable from ingest, none of them AP-16/AP-17.`);
