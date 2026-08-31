/**
 * Tests for tickets.mjs — tickets 0007, 0008, 0009.
 *
 * Uses node:test, built into Node, so this runs with `node --test` and needs no
 * package.json and no npm install. When 0013 lands vitest, these can migrate or
 * stay as-is; they cost nothing either way.
 *
 *   node --test .claude/skills/tickets/scripts/
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const SCRIPT = new URL("./tickets.mjs", import.meta.url).pathname;
const { parse, serialize, acceptance, isReady, findCycles, validate, buildIndex } = await import("./tickets.mjs");

// ───────────────────────────────────────────────────────────────── helpers ────

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "tickets-test-"));
  for (const d of ["tickets/inbox", "tickets/open", "tickets/closed", "docs/capabilities"]) {
    mkdirSync(join(dir, d), { recursive: true });
  }
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  return dir;
}

const FM = (o) => ({
  id: 1, slug: "a-ticket", title: "A ticket", type: "feature", priority: "high",
  status: "open", size: "m", capability: "00-x", depends_on: [], blocked_by: [],
  source: "operator", created: "2026-08-30T00:00:00Z", ...o,
});

const BODY = `
## Description

x

## Acceptance criteria

- [ ] one

## Notes

x

## Operator validation

x
`;

function ticket(dir, folder, fm, body = BODY) {
  const name = `${String(fm.id).padStart(4, "0")}-${fm.slug}.md`;
  writeFileSync(join(dir, "tickets", folder, name), serialize(fm, body));
  return join("tickets", folder, name);
}

const run = (dir, ...args) => {
  // spawnSync, not execFileSync: validate writes warnings to stderr, and a
  // helper that only captures stderr on failure silently hides them on success.
  const r = spawnSync("node", [SCRIPT, ...args], {
    cwd: dir, env: { ...process.env, TICKETS_ROOT: dir }, encoding: "utf8",
  });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
};
const commitAll = (dir, msg = "x") => {
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "--no-verify", "-m", msg], { cwd: dir });
};

// ───────────────────────────────────────────────────────────── 0007 parsing ────

describe("0007 — parse / serialize", () => {
  test("a title containing a colon and a # round-trips byte-identically", () => {
    const fm = FM({ title: "Fix: the #42 thing: really" });
    const raw = serialize(fm, BODY);
    const p = parse(raw);
    assert.equal(p.fm.title, "Fix: the #42 thing: really");
    assert.equal(serialize(p.fm, p.body), raw);
  });

  test("an unknown frontmatter key is preserved on rewrite", () => {
    const raw = serialize({ ...FM(), experimental_field: "keep me" }, BODY);
    const p = parse(raw);
    assert.equal(p.fm.experimental_field, "keep me");
    assert.match(serialize(p.fm, p.body), /experimental_field: keep me/);
  });

  test("rewritten frontmatter follows §3.1 key order and the body is byte-identical", () => {
    // deliberately scrambled input order
    const scrambled = `---\ncreated: 2026-08-30T00:00:00Z\ntitle: T\nid: 1\ntype: feature\nslug: s\npriority: high\nstatus: open\nsize: m\ncapability: 00-x\ndepends_on: []\nblocked_by: []\nsource: operator\n---\n${BODY}`;
    const p = parse(scrambled);
    const out = serialize(p.fm, p.body);
    const keys = out.split("\n---\n")[0].replace(/^---\n/, "").split("\n").map((l) => l.split(":")[0]);
    assert.deepEqual(keys.slice(0, 6), ["id", "slug", "title", "type", "priority", "status"]);
    assert.equal(out.split(/\n---\n/)[1], BODY);
  });

  test("empty and populated arrays round-trip", () => {
    assert.deepEqual(parse(serialize(FM({ depends_on: [] }), BODY)).fm.depends_on, []);
    assert.deepEqual(parse(serialize(FM({ depends_on: [3, 11] }), BODY)).fm.depends_on, [3, 11]);
  });
});

describe("0007 — acceptance counting", () => {
  test("counts only checkboxes under ## Acceptance criteria, stopping at the next ##", () => {
    const body = `
## Acceptance criteria

- [x] done
- [ ] not done

## Notes

- [ ] this looks like a checkbox but is in Notes
- [x] so is this

## Operator validation

- [ ] and this
`;
    const a = acceptance(body);
    assert.equal(a.total, 2, "must not count checkbox-looking lines outside the section");
    assert.equal(a.checked, 1);
    assert.deepEqual(a.unchecked, ["not done"]);
  });
});

// ───────────────────────────────────────────────────────── 0007 validation ────

describe("0007 — validate flags exactly the right rule", () => {
  const cases = [
    ["filename", (d) => { writeFileSync(join(d, "tickets/open/0009-wrong-name.md"), serialize(FM({ id: 9, slug: "right-name" }), BODY)); }],
    ["duplicate-id", (d) => { ticket(d, "open", FM({ id: 1, slug: "a" })); ticket(d, "open", FM({ id: 1, slug: "b" })); }],
    ["enum", (d) => ticket(d, "open", FM({ priority: "urgent" }))],
    ["status-folder", (d) => ticket(d, "open", FM({ status: "closed" }))],
    ["blocked-status", (d) => { ticket(d, "open", FM({ id: 1, blocked_by: [2], status: "open" })); ticket(d, "open", FM({ id: 2, slug: "b" })); }],
    ["dangling-ref", (d) => ticket(d, "open", FM({ depends_on: [999] }))],
    ["self-edge", (d) => ticket(d, "open", FM({ id: 1, depends_on: [1] }))],
    ["closed-section", (d) => ticket(d, "closed", FM({ status: "closed", closed: "2026-08-30T00:00:00Z" }), "\n## Acceptance criteria\n\n- [x] a\n")],
    ["closed-unchecked", (d) => ticket(d, "closed", FM({ status: "closed", closed: "2026-08-30T00:00:00Z" }), "\n## Acceptance criteria\n\n- [ ] a\n\n## Resolution\n\nx\n\n## Operator validation\n\nx\n")],
    ["closed-stamp", (d) => ticket(d, "open", FM({ closed: "2026-08-30T00:00:00Z" }))],
    ["bug-section", (d) => ticket(d, "open", FM({ type: "bug" }))],
    ["required-field", (d) => { const { size, ...rest } = FM(); writeFileSync(join(d, "tickets/open/0001-a-ticket.md"), serialize(rest, BODY)); }],
  ];
  for (const [rule, setup] of cases) {
    test(`flags '${rule}'`, () => {
      const d = repo(); setup(d);
      const { errors } = withRoot(d, () => validateIn(d));
      assert.ok(errors.some((e) => e.rule === rule), `expected rule '${rule}', got: ${errors.map((e) => e.rule).join(",") || "none"}`);
      rmSync(d, { recursive: true, force: true });
    });
  }

  test("an unknown key is a WARNING, and validate still exits 0", () => {
    const d = repo();
    writeFileSync(join(d, "tickets/open/0001-a-ticket.md"), serialize({ ...FM(), weird: "x" }, BODY));
    const r = run(d, "validate");
    assert.equal(r.code, 0, "warnings alone must not fail");
    assert.match(r.out, /unknown-key/);
    rmSync(d, { recursive: true, force: true });
  });
});

// helpers that re-import the module against a different root
function withRoot(dir, fn) { const prev = process.env.TICKETS_ROOT; process.env.TICKETS_ROOT = dir; try { return fn(); } finally { process.env.TICKETS_ROOT = prev; } }
function validateIn(dir) {
  const r = run(dir, "validate", "--json");
  return JSON.parse(r.out);
}

// ────────────────────────────────────────────────── 0009 ready set + cycles ────

describe("0009 — ready set", () => {
  const idx = (arr) => new Map(arr.map((fm) => [fm.id, { fm }]));

  test("blocked_by non-empty is never ready, even with all depends_on closed", () => {
    const m = idx([FM({ id: 1, status: "closed" }), FM({ id: 2, depends_on: [1], blocked_by: [1], status: "blocked" })]);
    assert.equal(isReady(m.get(2), m), false);
  });

  test("depends_on an OPEN ticket is not ready; it becomes ready when that closes", () => {
    let m = idx([FM({ id: 7, status: "open" }), FM({ id: 9, depends_on: [7] })]);
    assert.equal(isReady(m.get(9), m), false);
    m = idx([FM({ id: 7, status: "closed" }), FM({ id: 9, depends_on: [7] })]);
    assert.equal(isReady(m.get(9), m), true, "no manual edit should be needed");
  });

  test("a closed ticket is never in the ready set", () => {
    const m = idx([FM({ id: 1, status: "closed" })]);
    assert.equal(isReady(m.get(1), m), false);
  });
});

describe("0009 — cycle detection", () => {
  const g = (spec) => new Map(Object.entries(spec).map(([id, deps]) => [Number(id), { fm: FM({ id: Number(id), depends_on: deps, blocked_by: [] }) }]));

  test("a linear chain has no cycle", () => assert.equal(findCycles(g({ 1: [], 2: [1], 3: [2] })).length, 0));
  test("a diamond has no cycle", () => assert.equal(findCycles(g({ 1: [], 2: [1], 3: [1], 4: [2, 3] })).length, 0));
  test("a 3-node cycle is found and names every participant", () => {
    const c = findCycles(g({ 1: [3], 2: [1], 3: [2] }));
    assert.equal(c.length, 1);
    assert.deepEqual([...new Set(c[0])].sort(), [1, 2, 3]);
  });
  test("a self-edge is a cycle", () => {
    const c = findCycles(g({ 1: [1] }));
    assert.equal(c.length, 1);
    assert.deepEqual([...new Set(c[0])], [1]);
  });
  test("a cycle through blocked_by only is found", () => {
    const m = new Map([
      [1, { fm: FM({ id: 1, depends_on: [], blocked_by: [2] }) }],
      [2, { fm: FM({ id: 2, depends_on: [], blocked_by: [1] }) }],
    ]);
    assert.equal(findCycles(m).length, 1);
  });
  test("a mixed depends_on / blocked_by cycle is found", () => {
    const m = new Map([
      [1, { fm: FM({ id: 1, depends_on: [2], blocked_by: [] }) }],
      [2, { fm: FM({ id: 2, depends_on: [], blocked_by: [1] }) }],
    ]);
    assert.equal(findCycles(m).length, 1);
  });
  test("a dangling id does not crash and is simply not an edge", () => {
    assert.equal(findCycles(g({ 1: [999] })).length, 0);
  });
});

// ─────────────────────────────────────────────────────────── 0008 mutations ────

describe("0008 — allocate", () => {
  test("ids do not reset when the highest id is in closed/", () => {
    const d = repo();
    ticket(d, "open", FM({ id: 3, slug: "low" }));
    ticket(d, "closed", FM({ id: 41, slug: "high", status: "closed", closed: "2026-08-30T00:00:00Z" }),
      "\n## Acceptance criteria\n\n- [x] a\n\n## Resolution\n\nx\n\n## Operator validation\n\nx\n");
    assert.equal(run(d, "allocate").out.trim(), "0042");
    rmSync(d, { recursive: true, force: true });
  });
});

describe("0008 — create / start", () => {
  test("create makes a ticket that validates, with a colon in the title", () => {
    const d = repo();
    const r = run(d, "create", "--title", "Fix: the thing", "--type", "feature", "--priority", "high", "--slug", "fix-the-thing");
    assert.equal(r.code, 0);
    const path = r.out.trim();
    assert.match(path, /tickets\/open\/0001-fix-the-thing\.md/);
    const p = parse(readFileSync(join(d, path), "utf8"));
    assert.equal(p.fm.title, "Fix: the thing");
    assert.equal(p.fm.status, "open");
    assert.deepEqual(p.fm.blocked_by, []);
    assert.ok(!("closed" in p.fm) && !("started" in p.fm));
    rmSync(d, { recursive: true, force: true });
  });

  test("start is idempotent-safe — it reports rather than overwrites", () => {
    const d = repo(); ticket(d, "open", FM());
    run(d, "start", "1");
    const first = parse(readFileSync(join(d, "tickets/open/0001-a-ticket.md"), "utf8")).fm.started;
    const second = run(d, "start", "1");
    assert.match(second.out, /already started/);
    assert.equal(parse(readFileSync(join(d, "tickets/open/0001-a-ticket.md"), "utf8")).fm.started, first);
    rmSync(d, { recursive: true, force: true });
  });
});

describe("0008 — block / unblock", () => {
  test("block sets status and records the reason verbatim", () => {
    const d = repo(); ticket(d, "open", FM({ id: 1 })); ticket(d, "open", FM({ id: 2, slug: "b" }));
    run(d, "block", "1", "--on", "2", "--reason", "needs the schema from 0002");
    const p = parse(readFileSync(join(d, "tickets/open/0001-a-ticket.md"), "utf8"));
    assert.deepEqual(p.fm.blocked_by, [2]);
    assert.equal(p.fm.status, "blocked");
    assert.match(p.body, /needs the schema from 0002/);
    rmSync(d, { recursive: true, force: true });
  });

  test("block on a nonexistent id changes nothing", () => {
    const d = repo(); ticket(d, "open", FM({ id: 1 }));
    const before = readFileSync(join(d, "tickets/open/0001-a-ticket.md"), "utf8");
    const r = run(d, "block", "1", "--on", "999");
    assert.notEqual(r.code, 0);
    assert.equal(readFileSync(join(d, "tickets/open/0001-a-ticket.md"), "utf8"), before);
    rmSync(d, { recursive: true, force: true });
  });

  test("block refuses an edge that would create a cycle, and names it", () => {
    const d = repo();
    ticket(d, "open", FM({ id: 1, depends_on: [2] }));
    ticket(d, "open", FM({ id: 2, slug: "b" }));
    const before = readFileSync(join(d, "tickets/open/0002-b.md"), "utf8");
    const r = run(d, "block", "2", "--on", "1");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /cycle/);
    assert.equal(readFileSync(join(d, "tickets/open/0002-b.md"), "utf8"), before, "must change nothing");
    rmSync(d, { recursive: true, force: true });
  });

  test("unblock returns status to open only when the last edge goes", () => {
    const d = repo();
    ticket(d, "open", FM({ id: 1, blocked_by: [2, 3], status: "blocked" }));
    ticket(d, "open", FM({ id: 2, slug: "b" })); ticket(d, "open", FM({ id: 3, slug: "c" }));
    run(d, "unblock", "1", "--on", "2");
    assert.equal(parse(readFileSync(join(d, "tickets/open/0001-a-ticket.md"), "utf8")).fm.status, "blocked");
    run(d, "unblock", "1", "--on", "3");
    assert.equal(parse(readFileSync(join(d, "tickets/open/0001-a-ticket.md"), "utf8")).fm.status, "open");
    rmSync(d, { recursive: true, force: true });
  });
});

describe("0008 — close refuses (a refusal that is not tested is one that gets bypassed)", () => {
  const closable = "\n## Acceptance criteria\n\n- [x] a\n\n## Resolution\n\nx\n\n## Operator validation\n\nx\n";

  test("refuses an unchecked acceptance criterion and lists it verbatim", () => {
    const d = repo();
    ticket(d, "open", FM(), "\n## Acceptance criteria\n\n- [ ] the unfinished one\n\n## Resolution\n\nx\n\n## Operator validation\n\nx\n");
    commitAll(d);
    const r = run(d, "close", "1");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /the unfinished one/);
    assert.ok(existsSync(join(d, "tickets/open/0001-a-ticket.md")), "must not move the file");
    rmSync(d, { recursive: true, force: true });
  });

  test("refuses a missing ## Resolution, naming it", () => {
    const d = repo();
    ticket(d, "open", FM(), "\n## Acceptance criteria\n\n- [x] a\n\n## Operator validation\n\nx\n");
    commitAll(d);
    const r = run(d, "close", "1");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /Resolution/);
    rmSync(d, { recursive: true, force: true });
  });

  test("refuses a dirty tree, and --allow-dirty overrides (D-158)", () => {
    const d = repo();
    ticket(d, "open", FM(), closable);
    commitAll(d);
    writeFileSync(join(d, "unrelated.txt"), "dirty");
    assert.notEqual(run(d, "close", "1").code, 0);
    assert.equal(run(d, "close", "1", "--allow-dirty").code, 0);
    rmSync(d, { recursive: true, force: true });
  });

  test("close moves the file with git mv and announces newly-ready dependents", () => {
    const d = repo();
    ticket(d, "open", FM({ id: 1 }), closable);
    ticket(d, "open", FM({ id: 2, slug: "b", depends_on: [1] }));
    commitAll(d);
    const r = run(d, "close", "1");
    assert.equal(r.code, 0);
    assert.ok(existsSync(join(d, "tickets/closed/0001-a-ticket.md")));
    assert.ok(!existsSync(join(d, "tickets/open/0001-a-ticket.md")));
    assert.match(r.out, /0002.*NOW READY/s);
    rmSync(d, { recursive: true, force: true });
  });

  test("there is no --force on close — passing it changes nothing", () => {
    // Behavioural, not a grep of the source: the refusal message itself contains
    // the string "--force", so a textual test passes for the wrong reason and
    // fails for the wrong reason. Assert the behaviour instead.
    const d = repo();
    ticket(d, "open", FM(), "\n## Acceptance criteria\n\n- [ ] undone\n\n## Resolution\n\nx\n\n## Operator validation\n\nx\n");
    commitAll(d);
    const r = run(d, "close", "1", "--force");
    assert.notEqual(r.code, 0, "--force must not close a ticket with unchecked criteria");
    assert.ok(existsSync(join(d, "tickets/open/0001-a-ticket.md")), "file must not move");
    rmSync(d, { recursive: true, force: true });
  });
});

describe("0008 — triage-move", () => {
  test("allocates an id, rewrites frontmatter, and preserves the body byte-for-byte", () => {
    const d = repo();
    const body = "\n## Description\n\nIdea from the 10k. Exact  spacing   preserved.\n";
    writeFileSync(join(d, "tickets/inbox/2026-08-30T1432-foo.md"),
      serialize({ status: "inbox", title: "foo", type: "feature", priority: "med", source: "ui", created: "2026-08-30T14:32:00Z" }, body));
    ticket(d, "closed", FM({ id: 40, slug: "z", status: "closed", closed: "2026-08-30T00:00:00Z" }),
      "\n## Acceptance criteria\n\n- [x] a\n\n## Resolution\n\nx\n\n## Operator validation\n\nx\n");
    commitAll(d);
    const r = run(d, "triage-move", "tickets/inbox/2026-08-30T1432-foo.md", "--slug", "streak-freeze-tokens");
    assert.equal(r.code, 0, r.out);
    const dest = join(d, "tickets/open/0041-streak-freeze-tokens.md");
    assert.ok(existsSync(dest));
    const p = parse(readFileSync(dest, "utf8"));
    assert.equal(p.fm.id, 41);
    assert.equal(p.fm.status, "open");
    assert.equal(p.fm.source, "ui", "provenance survives triage");
    assert.equal(p.body, body, "body must be byte-identical");
    rmSync(d, { recursive: true, force: true });
  });

  test("refuses a slug that is not kebab-case", () => {
    const d = repo();
    writeFileSync(join(d, "tickets/inbox/x.md"), serialize({ status: "inbox", title: "t", type: "feature", priority: "med", source: "ui", created: "2026-08-30T00:00:00Z" }, "\nbody\n"));
    commitAll(d);
    const r = run(d, "triage-move", "tickets/inbox/x.md", "--slug", "Not_Kebab Case");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /kebab-case/);
    rmSync(d, { recursive: true, force: true });
  });
});

// ──────────────────────────────────────────────────────────────── 0007 index ────

describe("0007 — index.json", () => {
  test("is idempotent and contains no body text", () => {
    const d = repo(); ticket(d, "open", FM());
    run(d, "index");
    const a = readFileSync(join(d, "tickets/index.json"), "utf8");
    run(d, "index");
    assert.equal(readFileSync(join(d, "tickets/index.json"), "utf8"), a, "must be byte-identical");
    const entries = JSON.parse(a);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].acceptance, { checked: 0, total: 1 });
    assert.ok(!JSON.stringify(entries).includes("## Description"), "index must carry no body");
    rmSync(d, { recursive: true, force: true });
  });

  test("list output survives the bodies being emptied — it is sourced from the index", () => {
    const d = repo(); ticket(d, "open", FM({ title: "Keep me visible" }));
    const before = run(d, "list").out;
    writeFileSync(join(d, "tickets/open/0001-a-ticket.md"), serialize(FM({ title: "Keep me visible" }), "\n"));
    assert.equal(run(d, "list").out, before);
    rmSync(d, { recursive: true, force: true });
  });
});

describe("0008 — the dirty-tree rule exempts the ticket being closed", () => {
  test("a dirty ticket-under-close does not trip the refusal, but another file does", () => {
    const d = repo();
    ticket(d, "open", FM(), "\n## Acceptance criteria\n\n- [ ] a\n\n## Resolution\n\nx\n\n## Operator validation\n\nx\n");
    commitAll(d);
    // tick the last criterion — this is part of closing, not unrelated work
    const p = join(d, "tickets/open/0001-a-ticket.md");
    writeFileSync(p, readFileSync(p, "utf8").replace("- [ ] a", "- [x] a"));
    assert.equal(run(d, "close", "1").code, 0, "its own file being dirty must not block the close");

    // and the rule still bites for genuinely unrelated changes
    const d2 = repo();
    ticket(d2, "open", FM(), "\n## Acceptance criteria\n\n- [x] a\n\n## Resolution\n\nx\n\n## Operator validation\n\nx\n");
    commitAll(d2);
    writeFileSync(join(d2, "unrelated.txt"), "dirty");
    assert.notEqual(run(d2, "close", "1").code, 0, "unrelated dirt must still refuse");
    rmSync(d, { recursive: true, force: true });
    rmSync(d2, { recursive: true, force: true });
  });
});

describe("0008 — create emits the sections its type requires", () => {
  test("a bug gets Steps to reproduce and Expected vs actual, and validates", () => {
    const d = repo();
    assert.equal(run(d, "create", "--title", "A bug", "--type", "bug", "--priority", "high", "--slug", "a-bug").code, 0);
    const body = readFileSync(join(d, "tickets/open/0001-a-bug.md"), "utf8");
    assert.match(body, /^## Steps to reproduce$/m);
    assert.match(body, /^## Expected vs actual$/m);
    // the real assertion: what create produces must pass validate
    assert.equal(run(d, "validate").code, 0, "create must not produce a ticket that fails validation");
    rmSync(d, { recursive: true, force: true });
  });

  test("a design ticket gets Options considered and Open questions", () => {
    const d = repo();
    run(d, "create", "--title", "A design", "--type", "design", "--priority", "med", "--slug", "a-design");
    const body = readFileSync(join(d, "tickets/open/0001-a-design.md"), "utf8");
    assert.match(body, /^## Options considered$/m);
    assert.match(body, /^## Open questions$/m);
    assert.equal(run(d, "validate").code, 0);
    rmSync(d, { recursive: true, force: true });
  });

  test("a feature gets neither", () => {
    const d = repo();
    run(d, "create", "--title", "A feature", "--type", "feature", "--priority", "low", "--slug", "a-feature");
    const body = readFileSync(join(d, "tickets/open/0001-a-feature.md"), "utf8");
    assert.ok(!/## Steps to reproduce/.test(body));
    assert.equal(run(d, "validate").code, 0);
    rmSync(d, { recursive: true, force: true });
  });
});
