#!/usr/bin/env node
// PRIVATE-METHOD UPDATE CHECK — no `++`/`--`/assignment through the result of a
// `#privateMethod()` call.
//
// Ticket 0206. The bug this guards against crashes the PRODUCTION bundle only, and
// every other gate in this project passes it.
//
// SWC (the compiler `next build` uses) downlevels `#private` members for the browser
// target: a private FIELD becomes a `WeakMap`, a private METHOD becomes a `WeakSet`
// brand plus a plain function. Reading a private method is meant to compile to
// `_class_private_method_get(receiver, brand, fn)`, which only calls `brand.has()`.
// But when an UPDATE expression (`++`/`--`) has a private-method call anywhere in its
// operand's member chain, SWC routes that private-name access through
// `_class_extract_field_descriptor(receiver, map, "update")` instead — which calls
// `map.get(receiver)` on the `WeakSet`. A `WeakSet` has no `.get`:
//
//     this.#current().cameraEvents++      →  TypeError: a.get is not a function
//
// Ticket 0059 shipped exactly that line. It passed tsc, eslint, 2,074 vitest tests,
// six guard scripts, `next build` and two headless browser harnesses, because vitest
// and esbuild do not downlevel private methods this way. The operator found it by
// opening the page, and the stack pointed into MapLibre's `move` handler.
//
// What was measured (0206, Next 15.5.24's bundled SWC AND standalone @swc/core
// 1.16.2, the latest at the time — both identical, so upgrading does not fix it):
//
//     this.#m().n++   ++this.#m().n   this.#m().n--      THROWS
//     this.#m().a.n++   this.#m().g().n++   this.#m()[0]++   THROWS
//     other.#m().n++   (this.#m()).n++                    THROWS  (any receiver)
//     A.#staticM().n++                                    THROWS  (`_s is not defined`)
//     this.#m().n += 1   this.#m().n ??= 1   … = 5         compile correctly today
//     const o = this.#m(); o.n++                          correct — THE FIX
//
// Assignments are gated anyway, as the ticket asks: they take the neighbouring
// read-modify-write path in the same transform, the hoisted-local form is always
// available and always correct, and there are zero legitimate uses to protect.
//
// WHY A SOURCE SCAN AND NOT A BUNDLE SCAN. The bundle-level signature (a two-argument
// field-helper call on an identifier assigned `new WeakSet`) was tried in 0206 and
// gave ~30 hits, essentially all false: webpack concatenates modules and minified
// names are per-module, so a `WeakSet` called `I` in one module makes every `WeakMap`
// called `I` in every other module look guilty.
//
// HOW IT READS SOURCE. Plain node, no dependencies (D-163: it runs in the Actions gate
// and in the Amplify build container). Not a line grep: comments, string literals,
// template text and regex literals are blanked first, so the explanatory comment in
// lib/fog/perf/collector.ts does not trip it. Then, for every `++`/`--` and every
// assignment operator, it walks the member chain beside the operator — identifiers
// joined by `.`/`?.`, `(…)` calls and `[…]` indexes — and fails if that chain contains
// a `#name(` call. The walk stops at anything that is not part of a chain, so
// `if (this.#ok()) counter.n++` is not a hit.
//
//   node scripts/check-private-method-update.mjs              scan lib/ components/ src/ app/
//   node scripts/check-private-method-update.mjs --self-test  prove it FIRES on a real violation
//
// Upstream: https://github.com/swc-project/swc/issues/12427 (filed in 0206). When it is fixed
// AND Next ships that SWC, keep this anyway — it costs 0.1s and the failure is invisible.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const ROOTS = ["lib", "components", "src", "app"]
const SKIP_DIRS = new Set(["node_modules", ".next", ".amplify", ".git"])
const EXTS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"]

const IDENT = /[\w$#]/
const PRIVATE_CALL = /#[A-Za-z_$][\w$]*\s*\(/

/**
 * The source with every comment, string, template-literal text and regex literal
 * replaced by spaces — same length, newlines kept, so offsets still map to lines.
 * `${…}` inside a template stays code. A quoted string that reaches a newline is
 * abandoned and its quote treated as an ordinary character: that is how JSX text
 * with an apostrophe in it (`<p>don't</p>`) costs one line of accuracy, not the rest
 * of the file.
 */
export function blank(src) {
  const out = src.split("")
  const wipe = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " "
  }
  const stack = [] // template-literal brace depths
  let i = 0
  let lastSig = "" // last significant (non-space) code character, for `/` disambiguation
  while (i < src.length) {
    const c = src[i]
    const d = src[i + 1]
    if (c === "/" && d === "/") {
      const end = src.indexOf("\n", i)
      const stop = end === -1 ? src.length : end
      wipe(i, stop)
      i = stop
    } else if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2)
      const stop = end === -1 ? src.length : end + 2
      wipe(i, stop)
      i = stop
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < src.length && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1
      if (src[j] === c) {
        wipe(i + 1, j)
        i = j + 1
        lastSig = c
      } else {
        lastSig = c
        i += 1
      }
    } else if (c === "`" || (c === "}" && stack.length && stack[stack.length - 1] === 0)) {
      // Opening a template, or resuming one after `${…}`.
      if (c === "}") stack.pop()
      let j = i + 1
      while (j < src.length && src[j] !== "`" && !(src[j] === "$" && src[j + 1] === "{")) {
        j += src[j] === "\\" ? 2 : 1
      }
      wipe(i + 1, j)
      if (src[j] === "$") {
        stack.push(0)
        i = j + 2
        lastSig = "{"
      } else {
        i = j + 1
        lastSig = "`"
      }
    } else if (c === "/" && (lastSig === "" || "(,=:[!&|?{};+-*%<>~^".includes(lastSig))) {
      // A regex literal: `/` where an operand is expected.
      let j = i + 1
      let inClass = false
      while (j < src.length && src[j] !== "\n") {
        if (src[j] === "\\") j += 2
        else if (src[j] === "[") (inClass = true), j++
        else if (src[j] === "]") (inClass = false), j++
        else if (src[j] === "/" && !inClass) break
        else j++
      }
      if (src[j] === "/") {
        wipe(i + 1, j)
        i = j + 1
        lastSig = "/"
      } else {
        lastSig = "/"
        i += 1
      }
    } else {
      if (stack.length) {
        if (c === "{") stack[stack.length - 1]++
        else if (c === "}") stack[stack.length - 1]--
      }
      if (!/\s/.test(c)) lastSig = c
      i += 1
    }
  }
  return out.join("")
}

const OPEN = { ")": "(", "]": "[" }
const CLOSE = { "(": ")", "[": "]" }

function skipWsBack(s, j) {
  while (j >= 0 && /\s/.test(s[j])) j--
  return j
}
function skipWsFwd(s, j) {
  while (j < s.length && /\s/.test(s[j])) j++
  return j
}

/** Start offset of the member chain that ends just before `end`, or `end` if none. */
function chainBefore(s, end) {
  let j = skipWsBack(s, end - 1)
  let start = end
  for (;;) {
    if (j < 0) break
    if (OPEN[s[j]]) {
      // A `(…)` call / grouping or a `[…]` index. Adjacent groups and an adjacent
      // identifier continue the chain: `#m()`, `a[0]`, `g()()`.
      let depth = 0
      let k = j
      for (; k >= 0; k--) {
        if (s[k] === s[j]) depth++
        else if (s[k] === OPEN[s[j]] && --depth === 0) break
      }
      if (k < 0) break
      start = k
      j = skipWsBack(s, k - 1)
      if (j >= 0 && (IDENT.test(s[j]) || OPEN[s[j]])) continue
    } else if (IDENT.test(s[j])) {
      while (j >= 0 && IDENT.test(s[j])) j--
      start = j + 1
      j = skipWsBack(s, j)
    } else break
    // Only a `.` (or `?.`) joins a segment to what precedes it.
    if (j >= 0 && s[j] === ".") {
      j = skipWsBack(s, s[j - 1] === "?" ? j - 2 : j - 1)
      continue
    }
    break
  }
  return start
}

/** End offset of the member chain that starts at `begin`, or `begin` if none. */
function chainAfter(s, begin) {
  let j = skipWsFwd(s, begin)
  let end = begin
  for (;;) {
    if (j >= s.length) break
    if (CLOSE[s[j]]) {
      let depth = 0
      let k = j
      for (; k < s.length; k++) {
        if (s[k] === s[j]) depth++
        else if (s[k] === CLOSE[s[j]] && --depth === 0) break
      }
      if (k >= s.length) break
      end = k + 1
    } else if (IDENT.test(s[j])) {
      while (j < s.length && IDENT.test(s[j])) j++
      end = j
    } else break
    j = skipWsFwd(s, end)
    if (s[j] === "?" && s[j + 1] === ".") j = skipWsFwd(s, j + 2)
    else if (s[j] === ".") j = skipWsFwd(s, j + 1)
    else if (!CLOSE[s[j]]) break
  }
  return end
}

/**
 * Every assignment operator, and not `==`, `===`, `!=`, `<=`, `>=` or `=>`.
 * The longer compounds are listed first so `>>>=` is not read as `>=`.
 */
const ASSIGN = /(?<![=!<>])(\*\*|<<|>>>|>>|&&|\|\||\?\?|[-+*/%&|^])?=(?![=>])/g
const UPDATE = /\+\+|--/g

export function findViolations(src) {
  const s = blank(src)
  const hits = []
  const lineOf = (off) => src.slice(0, off).split("\n").length
  const report = (from, to, op) => {
    const operand = s.slice(from, to)
    if (PRIVATE_CALL.test(operand)) hits.push({ line: lineOf(from), op, operand: operand.replace(/\s+/g, " ").trim() })
  }
  for (const m of s.matchAll(UPDATE)) {
    report(chainBefore(s, m.index), m.index, m[0]) // postfix
    report(m.index + 2, chainAfter(s, m.index + 2), m[0]) // prefix
  }
  for (const m of s.matchAll(ASSIGN)) {
    report(chainBefore(s, m.index), m.index, m[0])
  }
  return hits
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (EXTS.some((e) => name.endsWith(e))) out.push(full)
  }
  return out
}

export function scan(base) {
  const hits = []
  for (const root of ROOTS) {
    for (const file of walk(join(base, root))) {
      const rel = relative(base, file).split(sep).join("/")
      for (const h of findViolations(readFileSync(file, "utf8"))) hits.push({ rel, ...h })
    }
  }
  return hits
}

function selfTest() {
  const CLS = (body) => `class A {\n  #m() { return this.o }\n  go(other) {\n    ${body}\n  }\n}\n`

  // Every one of these must FIRE. The first nine are measured crashes (see header).
  const violations = [
    "this.#m().n++",
    "++this.#m().n",
    "this.#m().n--",
    "this.#m().a.n++",
    "this.#m().g().n++",
    "this.#m()[0]++",
    "other.#m().n++",
    "(this.#m()).n++",
    "A.#staticM().n++",
    "this.#m(1, 2).n++",
    "this.#m()\n      .n++",
    "this.#m()?.a.n++",
    "this.#m().n += 1",
    "this.#m().n -= 1",
    "this.#m().n >>>= 1",
    "this.#m().n ??= 1",
    "this.#m().n ||= 1",
    "this.#m().n = 5",
  ]
  // Every one of these must PASS.
  const clean = [
    "const acc = this.#m(); acc.n++",
    "const culls = this.#m().culls\n    culls.n += 1",
    "this.#f.n++",
    "this.#m().frames.push(1)",
    "if (this.#m()) counter.n++",
    "return this.#m().n === 1",
    "if (this.#m().n >= 1 && this.#m().n <= 2 && this.#m().n != 3) x = 1",
    "const f = () => this.#m().n",
    "// this.#m().n++ in a comment",
    "/* this.#m().n++ in a block comment */",
    "const s = 'this.#m().n++'",
    'const s = "this.#m().n += 1"',
    "const s = `this.#m().n++ ${other.n++}`",
    "const r = /#m\\(\\)\\.n\\+\\+/",
    "i++; this.#m().go()",
    "total += this.#m().n",
    "arr[i++] = this.#m().n",
  ]

  const failures = []
  for (const v of violations) {
    if (findViolations(CLS(v)).length === 0) failures.push(`did NOT fire on: ${v}`)
  }
  for (const c of clean) {
    const hits = findViolations(CLS(c))
    if (hits.length) failures.push(`fired on correct code: ${c}  →  ${JSON.stringify(hits)}`)
  }
  // The exact line 0059 shipped, and the exact line that replaced it, in their real shape.
  if (findViolations("cameraEvent(): void {\n  this.#current().cameraEvents++\n}").length !== 1) {
    failures.push("did NOT fire on 0059's shipped line")
  }
  if (findViolations("cameraEvent(): void {\n  const acc = this.#current()\n  acc.cameraEvents++\n}").length) {
    failures.push("fired on 0059's hoisted fix")
  }

  if (failures.length) {
    console.error(
      "SELF-TEST FAILED — the check cannot be trusted:\n  " + failures.join("\n  "),
    )
    process.exit(1)
  }
  console.log(
    `check-private-method-update: self-test passed (${violations.length + 1} violations fired, ${clean.length + 1} correct forms passed)`,
  )
}

if (process.argv.includes("--self-test")) {
  selfTest()
} else {
  const hits = scan(ROOT)
  if (hits.length) {
    console.error(
      hits.map((h) => `${h.rel}:${h.line}  ${h.operand} ${h.op}`).join("\n") +
        "\n\nSWC miscompiles an update through a #privateMethod() call: the production bundle throws\n" +
        "`a.get is not a function` while vitest, esbuild and `next dev` all work (ticket 0206).\n" +
        "Hoist the call to a local first:   const acc = this.#m(); acc.n++",
    )
    process.exit(1)
  }
  console.log("check-private-method-update: no update or assignment through a #privateMethod() call")
}
