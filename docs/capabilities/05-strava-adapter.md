# 05-strava-adapter

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`05-strava-adapter\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (7)

- `0032` — Strava OAuth connect flow with activity:read_all - and a callback that refuses the lesser scope
- `0033` — strava/client.ts - token storage in SourceAccount (T7) and rotating-refresh-token handling
- `0034` — strava listSince(since) - the mandatory reconciliation sweep and the manual-sync producer
- `0035` — Fetch the full latlng stream - never summary_polyline, and never send resolution/series_type
- `0036` — strava/normalize.ts - pure, no network, no clock, streams JSON to { activity, trace }
- `0037` — Activity-kind mapping on sport_type, indoor/no-GPS handling, and trace sanitation
- `0038` — Checked-in real-response fixtures, the fidelity floor, and rate-limit backoff

## What the OAuth flow cost, and why  (tickets 0032/0165/0166, 2026-09-04)

The first connect worked on the **third** attempt at deploying it. Both intervening defects were
in the same place and had the same cause, and the capability is worth starting from that fact.

`0032` implements the scope check twice: once on the callback query string before the code is
exchanged (**the ticket's criterion 3**), and once on the exchanged grant (**nobody asked for
this**). The pre-exchange check has been correct throughout and did its job live — the operator
deliberately declined the permission and was refused before a token was ever minted. **Both
defects were in the extra check.**

- `0165` — an absent `scope` in the token response was read as "nothing was granted", so a good
  grant was refused and its credential revoked. *(Diagnosis later refuted; see below.)*
- `0166` — the real one. The callback spells its scope list with **commas**; the token endpoint
  spells it with **spaces** (RFC 6749 §5.1). `parseScopes` split on commas only, so
  `"read activity:read_all"` came back as one scope matching nothing and a full grant read as a
  downgrade.

**One document, one example, one surface.** `03-integrations.md` §2.2 shows a scope list exactly
once — on the callback, comma-separated. The parser was written for the surface the document
happened to illustrate. The document was not wrong; it was partial, which is harder to notice and
is now annotated in place rather than quietly rewritten.

**`0032` shipped 76 green tests and could not complete a single connect.** Every token-response
fixture was built from that example, so the suite proved the code matched the document. This is
the argument for `0038` (checked-in real-response fixtures, the fidelity floor), whose Notes now
carry it. **In this capability a fixture derived from a design doc is not a fixture; it is the
design doc asserted twice.**

**Two things paid for themselves and should be repeated.** The two refusal paths were given
*differently worded* log lines, so "which check fired" was answerable from CloudWatch without ever
reproducing anything — twice. And `0165`, unable to distinguish its two hypotheses without an
authorization code only the operator can produce, shipped a fix correct under both and put
`scopeSource` on the grant to settle it; the first successful connect printed
`scopeSource: "response"`, which refuted `0165`'s own diagnosis in one line and confirmed `0166`'s.
A fix safe under every hypothesis you cannot rule out, carrying the evidence that will rule them
out, beats a lucky guess.

**What the connection actually is**, read back rather than reported:

```
externalOwnerId  "51449053"   (a string)      scopes  activity:read_all, read
status           ACTIVE                        expiresAt  connect + 6.0h, from the response
```

## Design notes

No separate DESIGN session was held for this capability. Its seven tickets were written during
the original backlog pass and each carries its own design citations, so notes accumulate here per
ticket as they did for `02-deploy-and-auth` rather than arriving in one block. If a later ticket
finds the design contradictory rather than merely thin, that is the trigger for the DESIGN session
`WORKFLOW.md` prescribes — as `04` did.

## The Strava app registration  (ticket 0032, 2026-09-04)

**Authorization Callback Domain: `devaultsecurity.com`** — a bare domain, no scheme, no path, no
port, which is the only form that field accepts.

**Established by probe, not by reading the settings page.** The authorize endpoint answers
`302 -> https://www.strava.com/login` for a `redirect_uri` it will honour and `400` for one it
refuses, so the app's configuration is directly observable with nothing but the `client_id`
(`01-architecture.md` §7 records that id as semi-public by design — it appears in every authorize
URL). Re-runnable at any time, and cheap enough to be the verification rather than a screenshot:

```
soles.devaultsecurity.com/cb                   302   accepted
other.devaultsecurity.com/cb                   302   accepted
devaultsecurity.com/cb                         302   accepted
localhost:3000/cb                              302   accepted
notsoles.devaultsecurity.com.evil.example/cb   400   refused
attacker.example/cb                            400   refused
```

**Two findings came out of that, and both correct a written claim.**

1. **The domain is the bare parent, not the app's subdomain.** Strava matches the configured
   domain *or any subdomain of it*, so every `*.devaultsecurity.com` host is currently a
   legitimate destination for this app's authorization codes — the exact future
   `app/api/tickets/capture/route.ts` already worries about in its CORS comment. Suffix confusion
   is handled correctly by Strava, as the fifth row shows.

   > **RESOLVED 2026-09-06 as an ACCEPTED RISK, ticket `0163`, D-202. Not fixed.** The field is
   > not editable on the current Strava settings page, and the residual exposure was measured
   > rather than estimated. **Re-probed 2026-09-06: unchanged** — the parent and every sibling
   > are still accepted. D-202 carries the re-open trigger; read it before treating this as
   > closed business.

2. **`localhost` needs no second app.** `03-integrations.md` §2.2 and ticket `0032` both said
   *"you cannot have both at once on one app, so register a second throwaway Strava app for local
   dev"*. The probe shows `localhost` and the production host accepted by the **same** app —
   Strava exempts `localhost` from the callback-domain match. §2.2 was amended.
   **Re-confirmed 2026-09-06 (`0163` criterion 3): `localhost:3000/api/auth/strava/callback` and
   bare `localhost/cb` both still 302.** The exemption holds; it is not a side effect of the
   parent domain being wide, since `localhost` is not a subdomain of it. There are two
   further `STRAVA_CLIENT_ID` values in SSM under the sandbox paths
   (`lostsoles/root-sandbox-…`, `lostsoles/vivicat-sandbox-…`); whatever they were created for,
   this constraint is not it.

**Credentials** live at `/amplify/shared/d14fhvl4rp79nn/STRAVA_CLIENT_ID` and
`…/STRAVA_CLIENT_SECRET` (ticket `0017`), read at cold start by
`lib/sources/oauth-credentials.ts`. The SSR compute role is granted `ssm:GetParameter` on **those
two ARNs by name** — not on the path prefix, which also holds `GITHUB_TICKETS_PAT` and would have
quietly widened the compute role's reach to a token that acts as the operator on the repository.

## The two connection tables  (ticket 0032, 2026-09-04)

`LostSolesSourceAccount` (T7) and `LostSolesOAuthState`, both CDK, both in the `SourceConnections`
stack, both **absent from AppSync at any auth level** (I-20, I-28, I-29).

**Both names are literals stated twice** — in `amplify/backend.ts` and in the `lib/sources/*`
module that reads them — because the SSR compute is not a `defineFunction` Lambda and has no
CloudFormation output to be handed a generated name through. A test asserts each pair agrees. This
is the same trade-off `LostSolesCaptureGuard` records, **with one extra cost worth knowing before
you hit it**: `LostSolesSourceAccount` is `RETAIN`, so a stack teardown leaves the table behind
still holding its account-unique name, and recreating the stack then fails with a name collision
until the orphan is adopted or deleted by hand. That is the correct trade — `DESTROY` would make a
teardown silently delete the one thing in this system that cannot be rebuilt
(`02-data-model.md` §1.1, §8, I-2) — but it will look like a defect the first time it happens.

**No point-in-time recovery on T7, deliberately.** §1.1 lists its tokens as *not rebuildable, and
must not be*; recovery is re-authorisation. PITR is a continuous second copy of live credentials,
restorable by anyone who can restore a table, and it would make the drill's §8.3 claim untrue.

The `byExternalOwner` GSI (`KEYS_ONLY`) and the CMK are **not** here — they are ticket `0033`'s,
alongside the rotation handling they exist to serve.

## The read budget, recorded so a change is visibly a budget decision  (ticket 0038, 2026-09-06)

`03-integrations.md` §2.5 does the arithmetic; this is the copy that sits next to the code,
so that a future change which multiplies call volume shows up as a **budget decision** and
not as a performance detail.

**The fact everything else follows from: limits are per-APPLICATION, not per-athlete.** The
quota attaches to the `client_id`. Adding a user does not add quota, it splits it.

| Bucket | 15 min | Daily |
|---|---|---|
| Read (every call we make) | 100 | **1,000** |
| Overall | 200 | 2,000 |

**Steady state — ~6-10 reads/day of 1,000.** Webhook fires → 1 detail + 1 streams = 2.
Reconciliation, 4 sweeps × ~1 page = 4. Under 1% of quota: the steady state is free.

**Backfill — ~1,608 calls, ~2.3 days.** 8 years × ~200 activities ≈ 1,600, plus 8 list
pages. At 70% of the daily budget (700/day) that is 2.3 days, checkpointed and resumable.
The 15-minute ceiling of 100 is the tighter constraint, so the worker paces at ≤90 per 15
minutes — one call every ~10 seconds, deliberately slow and correct.

**Measured against the real account while building `0038`:** 104 activities, not the ~1,600
the estimate assumes. The backfill for THIS account is ~112 calls — a few minutes, not two
days. The 1,600 figure is kept because it is the number the *design* has to survive, and
because `0038`'s pacing primitives are sized for it.

**Live budget headers, observed 2026-09-06** across the whole fixture-capture session
(~54 reads — one activity list, ~53 detail/stream calls hunting a real signal-loss jump):

```
x-ratelimit-limit:      200,2000
x-readratelimit-limit:  100,1000
x-readratelimit-usage:  1,37   ->  1,55     (15min, daily)
```

Two things confirmed rather than assumed: the **default tier** is what is actually in
force (100/1,000 read, not the upgraded 200/2,000), and every call this adapter makes
lands in the **read** bucket — the read and overall usage counters moved in lockstep all
session. 55 of 1,000 for a day that included capturing five fixtures and sweeping 53
activities' streams; the budget is not the constraint at one user, exactly as §2.5 says.

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_REFLECT step, written at the drift audit, 2026-09-06._

**The capability that was planned as seven tickets closed as fourteen, and the seven extras are
the interesting half.** `0032`–`0038` were written during the original backlog pass. What
actually shipped added `0165`, `0166`, `0168`, `0156`, `0163`, `0172` and `0173` — every one of
them filed *while building*, none of them scope creep on an existing ticket. That ratio is the
headline finding: **for an integration against a third party, the plan is a hypothesis and the
provider is the experiment.** No amount of design-session care would have produced these seven,
because five of them are facts about Strava or about the operator's own data that only contact
revealed.

**The one lesson worth carrying to every future adapter.** `0032` shipped **76 green tests and
could not complete a single connect.** Every token-response fixture was built from the one
example in `03-integrations.md` §2.2, so the suite proved the code matched the document — and the
document showed the scope list exactly once, on the callback, comma-separated, while the token
endpoint uses spaces (RFC 6749 §5.1). **A fixture derived from a design doc is not a fixture; it
is the design doc asserted twice.** This is the entire argument for `0038`'s checked-in real
responses, and D-112/D-113 should treat "capture a real response before writing the parser" as a
precondition rather than a hardening step.

**Measurement beat specification four times, and never in the direction the spec feared.** D-197
(the 8 m/s gate rejected six real fixes and caught zero jumps, across 21,225), D-200 (a
points-per-km floor would have *passed* a real `summary_polyline`), D-201 (the anchor rule — a
cold first fix rejecting the whole trace behind it), and `0038`'s header probe (§2.5's "headers on
every response" is false; a `/streams` 404 carries none, and that is the *ordinary* answer for
every manual activity). In each case the design was directionally right and numerically wrong,
and in three of four the specified value failed **unsafely** — it discarded real data while
believing it was being careful. `05-fog-of-war.md` §9.5's *"measure it on the user's real first 20
runs before touching the constants"* is the best sentence in the design corpus and it was
vindicated repeatedly; eight runs were enough.

**What the boundary bought, measured rather than asserted.** `0156`'s deleted-adapter simulation
stubs the adapter's exports and asks the compiler instead of the import statements: **19 modules
stubbed, exactly one file fails to compile** — `registry.ts`. D-100 and D-121.1 are the most
expensive-sounding constraints in this project and they cost almost nothing to hold here, because
they were built in from the first file rather than retrofitted. The seam is real.

**The failure this capability nearly shipped, and what caught it.** `0038` was instructed to
commit **real** Strava responses redacted of tokens *"not of shape"* — ~2,700 `latlng` points
each — into a **public** repository. The reasoning was sound and the rule against it already
existed in `08` §7.2. It was **unenforceable**, and a rule nobody can run is a sentence in a
document. `0168` turned it into a fourth scanning layer on the pre-commit hook, and the pre-commit
hook is the right home because a home address is the one asset in this system that **cannot be
rotated after a leak**. Generalise: for any rule whose violation is irreversible, the gap between
"written down" and "executable" is the whole control.

**Where the honesty held under pressure.** Three closes refused the easy path. `0163` was closed
as an **accepted risk with a re-open trigger** (D-202) rather than as a fix, after the operator
found the Strava settings field simply does not exist — criteria were amended with reasons, not
ticked. `0037` **deferred** its one genuine operator check to capability `08` because nothing
draws a trace yet, instead of writing "None". `0032` recorded step 5 as **NOT run** and said why.
Those three entries are worth more to a future reader than the eleven that went cleanly.

**What this capability owes the next one.** Four divergences at the audit, over the budget of
three. Two are stale pre-implementation text in `01-architecture.md` (D-203); one is a
cross-reference defect that reached a settled decision (`0174`); one is a real contradiction
between this capability's sanitation gate and `05-fog-of-war.md` §2.2's split gate, bound to
`0045` so capability `07` cannot ship it silently. **None is a defect in the shipped code** — the
adapter matches its design everywhere it was checked. The design documents are what drifted, and
that is the argument for the DESIGN session on `01-architecture.md` that this audit's verdict
triggers.

**Two tooling failures cost real session time and both are in the auditor's own instrument**:
`0161` (the invariant sweep cannot go green until capability 18, so it has failed every audit
since `04`) and `0176` (the §2 reading list attributes a section number to whichever doc shares
its line). An audit runs at a capability boundary, when context is longest and least able to
absorb a false lead. These should be fixed before the next one.

## Audit — 2026-09-06 (`tickets.mjs audit --record`)

**Verdict: FORCED.** Mechanical half: 8 passed, 1 failed, 3 n/a. See AUDIT.md §1, §4, §5.

> **Overridden with `--force`.** Reason: Two overrides, recorded separately. (1) invariant-sweep fails for the reason 0161 documents and NOT for anything in this capability: the sweep arms on the first I-n citation and then demands all thirty, but the ticket supplying them (0116) is in capability 18, so the row has failed every audit since 04 and will fail every audit through 17. Capability 05 moved it in the right direction, 29/30 -> 25/30, by adding four citations. Also stale and carried in 0161's Notes: the vigil-test n/a claims no vigil test exists, after 0030 shipped src/rules/registry-delta.test.ts — the check matches on /vigil/i in a FILENAME and misses it. (2) Four divergences over the budget of three, recorded as four rather than folded into three to buy a pass — the 02 and 04 audits both rejected that folding and it is rejected again. NONE of the four is a defect in shipped code: the adapter matches its design everywhere checked, boundary-greps are clean, and 0156 measured the seam at 19 modules stubbed / 1 file broken. Three are stale design text and one is a cross-reference defect. The DESIGN session step 7 prescribes is scoped to 01-architecture.md §2/§3/§7, which carries two of the four, and runs before capability 06 starts. Separately noted: tickets 0174 and 0175 were filed by this audit and initially mis-filed into 05, which failed capability-tickets-closed; they are documentation cleanup rather than capability-05 delivery and were moved to 18-mvp-hardening, matching where the 04 audit filed 0162.

> - 1 mechanical check(s) failed: invariant-sweep
> - 4 divergences, over the budget of three — the design is stale, not the code.

**Divergences (4 of a budget of 3):**

1. **code-was-wrong** — `0174` — Trace sanitation is 03-integrations.md §2.6; 21 citations say §2.2, which is OAuth — 9 in sanitize.ts, 4 in sanitize.test.ts, 1 in normalize.ts and 7 inside settled decisions D-197 and D-201. Verified against the initial commit: the numbering never moved
2. **design-was-wrong** — `0045` — 05-fog-of-war.md §2.2's TELEPORT_SPEED = 12.0 contradicts D-197's 12.5 m/s foot gate, so the fog layer would split on fixes the sanitizer deliberately admits and write a D-198 gaps entry — the dotted corridor §9.5 warns about. Annotated in place; the value is bound to 0045 as an acceptance criterion because §9.5 says measure first and the measurement belongs to the ticket that builds traceToCells. Rides are out of scope: only wayfaring has revealsGround true
3. **design-was-wrong** — `D-203` — 01 §2's diagram, §7's secrets table and IAM grant, 08 §3 and capabilities/02 all named the callback route /api/strava/callback; the built route is the source-parameterized app/api/auth/[source]/callback, which 03 §2.2 and D-202 already had right. Corrected in place
4. **design-was-wrong** — `D-203` — 01 §3's module tree promised strava/types.ts holding the vendor wire shapes; the adapter declares deliberately partial interfaces at each point of use instead. The boundary rule the file was carrying is D-100 and is enforced by check-boundaries.mjs and check-adapter-deletion.mjs, not by the layout

- `typecheck` — **pass** — npm run typecheck
- `lint` — **pass** — npm run lint
- `unit-tests` — **pass** — npm run test
- `script-tests` — **pass** — node --test tickets.test.mjs
- `invariant-sweep` — **fail** — 25/30 invariants have no citing test: I-1, I-3 [S], I-4, I-5 [S], I-6, I-7 [S], I-8 [S], I-9, I-10, I-11 [S], I-12, I-13, I-14, I-15, I-16, I-17, I-18 [S], I-19 [S], I-21, I-22, I-23 [S], I-24, I-25, I-27, I-30
- `boundary-greps` — **pass** — check-boundaries.mjs clean
- `vigil-test` — **na** — no vigil test exists yet — ticket 0030 puts it permanently in CI (D-031/D-141)
- `validate` — **pass** — 0 errors across open/ and closed/
- `fog-no-refog` — **na** — no explored blob or fog pipeline exists yet — activates with capability 07 (D-020, I-7)
- `xp-not-lower` — **na** — no XP ledger exists yet — activates with capability 09 (D-135, I-16)
- `blocked-by-closed` — **pass** — no blocked_by points at a closed ticket
- `capability-tickets-closed` — **pass** — 14 closed

<!-- audit-record {"capability":"05-strava-adapter","audited":"2026-09-06T16:02:49Z","verdict":"forced","mechanical":{"pass":8,"fail":1,"na":3},"divergences":4,"forced":"Two overrides, recorded separately. (1) invariant-sweep fails for the reason 0161 documents and NOT for anything in this capability: the sweep arms on the first I-n citation and then demands all thirty, but the ticket supplying them (0116) is in capability 18, so the row has failed every audit since 04 and will fail every audit through 17. Capability 05 moved it in the right direction, 29/30 -> 25/30, by adding four citations. Also stale and carried in 0161's Notes: the vigil-test n/a claims no vigil test exists, after 0030 shipped src/rules/registry-delta.test.ts — the check matches on /vigil/i in a FILENAME and misses it. (2) Four divergences over the budget of three, recorded as four rather than folded into three to buy a pass — the 02 and 04 audits both rejected that folding and it is rejected again. NONE of the four is a defect in shipped code: the adapter matches its design everywhere checked, boundary-greps are clean, and 0156 measured the seam at 19 modules stubbed / 1 file broken. Three are stale design text and one is a cross-reference defect. The DESIGN session step 7 prescribes is scoped to 01-architecture.md §2/§3/§7, which carries two of the four, and runs before capability 06 starts. Separately noted: tickets 0174 and 0175 were filed by this audit and initially mis-filed into 05, which failed capability-tickets-closed; they are documentation cleanup rather than capability-05 delivery and were moved to 18-mvp-hardening, matching where the 04 audit filed 0162."} -->
