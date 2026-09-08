#!/usr/bin/env node
// TWO THINGS THE FOG CODE MAY NEVER DO.
//
//   1. Reach AP-16/AP-17, the full-table rebuild, from the ingest hot path.
//   2. Delete an ExploredCell. Anywhere, by any API, ever.
//
// ─── RULE 1 ─────────────────────────────────────────────────────────────────
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

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

// ─── RULE 2 ─────────────────────────────────────────────────────────────────
// NO CODE PATH DELETES AN ExploredCell. `02-data-model.md` I-7, D-020; ticket 0050
// criterion 9: "No code path anywhere calls DeleteItem on T6; a grep test enforces this."
//
// I-7 is classified [S] Structural, which means it must not be removable without the removal
// showing up in a diff. Three mechanisms carry it and this is the cheapest:
//
//   - IAM: the worker's role holds no dynamodb:DeleteItem or BatchWriteItem on T6
//     (amplify/explored-cells-table.test.ts asserts the absence, non-vacuously).
//   - The module: there is no delete in src/pipeline/explored-cells.ts.
//   - HERE: no file that knows T6's name may import a delete-capable command.
//
// SCOPED TO FILES THAT NAME T6, not to the whole repo, because deletion is legitimate
// elsewhere and will be needed soon: 0051 expires deltas from S3, and 0066 step 2 deletes
// non-floor XpLedgerEntry rows. A blanket ban would be a gate someone has to switch off, which
// is worse than no gate. A file that both knows the cell table and imports a delete command is
// the actual shape of the mistake.
const T6_NAMES = /EXPLORED_CELL_TABLE|LostSolesExploredCell|explored-cells/;
const DELETE_COMMANDS =
  /\b(DeleteItemCommand|DeleteCommand|BatchWriteCommand|BatchWriteItemCommand)\b|["']dynamodb:(DeleteItem|BatchWriteItem)["']/;
const DELETE_ROOTS = ["src", "amplify"];

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

// RULE 2's scan. Independent of the import graph: this is about what a file CONTAINS.
function scanDeletes(base = ROOT) {
  const hits = [];
  let scanned = 0;
  for (const root of DELETE_ROOTS) {
    for (const file of walkFiles(join(base, root))) {
      scanned++;
      const rel = relative(base, file).split(sep).join("/");
      // This file names T6 and the commands, in prose, to explain the rule.
      if (rel.endsWith("scripts/check-fog-hot-path.mjs")) continue;
      // TESTS ARE NOT CODE PATHS, and the tests that matter here NAME the forbidden actions
      // on purpose: amplify/explored-cells-table.test.ts asserts the worker's role grants
      // neither dynamodb:DeleteItem nor BatchWriteItem, which it cannot do without writing
      // both strings. Firing on the assertion that enforces the invariant is the false
      // positive that gets a gate switched off — the lesson check-boundaries.mjs learned on
      // 0016 and contract-drift.test.ts learned again on 0048.
      if (/\.test\.(ts|tsx|mjs|js)$/.test(rel)) continue;
      const src = codeOnly(readFileSync(file, "utf8"));
      if (!T6_NAMES.test(src)) continue;
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (DELETE_COMMANDS.test(lines[i])) {
          hits.push({ rel, n: i + 1, line: lines[i].trim() });
        }
      }
    }
  }
  return { hits, scanned };
}

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else if (EXTS.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
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

  const DELETE_CASES = [
    {
      name: "clean — the cell writer imports UpdateCommand only",
      files: { "src/pipeline/explored-cells.ts": ['import { UpdateCommand }', "from", '"@aws-sdk/lib-dynamodb"'].join(" ") + "\nexport const EXPLORED_CELL_TABLE = \"LostSolesExploredCell\"" },
      mustFire: false,
    },
    {
      name: "a file that knows T6 imports DeleteCommand",
      files: { "src/pipeline/explored-cells.ts": ['import { DeleteCommand }', "from", '"@aws-sdk/lib-dynamodb"'].join(" ") + "\nconst t = EXPLORED_CELL_TABLE" },
      mustFire: true,
    },
    {
      name: "BatchWriteCommand counts — a batch carries DeleteRequest",
      files: { "src/pipeline/x.ts": "import { BatchWriteCommand } from \"@aws-sdk/lib-dynamodb\"\nconst t = EXPLORED_CELL_TABLE" },
      mustFire: true,
    },
    {
      name: "an IAM grant string counts too",
      files: { "amplify/backend.ts": 'const a = ["dynamodb:DeleteItem"]\nconst t = "LostSolesExploredCell"' },
      mustFire: true,
    },
    {
      name: "deletion elsewhere is fine — 0051 expires deltas, 0066 clears ledger rows",
      files: { "src/pipeline/ledger.ts": "import { DeleteCommand } from \"@aws-sdk/lib-dynamodb\"\nconst t = \"LostSolesXpLedgerEntry\"" },
      mustFire: false,
    },
    {
      name: "a TEST asserting the absence does not fire — it must name what it forbids",
      files: {
        "src/pipeline/explored-cells.test.ts":
          'expect(actions).not.toContain("dynamodb:DeleteItem")\nconst t = EXPLORED_CELL_TABLE',
      },
      mustFire: false,
    },
    {
      name: "PROSE naming both does not fire — the rule must be explainable",
      files: { "src/pipeline/explored-cells.ts": "// EXPLORED_CELL_TABLE never sees a DeleteCommand or BatchWriteCommand (I-7)\nexport const x = 1" },
      mustFire: false,
    },
  ];

  let failed = 0;
  for (const testCase of DELETE_CASES) {
    const base = mkdtempSync(join(tmpdir(), "fogdel-"));
    try {
      for (const [rel, body] of Object.entries(testCase.files)) {
        const full = join(base, rel);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, `${body}\n`);
      }
      const { hits, scanned } = scanDeletes(base);
      const ok = hits.length > 0 === testCase.mustFire && scanned > 0;
      if (!ok) failed++;
      console.log(
        `  ${ok ? "ok" : "FAIL"}  ${testCase.mustFire ? "must fire " : "must pass"}  ${testCase.name}`,
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }

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
    `\nself-test: ${CASES.length + DELETE_CASES.length} cases passed — the gate follows imports transitively, refuses a delete in any file that knows T6, and stays quiet when a file merely explains the rule.`,
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

const deletes = scanDeletes();
if (deletes.scanned === 0) {
  console.error("FOG DELETE GUARD: scanned 0 files — the scan roots are wrong.");
  process.exit(1);
}
if (deletes.hits.length) {
  console.error("I-7 VIOLATION — a file that knows T6 can delete from DynamoDB:\n");
  for (const h of deletes.hits) console.error(`  ${h.rel}:${h.n}\n    ${h.line}`);
  console.error(
    "\nNo code path deletes an ExploredCell, at any level of retreat (02 §9 I-7, D-020).\n" +
      "The map only ever grows. A source-side delete TOMBSTONES an activity; it removes no cells.",
  );
  process.exit(1);
}

console.log(
  `fog hot path: ${files} files reachable from ingest, none of them AP-16/AP-17.\n` +
    `I-7: ${deletes.scanned} files scanned, no delete reachable from anything that knows T6.`,
);
