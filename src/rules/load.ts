/**
 * Reads and validates a rules file. One place that knows where the YAML lives, so the
 * seeder, CI and tests cannot disagree about which file is authoritative.
 *
 * Node-only: it touches the filesystem. The browser reads the registry from T5 (`02` §3.3),
 * never from this file — the YAML is the authority, T5 is a build artefact.
 *
 * Ticket 0028.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { parse } from "yaml"

import { assertValidRuleSet } from "./validate"
import type { RuleSet } from "./schema"

/** Repo root, from this module's location: `<root>/src/rules/load.ts`. */
const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")

export const RULES_DIR = join(ROOT, "rules")

export function rulesPath(version: number): string {
  return join(RULES_DIR, `xp-rules-v${version}.yaml`)
}

/** Parse without validating — for tests that need to assert the validator REJECTS something. */
export function parseRuleSetFile(version: number): unknown {
  return parse(readFileSync(rulesPath(version), "utf8"))
}

/** Parse and validate. Throws `RuleValidationError` listing every problem at once. */
export function loadRuleSet(version: number): RuleSet {
  const parsed = parseRuleSetFile(version)
  assertValidRuleSet(parsed)
  return parsed
}
