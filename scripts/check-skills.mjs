#!/usr/bin/env node
/**
 * Asserts every .claude/skills/<name>/SKILL.md has parseable frontmatter.
 *
 * Ticket 0123: /tickets never registered because its `description` was an
 * unquoted scalar containing "Subcommands: list…". The `: ` makes it invalid
 * YAML, and **Claude Code skips a skill whose frontmatter does not parse with
 * no error anywhere** — the skill is simply absent. Nothing surfaced the
 * failure; it was found by a human typing `/tickets` and seeing nothing.
 *
 * Deliberately a hand-rolled check rather than a YAML dependency: this must run
 * with zero install, and it only needs to catch the class of error that bites —
 * a bare `: ` or ` #` in an unquoted scalar.
 *
 *   node scripts/check-skills.mjs
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SKILLS = join(ROOT, ".claude/skills");
const REQUIRED = ["name", "description"];
let failed = 0;

const problems = (block, label) => {
  const errs = [];
  const keys = new Set();
  const lines = block.split("\n");
  let inFolded = false, foldedIndent = 0;

  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const indent = line.length - line.trimStart().length;
    if (inFolded) {
      if (indent > foldedIndent) return;            // continuation of a folded scalar
      inFolded = false;
    }
    const kv = /^([A-Za-z_][\w-]*):\s?(.*)$/.exec(line);
    if (!kv) { errs.push(`line ${i + 1}: not a key: value pair -> ${line.trim()}`); return; }
    const [, key, raw] = kv;
    keys.add(key);
    const v = raw.trim();
    if (v === ">" || v === "|" || v === ">-" || v === "|-") { inFolded = true; foldedIndent = indent; return; }
    if (/^["'].*["']$/.test(v) || /^\[.*\]$/.test(v) || v === "" || /^(true|false|\d+)$/.test(v)) return;
    // an unquoted plain scalar: ": " or " #" makes it invalid or truncates it
    if (v.includes(": ")) errs.push(`'${key}' is an unquoted scalar containing ": " — invalid YAML. Quote it or use a > folded scalar.`);
    if (/\s#/.test(v)) errs.push(`'${key}' is an unquoted scalar containing " #" — YAML truncates it as a comment. Quote it.`);
  });
  for (const r of REQUIRED) if (!keys.has(r)) errs.push(`missing required key '${r}'`);
  return errs;
};

// Ticket 0137. This used to `console.log("nothing to check")` and exit 0, which
// made "there are no skills" indistinguishable from "I resolved the wrong root
// and looked in the wrong place" — a scanner reporting a pass on a directory it
// never read. The pre-commit hook only invokes this when a SKILL.md is STAGED,
// so an absent skills directory at that moment is self-contradictory. Fail closed.
if (!existsSync(SKILLS)) {
  console.error(`  FAIL  no skills directory at ${SKILLS}`);
  console.error(`        Nothing was scanned, so this is not a pass. Either the`);
  console.error(`        scan root is wrong, or this script is being run from a`);
  console.error(`        tree that does not carry .claude/skills/.`);
  process.exit(1);
}

for (const name of readdirSync(SKILLS)) {
  const f = join(SKILLS, name, "SKILL.md");
  if (!existsSync(f)) continue;
  const m = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(f, "utf8"));
  if (!m) { console.error(`  FAIL  ${name}/SKILL.md: no frontmatter block`); failed++; continue; }
  const errs = problems(m[1], name);
  if (errs.length) {
    failed++;
    console.error(`  FAIL  ${name}/SKILL.md`);
    for (const e of errs) console.error(`          ${e}`);
  } else {
    console.log(`  ok    ${name}/SKILL.md`);
  }
}

if (failed) {
  console.error(`\n  ${failed} skill(s) will be SILENTLY SKIPPED by Claude Code. Fix before committing.\n`);
  process.exit(1);
}
console.log("\n  all skills parse.\n");
