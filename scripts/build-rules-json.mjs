#!/usr/bin/env node
// THE RULESET, AS SOMETHING A LAMBDA CAN ACTUALLY READ. Ticket 0047, D-217.
//
// `rules/xp-rules-v*.yaml` is the authority and stays the authority (02 §3.3). This
// script emits a byte-for-byte equivalent `.json` beside each one, for exactly one
// reason: **the ingest worker has no way to read the YAML at runtime.**
//
//   - `src/rules/load.ts` resolves `rules/` from `import.meta.url`, which after esbuild
//     bundling points at the bundle, not at the repo. `readFileSync` there finds nothing.
//   - T5 — the `RuleSkill` DynamoDB table the browser reads (02 §3.3) — does not exist
//     until capability 09 seeds it (ticket 0060).
//   - And the worker MUST read the registry, because D-189 says `revealsGround` decides
//     whether an activity's cells are written at all, and a cell written by mistake is
//     permanent (D-020).
//
// esbuild inlines a JSON import natively, with no loader and no bundling configuration,
// so a generated `.json` is the one format that reaches the Lambda without changing how
// Amplify builds it. The YAML is still what a human edits; this is a build artefact.
//
// COMMITTED, NOT GITIGNORED, and `--check` in CI is why that is safe. An artefact
// regenerated at deploy time is one that can differ between the tree a reviewer reads
// and the bytes that ship. Committing it plus a gate that fails on drift means the diff
// of a rules change shows both halves, which is the point: D-031 promises that adding a
// workout type is a data row, and a reviewer should be able to see the whole row.
//
//   node scripts/build-rules-json.mjs           regenerate
//   node scripts/build-rules-json.mjs --check   exit 1 if any file is out of date

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const RULES_DIR = join(ROOT, "rules");

const YAML_NAME = /^xp-rules-v(\d+)\.yaml$/;

/**
 * `JSON.stringify` with two-space indent and a trailing newline — the same shape a
 * formatter would leave, so the file does not fight the editor. Key ORDER is the YAML's
 * own, because `parse` preserves it and a re-sort would make the diff of a rules change
 * unreadable for no gain.
 */
function render(yamlText) {
  return `${JSON.stringify(parse(yamlText), null, 2)}\n`;
}

const sources = readdirSync(RULES_DIR)
  .filter((n) => YAML_NAME.test(n))
  .sort();

if (sources.length === 0) {
  console.error(`No xp-rules-v*.yaml under ${RULES_DIR} — the scan is wrong, not the tree.`);
  process.exit(1);
}

const check = process.argv.includes("--check");
const stale = [];
let written = 0;

for (const name of sources) {
  const jsonName = name.replace(/\.yaml$/, ".json");
  const yamlPath = join(RULES_DIR, name);
  const jsonPath = join(RULES_DIR, jsonName);

  const want = render(readFileSync(yamlPath, "utf8"));

  let have = null;
  try {
    have = readFileSync(jsonPath, "utf8");
  } catch {
    /* missing counts as stale */
  }

  if (have === want) continue;

  if (check) {
    stale.push(have === null ? `${jsonName} (missing)` : jsonName);
  } else {
    writeFileSync(jsonPath, want);
    console.log(`  wrote  rules/${jsonName}`);
    written++;
  }
}

if (check) {
  if (stale.length) {
    console.error("RULES JSON IS STALE — the YAML changed and the generated file did not:\n");
    for (const s of stale) console.error(`  rules/${s}`);
    console.error("\nRun: node scripts/build-rules-json.mjs");
    console.error(
      "The .json is what the ingest Lambda reads (D-217). A stale one means the deployed\n" +
        "worker is scoring against a ruleset nobody reviewed.",
    );
    process.exit(1);
  }
  console.log(`Rules JSON: ${sources.length} file(s) up to date with their YAML.`);
  process.exit(0);
}

console.log(
  written === 0
    ? `Rules JSON: ${sources.length} file(s) already up to date.`
    : `Rules JSON: ${written} of ${sources.length} file(s) regenerated.`,
);
