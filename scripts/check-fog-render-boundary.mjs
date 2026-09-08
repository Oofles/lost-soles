#!/usr/bin/env node
// THE REVEAL RADIUS AND THE RENDER RADIUS ARE DIFFERENT NUMBERS AND THEY MUST NEVER MEET.
// `05-fog-of-war.md` §2.3, ticket 0046 criterion 7.
//
//   REVEAL_R_M                 = 65 m    scoring, set membership, server-side, permanent
//   revealScale × circumradius ≈ 102 m   a soft disc in the mask shader (§4), a LOOK
//
// The render disc overspills its hexagon on purpose, so neighbouring discs merge without
// scalloping (R4 §4.4). It is tuned by eye and it will be tuned again. If it ever reaches
// `src/domain/fog.ts`, an art-direction tweak silently rewrites what counts as explored —
// and D-020 says the map never re-fogs, so that mistake is not recoverable by editing the
// constant back. This is why the rule is a build gate and not a code comment.
//
// TWO RULES:
//
//   1. `src/domain/` imports nothing from the renderer. The domain is pure geometry and
//      arithmetic; a MapLibre, WebGL, React or component import there is either a leak of
//      render concerns into scoring, or scoring code that has wandered into a component.
//   2. `revealScale` appears nowhere under `src/`. It is a shader uniform. Its home is the
//      renderer (ticket 0055), and `src/` is the wrong side of the line by definition.
//
// BOTH RULES PASS VACUOUSLY TODAY, AND THAT IS THE POINT. The renderer is capability 08
// and does not exist yet. `check-boundaries.mjs` landed the same way — while the domain
// was still empty — on the reasoning that a grep added after the leak is a grep that has
// already failed at its job. The self-test is what stops "passes vacuously" from becoming
// "passes because it scans nothing": it proves the check FIRES on a real violation.
//
// Plain node, no dependencies, no ripgrep, because it runs in BOTH the GitHub gate and the
// Amplify build container, which has no rg (D-163: a check that runs in one of the two is
// half a control).
//
//   node scripts/check-fog-render-boundary.mjs              check
//   node scripts/check-fog-render-boundary.mjs --self-test  prove it FAILS on a real hit

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// RULE 1 — what "the renderer" means, as an import specifier.
//
// Deliberately matched on the IMPORT PATH only, never on a bare word. `05-fog-of-war.md`
// is full of the words "render" and "shader" and a domain comment must be free to explain
// why the two radii differ — which the header of `src/domain/fog.ts` does at length. A
// gate with false positives is a gate that gets bypassed, which is the lesson
// `check-boundaries.mjs` learned the hard way on ticket 0016's settings copy.
const RENDERER_IMPORT = {
  roots: ["src/domain"],
  pattern: new RegExp(
    [
      "maplibre",
      "deck\\.gl",
      "\\bthree\\b",
      "regl",
      "\\breact\\b",
      "react-dom",
      "next/",
      "@/components",
      "@/app",
      "\\.glsl",
      "\\.frag",
      "\\.vert",
    ].join("|"),
    "i",
  ),
  why: "05 §2.3 — the render radius must not reach the domain that owns REVEAL_R_M",
};

// RULE 2 — the render constant itself, wherever it appears under src/.
//
// Matched as an identifier, case-insensitively, so `revealScale`, `REVEAL_SCALE` and
// `reveal_scale` all fire. `REVEAL_R_M` does NOT match: the boundary is `Scale`.
const REVEAL_SCALE = {
  roots: ["src"],
  pattern: /reveal[_-]?scale/i,
  why: "05 §2.3 — `revealScale` is a shader uniform; it has no business under src/",
};

const RULES = [RENDERER_IMPORT, REVEAL_SCALE];

const SKIP_DIRS = new Set(["node_modules", ".next", ".amplify", ".git", "dist", "build"]);
const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTS.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

// RULE 1 reads import statements only. A path literal inside a comment or a string is not
// an import, and the domain must be able to NAME the renderer in prose to explain itself.
const IMPORT_LINE = /^\s*(import\b|export\b.*\bfrom\b|.*\brequire\s*\()/;

function scan(base = ROOT) {
  const hits = [];
  for (const rule of RULES) {
    for (const root of rule.roots) {
      for (const file of walk(join(base, root))) {
        const rel = relative(base, file).split(sep).join("/");
        const lines = readFileSync(file, "utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (rule === RENDERER_IMPORT && !IMPORT_LINE.test(line)) continue;
          // RULE 2 skips `//` comments, so this file's own explanation of the rule and
          // fog.ts's header may both say the word. Code is what is being policed.
          if (rule === REVEAL_SCALE && /^\s*(\/\/|\*|\/\*)/.test(line)) continue;
          if (rule.pattern.test(line)) {
            hits.push({ rel, n: i + 1, line: line.trim(), why: rule.why });
          }
        }
      }
    }
  }
  return hits;
}

// How many files the check actually looked at. A gate that scans zero files reports
// success identically to a gate that scans a clean tree, and 0142 found exactly that
// failure in a sibling script.
function scanned(base = ROOT) {
  const seen = new Set();
  for (const rule of RULES) {
    for (const root of rule.roots) for (const f of walk(join(base, root))) seen.add(f);
  }
  return seen.size;
}

if (process.argv.includes("--self-test")) {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  const FIXTURE = {
    // [line, mustFire]
    "src/domain/fog.ts": ['import { gridDisk } from "h3-js"', false],
    "src/domain/leak-import.ts": ['import { Map } from "maplibre-gl"', true],
    "src/domain/leak-component.ts": ['import { Fog } from "@/components/map/fog"', true],
    "src/domain/leak-reexport.ts": ['export { x } from "@/app/map/shader"', true],
    "src/domain/leak-require.ts": ['const gl = require("regl")', true],
    "src/domain/leak-shader.ts": ['import src from "./mask.frag"', true],
    // The domain must be free to EXPLAIN the boundary. §2.3 is unreadable otherwise, and
    // fog.ts's own header names maplibre, the shader and the disc in prose.
    "src/domain/prose.ts": ["// the maplibre renderer splats a soft disc; see @/components", false],
    "src/domain/prose-string.ts": ['const why = "not the render radius, see the shader"', false],
    // RULE 2 — anywhere under src/, not just the domain, and not just as an import.
    "src/domain/leak-scale.ts": ["const r = revealScale * circumradius", true],
    "src/pipeline/leak-scale.ts": ["export const REVEAL_SCALE = 1.35", true],
    "src/adapters/x/leak-scale.ts": ["const s = reveal_scale", true],
    "src/domain/scale-prose.ts": ["// revealScale lives in the renderer, never here", false],
    // The constant this whole gate protects must not trip the gate protecting it.
    "src/domain/reveal.ts": ["export const REVEAL_R_M = 65", false],
  };

  const base = mkdtempSync(join(tmpdir(), "fogrender-"));
  try {
    for (const [rel, [body]] of Object.entries(FIXTURE)) {
      const full = join(base, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, `${body}\n`);
    }
    const caught = new Set(scan(base).map((h) => h.rel));
    let failed = 0;
    for (const [rel, [, shouldFire]] of Object.entries(FIXTURE)) {
      const ok = caught.has(rel) === shouldFire;
      if (!ok) failed++;
      console.log(`  ${ok ? "ok" : "FAIL"}  ${shouldFire ? "must fire " : "must pass"}  ${rel}`);
    }
    if (scanned(base) === 0) {
      failed++;
      console.log("  FAIL  the self-test fixture was not scanned at all");
    }
    if (failed) {
      console.error(`\n${failed} self-test case(s) failed — the fog/render gate is broken.`);
      process.exit(1);
    }
    console.log(
      `\nself-test: ${Object.keys(FIXTURE).length} cases passed — the gate fires on a renderer import and on \`revealScale\`, and stays quiet when the domain merely explains why they exist.`,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  process.exit(0);
}

const files = scanned();
if (files === 0) {
  console.error("FOG/RENDER BOUNDARY: scanned 0 files — the scan roots are wrong.");
  process.exit(1);
}

const hits = scan();
if (hits.length) {
  console.error("FOG/RENDER BOUNDARY VIOLATION — the render radius is reaching scoring:\n");
  for (const h of hits) {
    console.error(`  ${h.rel}:${h.n}`);
    console.error(`    ${h.line}`);
    console.error(`    ${h.why}\n`);
  }
  console.error(
    "REVEAL_R_M (65 m) decides what is explored, permanently (D-020). revealScale (~102 m)\n" +
      "decides how it looks. Move the render concern into the renderer.",
  );
  process.exit(1);
}
console.log(
  `Fog/render boundary: ${files} files scanned — no renderer import in src/domain, no revealScale under src/.`,
);
