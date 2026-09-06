# Pipeline fixtures

**Source-agnostic by rule, not by preference.** `scripts/check-boundaries.mjs` fires on the
string `strava` anywhere under `src/pipeline` (D-100, `01-architecture.md` §3 T1), and that
includes these fixtures and the tests that read them. A pipeline that knows which vendor its
bytes came from is the exact failure D-100 exists to prevent — so the payload here belongs to
`acme-tracker`, which is nobody.

## `verbatim-payload.json`

**Deliberately ugly, and every ugly thing in it is load-bearing.** The archive's one job is to
write bytes through untouched (`03-integrations.md` §3.1 rule 2), and a tidy fixture cannot
demonstrate that — `JSON.parse` + `JSON.stringify` would round-trip a tidy file to something
byte-identical and the test would pass while proving nothing.

So it carries, on purpose:

- **Mixed indentation** — tabs and two-space, inconsistently. Any reformatter normalises these.
- **Irregular inner whitespace** — `"distance":3310.4,   "elapsed_time"`. Lost by re-encoding.
- **An int64 id past 2^53** — `18736594040123457`. Odd, and therefore genuinely not
  representable as a double: `JSON.parse` silently rounds it down to `…456` (§2.7,
  `json-ids.ts`). Plenty of large ids happen to round-trip cleanly, so the value matters —
  a re-encoded archive would hold a *different number* and nothing downstream could tell.
- **Escaped non-ASCII** — `—`, `ö`. A re-encode emits the literal characters instead,
  which is equivalent JSON and different bytes.
- **No trailing newline.** Most editors and formatters add one.

**Do not "fix" any of it,** and do not let a formatter near this directory. If a change to this
file makes `archive.test.ts` pass more easily, the change is wrong.

It carries no coordinates, so `scripts/check-fixture-geography.mjs` has nothing to check here —
unlike the adapter fixtures, which are real responses with Point Nemo geometry (D-199).
