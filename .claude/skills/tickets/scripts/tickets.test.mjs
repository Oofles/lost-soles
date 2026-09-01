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
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const SCRIPT = new URL("./tickets.mjs", import.meta.url).pathname;
const { parse, serialize, acceptance, isReady, findCycles, validate, buildIndex, missingSections, slugify } = await import("./tickets.mjs");

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
    // Deliberately in open/: an operator criterion ticked with no dated result is
    // wrong where it is written, not only where it lands (0124).
    ["operator-unsigned", (d) => ticket(d, "open", FM(), "\n## Acceptance criteria\n\n- [x] (operator) ran it on the phone\n")],
    ["bug-section", (d) => ticket(d, "open", FM({ type: "bug" }))],
    ["design-section", (d) => ticket(d, "open", FM({ type: "design" }))],
    ["missing-section", (d) => ticket(d, "open", FM(), "\n## Description\n\nx\n")],
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

// ─────────────────────────────────────────── 0124 operator-verifiable criteria ────

describe("0124 — operator-verifiable criteria block a close", () => {
  const AC = (...items) => `\n## Acceptance criteria\n\n${items.join("\n")}\n\n## Resolution\n\nx\n\n## Operator validation\n\nx\n`;
  const only = (body) => acceptance(body);

  test("recognises the marker bare, bolded, and in any case; ignores it mid-text", () => {
    const { criteria } = only(AC(
      "- [ ] (operator) ran it on the phone",
      "- [ ] **(Operator)** bolded and capitalised",
      "- [ ] (OPERATOR): with a colon",
      "- [ ] a criterion mentioning the (operator) halfway through",
      "- [ ] an ordinary criterion",
    ));
    assert.deepEqual(criteria.map((c) => c.operator), [true, true, true, false, false]);
  });

  test("a sign-off needs a date AND a result — a bare 'verified' is not one", () => {
    const { criteria } = only(AC(
      "- [x] (operator) checked \u2014 verified 2026-08-31: passed on the Pixel",
      "- [x] (operator) checked - verified 2026-08-31: passed",
      "- [x] (operator) checked \u2013 verified 2026-08-31: passed",
      "- [x] (operator) checked \u2014 verified: passed",
      "- [x] (operator) checked \u2014 verified 2026-08-31:",
      "- [x] (operator) checked, honest",
    ));
    assert.deepEqual(criteria.map((c) => c.signed), [true, true, true, false, false, false]);
  });

  test("a criterion wrapped across lines is one criterion, and its sign-off counts", () => {
    // The rule must not fail open on exactly the criteria long enough to wrap.
    const body = AC(
      "- [x] (operator) typing /tickets shows the skill with its argument-hint",
      "      \u2014 verified 2026-08-31: registered, no session restart needed",
    );
    const { total, criteria, unsignedOperator } = only(body);
    assert.equal(total, 1, "continuation lines must fold, not count as criteria");
    assert.equal(criteria[0].signed, true);
    assert.deepEqual(unsignedOperator, []);
  });

  test("an unchecked operator criterion is not itself an error — it is a wait", () => {
    const { unsignedOperator, pendingOperator } = only(AC("- [ ] (operator) go for a run with the build"));
    assert.deepEqual(unsignedOperator, []);
    assert.equal(pendingOperator.length, 1);
  });

  test("close refuses an unchecked operator criterion, and says to leave it open", () => {
    const d = repo();
    ticket(d, "open", FM(), AC("- [x] done", "- [ ] (operator) typing /tickets shows the skill"));
    commitAll(d);
    const r = run(d, "close", "1");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /only be checked by a human/i);
    assert.match(r.out, /Do NOT tick these/);
    assert.match(r.out, /Leave the ticket open/i);
    assert.ok(existsSync(join(d, "tickets/open/0001-a-ticket.md")), "file must not move");
    rmSync(d, { recursive: true, force: true });
  });

  test("close refuses an operator criterion ticked with no sign-off", () => {
    const d = repo();
    ticket(d, "open", FM(), AC("- [x] (operator) typing /tickets shows the skill"));
    commitAll(d);
    const r = run(d, "close", "1");
    assert.notEqual(r.code, 0, "this is the 0010 failure: every box ticked, nothing verified");
    assert.match(r.out, /ticked with no sign-off/i);
    assert.ok(existsSync(join(d, "tickets/open/0001-a-ticket.md")), "file must not move");
    rmSync(d, { recursive: true, force: true });
  });

  test("close accepts a signed operator criterion", () => {
    const d = repo();
    ticket(d, "open", FM(), AC("- [x] (operator) typing /tickets shows the skill \u2014 verified 2026-08-31: it did"));
    commitAll(d);
    const r = run(d, "close", "1");
    assert.equal(r.code, 0, r.out);
    assert.ok(existsSync(join(d, "tickets/closed/0001-a-ticket.md")));
    rmSync(d, { recursive: true, force: true });
  });

  test("--allow-dirty does not launder an unsigned operator criterion", () => {
    // --allow-dirty exists for the tree, not for the criteria. Worth asserting:
    // the nearest available flag is the first thing anyone reaches for.
    const d = repo();
    ticket(d, "open", FM(), AC("- [x] (operator) checked it"));
    commitAll(d);
    assert.notEqual(run(d, "close", "1", "--allow-dirty").code, 0);
    assert.ok(existsSync(join(d, "tickets/open/0001-a-ticket.md")));
    rmSync(d, { recursive: true, force: true });
  });

  test("tickets written before the marker existed are untouched by it", () => {
    // The rule is opt-in. If an unmarked ticket could trip it, landing this
    // would have turned 121 closed tickets red.
    const d = repo();
    ticket(d, "open", FM(), AC("- [x] an ordinary criterion, ticked by the agent that did the work"));
    commitAll(d);
    assert.equal(run(d, "close", "1").code, 0);
    rmSync(d, { recursive: true, force: true });
  });
});

// ────────────────────────────────────── 0126 required body sections, everywhere ────

describe("0126 — validate enforces required body sections on every non-inbox ticket", () => {
  const BASE = ["Description", "Acceptance criteria", "Notes", "Operator validation"];
  const sections = (...names) => "\n" + names.map((n) => `## ${n}\n\nx\n`).join("\n");

  test("each of the four base sections is required on its own", () => {
    // One at a time: a rule that only fires when all four are absent would pass
    // a single-section test and miss every realistic case.
    for (const omitted of BASE) {
      const d = repo();
      ticket(d, "open", FM(), sections(...BASE.filter((n) => n !== omitted)));
      const { errors } = withRoot(d, () => validateIn(d));
      assert.ok(
        errors.some((e) => e.rule === "missing-section" && e.msg.includes(omitted)),
        `omitting '${omitted}' must be an error, got: ${errors.map((e) => e.msg).join(" | ") || "none"}`,
      );
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("a frontmatter-only ticket names all four missing sections, not just the first", () => {
    // The probe that motivated the ticket: valid frontmatter, no body at all,
    // and validate used to call the backlog clean.
    const d = repo();
    ticket(d, "open", FM(), "\n");
    const { errors } = withRoot(d, () => validateIn(d));
    const missing = errors.filter((e) => e.rule === "missing-section").map((e) => e.msg);
    assert.equal(missing.length, 4, `expected all four, got: ${missing.join(" | ")}`);
    rmSync(d, { recursive: true, force: true });
  });

  test("a design ticket needs Options considered and Open questions", () => {
    const d = repo();
    ticket(d, "open", FM({ type: "design" }), sections(...BASE));
    const { errors } = withRoot(d, () => validateIn(d));
    const msgs = errors.filter((e) => e.rule === "design-section").map((e) => e.msg).join(" | ");
    assert.match(msgs, /Options considered/);
    assert.match(msgs, /Open questions/);
    rmSync(d, { recursive: true, force: true });
  });

  test("inbox captures are exempt — including a bug typed on a phone", () => {
    // Live before 0126, not hypothetical: the bug rule ran in every folder, so
    // capturing "fog flickers when panning" as a bug turned the backlog red.
    const d = repo();
    writeFileSync(join(d, "tickets/inbox/2026-09-01T0100-fog-flickers.md"), serialize({
      status: "inbox", title: "fog flickers when panning", type: "bug",
      priority: "med", source: "ui", created: "2026-09-01T01:00:00Z",
    }, "\n## Description\n\nNoticed at mile six.\n"));
    const r = run(d, "validate");
    assert.equal(r.code, 0, `an inbox capture must never fail validation:\n${r.out}`);
    rmSync(d, { recursive: true, force: true });
  });

  test("missingSections returns nothing for inbox, whatever the body", () => {
    assert.deepEqual(missingSections({ type: "bug" }, "", "inbox"), []);
    assert.ok(missingSections({ type: "bug" }, "", "open").length > 0);
  });

  test("a closed ticket still needs ## Resolution, and it is still 'closed-section'", () => {
    const d = repo();
    ticket(d, "closed", FM({ status: "closed", closed: "2026-08-30T00:00:00Z" }),
      "\n## Description\n\nx\n\n## Acceptance criteria\n\n- [x] a\n\n## Notes\n\nx\n\n## Operator validation\n\nx\n");
    const { errors } = withRoot(d, () => validateIn(d));
    assert.ok(errors.some((e) => e.rule === "closed-section" && e.msg.includes("Resolution")));
    rmSync(d, { recursive: true, force: true });
  });

  test("everything `create` emits, `validate` accepts — for every type", () => {
    // The drift this ticket closes: the generator wrote sections the validator
    // did not require. Asserting them against each other keeps them married.
    for (const type of ["feature", "bug", "design", "chore", "refactor", "docs"]) {
      const d = repo();
      const r = run(d, "create", "--title", `A ${type}`, "--type", type, "--priority", "med", "--capability", "00-x");
      assert.equal(r.code, 0, r.out);
      const v = run(d, "validate");
      assert.equal(v.code, 0, `create --type ${type} produced a ticket validate rejects:\n${v.out}`);
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("triage-move leaves a promoted capture failing validate, deliberately", () => {
    // D-170: a promoted capture is not yet a ticket. The error IS the gate —
    // triage supplies the criteria (§2.3), and a TODO skeleton would validate
    // green while meaning nothing, which is 0124's failure in another costume.
    const d = repo();
    writeFileSync(join(d, "tickets/inbox/2026-09-01T0100-streak-freeze.md"), serialize({
      status: "inbox", title: "streak freeze", type: "feature",
      priority: "med", source: "ui", created: "2026-09-01T01:00:00Z",
    }, "\n## Description\n\nIdea from the 10k.\n"));
    commitAll(d);
    assert.equal(run(d, "triage-move", "tickets/inbox/2026-09-01T0100-streak-freeze.md", "--slug", "streak-freeze").code, 0);
    const r = run(d, "validate");
    assert.notEqual(r.code, 0, "an unfinished triage must not validate clean");
    assert.match(r.out, /Acceptance criteria/);
    rmSync(d, { recursive: true, force: true });
  });
});

// ──────────────────────────────────────────── 0127 slug derivation in `create` ────

describe("0127 — create derives a valid slug from a title long enough to truncate", () => {
  const LONG = "validate: enforce required body sections on every ticket, not just closed ones";

  test("the reported title now yields the slug the ticket predicted", () => {
    assert.equal(slugify(LONG), "validate-enforce-required-body-sections-on-every-ticket-not");
  });

  test("no truncation point can produce a trailing hyphen", () => {
    // The bug was an ordering one, so a single example proves little. Every
    // prefix of a hyphen-rich title is a candidate cut point; none may end in
    // a hyphen, and each must satisfy the same regex `create` checks against.
    const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (let i = 1; i <= LONG.length; i++) {
      const out = slugify(LONG.slice(0, i));
      if (out === "") continue;
      assert.ok(!out.endsWith("-"), `slugify(title[0..${i}]) ended in a hyphen: '${out}'`);
      assert.ok(SLUG_RE.test(out), `slugify(title[0..${i}]) is not kebab-case: '${out}'`);
      assert.ok(out.length <= 60, `slugify(title[0..${i}]) is ${out.length} chars`);
    }
  });

  test("a title with no alphanumerics yields an empty slug, not a hyphen", () => {
    assert.equal(slugify("!!! ???"), "");
  });

  test("create succeeds on the reported title with no --slug, and the result validates", () => {
    const d = repo();
    const r = run(d, "create", "--title", LONG, "--type", "chore", "--priority", "med",
                  "--size", "s", "--capability", "00-x");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /0001-validate-enforce-required-body-sections-on-every-ticket-not\.md/);
    assert.equal(run(d, "validate").code, 0, "a ticket create makes must validate");
    rmSync(d, { recursive: true, force: true });
  });

  test("create still refuses a punctuation-only title rather than writing an empty slug", () => {
    const d = repo();
    const r = run(d, "create", "--title", "!!! ???", "--type", "chore", "--priority", "med");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /not kebab-case/);
    assert.equal(readdirSync(join(d, "tickets/open")).length, 0, "no file may be written");
    rmSync(d, { recursive: true, force: true });
  });

  test("the usage text lists every flag create actually accepts", () => {
    // --source and --body were both accepted and both undocumented. A usage
    // line that omits a working flag is how the next person concludes it does
    // not exist.
    const d = repo();
    const usage = run(d).out;
    const createLine = usage.split("\n").find((l) => l.trim().startsWith("create "));
    for (const flag of ["--size", "--capability", "--slug", "--depends", "--source", "--body"]) {
      assert.ok(createLine.includes(flag), `usage omits ${flag}: ${createLine}`);
    }
    rmSync(d, { recursive: true, force: true });
  });
});

// ──────────────────────────────────────────── 0133 the audit mechanical checks ────

describe("0133 — audit runs AUDIT.md's mechanical half and is honest about what it cannot run", () => {
  const withCap = (d, name = "00-x") => {
    writeFileSync(join(d, "docs/capabilities", `${name}.md`), "# cap\n");
    return name;
  };
  const auditJson = (d, cap) => JSON.parse(run(d, "audit", cap, "--json").out);

  test("every n/a result carries a reason — an empty one is a bug, not a shortcut", () => {
    // The whole design: "could not check" must survive into the output as
    // something other than "checked". A blank reason collapses the two again.
    const d = repo();
    const cap = withCap(d);
    ticket(d, "closed", FM({ status: "closed", closed: "2026-08-30T00:00:00Z", capability: cap }),
      "\n## Description\n\nx\n\n## Acceptance criteria\n\n- [x] a\n\n## Notes\n\nx\n\n## Operator validation\n\nx\n\n## Resolution\n\nx\n");
    const { checks } = auditJson(d, cap);
    const nas = checks.filter((c) => c.status === "na");
    assert.ok(nas.length >= 4, `expected several n/a on a bare repo, got ${nas.length}`);
    for (const c of checks) {
      assert.ok(c.detail && c.detail.trim().length > 0, `check '${c.id}' has an empty detail`);
      if (c.status === "na") {
        assert.ok(c.detail.length > 25, `n/a reason for '${c.id}' is too thin to be useful: '${c.detail}'`);
        assert.ok(/exist|no |activat|add one|until|yet/i.test(c.detail),
          `n/a reason for '${c.id}' does not say what would make it applicable: '${c.detail}'`);
      }
    }
    rmSync(d, { recursive: true, force: true });
  });

  test("n/a alone exits 0 — an inapplicable check is not a failure", () => {
    const d = repo();
    const cap = withCap(d);
    ticket(d, "closed", FM({ status: "closed", closed: "2026-08-30T00:00:00Z", capability: cap }),
      "\n## Description\n\nx\n\n## Acceptance criteria\n\n- [x] a\n\n## Notes\n\nx\n\n## Operator validation\n\nx\n\n## Resolution\n\nx\n");
    const r = run(d, "audit", cap);
    assert.equal(r.code, 0, `a repo whose checks are all pass-or-n/a must exit 0:\n${r.out}`);
    rmSync(d, { recursive: true, force: true });
  });

  test("an open ticket in the capability fails the audit and is named", () => {
    const d = repo();
    const cap = withCap(d);
    ticket(d, "open", FM({ capability: cap }));
    const r = run(d, "audit", cap);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /capability-tickets-closed/);
    assert.match(r.out, /0001/);
    rmSync(d, { recursive: true, force: true });
  });

  test("a blocked_by pointing at a closed ticket fails §5", () => {
    const d = repo();
    const cap = withCap(d);
    const closed = "\n## Description\n\nx\n\n## Acceptance criteria\n\n- [x] a\n\n## Notes\n\nx\n\n## Operator validation\n\nx\n\n## Resolution\n\nx\n";
    ticket(d, "closed", FM({ id: 1, status: "closed", closed: "2026-08-30T00:00:00Z", capability: cap }), closed);
    ticket(d, "open", FM({ id: 2, slug: "b", status: "blocked", blocked_by: [1], capability: "99-other" }));
    const { checks } = auditJson(d, cap);
    const c = checks.find((x) => x.id === "blocked-by-closed");
    assert.equal(c.status, "fail", c.detail);
    assert.match(c.detail, /0002 blocked_by 0001/);
    rmSync(d, { recursive: true, force: true });
  });

  test("the invariant sweep parses I-n rows and goes live once a test cites one", () => {
    const d = repo();
    const cap = withCap(d);
    mkdirSync(join(d, "docs"), { recursive: true });
    writeFileSync(join(d, "docs/02-data-model.md"),
      "## 9. Invariants\n\n| **I-1** | never re-fog | why | **[S]** enforced |\n| **I-2** | xp only grows | why | CI |\n");

    // No citation anywhere: n/a, and the reason names the activation condition.
    let c = auditJson(d, cap).checks.find((x) => x.id === "invariant-sweep");
    assert.equal(c.status, "na");
    assert.match(c.detail, /2 invariants declared/);
    assert.match(c.detail, /activates/);

    // One cited, one not: live, and it names the gap rather than the coverage.
    mkdirSync(join(d, "src"), { recursive: true });
    writeFileSync(join(d, "src/cells.test.mjs"), "// asserts I-1 holds\n");
    c = auditJson(d, cap).checks.find((x) => x.id === "invariant-sweep");
    assert.equal(c.status, "fail");
    assert.match(c.detail, /I-2/);
    assert.ok(!/I-1\b/.test(c.detail.replace(/1\/2/, "")), `I-1 is cited and must not be listed as missing: ${c.detail}`);

    // Both cited: pass.
    writeFileSync(join(d, "src/xp.test.mjs"), "// asserts I-2 holds\n");
    c = auditJson(d, cap).checks.find((x) => x.id === "invariant-sweep");
    assert.equal(c.status, "pass", c.detail);
    rmSync(d, { recursive: true, force: true });
  });

  test("a citation outside the app roots does not activate the sweep", () => {
    // Regression: 0133's own test carries `| **I-1** |` rows as fixture data,
    // and scanning the whole repo let that trip the sweep against the real
    // backlog — 28 uncited invariants reported from a string describing the
    // check itself.
    const d = repo();
    const cap = withCap(d);
    mkdirSync(join(d, "docs"), { recursive: true });
    writeFileSync(join(d, "docs/02-data-model.md"), "| **I-1** | never re-fog | why | CI |\n");
    mkdirSync(join(d, ".claude/skills/x"), { recursive: true });
    writeFileSync(join(d, ".claude/skills/x/tool.test.mjs"), "const fixture = '| **I-1** | never re-fog |';\n");
    const c = auditJson(d, cap).checks.find((x) => x.id === "invariant-sweep");
    assert.equal(c.status, "na", `tooling fixtures must not activate the sweep: ${c.detail}`);
    rmSync(d, { recursive: true, force: true });
  });

  test("an unknown capability is refused and the real ones are listed", () => {
    const d = repo();
    withCap(d, "00-preflight-and-repo");
    withCap(d, "01-ticket-system");
    const r = run(d, "audit", "01-ticket-sistem");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /00-preflight-and-repo/);
    assert.match(r.out, /01-ticket-system/);
    rmSync(d, { recursive: true, force: true });
  });

  test("audit with no capability names the ones that exist rather than guessing", () => {
    const d = repo();
    withCap(d, "01-ticket-system");
    const r = run(d, "audit");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /01-ticket-system/);
    rmSync(d, { recursive: true, force: true });
  });

  test("the table says a green table is not a passed audit, and names the way to one", () => {
    // Updated in 0134: the footer used to point at ticket 0134 as the missing
    // half. Naming a ticket in output that outlives the ticket is the stale
    // part — it now names the commands and the AUDIT.md sections instead.
    const d = repo();
    const cap = withCap(d);
    const out = run(d, "audit", cap).out;
    assert.match(out, /not a passed audit/i);
    for (const s of [/§2/, /§3/, /§6/, /--sections/, /--record/]) assert.match(out, s);
    rmSync(d, { recursive: true, force: true });
  });
});

// ──────────────────────────────────────── 0134 the audit record + drift budget ────

describe("0134 — the audit record, the divergence list and the drift budget", () => {
  const REFLECT = "\n## Reflection\n\n" + "The design got the validator's flat rule list right, which is why conformance could be checked line by line rather than argued about. ".repeat(3) + "\n";
  const STUB = "\n## Reflection\n\n_Filled in at the REFLECT step, after USE._\n";

  /** A repo whose capability doc is ready to be recorded against. */
  const ready = (reflect = REFLECT, cap = "00-x") => {
    const d = repo();
    writeFileSync(join(d, "docs/capabilities", `${cap}.md`), `# ${cap}\n${reflect}`);
    ticket(d, "closed", FM({ status: "closed", closed: "2026-08-30T00:00:00Z", capability: cap }),
      "\n## Description\n\nx\n\n## Acceptance criteria\n\n- [x] a\n\n## Notes\n\nx\n\n## Operator validation\n\nx\n\n## Resolution\n\nx\n");
    return [d, cap];
  };
  const docOf = (d, cap) => readFileSync(join(d, "docs/capabilities", `${cap}.md`), "utf8");
  const records = (d, cap) => [...docOf(d, cap).matchAll(/<!--\s*audit-record\s+(\{.*?\})\s*-->/g)].map((m) => JSON.parse(m[1]));

  test("an omitted divergence list is refused — an empty one must be asserted", () => {
    // The heart of the ticket: a skipped §2 and a §2 that found nothing must not
    // look the same from outside.
    const [d, cap] = ready();
    const r = run(d, "audit", cap, "--record");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /never assumed by omission/i);
    assert.equal(records(d, cap).length, 0, "nothing may be recorded on a refusal");
    rmSync(d, { recursive: true, force: true });
  });

  test("--no-divergences records a clean audit, and says the assertion was made", () => {
    const [d, cap] = ready();
    const r = run(d, "audit", cap, "--record", "--no-divergences");
    assert.equal(r.code, 0, r.out);
    assert.match(docOf(d, cap), /Divergences: none.*Asserted explicitly/s);
    const [rec] = records(d, cap);
    assert.equal(rec.verdict, "pass");
    assert.equal(rec.divergences, 0);
    rmSync(d, { recursive: true, force: true });
  });

  test("--no-divergences alongside a --divergence is refused rather than guessed at", () => {
    const [d, cap] = ready();
    const r = run(d, "audit", cap, "--record", "--no-divergences", "--divergence", "code-was-wrong|0127|x");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /Pick one/);
    rmSync(d, { recursive: true, force: true });
  });

  test("a divergence must resolve one way or the other — 'neither' is not an outcome", () => {
    const [d, cap] = ready();
    for (const bad of ["we-will-remember|x|y", "code-was-wrong||no ref", "code-was-wrong|0127|"]) {
      const r = run(d, "audit", cap, "--record", "--divergence", bad);
      assert.notEqual(r.code, 0, `'${bad}' must be refused`);
      assert.equal(records(d, cap).length, 0);
    }
    rmSync(d, { recursive: true, force: true });
  });

  test("three divergences pass; a fourth fails and calls for a DESIGN session", () => {
    const div = (n) => ["--divergence", `code-was-wrong|01${n}0|divergence number ${n}`];
    const [d, cap] = ready();
    assert.equal(run(d, "audit", cap, "--record", ...div(1), ...div(2), ...div(3)).code, 0);
    assert.equal(records(d, cap)[0].divergences, 3);

    const [e, ecap] = ready();
    const r = run(e, "audit", ecap, "--record", ...div(1), ...div(2), ...div(3), ...div(4));
    assert.notEqual(r.code, 0);
    assert.match(r.out, /budget of three/i);
    assert.match(r.out, /DESIGN session/);
    assert.equal(records(e, ecap).length, 0);
    rmSync(d, { recursive: true, force: true });
    rmSync(e, { recursive: true, force: true });
  });

  test("a placeholder REFLECT section fails — the heading existing is not enough", () => {
    // Every capability doc ships with `## Reflection` already present, holding
    // the template line. Checking the heading exists would pass every capability
    // from the day its doc was created.
    const [d, cap] = ready(STUB);
    const r = run(d, "audit", cap, "--record", "--no-divergences");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /placeholder/i);
    assert.match(r.out, /§6/);
    rmSync(d, { recursive: true, force: true });
  });

  test("a REFLECT section under any heading depth counts — capability 00 keeps its at §6", () => {
    const [d, cap] = ready("\n## Close audit\n\n### §6 Reflection\n\n" + "Real content about what the design got wrong and why it mattered. ".repeat(6) + "\n");
    assert.equal(run(d, "audit", cap, "--record", "--no-divergences").code, 0);
    rmSync(d, { recursive: true, force: true });
  });

  test("--force needs a reason, and records the override rather than hiding it", () => {
    const [d, cap] = ready(STUB);
    assert.notEqual(run(d, "audit", cap, "--record", "--no-divergences", "--force").code, 0,
      "a bare --force must be refused");

    const r = run(d, "audit", cap, "--record", "--no-divergences", "--force", "shipping before the retro, agreed with the operator");
    assert.equal(r.code, 0, r.out);
    const [rec] = records(d, cap);
    assert.equal(rec.verdict, "forced", "a forced audit must never record as a pass");
    assert.match(docOf(d, cap), /Overridden with/);
    assert.match(docOf(d, cap), /shipping before the retro/);
    rmSync(d, { recursive: true, force: true });
  });

  test("records are append-only — a re-audit adds a line and keeps the old one", () => {
    const [d, cap] = ready();
    run(d, "audit", cap, "--record", "--no-divergences");
    run(d, "audit", cap, "--record", "--divergence", "code-was-wrong|0127|found on the second pass");
    const rs = records(d, cap);
    assert.equal(rs.length, 2, "the first record must survive the second audit");
    assert.equal(rs[0].divergences, 0);
    assert.equal(rs[1].divergences, 1);
    rmSync(d, { recursive: true, force: true });
  });

  test("--sections lists design docs with their §refs, and no ticket filenames", () => {
    // `0121-tickets-audit-subcommand.md` reads as `21-tickets-audit-subcommand.md`
    // from the middle, and capability docs share the naming scheme entirely.
    const [d, cap] = ready();
    writeFileSync(join(d, "docs/07-ticketsmith.md"), "# spec\n");
    ticket(d, "open", FM({ id: 2, slug: "b", capability: cap }),
      "\n## Description\n\nSee `07-ticketsmith.md` §3 and §4.7, plus 0121-tickets-audit-subcommand.md and 00-x.md.\n\n## Acceptance criteria\n\n- [ ] a\n\n## Notes\n\nx\n\n## Operator validation\n\nx\n");
    const out = run(d, "audit", cap, "--sections").out;
    assert.match(out, /07-ticketsmith\.md\s+§3, §4\.7/);
    assert.ok(!/21-tickets-audit/.test(out), `a ticket filename leaked into the reading list:\n${out}`);
    assert.ok(!/00-x\.md/.test(out), `a capability doc leaked into the reading list:\n${out}`);
    rmSync(d, { recursive: true, force: true });
  });
});
