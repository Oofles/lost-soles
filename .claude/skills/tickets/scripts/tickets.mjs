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
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = process.env.TICKETS_ROOT ?? new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const DIRS = { inbox: "tickets/inbox", open: "tickets/open", closed: "tickets/closed" };
const INDEX = "tickets/index.json";

// §3.1 key order. Rewritten files use exactly this order so diffs stay readable.
const FIELD_ORDER = [
  "id", "slug", "title", "type", "priority", "status", "size",
  "capability", "depends_on", "blocked_by", "source",
  "created", "started", "closed",
];
const ENUMS = {
  type: ["feature", "bug", "design", "chore", "refactor", "docs"],
  priority: ["high", "med", "low"],
  status: ["inbox", "open", "blocked", "closed"],
  size: ["s", "m", "l"],
  source: ["ui", "agent", "operator"],
};
const PRIO_RANK = { high: 0, med: 1, low: 2 };
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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

    const folderStatus = { inbox: ["inbox"], open: ["open", "blocked"], closed: ["closed"] }[folder];
    if (fm.status && !folderStatus.includes(fm.status)) E("status-folder", `status '${fm.status}' disagrees with folder '${folder}/'`);

    const blocked = (fm.blocked_by ?? []).length > 0;
    if (blocked && fm.status !== "blocked") E("blocked-status", `blocked_by is non-empty but status is '${fm.status}'`);
    if (!blocked && fm.status === "blocked") E("blocked-status", `status is 'blocked' but blocked_by is empty`);

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

    if (folder === "closed") {
      if (!("closed" in fm)) E("closed-stamp", "closed ticket has no 'closed:' timestamp");
      for (const s of ["Resolution", "Operator validation"]) {
        if (!hasSection(body, s)) E("closed-section", `closed ticket is missing '## ${s}'`);
      }
      const { unchecked } = acceptance(body);
      if (unchecked.length) E("closed-unchecked", `closed with ${unchecked.length} unchecked acceptance criteria`);
    } else if ("closed" in fm) {
      E("closed-stamp", `'closed:' is present on a ticket in ${folder}/`);
    }

    if (fm.type === "bug") {
      for (const s of ["Steps to reproduce", "Expected vs actual"]) {
        if (!hasSection(body, s)) E("bug-section", `bug ticket is missing '## ${s}'`);
      }
    }

    // warnings
    if (fm.type === "feature" && (fm.capability === "null" || fm.capability == null)) W("no-capability", "feature ticket has no capability");
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

function cmdAllocate() {
  const ids = load().map((t) => t.fm?.id).filter((n) => typeof n === "number");
  console.log(pad(ids.length ? Math.max(...ids) + 1 : 1));
}

function cmdNext(flags) {
  const ts = load();
  const ready = readySet(ts);
  if (!ready.length) {
    const open = ts.filter((t) => t.fm && ["open", "blocked"].includes(t.fm.status));
    if (!open.length) die("nothing open. Every ticket is closed or in the inbox.");
    die(`nothing is ready. ${open.length} ticket(s) are open, but all are blocked or waiting on\n` +
        `  unclosed dependencies. Run 'tickets.mjs list --status blocked' to see why.`);
  }
  if (flags.all) {
    for (const t of ready) console.log(`  ${pad(t.fm.id)}  ${t.fm.priority.padEnd(5)}${t.fm.size === "l" ? "[SIZE:L — SPLIT] " : ""}${t.fm.title}`);
    return console.log(`\n  ${ready.length} ready`);
  }
  const t = ready[0];
  if (t.fm.size === "l") {
    die(`next ready ticket is ${pad(t.fm.id)} "${t.fm.title}" — but it is size: l.\n` +
        `  'l' is a smell recorded honestly, not a valid plan. Split it into two tickets\n` +
        `  before starting, or pick another with 'tickets.mjs next --all'.`);
  }
  if (flags.json) return console.log(JSON.stringify({ ...t.fm, path: t.path }, null, 2));
  console.log(`  ${pad(t.fm.id)}  ${t.fm.title}\n  ${t.path}`);
}

function rewrite(t, fm, body = t.body) {
  writeFileSync(join(ROOT, t.path), serialize(fm, body));
}

function cmdCreate(flags) {
  if (!flags.title || !flags.type || !flags.priority) die("create requires --title, --type and --priority");
  const ts = load();
  const ids = ts.map((t) => t.fm?.id).filter((n) => typeof n === "number");
  const id = ids.length ? Math.max(...ids) + 1 : 1;
  const slug = flags.slug ?? flags.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
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

function cmdTriageMove(path, flags) {
  if (!flags.slug) die("triage-move requires --slug");
  if (!SLUG_RE.test(flags.slug)) die(`slug '${flags.slug}' is not kebab-case (^[a-z0-9]+(-[a-z0-9]+)*$)`);
  const rel = path.startsWith("tickets/") ? path : relative(ROOT, path);
  if (!existsSync(join(ROOT, rel))) die(`no such file: ${rel}`);
  requireCleanTree("triage-move", flags["allow-dirty"], rel);
  const p = parse(readFileSync(join(ROOT, rel), "utf8"), rel);
  if (!p.fm) die(`${rel}: ${p.error}`);
  const ids = load().map((t) => t.fm?.id).filter((n) => typeof n === "number");
  const id = ids.length ? Math.max(...ids) + 1 : 1;
  const fm = {
    id, slug: flags.slug, title: p.fm.title, type: p.fm.type ?? "feature",
    priority: p.fm.priority ?? "med", status: "open", size: flags.size ?? "m",
    capability: flags.capability ?? "null", depends_on: [], blocked_by: [],
    source: p.fm.source ?? "ui", created: p.fm.created,
  };
  const dest = `${DIRS.open}/${pad(id)}-${flags.slug}.md`;
  writeFileSync(join(ROOT, rel), serialize(fm, p.body));   // body byte-identical
  git("mv", rel, dest);
  writeIndex();
  console.log(dest);
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
  flags[k] = v;
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
    case "close": cmdClose(positional[0], flags); break;
    case "triage-move": cmdTriageMove(positional[0], flags); break;
    default:
      console.log(`tickets.mjs <command>

  index                       rebuild tickets/index.json
  list [filters]              --status --type --priority --capability --size --ready
  show <id>                   raw markdown + dependency status
  validate                    exit 1 on errors, 0 on warnings only
  next [--all]                highest-priority ready ticket; refuses size:l
  allocate                    next free id
  create --title --type --priority [--size --capability --slug --depends]
  start <id>
  block <id> --on <id> [--reason "..."]
  unblock <id> --on <id>
  close <id> [--allow-dirty]
  triage-move <path> --slug <kebab> [--capability --size] [--allow-dirty]

  --json works on index, list, show, validate, next, create.`);
      process.exit(cmd ? 1 : 0);
  }
} catch (err) {
  die(err.message);
}

export { parse, serialize, acceptance, isReady, findCycles, readySet, validate, buildIndex, FIELD_ORDER };
