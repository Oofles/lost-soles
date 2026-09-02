#!/usr/bin/env node
/**
 * tickets.mjs — the mechanical half of /tickets.
 *
 * Tickets 0007 (parse, index, list, show, validate), 0008 (mutations) and
 * 0009 (dependency graph, ready set, next, cycles).
 *
 * Design rule, from docs/07-ticketsmith.md §4: this script does everything
 * MECHANICAL — parsing, id allocation, dependency resolution, file moves,
 * validation. The model does everything JUDGEMENTAL — what a ticket means,
 * whether the work is actually done, what to write in ## Resolution.
 * Anything a script can decide deterministically should not cost tokens.
 *
 * No dependencies. Node's stdlib only, so it runs before `npm install` exists.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, basename, relative } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = process.env.TICKETS_ROOT ?? new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const DIRS = { inbox: "tickets/inbox", open: "tickets/open", closed: "tickets/closed" };
const INDEX = "tickets/index.json";

// §3.1 key order. Rewritten files use exactly this order so diffs stay readable.
const FIELD_ORDER = [
  "id", "slug", "title", "type", "priority", "status", "size",
  "capability", "depends_on", "blocked_by", "source",
  "created", "started", "deferred", "closed",
];
const ENUMS = {
  type: ["feature", "bug", "design", "chore", "refactor", "docs"],
  priority: ["high", "med", "low"],
  status: ["inbox", "open", "blocked", "deferred", "closed"],
  size: ["s", "m", "l"],
  source: ["ui", "agent", "operator"],
};
const PRIO_RANK = { high: 0, med: 1, low: 2 };
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Title → slug, for `create` when no --slug is given.
 *
 * The trim runs AFTER the truncation, and the order is the entire point (0127).
 * Trimming first and slicing second lets the 60-character cut land on a word
 * boundary and reintroduce the exact hyphen the trim just removed — SLUG_RE
 * then rejects it and `create` dies, so any title long enough to truncate on a
 * boundary could not be created without passing --slug by hand.
 *
 * A title with no alphanumerics yields "", which SLUG_RE rejects. That is
 * deliberate: better a loud refusal than a ticket with an empty slug.
 */
const slugify = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "");

// ─────────────────────────────────────────────────────────── frontmatter ────
// Deliberately NOT a YAML library: the frontmatter is a fixed, flat schema, and
// a real YAML parser would happily accept nested structures the format does not
// allow, then silently reformat them on write. This parser round-trips or fails.

function parse(raw, path) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) return { fm: null, body: raw, order: [], error: "no frontmatter block" };
  const fm = {};
  const order = [];
  for (const line of m[1].split("\n")) {
    if (!line.trim()) continue;
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!kv) return { fm: null, body: m[2], order, error: `unparseable frontmatter line: ${line}` };
    const [, k, rawV] = kv;
    order.push(k);
    const v = rawV.trim();
    if (/^\[.*\]$/.test(v)) fm[k] = v.slice(1, -1).trim() ? v.slice(1, -1).split(",").map((x) => Number(x.trim())) : [];
    else if (/^-?\d+$/.test(v)) fm[k] = Number(v);
    else fm[k] = v.replace(/^["'](.*)["']$/, "$1");
  }
  return { fm, body: m[2], order, error: null, path };
}

function serialize(fm, body) {
  const keys = [...FIELD_ORDER.filter((k) => k in fm), ...Object.keys(fm).filter((k) => !FIELD_ORDER.includes(k))];
  const lines = keys.map((k) => {
    const v = fm[k];
    if (Array.isArray(v)) return `${k}: [${v.join(", ")}]`;
    return `${k}: ${v}`;
  });
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

/**
 * A criterion prefixed `(operator)` — bare or bolded, any case — is one only a
 * human at a device can check. Ticket 0010 marked such a criterion in prose,
 * ticked it anyway, and shipped a skill that never registered (0123, 0124).
 * The marker exists so the two kinds of tick stop being the same character.
 */
const OPERATOR_MARK = /^\*{0,2}\((?:operator)\)\*{0,2}[:\s]\s*/i;

/**
 * A ticked operator criterion must carry its evidence inline: a dated result,
 * next to the claim it supports. The dash may be em, en or hyphen and the
 * wording of the result is free — only the shape is checked, because the point
 * is to force an explicit dated statement, not to parse one.
 */
const SIGN_OFF = /[—–-]\s*verified\s+(\d{4}-\d{2}-\d{2})\s*:\s*\S/i;

/**
 * Checkboxes under "## Acceptance criteria" only, stopping at the next "##".
 *
 * Continuation lines (indented, not themselves a checkbox) fold into the
 * criterion above them. Without that, a sign-off would go unseen on exactly
 * the criteria long enough to wrap — the rule would fail open where it is
 * needed most.
 */
function acceptance(body) {
  const lines = body.split("\n");
  let inSec = false;
  const items = [];
  for (const l of lines) {
    if (/^##\s/.test(l)) { inSec = /^##\s+Acceptance criteria\s*$/i.test(l); continue; }
    if (!inSec) continue;
    const m = /^\s*-\s+\[( |x|X)\]\s*(.*)$/.exec(l);
    if (m) { items.push({ checked: m[1] !== " ", text: m[2].trim() }); continue; }
    if (items.length && /^\s+\S/.test(l)) items[items.length - 1].text += " " + l.trim();
  }

  const criteria = items.map(({ checked, text }) => {
    const operator = OPERATOR_MARK.test(text);
    return { checked, text, operator, signed: operator && SIGN_OFF.test(text) };
  });

  return {
    criteria,
    total: criteria.length,
    checked: criteria.filter((c) => c.checked).length,
    unchecked: criteria.filter((c) => !c.checked).map((c) => c.text),
    // Operator criteria still awaiting a human — the ones that must block a close.
    pendingOperator: criteria.filter((c) => c.operator && !c.checked).map((c) => c.text),
    // Ticked, but with no dated result: the 0010 failure, now machine-visible.
    unsignedOperator: criteria.filter((c) => c.operator && c.checked && !c.signed).map((c) => c.text),
  };
}

const hasSection = (body, name) => new RegExp(`^##\\s+${name}\\s*$`, "im").test(body);

/**
 * The `## Deferred` section: why the wait, and the cheap test that says it is over.
 *
 * `deferred` (0136) is for work that is specified, correct, and unworkable because
 * something OUTSIDE the project has not happened yet. It is not `blocked` —
 * `blocked_by` holds ticket ids, and there is no ticket for "npm fixes its
 * tarballs". It is not `open`, which claims the work is available and makes every
 * future session re-derive that it is not.
 *
 * Both halves are mandatory and `validate` errors without them. A deferral with no
 * reason is indistinguishable from a ticket nobody got to; a deferral with no
 * re-check is a wait with no end condition, which is how a ticket goes quiet for a
 * year. The re-check is a fenced shell block rather than a frontmatter field
 * because the frontmatter parser is deliberately flat and one-line, and a real
 * re-check is not — 0128's is three commands.
 *
 * The block is RUN by `recheck` and REPORTED. Nothing un-defers on its own: leaving
 * the state is `resume`, typed by someone who read the result. A ticket that
 * silently un-defers is a ticket nobody looks at.
 */
function deferral(body) {
  let inSec = false, found = false;
  const sec = [];
  for (const l of body.split("\n")) {
    if (/^##\s/.test(l)) { inSec = /^##\s+Deferred\s*$/i.test(l); if (inSec) found = true; continue; }
    if (inSec) sec.push(l);
  }
  const reason = (sec.map((l) => /^\*\*Reason:\*\*\s*(.*)$/.exec(l.trim())).find(Boolean)?.[1] ?? "").trim();
  const open = sec.findIndex((l) => /^```[a-z]*\s*$/.test(l.trim()));
  let recheck = "";
  if (open !== -1) {
    const rest = sec.slice(open + 1);
    const end = rest.findIndex((l) => l.trim() === "```");
    // An unterminated fence yields "", which validate reports. Guessing where the
    // block ends would silently hand `bash -c` the rest of the ticket.
    if (end !== -1) recheck = rest.slice(0, end).join("\n").trim();
  }
  return { found, reason, recheck };
}

/** The section `defer` writes. The doctrine is in the file, not only in the script. */
const deferredSection = (reason, recheck, id) => [
  "",
  "## Deferred",
  "",
  `**Reason:** ${reason}`,
  "",
  "**Re-check** — the cheap test that says the wait is over. `tickets.mjs recheck " + pad(id) + "`",
  "runs it and reports the result; nothing un-defers on its own. When it exits 0, read the",
  "output and `tickets.mjs resume " + pad(id) + "`.",
  "",
  "```sh",
  recheck,
  "```",
  "",
].join("\n");

/** Insert a block immediately after the named section, or at the end if absent. */
function insertAfterSection(body, after, block) {
  const lines = body.split("\n");
  const i = lines.findIndex((l) => new RegExp(`^##\\s+${after}\\s*$`, "i").test(l));
  if (i === -1) return body.replace(/\s*$/, "\n") + block;
  let j = i + 1;
  while (j < lines.length && !/^##\s/.test(lines[j])) j++;
  while (j > i + 1 && !lines[j - 1].trim()) j--;   // keep the blank line before the next heading
  return [...lines.slice(0, j), ...block.split("\n"), ...lines.slice(j)].join("\n");
}

/**
 * `resume` renames the heading rather than deleting the section: the record of what
 * was waited on, and why, is worth more than a tidy file. Renaming also means a
 * second deferral opens a FRESH `## Deferred` — without it, `deferral()` would read
 * the stale re-check from the first one and `recheck` would run the wrong test.
 */
function closeDeferredSection(body, stamp, note) {
  const lines = body.split("\n");
  const i = lines.findIndex((l) => /^##\s+Deferred\s*$/i.test(l));
  if (i === -1) return body;
  let j = i + 1;
  while (j < lines.length && !/^##\s/.test(lines[j])) j++;
  let k = j;
  while (k > i + 1 && !lines[k - 1].trim()) k--;
  lines[i] = `## Deferred — resumed ${stamp}`;
  return [...lines.slice(0, k), "", note, "", ...lines.slice(j)].join("\n");
}

/**
 * Which `## sections` a ticket body must carry, and under what condition.
 *
 * One table rather than a rule per condition: `07-ticketsmith.md` §3 makes the
 * four base sections normative for every ticket, and until 0126 §4.7's rule
 * list carried no check for them — so a frontmatter-only file with no body at
 * all validated clean (D-170). A table is also how `create` already thinks, and
 * the generator writing sections the validator does not require is the drift
 * that let the two halves of the spec disagree unnoticed.
 *
 * Rule names stay distinct rather than collapsing to one: 'this bug has no
 * repro steps' and 'this ticket has no body' want different reactions.
 *
 * Inbox items are exempt entirely (§2.3) — they are free-form captures typed
 * on a phone, and triage is what supplies structure. Before 0126 the `bug`
 * check ran in every folder, so capturing "fog flickers when panning" as a bug
 * from the phone turned the whole backlog red.
 */
const SECTION_RULES = [
  { rule: "missing-section", applies: () => true,
    sections: ["Description", "Acceptance criteria", "Notes", "Operator validation"] },
  { rule: "bug-section", applies: (fm) => fm.type === "bug",
    sections: ["Steps to reproduce", "Expected vs actual"] },
  { rule: "design-section", applies: (fm) => fm.type === "design",
    sections: ["Options considered", "Open questions"] },
  { rule: "closed-section", applies: (fm, folder) => folder === "closed",
    sections: ["Resolution"] },
];

/** Every required section a ticket is missing, as [{rule, section}]. */
function missingSections(fm, body, folder) {
  if (folder === "inbox") return [];
  return SECTION_RULES
    .filter((r) => r.applies(fm, folder))
    .flatMap((r) => r.sections.filter((s) => !hasSection(body, s)).map((s) => ({ rule: r.rule, section: s })));
}

// ──────────────────────────────────────────────────────────────── loading ────

function load() {
  const tickets = [];
  for (const [folder, dir] of Object.entries(DIRS)) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs).filter((f) => f.endsWith(".md")).sort()) {
      const path = join(dir, f);
      const raw = readFileSync(join(ROOT, path), "utf8");
      const p = parse(raw, path);
      tickets.push({ ...p, folder, file: f, raw, path, mtime: statSync(join(ROOT, path)).mtime });
    }
  }
  return tickets;
}

const byId = (ts) => new Map(ts.filter((t) => t.fm && typeof t.fm.id === "number").map((t) => [t.fm.id, t]));

// ─────────────────────────────────────────────────── graph: ready + cycles ────

/**
 * ready(T) ⟺ status ∈ {open, blocked} ∧ blocked_by = [] ∧ ∀d ∈ depends_on: closed
 * A non-empty blocked_by is NEVER ready, regardless of depends_on (0009).
 */
function isReady(t, index) {
  if (!t.fm) return false;
  if (!["open", "blocked"].includes(t.fm.status)) return false;
  if ((t.fm.blocked_by ?? []).length > 0) return false;
  return (t.fm.depends_on ?? []).every((d) => index.get(d)?.fm?.status === "closed");
}

/** Every cycle over depends_on ∪ blocked_by, each returned in cycle order. */
function findCycles(index) {
  const edges = new Map();
  for (const [id, t] of index) edges.set(id, [...(t.fm.depends_on ?? []), ...(t.fm.blocked_by ?? [])].filter((d) => index.has(d)));
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map([...index.keys()].map((k) => [k, WHITE]));
  const cycles = [];
  const seen = new Set();
  const stack = [];
  function dfs(u) {
    color.set(u, GREY); stack.push(u);
    for (const v of edges.get(u) ?? []) {
      if (color.get(v) === GREY) {
        const cyc = stack.slice(stack.indexOf(v));
        const key = [...cyc].sort((a, b) => a - b).join(",");
        if (!seen.has(key)) { seen.add(key); cycles.push([...cyc, v]); }
      } else if (color.get(v) === WHITE) dfs(v);
    }
    color.set(u, BLACK); stack.pop();
  }
  for (const id of [...index.keys()].sort((a, b) => a - b)) if (color.get(id) === WHITE) dfs(id);
  return cycles;
}

function readySet(tickets) {
  const index = byId(tickets);
  return tickets
    .filter((t) => isReady(t, index))
    .sort((a, b) => (PRIO_RANK[a.fm.priority] ?? 9) - (PRIO_RANK[b.fm.priority] ?? 9) || a.fm.id - b.fm.id);
}

// ──────────────────────────────────────────────────────────────── validate ────

function validate(tickets) {
  const errors = [], warnings = [];
  const index = byId(tickets);
  const seenIds = new Map();
  const caps = existsSync(join(ROOT, "docs/capabilities"))
    ? new Set(readdirSync(join(ROOT, "docs/capabilities")).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)))
    : new Set();

  for (const t of tickets) {
    const E = (rule, msg) => errors.push({ path: t.path, rule, msg });
    const W = (rule, msg) => warnings.push({ path: t.path, rule, msg });

    if (!t.fm) { E("frontmatter", t.error ?? "missing frontmatter"); continue; }
    const { fm, body, folder } = t;

    const required = folder === "inbox"
      ? ["title", "type", "priority", "status", "source", "created"]
      : ["id", "slug", "title", "type", "priority", "status", "size", "capability", "depends_on", "blocked_by", "source", "created"];
    for (const k of required) if (!(k in fm)) E("required-field", `missing required field '${k}'`);

    for (const [k, allowed] of Object.entries(ENUMS)) {
      if (k in fm && !allowed.includes(fm[k])) E("enum", `${k}='${fm[k]}' is not one of ${allowed.join("|")}`);
    }

    if (folder !== "inbox") {
      const expect = `${String(fm.id).padStart(4, "0")}-${fm.slug}.md`;
      if (t.file !== expect) E("filename", `filename '${t.file}' does not match id+slug ('${expect}')`);
      if (typeof fm.slug === "string" && !SLUG_RE.test(fm.slug)) E("slug", `slug '${fm.slug}' is not kebab-case`);
      if (seenIds.has(fm.id)) E("duplicate-id", `id ${fm.id} also used by ${seenIds.get(fm.id)}`);
      else seenIds.set(fm.id, t.path);
    }

    const folderStatus = { inbox: ["inbox"], open: ["open", "blocked", "deferred"], closed: ["closed"] }[folder];
    if (fm.status && !folderStatus.includes(fm.status)) E("status-folder", `status '${fm.status}' disagrees with folder '${folder}/'`);

    const blocked = (fm.blocked_by ?? []).length > 0;
    if (blocked && fm.status !== "blocked") E("blocked-status", `blocked_by is non-empty but status is '${fm.status}'`);
    if (!blocked && fm.status === "blocked") E("blocked-status", `status is 'blocked' but blocked_by is empty`);

    // A deferral must say what it is waiting on and how anyone would know it is
    // over. Neither is optional, because a deferred ticket is one nobody will look
    // at again until something makes them (0136).
    if (fm.status === "deferred") {
      const d = deferral(body);
      if (!("deferred" in fm)) E("deferred-stamp", "status is 'deferred' but there is no 'deferred:' timestamp");
      if (!d.found) E("deferred-section", "status is 'deferred' but there is no '## Deferred' section");
      else {
        if (!d.reason) E("deferred-reason", "'## Deferred' has no '**Reason:**' line — what is this waiting on?");
        if (!d.recheck) E("deferred-recheck", "'## Deferred' has no fenced re-check block — a wait with no end condition");
      }
    } else if ("deferred" in fm) {
      E("deferred-stamp", `'deferred:' is present on a ticket whose status is '${fm.status}'`);
    }

    for (const field of ["depends_on", "blocked_by"]) {
      for (const d of fm[field] ?? []) {
        if (!index.has(d)) E("dangling-ref", `${field} references ticket ${d}, which does not exist`);
        if (d === fm.id) E("self-edge", `${field} references itself`);
      }
    }

    // Folder-independent on purpose: a ticked operator criterion with no dated
    // result is wrong the moment it is written, not merely once the ticket
    // closes. Catching it in open/ is the difference between a refusal and a
    // post-mortem (0124).
    for (const c of acceptance(body).unsignedOperator) {
      E("operator-unsigned", `operator criterion is ticked with no '— verified <date>: <result>': "${c}"`);
    }

    for (const { rule, section } of missingSections(fm, body, folder)) {
      E(rule, `missing '## ${section}'`);
    }

    if (folder === "closed") {
      if (!("closed" in fm)) E("closed-stamp", "closed ticket has no 'closed:' timestamp");
      const { unchecked } = acceptance(body);
      if (unchecked.length) E("closed-unchecked", `closed with ${unchecked.length} unchecked acceptance criteria`);
    } else if ("closed" in fm) {
      E("closed-stamp", `'closed:' is present on a ticket in ${folder}/`);
    }

    // warnings
    // Scoped to work that might still be DONE. The warning's job is "this
    // feature has no home in the roadmap, decide where it goes" — which is not
    // a question anyone will answer about a capture that was declined or merged
    // at triage (0023). Without this, every decline leaves a permanent warning,
    // and a warning list that only grows is one people stop reading.
    if (folder !== "closed" && fm.type === "feature" && (fm.capability === "null" || fm.capability == null)) {
      W("no-capability", "feature ticket has no capability");
    }
    if (fm.capability && fm.capability !== "null" && !caps.has(fm.capability)) W("missing-capability-doc", `no docs/capabilities/${fm.capability}.md`);
    if (fm.size === "l" && isReady(t, index)) W("size-l-ready", "size:l ticket is in the ready set — split it");
    if (folder === "inbox" && Date.now() - t.mtime.getTime() > 14 * 864e5) W("stale-inbox", "inbox item older than 14 days");
    for (const k of t.order) if (!FIELD_ORDER.includes(k)) W("unknown-key", `unknown frontmatter key '${k}' (preserved)`);
  }

  for (const cyc of findCycles(index)) {
    errors.push({ path: "(graph)", rule: "cycle", msg: `dependency cycle: ${cyc.map((i) => String(i).padStart(4, "0")).join(" → ")}` });
  }
  return { errors, warnings };
}

// ─────────────────────────────────────────────────────────────────── index ────

function buildIndex(tickets) {
  const index = byId(tickets);
  return tickets
    .filter((t) => t.fm)
    .map((t) => {
      const { checked, total } = acceptance(t.body);
      const entry = {};
      for (const k of FIELD_ORDER) if (k in t.fm) entry[k] = t.fm[k];
      for (const k of Object.keys(t.fm)) if (!(k in entry)) entry[k] = t.fm[k];
      return { ...entry, path: t.path, ready: isReady(t, index), acceptance: { checked, total } };
    })
    .sort((a, b) => (a.id ?? 1e9) - (b.id ?? 1e9) || String(a.path).localeCompare(String(b.path)));
}

function writeIndex(tickets = load()) {
  const data = buildIndex(tickets);
  writeFileSync(join(ROOT, INDEX), JSON.stringify(data, null, 2) + "\n");
  return data;
}

// ─────────────────────────────────────────────────────────────────── audit ────

/**
 * `AUDIT.md`'s mechanical half (D-153), ticket 0133.
 *
 * Every check returns one of three verdicts, and the third is the point:
 *
 *   pass  ran, and was green
 *   fail  ran, and was red
 *   na    could NOT run — with a reason naming what would make it applicable
 *
 * Most of AUDIT.md targets application code that does not exist yet. Collapsing
 * "could not check" into "checked" would make the audit read green while
 * checking almost nothing, and capability 01's hand-run audit already named the
 * failure mode: "a checklist that is 60% dishonest ticks is worse than no
 * checklist." An `na` with no reason is therefore a bug, not a shortcut — same
 * rule as a ticked (operator) criterion with no sign-off (D-169).
 *
 * This command is advisory and writes nothing. The recorded result, the
 * divergence list and the drift budget are 0134; the gate in `next` is 0135.
 */
const PASS = (id, section, detail) => ({ id, section, status: "pass", detail });
const FAIL = (id, section, detail) => ({ id, section, status: "fail", detail });
const NA = (id, section, reason) => ({ id, section, status: "na", detail: reason });

/** Run a command, and report only whether it succeeded — audits are not test runners. */
function runCheck(cmd, args, { timeout = 300_000 } = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", timeout });
  if (r.error && r.error.code === "ETIMEDOUT") return { ok: false, detail: `timed out after ${timeout / 1000}s` };
  if (r.error) return { ok: false, detail: r.error.message };
  const out = ((r.stdout ?? "") + (r.stderr ?? "")).trim().split("\n").filter(Boolean);
  return { ok: r.status === 0, detail: out.length ? out[out.length - 1].slice(0, 160) : `exit ${r.status}` };
}

const pkgScripts = () => {
  try { return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts ?? {}; }
  catch { return null; }
};

/** An npm script check: na when there is no package.json, or no such script in it. */
function npmCheck(id, section, script) {
  const scripts = pkgScripts();
  if (scripts === null) return NA(id, section, "no package.json at the repo root yet — applies once the app exists (ticket 0012)");
  if (!scripts[script]) return NA(id, section, `package.json has no '${script}' script — add one to activate this check`);
  const { ok, detail } = runCheck("npm", ["run", "--silent", script]);
  return ok ? PASS(id, section, `npm run ${script}`) : FAIL(id, section, detail);
}

/**
 * The invariant sweep. `02-data-model.md` §9 numbers its invariants `I-n`
 * precisely so tests can cite them, so the sweep is a citation check: which
 * invariants does a test actually name?
 *
 * It stays `na` until at least one test cites one. That is deliberate rather
 * than lenient — reporting 30 uncited invariants as failures on a repo with no
 * domain model would be noise that trains everyone to ignore the row, and the
 * reason string names exactly what switches it on.
 */
function invariantSweep() {
  const doc = join(ROOT, "docs/02-data-model.md");
  const S = "1";
  if (!existsSync(doc)) return NA("invariant-sweep", S, "docs/02-data-model.md does not exist");
  const invariants = [...readFileSync(doc, "utf8").matchAll(/^\|\s*\*\*(I-\d+)\*\*\s*\|(.*)$/gm)]
    .map((m) => ({ id: m[1], structural: m[2].includes("[S]") }));
  if (!invariants.length) return NA("invariant-sweep", S, "no `| **I-n** |` rows found in 02-data-model.md §9");

  const tests = testFiles();
  const cited = new Set();
  for (const f of tests) {
    for (const m of readFileSync(f, "utf8").matchAll(/\bI-\d+\b/g)) cited.add(m[0]);
  }
  if (!cited.size) {
    return NA("invariant-sweep", S,
      `${invariants.length} invariants declared, none cited by any test yet — activates as soon as one test names an I-n (the domain model starts at capability 04)`);
  }
  const missing = invariants.filter((i) => !cited.has(i.id));
  if (!missing.length) return PASS("invariant-sweep", S, `all ${invariants.length} invariants cited by a test`);
  return FAIL("invariant-sweep", S,
    `${missing.length}/${invariants.length} invariants have no citing test: ${missing.map((i) => i.id + (i.structural ? " [S]" : "")).join(", ")}`);
}

/**
 * Test files under the APPLICATION roots only — not the whole repo.
 *
 * The `I-n` invariants are properties of the data model, enforced in app code
 * and CI assertions; the ticket tooling under `.claude/` is not where they
 * live. Scanning everything looked equivalent and was not: 0133's own test
 * carries `| **I-1** |` rows as *fixture data*, which activated the invariant
 * sweep against the real backlog and reported 28 uncited invariants. A sweep
 * that can be tripped by the string that describes it is worse than no sweep.
 */
const APP_ROOTS = ["src", "app", "lib", "scripts"];

function testFiles(roots = APP_ROOTS, acc = []) {
  for (const r of roots) {
    const abs = join(ROOT, r);
    if (!existsSync(abs)) continue;
    walkTests(abs, acc);
  }
  return acc;
}

function walkTests(dir, acc) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === ".next") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walkTests(p, acc);
    else if (/\.test\.(ts|tsx|mjs|js)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function auditChecks(capability, tickets) {
  const checks = [];

  // ── §1 automated ──────────────────────────────────────────────────────────
  checks.push(npmCheck("typecheck", "1", "typecheck"));
  checks.push(npmCheck("lint", "1", "lint"));
  checks.push(npmCheck("unit-tests", "1", "test"));

  // The node:test suite is a separate gate from vitest (D-160) and predates it.
  const scriptTests = join(ROOT, ".claude/skills/tickets/scripts/tickets.test.mjs");
  if (!existsSync(scriptTests)) {
    checks.push(NA("script-tests", "1", "no tickets.test.mjs — the node:test suite (D-160) does not exist here"));
  } else {
    // The explicit file path, never the directory form: `node --test <dir>` tries
    // to execute tickets.mjs itself, which prints usage and exits 1. Recorded in
    // capability 01's audit; repeated here so nobody "helpfully" shortens it.
    const { ok, detail } = runCheck("node", ["--test", scriptTests]);
    checks.push(ok ? PASS("script-tests", "1", "node --test tickets.test.mjs") : FAIL("script-tests", "1", detail));
  }

  checks.push(invariantSweep());

  const boundaries = join(ROOT, "scripts/check-boundaries.mjs");
  if (!existsSync(boundaries)) {
    checks.push(NA("boundary-greps", "1", "scripts/check-boundaries.mjs does not exist — D-100's grep gate lands with the domain layer"));
  } else {
    const { ok, detail } = runCheck("node", [boundaries]);
    checks.push(ok ? PASS("boundary-greps", "1", "check-boundaries.mjs clean") : FAIL("boundary-greps", "1", detail));
  }

  const vigil = testFiles().filter((f) => /vigil/i.test(f));
  checks.push(vigil.length
    ? (() => { const { ok, detail } = runCheck("npx", ["vitest", "run", ...vigil]);
               return ok ? PASS("vigil-test", "1", vigil.map((f) => relative(ROOT, f)).join(", ")) : FAIL("vigil-test", "1", detail); })()
    : NA("vigil-test", "1", "no vigil test exists yet — ticket 0030 puts it permanently in CI (D-031/D-141)"));

  const { errors } = validate(tickets);
  checks.push(errors.length
    ? FAIL("validate", "1", `${errors.length} validation error(s): ${errors.slice(0, 3).map((e) => e.rule).join(", ")}`)
    : PASS("validate", "1", "0 errors across open/ and closed/"));

  // ── §4 regression, the scriptable rows ────────────────────────────────────
  checks.push(NA("fog-no-refog", "4",
    "no explored blob or fog pipeline exists yet — activates with capability 07 (D-020, I-7)"));
  checks.push(NA("xp-not-lower", "4",
    "no XP ledger exists yet — activates with capability 09 (D-135, I-16)"));

  // ── §5 hygiene ────────────────────────────────────────────────────────────
  const byIdx = byId(tickets);
  const staleBlocks = tickets.filter((t) => t.fm)
    .flatMap((t) => (t.fm.blocked_by ?? [])
      .filter((d) => byIdx.get(d)?.fm?.status === "closed")
      .map((d) => `${pad(t.fm.id)} blocked_by ${pad(d)} (closed)`));
  checks.push(staleBlocks.length
    ? FAIL("blocked-by-closed", "5", staleBlocks.join("; "))
    : PASS("blocked-by-closed", "5", "no blocked_by points at a closed ticket"));

  // A `deferred` ticket (0136) does not hold a capability open: it is correct,
  // specified, and waiting on something the project does not control. It IS named
  // in both the row and the recorded audit, so a capability that passed with three
  // deferrals never reads as one that passed clean.
  const mine = tickets.filter((t) => t.fm?.capability === capability);
  const deferredInCap = mine.filter((t) => t.fm.status === "deferred");
  const openInCap = mine.filter((t) => !["closed", "deferred"].includes(t.fm.status));
  const defNote = deferredInCap.length
    ? `; ${deferredInCap.length} deferred (${deferredInCap.map((t) => pad(t.fm.id)).join(", ")})`
    : "";
  checks.push(openInCap.length
    ? FAIL("capability-tickets-closed", "5",
        `${openInCap.length} still open: ${openInCap.map((t) => pad(t.fm.id)).join(", ")}${defNote}`)
    : PASS("capability-tickets-closed", "5", `${mine.length - deferredInCap.length} closed${defNote}`));

  return checks;
}

// ──────────────────────────────────────────────────────── the audit record ────

/**
 * An audit result is recorded in `docs/capabilities/NN-name.md` as ONE line:
 *
 *   <!-- audit-record {"capability":"01-…","verdict":"pass",…} -->
 *
 * A single-line HTML comment carrying JSON, not a parsed prose section (D-172).
 * `0135` has to answer "did capability N pass its audit?" without a human, and
 * parsing prose for that answer is how the record starts lying — a heading
 * someone reworded silently becomes a capability that never passed, or worse,
 * one that did. The comment renders invisibly, cannot collide with prose, and
 * sits underneath the human-readable write-up rather than replacing it.
 *
 * Records are append-only. A re-audit adds a line; the last one wins. The
 * project's instincts everywhere else are append-only (D-020, D-135) and an
 * audit history you can read backwards is worth more than a current-value field.
 */
const RECORD_RE = /<!--\s*audit-record\s+(\{.*?\})\s*-->/g;

function auditRecords(capability) {
  const doc = join(ROOT, `docs/capabilities/${capability}.md`);
  if (!existsSync(doc)) return [];
  const out = [];
  for (const m of readFileSync(doc, "utf8").matchAll(RECORD_RE)) {
    try { out.push(JSON.parse(m[1])); } catch { /* a malformed record is not a passing one */ }
  }
  return out;
}

/** The audit standing for a capability right now, or null if it has never passed. */
function latestAuditRecord(capability) {
  const rs = auditRecords(capability);
  return rs.length ? rs[rs.length - 1] : null;
}

/**
 * Has the capability got a REFLECT section with something actually in it?
 *
 * Every capability doc ships with `## Reflection` already present and holding
 * the template line `_Filled in at the REFLECT step, after USE._`. Checking
 * that the heading exists would therefore pass every capability from the day
 * its doc was created — a green light that means nothing, which is exactly what
 * D-171 exists to prevent. So: find every heading matching /reflect/i (capability
 * 00 keeps its real one at `### §6 Reflection` inside the hand-run audit), strip
 * italic placeholder lines, and require substance in what is left.
 */
function reflectSection(capability) {
  const doc = join(ROOT, `docs/capabilities/${capability}.md`);
  if (!existsSync(doc)) return { found: false, filled: false, chars: 0 };
  const lines = readFileSync(doc, "utf8").split("\n");
  let depth = 0, body = [], found = false;
  for (const l of lines) {
    const h = /^(#{2,6})\s+(.*)$/.exec(l);
    if (h) {
      if (/reflect/i.test(h[2])) { found = true; depth = h[1].length; continue; }
      if (depth && h[1].length <= depth) depth = 0;
      continue;
    }
    if (depth) body.push(l);
  }
  const substantive = body
    .filter((l) => l.trim())
    .filter((l) => !/^_.*_$/.test(l.trim()))          // `_Filled in at the REFLECT step_`
    .filter((l) => !/^<!--.*-->$/.test(l.trim()));
  const chars = substantive.join(" ").length;
  return { found, filled: chars >= 200, chars };
}

const DIVERGENCE_RESOLUTIONS = ["code-was-wrong", "design-was-wrong"];

/**
 * `--divergence "code-was-wrong|0127|create could not derive a valid slug"`
 *
 * The resolution and the reference are both mandatory, because AUDIT.md's
 * governing rule is that a divergence resolves one way or the other and
 * "neither" is not an outcome. A divergence with no ticket and no `D-xxx` is
 * the "we'll remember" that the rule exists to forbid.
 */
function parseDivergence(raw) {
  const parts = String(raw).split("|").map((x) => x.trim());
  const [resolution, ref, ...rest] = parts;
  const description = rest.join(" | ");
  if (!DIVERGENCE_RESOLUTIONS.includes(resolution)) {
    die(`divergence '${raw}'\n` +
        `  must start with one of: ${DIVERGENCE_RESOLUTIONS.join(", ")}\n` +
        `  format: --divergence "<resolution>|<ref>|<description>"\n\n` +
        `  'code-was-wrong' means a ticket was filed; 'design-was-wrong' means the doc was\n` +
        `  amended and a D-xxx recorded. AUDIT.md allows no third option — "we'll remember"\n` +
        `  is the drift, not a resolution of it.`);
  }
  if (!ref) die(`divergence '${raw}' has no reference.\n` +
                `  code-was-wrong needs the ticket id it was filed as; design-was-wrong needs\n` +
                `  the D-xxx that records the amendment. An unreferenced divergence is unresolved.`);
  if (!description) die(`divergence '${raw}' has no description. Say what actually diverged.`);
  return { resolution, ref, description };
}

/**
 * Design-doc sections this capability's tickets cite — the reading list for §2.
 *
 * Line-wise rather than one regex over the body, because a citation reads
 * "`07-ticketsmith.md` §3, §4.1–§4.8" and the backticks sit between the two
 * halves. Two constraints keep the list honest:
 *
 *  - `(?<!\d)` so `0121-tickets-audit-subcommand.md` does not yield a phantom
 *    `21-tickets-audit-subcommand.md`; ticket filenames look exactly like
 *    design-doc names from the middle.
 *  - the doc must actually exist at `docs/NN-name.md`. Capability docs share the
 *    naming scheme but live in `docs/capabilities/`, and they are the audit's
 *    output, not its reading list.
 */
function citedSections(capability, tickets) {
  const isDesignDoc = (f) => existsSync(join(ROOT, "docs", f));
  const cites = new Map();
  for (const t of tickets.filter((x) => x.fm?.capability === capability)) {
    for (const line of t.raw.split("\n")) {
      const docs = [...line.matchAll(/(?<!\d)(\d\d-[a-z0-9-]+\.md)/g)].map((m) => m[1]).filter(isDesignDoc);
      if (!docs.length) continue;
      const secs = [...line.matchAll(/§\s*[\d]+(?:\.[\d]+)*/g)].map((m) => m[0].replace(/\s+/g, ""));
      for (const d of docs) {
        if (!cites.has(d)) cites.set(d, new Set());
        for (const sec of secs) cites.get(d).add(sec);
      }
    }
  }
  return [...cites.entries()]
    .map(([doc, secs]) => ({ doc, sections: [...secs].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) }))
    .sort((a, b) => a.doc.localeCompare(b.doc));
}

function cmdAudit(capability, flags) {
  const tickets = load();
  const caps = existsSync(join(ROOT, "docs/capabilities"))
    ? readdirSync(join(ROOT, "docs/capabilities")).filter((f) => /^\d\d-.*\.md$/.test(f)).map((f) => f.slice(0, -3)).sort()
    : [];
  if (!capability) die(`audit requires a capability.\n${caps.map((c) => `    ${c}`).join("\n")}`);
  if (!caps.includes(capability)) {
    die(`no capability '${capability}'. These exist:\n${caps.map((c) => `    ${c}`).join("\n")}`);
  }

  // --sections: the reading list for AUDIT.md §2. Mechanical (which docs did
  // this capability's tickets cite) in service of the judgemental half.
  if (flags.sections) {
    const cited = citedSections(capability, tickets);
    if (flags.json) return console.log(JSON.stringify({ capability, cited }, null, 2));
    if (!cited.length) return console.log(`\n  ${capability} cites no design-doc sections.\n`);
    console.log(`\n  Design sections cited by ${capability}'s tickets — re-read each for §2:\n`);
    for (const { doc, sections } of cited) {
      console.log(`    docs/${doc}${sections.length ? "  " + sections.join(", ") : "  (no § given)"}`);
    }
    console.log(`\n  For each: list every place the implementation differs. An empty list is a`);
    console.log(`  finding to assert with --no-divergences, never an omission.\n`);
    return;
  }

  const checks = auditChecks(capability, tickets);
  const failed = checks.filter((c) => c.status === "fail");
  const na = checks.filter((c) => c.status === "na");

  if (!flags.record) {
    if (flags.json) {
      console.log(JSON.stringify({ capability, checks, passed: !failed.length }, null, 2));
    } else {
      printAuditTable(capability, checks, failed, na);
    }
    if (failed.length) process.exit(1);
    return;
  }

  // ── --record: the full audit, mechanical + the judgemental half's outcome ──
  const force = flags.force;
  if (force === true) die(`--force needs a reason: --force "why this is being overridden".\n` +
                          `  The override is recorded in the capability doc. Skipping is visible, not silent.`);

  const asserted = "no-divergences" in flags;
  const raw = flags.divergence ? [].concat(flags.divergence) : [];
  if (!asserted && !raw.length) {
    die(`${capability}: no divergence assertion.\n\n` +
        `  AUDIT.md §2 asks for every place the implementation differs from the design.\n` +
        `  Pass each as --divergence "<code-was-wrong|design-was-wrong>|<ref>|<description>",\n` +
        `  or assert there were none with --no-divergences.\n\n` +
        `  An empty list must be asserted, never assumed by omission — omission is what a\n` +
        `  skipped §2 also looks like, and the two must not be indistinguishable.`);
  }
  if (asserted && raw.length) die(`--no-divergences was passed alongside ${raw.length} --divergence flag(s). Pick one.`);
  const divergences = raw.map(parseDivergence);

  const problems = [];
  if (failed.length) problems.push(`${failed.length} mechanical check(s) failed: ${failed.map((c) => c.id).join(", ")}`);
  if (divergences.length > 3) {
    problems.push(`${divergences.length} divergences, over the budget of three — the design is stale, not the code.\n` +
                  `    Stop shipping tickets and run a DESIGN session on the affected doc (AUDIT.md §2).`);
  }
  const reflect = reflectSection(capability);
  if (!reflect.filled) {
    problems.push(reflect.found
      ? `the REFLECT section is still a placeholder (${reflect.chars} substantive chars) — AUDIT.md §6`
      : `there is no REFLECT section in docs/capabilities/${capability}.md — AUDIT.md §6`);
  }

  if (problems.length && !force) {
    printAuditTable(capability, checks, failed, na);
    die(`${capability} does not pass its audit:\n` +
        problems.map((p) => `  - ${p}`).join("\n") +
        `\n\n  Nothing was recorded. Fix these, or override with --force "<reason>" — which\n` +
        `  records the override and its reason in the capability doc rather than hiding it.`);
  }

  const record = {
    capability,
    audited: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    verdict: problems.length ? "forced" : "pass",
    mechanical: { pass: checks.length - failed.length - na.length, fail: failed.length, na: na.length },
    divergences: divergences.length,
  };
  const deferredInCap = tickets.filter((t) => t.fm?.capability === capability && t.fm.status === "deferred");
  if (deferredInCap.length) record.deferred = deferredInCap.map((t) => pad(t.fm.id));
  if (problems.length) record.forced = String(force);

  const lines = [
    ``,
    `## Audit — ${record.audited.slice(0, 10)} (\`tickets.mjs audit --record\`)`,
    ``,
    `**Verdict: ${record.verdict.toUpperCase()}.** Mechanical half: ${record.mechanical.pass} passed, ` +
      `${record.mechanical.fail} failed, ${record.mechanical.na} n/a. See AUDIT.md §1, §4, §5.`,
    ``,
  ];
  if (problems.length) {
    lines.push(`> **Overridden with \`--force\`.** Reason: ${force}`, ``,
               ...problems.map((p) => `> - ${p.split("\n")[0]}`), ``);
  }
  if (deferredInCap.length) {
    lines.push(`**Deferred, and therefore excluded from \`capability-tickets-closed\`:** ` +
               deferredInCap.map((t) => `\`${pad(t.fm.id)}\` ${t.fm.title}`).join("; ") +
               `. This capability passed with work outstanding — waiting on something outside the ` +
               `project, not forgotten. \`tickets.mjs recheck\` reports whether any wait is over.`, ``);
  }
  lines.push(divergences.length
    ? `**Divergences (${divergences.length} of a budget of 3):**`
    : `**Divergences: none.** Asserted explicitly at audit time, not left blank.`);
  lines.push(``);
  for (const [i, d] of divergences.entries()) {
    lines.push(`${i + 1}. **${d.resolution}** — \`${d.ref}\` — ${d.description}`);
  }
  if (divergences.length) lines.push(``);
  for (const c of checks) lines.push(`- \`${c.id}\` — **${c.status}** — ${c.detail}`);
  lines.push(``, `<!-- audit-record ${JSON.stringify(record)} -->`, ``);

  const doc = join(ROOT, `docs/capabilities/${capability}.md`);
  writeFileSync(doc, readFileSync(doc, "utf8").replace(/\s*$/, "\n") + lines.join("\n"));

  printAuditTable(capability, checks, failed, na);
  console.log(`  recorded → docs/capabilities/${capability}.md  (verdict: ${record.verdict})`);
  if (problems.length) console.log(`  the override and its reason are in the doc.`);
}

function printAuditTable(capability, checks, failed, na) {
  console.log(`\n  audit ${capability} — AUDIT.md mechanical half (0133)\n`);
  let section = null;
  for (const c of checks) {
    if (c.section !== section) { section = c.section; console.log(`  §${section}`); }
    const mark = { pass: "  ok  ", fail: " FAIL ", na: "  n/a " }[c.status];
    console.log(`   ${mark} ${c.id.padEnd(26)} ${c.detail}`);
  }
  console.log(`\n  ${checks.length - failed.length - na.length} passed, ${failed.length} failed, ${na.length} n/a`);
  console.log(`\n  Mechanical only — a green table is not a passed audit. AUDIT.md §2 (design`);
  console.log(`  conformance) and §3 (operator validation) are judgement: run`);
  console.log(`  'audit ${capability} --sections' for the reading list, then --record, which`);
  console.log(`  also requires an explicit divergence assertion and a written §6 REFLECT.\n`);
}

// ────────────────────────────────────────────────────────────────────  git ────

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

/**
 * `except` is the path of the file this command is itself transitioning.
 * Ticking a ticket's final acceptance criteria is *part of closing it*, so a
 * dirty entry for that exact file is not the "unrelated work in flight" D-158
 * guards against. Without this exemption the honest workflow needs two commits
 * or a routine --allow-dirty, and a rule reached for routinely stops being one.
 */
function requireCleanTree(cmd, allowDirty, except = null) {
  if (allowDirty) return;
  const dirty = git("status", "--porcelain").split("\n").filter(Boolean)
    .filter((l) => !l.includes("tickets/index.json"))
    .filter((l) => !(except && l.includes(except)));
  if (dirty.length) {
    die(`'${cmd}' refuses to run with a dirty working tree (D-158).\n` +
        `  ${dirty.length} uncommitted path(s). This command git-mv's a file and expects to be\n` +
        `  followed by its own commit; running it over unrelated changes produces a commit that\n` +
        `  mixes a ticket transition with whatever else was in flight.\n` +
        `  Commit or stash first, or pass --allow-dirty if you have considered it.`);
  }
}

// ──────────────────────────────────────────────────────────────── commands ────

const die = (msg) => { console.error(`\n  ${msg}\n`); process.exit(1); };
const pad = (n) => String(n).padStart(4, "0");

function cmdIndex(flags) {
  const data = writeIndex();
  if (flags.json) console.log(JSON.stringify(data, null, 2));
  else console.log(`tickets/index.json: ${data.length} tickets, ${data.filter((d) => d.ready).length} ready`);
}

function cmdList(flags) {
  let ts = load().filter((t) => t.fm);
  const index = byId(ts);
  const f = flags;
  if (f.status) ts = ts.filter((t) => t.fm.status === f.status);
  if (f.type) ts = ts.filter((t) => t.fm.type === f.type);
  if (f.priority) ts = ts.filter((t) => t.fm.priority === f.priority);
  if (f.capability) ts = ts.filter((t) => t.fm.capability === f.capability);
  if (f.size) ts = ts.filter((t) => t.fm.size === f.size);
  if (f.ready) ts = ts.filter((t) => isReady(t, index));
  ts.sort((a, b) => (PRIO_RANK[a.fm.priority] ?? 9) - (PRIO_RANK[b.fm.priority] ?? 9) || (a.fm.id ?? 1e9) - (b.fm.id ?? 1e9));
  if (f.json) return console.log(JSON.stringify(ts.map((t) => ({ ...t.fm, path: t.path, ready: isReady(t, index) })), null, 2));
  if (!ts.length) return console.log("no tickets match");
  const w = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
  console.log(`  ${w("ID", 5)}${w("TYPE", 9)}${w("PRI", 5)}${w("SZ", 3)}${w("STATUS", 8)}${w("CAPABILITY", 30)}TITLE`);
  for (const t of ts) {
    console.log(`  ${w(t.fm.id ? pad(t.fm.id) : "—", 5)}${w(t.fm.type, 9)}${w(t.fm.priority, 5)}${w(t.fm.size, 3)}${w(t.fm.status, 8)}${w(t.fm.capability, 30)}${t.fm.title}`);
  }
  console.log(`\n  ${ts.length} ticket(s)`);
}

function cmdShow(id, flags) {
  const ts = load(); const index = byId(ts);
  const t = index.get(Number(id)) ?? die(`no ticket ${id}`);
  if (flags.json) {
    const rel = (f) => (t.fm[f] ?? []).map((d) => ({ id: d, title: index.get(d)?.fm?.title ?? null, status: index.get(d)?.fm?.status ?? "MISSING" }));
    return console.log(JSON.stringify({ ...t.fm, path: t.path, ready: isReady(t, index), depends_on_detail: rel("depends_on"), blocked_by_detail: rel("blocked_by") }, null, 2));
  }
  console.log(t.raw);
  for (const field of ["depends_on", "blocked_by"]) {
    const ids = t.fm[field] ?? [];
    if (!ids.length) continue;
    console.log(`\n  ${field}:`);
    for (const d of ids) {
      const o = index.get(d);
      console.log(`    ${pad(d)}  ${o ? `[${o.fm.status}]`.padEnd(10) + o.fm.title : "*** MISSING ***"}`);
    }
  }
  console.log(`\n  ready: ${isReady(t, index)}`);
  const { pendingOperator } = acceptance(t.body);
  if (pendingOperator.length && t.folder !== "closed") {
    console.log(`  awaiting operator: ${pendingOperator.length} criteri${pendingOperator.length === 1 ? "on" : "a"} — this ticket cannot close until a human runs them`);
  }
}

function cmdValidate(flags) {
  const { errors, warnings } = validate(load());
  if (flags.json) {
    console.log(JSON.stringify({ errors, warnings, ok: errors.length === 0 }, null, 2));
    process.exit(errors.length ? 1 : 0);
  }
  for (const e of errors) console.error(`  ERROR  ${e.path}  [${e.rule}]  ${e.msg}`);
  for (const w of warnings) console.warn(`  warn   ${w.path}  [${w.rule}]  ${w.msg}`);
  console.log(`\n  ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}

/**
 * THE id allocator. Singular, deliberately.
 *
 * 0023's Notes name the failure this prevents: "triage logic must not
 * re-implement id allocation — a second allocator is how two tickets end up
 * with the same id." Before this, `create` and `triage-move` each carried their
 * own `Math.max(...) + 1`, and the four triage outcomes would have made six
 * copies of one rule. Every caller goes through here.
 *
 * Max-plus-one, never count-plus-one and never gap-filling: ids are permanent
 * and never renumbered, so a closed 0042 must not be reissued to a note
 * captured next week.
 */
function nextId(tickets = load()) {
  const ids = tickets.map((t) => t.fm?.id).filter((n) => typeof n === "number");
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function cmdAllocate() {
  console.log(pad(nextId()));
}

/**
 * The capability gate (0135, D-153's teeth).
 *
 * A ticket in capability C is gated while any capability numbered below C — that
 * actually has tickets — has not recorded a passing audit. The blocker reported
 * is the LOWEST-numbered one: capabilities are built in order and audited in
 * order, so the earliest gap is the one that can actually be closed next.
 * Reporting the nearest gap instead sends you to audit 02 while 01 is still
 * outstanding, and you arrive back here one capability later.
 *
 * Expressed as "every lower capability", not "the immediately previous one", so
 * that skipping a capability cannot launder the gap. It also gives criterion 2
 * for free: work *inside* the capability you are in is never gated, because a
 * capability is never below itself. You are blocked from advancing, never from
 * finishing.
 *
 * Enforcement begins at capability 02 (0121): `00` and `01` predate the command
 * that audits them, and that bootstrap gap is closed by 0121's retroactive run
 * rather than by pretending they were gated all along.
 *
 * A `forced` verdict lifts the gate exactly as `pass` does. --force is meant to
 * make skipping *visible*, not impossible (0121); a force that still blocked
 * would just be a refusal with extra steps, and the record says which it was.
 */
const capNumber = (cap) => (typeof cap === "string" && /^\d\d-/.test(cap) ? Number(cap.slice(0, 2)) : null);
const GATE_BEGINS_AT = 2;

function auditBlockers(capability, tickets) {
  const n = capNumber(capability);
  if (n === null || n < GATE_BEGINS_AT) return [];
  const lower = [...new Set(tickets.map((t) => t.fm?.capability).filter((c) => {
    const m = capNumber(c);
    return m !== null && m < n;
  }))].sort();
  return lower.filter((c) => !["pass", "forced"].includes(latestAuditRecord(c)?.verdict));
}

const isGated = (t, tickets) => auditBlockers(t.fm?.capability, tickets).length > 0;

function cmdNext(flags) {
  const ts = load();
  const ready = readySet(ts);
  // isReady already excludes `deferred`, so a deferred ticket is never offered as
  // workable. It is still counted aloud (0136): a backlog that hides its deferrals
  // is one where "nothing is ready" and "everything is waiting on npm" look alike.
  const deferred = ts.filter((t) => t.fm?.status === "deferred").sort((a, b) => a.fm.id - b.fm.id);
  const defTail = deferred.length
    ? `\n\n  ${deferred.length} ticket(s) are deferred, waiting on something outside the project:\n` +
      deferred.map((t) => `    ${pad(t.fm.id)}  ${t.fm.title}`).join("\n") +
      `\n  'tickets.mjs recheck' runs their re-checks and reports; it never un-defers.`
    : "";
  if (!ready.length) {
    const open = ts.filter((t) => t.fm && ["open", "blocked"].includes(t.fm.status));
    if (!open.length) die(`nothing open. Every ticket is closed, deferred or in the inbox.${defTail}`);
    die(`nothing is ready. ${open.length} ticket(s) are open, but all are blocked or waiting on\n` +
        `  unclosed dependencies. Run 'tickets.mjs list --status blocked' to see why.${defTail}`);
  }

  const gate = new Map(ready.map((t) => [t.fm.id, auditBlockers(t.fm.capability, ts)]));
  const open_ = ready.filter((t) => !gate.get(t.fm.id).length);

  if (flags.all) {
    // The gate refuses to hand over work; it does not hide the backlog.
    for (const t of ready) {
      const blockers = gate.get(t.fm.id);
      const mark = blockers.length ? `[GATED on ${blockers[0]}] ` : "";
      console.log(`  ${pad(t.fm.id)}  ${t.fm.priority.padEnd(5)}${t.fm.size === "l" ? "[SIZE:L — SPLIT] " : ""}${mark}${t.fm.title}`);
    }
    for (const t of deferred) {
      console.log(`  ${pad(t.fm.id)}  ${t.fm.priority.padEnd(5)}[DEFERRED] ${t.fm.title}`);
    }
    console.log(`\n  ${ready.length} ready` +
      `${ready.length - open_.length ? `, ${ready.length - open_.length} gated on an unaudited capability` : ""}` +
      `${deferred.length ? `, ${deferred.length} deferred on something outside the project` : ""}`);
    return;
  }

  if (!open_.length) {
    const blocker = gate.get(ready[0].fm.id)[0];
    die(`every ready ticket is gated on capability '${blocker}', whose audit has not passed (D-153).\n\n` +
        `  A capability is not done when its tickets are closed. It is done when its audit passes,\n` +
        `  and the audit is worth most exactly when there is pressure to skip it.\n\n` +
        `    tickets.mjs audit ${blocker}              the mechanical half\n` +
        `    tickets.mjs audit ${blocker} --sections   the §2 reading list\n` +
        `    tickets.mjs audit ${blocker} --record …   record the result\n\n` +
        `  'tickets.mjs next --all' still lists the whole backlog, gated entries marked.`);
  }

  const t = open_[0];
  if (t.fm.size === "l") {
    die(`next ready ticket is ${pad(t.fm.id)} "${t.fm.title}" — but it is size: l.\n` +
        `  'l' is a smell recorded honestly, not a valid plan. Split it into two tickets\n` +
        `  before starting, or pick another with 'tickets.mjs next --all'.`);
  }
  if (flags.json) return console.log(JSON.stringify({ ...t.fm, path: t.path, gated: ready.length - open_.length, deferred: deferred.length }, null, 2));
  console.log(`  ${pad(t.fm.id)}  ${t.fm.title}\n  ${t.path}`);
  const gated = ready.length - open_.length;
  if (gated) {
    const blocker = gate.get(ready.find((r) => gate.get(r.fm.id).length).fm.id)[0];
    console.log(`\n  ${gated} higher-priority ticket(s) are gated on capability '${blocker}' —`);
    console.log(`  its audit has not passed. 'tickets.mjs audit ${blocker}' to start it.`);
  }
  if (deferred.length) {
    console.log(`\n  ${deferred.length} ticket(s) deferred, waiting on something outside the project` +
                ` (${deferred.map((d) => pad(d.fm.id)).join(", ")}).`);
    console.log(`  'tickets.mjs recheck' reports whether any wait is over. It never un-defers.`);
  }
}

function rewrite(t, fm, body = t.body) {
  writeFileSync(join(ROOT, t.path), serialize(fm, body));
}

function cmdCreate(flags) {
  if (!flags.title || !flags.type || !flags.priority) die("create requires --title, --type and --priority");
  const id = nextId();
  const slug = flags.slug ?? slugify(flags.title);
  if (!SLUG_RE.test(slug)) die(`derived slug '${slug}' is not kebab-case; pass --slug`);
  const fm = {
    id, slug, title: flags.title, type: flags.type, priority: flags.priority,
    status: "open", size: flags.size ?? "m", capability: flags.capability ?? "null",
    depends_on: flags.depends ? flags.depends.split(",").map(Number) : [], blocked_by: [],
    source: flags.source ?? "agent", created: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  };
  // Type-specific sections are REQUIRED by validate (§3.3). Emitting them here
  // rather than leaving them to be remembered is the difference between `create`
  // producing a valid ticket and producing one that fails validation seconds later.
  const extra = fm.type === "bug"
    ? "\n## Steps to reproduce\n\n1. TODO\n\n## Expected vs actual\n\n**Expected:** TODO\n\n**Actual:** TODO\n"
    : fm.type === "design"
    ? "\n## Options considered\n\nTODO\n\n## Open questions\n\n- TODO\n"
    : "";
  const body = `\n## Description\n\n${flags.body ?? "TODO"}\n\n## Acceptance criteria\n\n- [ ] TODO\n${extra}\n## Notes\n\nTODO\n\n## Operator validation\n\nTODO\n`;
  const path = `${DIRS.open}/${pad(id)}-${slug}.md`;
  writeFileSync(join(ROOT, path), serialize(fm, body));
  writeIndex();
  if (flags.json) console.log(JSON.stringify({ id, path }, null, 2));
  else console.log(path);
}

function cmdStart(id) {
  const ts = load(); const t = byId(ts).get(Number(id)) ?? die(`no ticket ${id}`);
  if (t.fm.started) return console.log(`${pad(t.fm.id)} already started at ${t.fm.started}`);
  rewrite(t, { ...t.fm, started: new Date().toISOString().replace(/\.\d+Z$/, "Z") });
  writeIndex();
  console.log(`started ${pad(t.fm.id)}`);
}

function cmdBlock(id, flags) {
  if (!flags.on) die("block requires --on <id>");
  const ts = load(); const index = byId(ts);
  const t = index.get(Number(id)) ?? die(`no ticket ${id}`);
  const on = Number(flags.on);
  if (!index.has(on)) die(`cannot block on ${pad(on)}: no such ticket. Nothing changed.`);
  if (on === t.fm.id) die(`a ticket cannot block itself. Nothing changed.`);
  const trial = new Map(index);
  trial.set(t.fm.id, { ...t, fm: { ...t.fm, blocked_by: [...new Set([...(t.fm.blocked_by ?? []), on])] } });
  const cyc = findCycles(trial);
  if (cyc.length) die(`that edge would create a cycle: ${cyc[0].map(pad).join(" → ")}\n  Nothing changed.`);
  const fm = { ...t.fm, blocked_by: [...new Set([...(t.fm.blocked_by ?? []), on])], status: "blocked" };
  let body = t.body;
  if (flags.reason) {
    const stamp = new Date().toISOString().slice(0, 10);
    const note = `\n**Blocked ${stamp} on ${pad(on)}:** ${flags.reason}\n`;
    body = body.includes("## Notes") ? body.replace(/(^##\s+Notes\s*$)/im, `$1\n${note}`) : body + `\n## Notes\n${note}`;
  }
  rewrite(t, fm, body); writeIndex();
  console.log(`${pad(t.fm.id)} blocked on ${pad(on)}`);
}

function cmdUnblock(id, flags) {
  if (!flags.on) die("unblock requires --on <id>");
  const ts = load(); const t = byId(ts).get(Number(id)) ?? die(`no ticket ${id}`);
  const on = Number(flags.on);
  const remaining = (t.fm.blocked_by ?? []).filter((d) => d !== on);
  const fm = { ...t.fm, blocked_by: remaining, status: remaining.length ? "blocked" : "open" };
  rewrite(t, fm); writeIndex();
  console.log(`${pad(t.fm.id)} unblocked from ${pad(on)} — status now ${fm.status}`);
}

/**
 * `defer` and `resume` — entering and leaving the fifth status (0136).
 *
 * Deliberately NOT a `git mv`: `deferred` lives in `open/` exactly as `blocked`
 * does. The folder is the coarse state — untriaged / live / done — and a deferred
 * ticket is still live work, just not available. Both commands maintain
 * `index.json`, so no frontmatter is ever hand-edited into this state.
 */
function cmdDefer(id, flags) {
  const ts = load();
  const t = byId(ts).get(Number(id)) ?? die(`no ticket ${id}`);
  const reason = typeof flags.reason === "string" ? flags.reason.trim() : "";
  const file = typeof flags["recheck-file"] === "string" ? flags["recheck-file"] : null;
  const recheck = file
    ? readFileSync(existsSync(file) ? file : join(ROOT, file), "utf8").trim()
    : (typeof flags.recheck === "string" ? flags.recheck.trim() : "");

  if (!reason) {
    die(`defer requires --reason "…".\n` +
        `  Say what is being waited on, and name the third party. A deferral with no reason is\n` +
        `  indistinguishable from a ticket nobody got around to — which is the thing this\n` +
        `  status exists to stop looking the same.`);
  }
  if (!recheck) {
    die(`defer requires --recheck "<shell>" (or --recheck-file <path>).\n` +
        `  The cheap test that says the wait is over — the two-minute version, not the ticket.\n` +
        `  It is run by 'tickets.mjs recheck' and REPORTED; nothing un-defers on its own.\n` +
        `  A deferral with no re-check is a wait with no end condition.`);
  }
  if (t.folder !== "open") {
    die(`${pad(t.fm.id)} is in ${t.folder}/. Only a live ticket can be deferred — a closed one is\n` +
        `  done and an inbox item is not yet a ticket.`);
  }
  if (t.fm.status === "deferred") die(`${pad(t.fm.id)} is already deferred. 'resume ${pad(t.fm.id)}' first if the wait is over.`);
  if ((t.fm.blocked_by ?? []).length) {
    die(`${pad(t.fm.id)} has blocked_by ${(t.fm.blocked_by).map(pad).join(", ")}. That is 'blocked', not 'deferred'.\n` +
        `  'blocked' means another ticket in this backlog has to land first, and closing it clears\n` +
        `  the block automatically. 'deferred' means nothing in this backlog can clear it. Unblock\n` +
        `  first if the dependency was really an external wait.`);
  }

  const fm = { ...t.fm, status: "deferred", deferred: new Date().toISOString().replace(/\.\d+Z$/, "Z") };
  rewrite(t, fm, insertAfterSection(t.body, "Description", deferredSection(reason, recheck, t.fm.id)));
  writeIndex();
  console.log(`deferred ${pad(t.fm.id)} — out of the ready set, and out of its capability's close gate.`);
  console.log(`  'tickets.mjs recheck ${pad(t.fm.id)}' runs the re-check; 'resume ${pad(t.fm.id)}' brings it back.`);
}

function cmdResume(id, flags) {
  const ts = load();
  const t = byId(ts).get(Number(id)) ?? die(`no ticket ${id}`);
  if (t.fm.status !== "deferred") die(`${pad(t.fm.id)} is not deferred (status: ${t.fm.status}). Nothing changed.`);
  const fm = { ...t.fm, status: "open" };
  delete fm.deferred;
  const stamp = new Date().toISOString().slice(0, 10);
  const note = `**Resumed ${stamp}:** ${flags.reason ?? "the wait is over — re-check read by hand."}`;
  rewrite(t, fm, closeDeferredSection(t.body, stamp, note));
  writeIndex();
  console.log(`resumed ${pad(t.fm.id)} — status now open, back in the ready set and back in`);
  console.log(`  '${t.fm.capability}'s close gate. The old '## Deferred' section is kept, renamed.`);
}

/**
 * `recheck` — runs the re-check condition and REPORTS. It changes nothing, ever.
 *
 * Criterion 5 of 0136: leaving the state is not automatic. A ticket that silently
 * un-defers is a ticket nobody looks at, and the whole value of the status is that
 * somebody reads the result and decides. So this exits 0 whatever the outcome —
 * it is a report, not a gate, and a failing re-check is the expected case.
 */
function cmdRecheck(id, flags) {
  const ts = load();
  const targets = id
    ? [byId(ts).get(Number(id)) ?? die(`no ticket ${id}`)]
    : ts.filter((t) => t.fm?.status === "deferred").sort((a, b) => a.fm.id - b.fm.id);
  if (id && targets[0].fm.status !== "deferred") {
    die(`${pad(targets[0].fm.id)} is not deferred (status: ${targets[0].fm.status}) — there is no re-check to run.`);
  }
  if (!targets.length) {
    if (flags.json) return console.log("[]");
    return console.log(`\n  no deferred tickets — nothing is waiting on anything outside the project.\n`);
  }

  const results = [];
  for (const t of targets) {
    const { recheck } = deferral(t.body);
    if (!recheck) {
      results.push({ id: t.fm.id, title: t.fm.title, passes: false, detail: "no fenced re-check block (validate reports this)" });
      continue;
    }
    const r = runCheck("bash", ["-c", recheck], { timeout: 600_000 });
    results.push({ id: t.fm.id, title: t.fm.title, passes: r.ok, detail: r.detail });
  }
  if (flags.json) return console.log(JSON.stringify(results, null, 2));

  console.log(`\n  re-checks — reported, never acted on\n`);
  for (const r of results) console.log(`   ${r.passes ? "PASSES" : " waits"}  ${pad(r.id)}  ${r.detail}`);
  const passing = results.filter((r) => r.passes);
  console.log(passing.length
    ? `\n  ${passing.length} wait(s) may be over. Nothing was changed — read the output, then:\n` +
      passing.map((r) => `    tickets.mjs resume ${pad(r.id)}`).join("\n") + "\n"
    : `\n  every wait is still on. Nothing to do.\n`);
}

function cmdClose(id, flags) {
  const ts = load(); const index = byId(ts);
  const t = index.get(Number(id)) ?? die(`no ticket ${id}`);
  requireCleanTree("close", flags["allow-dirty"], t.path);
  if (t.folder === "closed") die(`${pad(t.fm.id)} is already closed.`);

  const { unchecked, pendingOperator, unsignedOperator } = acceptance(t.body);
  if (unchecked.length) {
    // Two different refusals, because the right answer differs. "Do the work or
    // amend it" is advice an agent can act on alone — which for an operator
    // criterion means ticking it, the exact failure 0010 shipped.
    const tail = pendingOperator.length
      ? `\n\n  ${pendingOperator.length} of these can only be checked by a human at a device:\n` +
        pendingOperator.map((u) => `    - [ ] ${u}`).join("\n") +
        `\n\n  Do NOT tick these. Leave the ticket open, commit the work, and close it in a\n` +
        `  later session once the operator has actually run them — recording the result as\n` +
        `  '— verified YYYY-MM-DD: <what happened>' on the criterion itself. Ticket 0123 did\n` +
        `  exactly this and it worked; 0010 pre-ticked and shipped a skill that never ran.`
      : `\n\n  There is no --force. Either do the work, or edit the criterion and say why in\n` +
        `  ## Resolution. A criterion quietly ticked is a criterion that never existed.`;
    die(`${pad(t.fm.id)} has ${unchecked.length} unchecked acceptance criteria:\n` +
        unchecked.map((u) => `    - [ ] ${u}`).join("\n") + tail);
  }
  if (unsignedOperator.length) {
    die(`${pad(t.fm.id)} has ${unsignedOperator.length} operator criteria ticked with no sign-off:\n` +
        unsignedOperator.map((u) => `    - [x] ${u}`).join("\n") +
        `\n\n  An operator criterion is ticked by recording what the operator saw, not by\n` +
        `  marking it done. Append the result to the criterion:\n` +
        `    - [x] (operator) … — verified ${new Date().toISOString().slice(0, 10)}: <what happened>\n\n` +
        `  If the operator has not run it yet, the ticket is not closeable yet. That is the\n` +
        `  rule working, not an obstacle to route around.`);
  }
  const missing = ["Resolution", "Operator validation"].filter((s) => !hasSection(t.body, s));
  if (missing.length) die(`${pad(t.fm.id)} cannot close: missing ${missing.map((m) => `'## ${m}'`).join(" and ")}.`);

  const fm = { ...t.fm, status: "closed", closed: new Date().toISOString().replace(/\.\d+Z$/, "Z") };
  const dest = `${DIRS.closed}/${t.file}`;
  writeFileSync(join(ROOT, t.path), serialize(fm, t.body));
  git("mv", t.path, dest);
  const after = load();
  writeIndex(after);

  console.log(`closed ${pad(t.fm.id)} → ${dest}`);
  const afterIdx = byId(after);
  const referrers = after.filter((o) => o.fm && [...(o.fm.depends_on ?? []), ...(o.fm.blocked_by ?? [])].includes(t.fm.id));
  if (referrers.length) {
    console.log(`\n  ${referrers.length} ticket(s) referenced ${pad(t.fm.id)}:`);
    for (const r of referrers) {
      console.log(`    ${pad(r.fm.id)}  ${isReady(r, afterIdx) ? "NOW READY" : "still waiting"}  ${r.fm.title}`);
    }
  }
}

// ───────────────────────────────────────────────────────────────  triage ────
/**
 * §4.5 / ticket 0023. Triage has FOUR legitimate outcomes, not one:
 *
 *   promote  → tickets/open/NNNN-slug.md      `triage-move`
 *   merge    → the idea joins an existing ticket's ## Notes   `triage-merge`
 *   decline  → tickets/closed/NNNN-slug.md with a ## Resolution   `triage-decline`
 *   defer    → stays in tickets/inbox/ with a dated note   `triage-defer`
 *
 * **No path here deletes a capture.** TicketSmith's "never delete a ticket"
 * applies to captures too (§4.5/7): a declined idea re-captured three months
 * later should meet its own previous rejection, which requires the rejection to
 * still be somewhere findable. `git rm` appears in none of these functions, and
 * a test asserts the source file survives every outcome.
 */

/**
 * Resolve and validate an inbox path, shared by all four outcomes.
 *
 * Refuses a file outside `tickets/inbox/` outright. Triage is defined over
 * captures; pointing it at `tickets/open/0042-....md` would allocate a second id
 * for a ticket that already has one, and the error is much cheaper than the
 * duplicate.
 */
function readCapture(path, cmd, flags) {
  const rel = path.startsWith("tickets/") ? path : relative(ROOT, path);
  if (!rel.startsWith(`${DIRS.inbox}/`)) {
    die(`${cmd} operates on captures in ${DIRS.inbox}/, but got '${rel}'.\n` +
        `  A file that has already been triaged has an id; giving it a second one is the\n` +
        `  duplicate-id failure 0023's Notes warn about.`);
  }
  if (!existsSync(join(ROOT, rel))) die(`no such file: ${rel}`);
  requireCleanTreeForTriage(cmd, flags["allow-dirty"], rel);
  const p = parse(readFileSync(join(ROOT, rel), "utf8"), rel);
  if (!p.fm) die(`${rel}: ${p.error}`);
  return { rel, fm: p.fm, body: p.body };
}

/**
 * D-182. The clean-tree guard, relaxed for triage — and ONLY for triage.
 *
 * D-158 stops a ticket transition being committed on top of unrelated work in
 * flight. A triage batch's other transitions are not unrelated work: §4.5/8
 * requires a batch of N captures to land as ONE commit, `tickets: triage inbox
 * (N items)`, so by construction the second item runs with the first already
 * written to disk. Excepting only its own file — which is what `triage-move`
 * did before 0023 — makes that batch impossible without a routine
 * `--allow-dirty`, and a rule reached for routinely stops being a rule.
 *
 * So `tickets/` is excepted and everything else still blocks. An edit to
 * `src/` or a design doc sitting uncommitted still refuses, which is the case
 * D-158 was actually written about.
 */
function requireCleanTreeForTriage(cmd, allowDirty, _rel) {
  if (allowDirty) return;
  const dirty = git("status", "--porcelain").split("\n").filter(Boolean)
    .filter((l) => !l.includes("tickets/"));
  if (dirty.length) {
    die(`'${cmd}' refuses to run with non-ticket changes in the working tree (D-158/D-182).\n` +
        `  ${dirty.length} uncommitted path(s) outside tickets/. A triage batch commits once as\n` +
        `  'tickets: triage inbox (N items)'; running it over unrelated changes folds them into\n` +
        `  that commit.\n` +
        `  Commit or stash first, or pass --allow-dirty if you have considered it.`);
  }
}

/**
 * The frontmatter every triaged capture carries out of the inbox.
 *
 * §4.5/4 is explicit about the two fields that are PRESERVED rather than reset:
 * `source` stays `ui` (the idea came from the phone, and rewriting that erases
 * where the backlog actually comes from) and `created` stays byte-identical
 * (the idea's age is real information — a note that sat for six weeks is a
 * different signal from one captured this morning).
 */
function triagedFrontmatter(cap, { id, slug, status, size, capability }) {
  return {
    id, slug, title: cap.fm.title, type: cap.fm.type ?? "feature",
    priority: cap.fm.priority ?? "med", status, size: size ?? "m",
    capability: capability ?? "null", depends_on: [], blocked_by: [],
    source: cap.fm.source ?? "ui", created: cap.fm.created,
  };
}

/** ISO date, for the dated notes §4.5 requires on merge and defer. */
const today = () => new Date().toISOString().slice(0, 10);

/**
 * A capture's body, padded out to the sections `validate` requires of a file in
 * `closed/` — used by both decline and merge, which each land there.
 *
 * The Description is the capture's own text, untouched. That is the operator's
 * wording, dictated once, and §4.5/4 says keep it; a declined idea rewritten in
 * the agent's voice is not the idea that was declined.
 *
 * `## Acceptance criteria` is emitted EMPTY, deliberately. A closed ticket with
 * an unchecked criterion is a validation error, and inventing criteria for an
 * idea nobody is going to build would be inventing a plan in order to reject
 * it. Zero criteria is zero unchecked criteria, and it validates.
 */
function closedCaptureBody(cap, resolution) {
  const has = (name) => new RegExp(`^##\\s+${name}\\s*$`, "im").test(cap.body);
  let body = cap.body.replace(/\s*$/, "\n");
  if (!has("Description")) body += `\n## Description\n\n${cap.fm.title}\n`;
  if (!has("Acceptance criteria")) {
    body += `\n## Acceptance criteria\n\nNone — this capture was closed at triage, not built.\n`;
  }
  if (!has("Notes")) body += `\n## Notes\n\nCaptured ${cap.fm.created}, closed at triage.\n`;
  if (!has("Operator validation")) {
    body += `\n## Operator validation\n\nNone — nothing was built, so there is nothing to check.\n`;
  }
  body += `\n## Resolution\n\n${resolution}\n`;
  return body;
}

function cmdTriageMove(path, flags) {
  if (!flags.slug) die("triage-move requires --slug");
  if (!SLUG_RE.test(flags.slug)) die(`slug '${flags.slug}' is not kebab-case (^[a-z0-9]+(-[a-z0-9]+)*$)`);
  const cap = readCapture(path, "triage-move", flags);
  const fm = triagedFrontmatter(cap, {
    id: nextId(), slug: flags.slug, status: "open", size: flags.size, capability: flags.capability,
  });
  const dest = `${DIRS.open}/${pad(fm.id)}-${flags.slug}.md`;
  writeFileSync(join(ROOT, cap.rel), serialize(fm, cap.body));   // body byte-identical
  git("mv", cap.rel, dest);
  writeIndex();
  console.log(dest);
}

/**
 * DECLINE — the idea is not going to be built, and that judgement is recorded
 * where the idea is.
 *
 * It becomes a real, closed ticket with a real id rather than a loose file,
 * because `closed/` is validated like everywhere else: id matching the filename
 * prefix, a matching slug, a `closed:` stamp, the four body sections and a
 * `## Resolution`. 0023's criterion said only "moves to closed/ with a
 * ## Resolution", which as literally written produced a file `validate` rejects
 * — the criterion and the validator contradicted each other and the operator
 * settled it this way on 2026-09-02.
 *
 * Spending an id on a rejected idea is the point, not the cost. Ids are cheap
 * and permanent, and "a declined idea re-captured three months later should
 * meet its own previous rejection" only works if the rejection is a findable,
 * numbered thing.
 */
function cmdTriageDecline(path, flags) {
  if (!flags.reason || flags.reason === true) {
    die("triage-decline requires --reason \"...\" — a decline with no recorded reason is a delete\n" +
        "  with extra steps, and §4.5/7 exists so a re-captured idea meets its own rejection.");
  }
  const cap = readCapture(path, "triage-decline", flags);
  const slug = flags.slug ?? slugify(cap.fm.title ?? "");
  if (!SLUG_RE.test(slug)) die(`derived slug '${slug}' is not kebab-case; pass --slug`);
  const id = nextId();
  const fm = {
    ...triagedFrontmatter(cap, { id, slug, status: "closed", size: flags.size, capability: flags.capability }),
    closed: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  };
  const body = closedCaptureBody(cap, `**Declined at triage, ${today()}.** ${flags.reason}`);
  const dest = `${DIRS.closed}/${pad(id)}-${slug}.md`;
  writeFileSync(join(ROOT, cap.rel), serialize(fm, body));
  git("mv", cap.rel, dest);
  writeIndex();
  console.log(dest);
}

/**
 * MERGE — the idea already has a home, so it joins that ticket's ## Notes and
 * the capture is closed pointing at it.
 *
 * Two files change, which is why this needs D-182's relaxed tree guard even for
 * a single item.
 *
 * Merging into a CLOSED ticket is refused. It looks harmless and quietly loses
 * the idea: nobody re-reads a closed ticket's Notes, so the note lands where it
 * will never be seen and the inbox reports the capture as handled. Promote or
 * decline it instead — both leave something a person will actually encounter.
 */
function cmdTriageMerge(path, flags) {
  const into = Number(flags.into);
  if (!Number.isInteger(into)) die("triage-merge requires --into <id>");
  const cap = readCapture(path, "triage-merge", flags);
  const target = byId(load()).get(into);
  if (!target || !target.fm) die(`no ticket ${pad(into)} to merge into`);
  if (target.folder === "closed") {
    die(`${pad(into)} is closed. Merging into it files the idea where nobody will read it —\n` +
        `  a closed ticket's Notes are not re-read, and the inbox would report this capture as\n` +
        `  handled. Promote it or decline it instead.`);
  }

  // Appended at the END of ## Notes, not the top: Notes read chronologically,
  // and a merged idea is the newest thing known about the ticket.
  const note = `\n**Merged from a capture, ${today()}** (captured ${cap.fm.created}):\n` +
    `${cap.body.replace(/^##\s+Description\s*$/im, "").trim()}\n`;
  const secRe = /^##\s+Notes\s*$/im;
  if (!secRe.test(target.body)) die(`${pad(into)} has no '## Notes' section to merge into`);
  const lines = target.body.split("\n");
  const start = lines.findIndex((l) => secRe.test(l));
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  const merged = [...lines.slice(0, end), ...note.split("\n"), ...lines.slice(end)].join("\n");
  writeFileSync(join(ROOT, target.path), serialize(target.fm, merged));

  const slug = flags.slug ?? slugify(cap.fm.title ?? "");
  if (!SLUG_RE.test(slug)) die(`derived slug '${slug}' is not kebab-case; pass --slug`);
  const id = nextId();
  const fm = {
    ...triagedFrontmatter(cap, { id, slug, status: "closed", size: flags.size, capability: flags.capability }),
    closed: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  };
  const body = closedCaptureBody(cap,
    `**Merged at triage, ${today()}, into ${pad(into)} — ${target.fm.title}.** ` +
    `${flags.reason && flags.reason !== true ? flags.reason : "The idea is recorded in that ticket's ## Notes."}`);
  const dest = `${DIRS.closed}/${pad(id)}-${slug}.md`;
  writeFileSync(join(ROOT, cap.rel), serialize(fm, body));
  git("mv", cap.rel, dest);
  writeIndex();
  console.log(`${dest}  →  merged into ${target.path}`);
}

/**
 * DEFER — the idea is worth keeping and cannot be decided today, so it stays a
 * capture. No id, no move, still in the inbox.
 *
 * Distinct from `status: deferred`, which is for a TICKET waiting on something
 * outside the project and carries a runnable re-check (D-174). This is a note
 * nobody has decided about yet, so the heading is `## Triage deferred` and the
 * status stays `inbox`.
 *
 * The capture therefore keeps ageing, and `validate` will warn once it passes 14
 * days. That is correct and deliberate: a deferred idea should get louder, not
 * quieter. Deferring the same note twice appends a second dated line rather than
 * overwriting the first — the history of putting something off IS the signal
 * that it should be declined.
 */
function cmdTriageDefer(path, flags) {
  if (!flags.reason || flags.reason === true) {
    die("triage-defer requires --reason \"...\" — an undated, unexplained deferral is\n" +
        "  indistinguishable from an inbox nobody has looked at.");
  }
  const cap = readCapture(path, "triage-defer", flags);
  let body = cap.body.replace(/\s*$/, "\n");
  if (!/^##\s+Triage deferred\s*$/im.test(body)) body += `\n## Triage deferred\n`;
  body += `\n- **${today()}** — ${flags.reason}\n`;
  writeFileSync(join(ROOT, cap.rel), serialize(cap.fm, body));   // no id, no move
  writeIndex();
  console.log(`${cap.rel}  (still in the inbox, deferred ${today()})`);
}

// ──────────────────────────────────────────────────────────────────── main ────

// Only dispatch when run directly. Without this, `import`ing the module for
// tests executes the CLI, hits the default case, prints help and exits — which
// makes the module untestable and the failure baffling.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const argv = process.argv.slice(2);
const cmd = argv[0];
const positional = argv.slice(1).filter((a) => !a.startsWith("--"));
const flags = {};
for (let i = 1; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const k = argv[i].slice(2);
  const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  // Repeats accumulate rather than overwrite: `--divergence a --divergence b`
  // is a list. Every other flag is passed once, so this changes nothing for them.
  flags[k] = k in flags ? [].concat(flags[k], v) : v;
}

if (isMain) try {
  switch (cmd) {
    case "index": cmdIndex(flags); break;
    case "list": cmdList(flags); break;
    case "show": cmdShow(positional[0], flags); break;
    case "validate": cmdValidate(flags); break;
    case "allocate": cmdAllocate(); break;
    case "next": cmdNext(flags); break;
    case "create": cmdCreate(flags); break;
    case "start": cmdStart(positional[0]); break;
    case "block": cmdBlock(positional[0], flags); break;
    case "unblock": cmdUnblock(positional[0], flags); break;
    case "defer": cmdDefer(positional[0], flags); break;
    case "resume": cmdResume(positional[0], flags); break;
    case "recheck": cmdRecheck(positional[0], flags); break;
    case "close": cmdClose(positional[0], flags); break;
    case "triage-move": cmdTriageMove(positional[0], flags); break;
    case "triage-merge": cmdTriageMerge(positional[0], flags); break;
    case "triage-decline": cmdTriageDecline(positional[0], flags); break;
    case "triage-defer": cmdTriageDefer(positional[0], flags); break;
    case "audit": cmdAudit(positional[0], flags); break;
    default:
      console.log(`tickets.mjs <command>

  index                       rebuild tickets/index.json
  list [filters]              --status --type --priority --capability --size --ready
  show <id>                   raw markdown + dependency status
  validate                    exit 1 on errors, 0 on warnings only
  next [--all]                highest-priority ready ticket; refuses size:l
  allocate                    next free id
  create --title --type --priority [--size --capability --slug --depends --source --body]
  start <id>
  block <id> --on <id> [--reason "..."]
  unblock <id> --on <id>
  defer <id> --reason "..." --recheck "<shell>" | --recheck-file <path>
  resume <id> [--reason "..."]
  recheck [<id>]              run deferred tickets' re-checks and REPORT; never un-defers
  close <id> [--allow-dirty]
  triage-move <path> --slug <kebab> [--capability --size] [--allow-dirty]
  triage-merge <path> --into <id> [--slug --reason]      capture joins a ticket's ## Notes
  triage-decline <path> --reason "..." [--slug]          closed with a ## Resolution
  triage-defer <path> --reason "..."                     stays in the inbox, dated
  audit <capability>          AUDIT.md mechanical checks; exit 1 on any failure

  --json works on index, list, show, validate, next, create, audit, recheck.`);
      process.exit(cmd ? 1 : 0);
  }
} catch (err) {
  die(err.message);
}

export { deferral, insertAfterSection, closeDeferredSection, auditChecks, auditBlockers, latestAuditRecord, reflectSection, parse, serialize, acceptance, isReady, findCycles, readySet, validate, buildIndex, missingSections, SECTION_RULES, slugify, FIELD_ORDER };
