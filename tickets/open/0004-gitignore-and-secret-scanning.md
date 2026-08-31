---
id: 4
slug: gitignore-and-secret-scanning
title: .gitignore and secret scanning, in place before the first commit
type: chore
priority: high
status: open
size: m
capability: 00-preflight-and-repo
depends_on: [3]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

`08-security-privacy.md` §7.1: *"a `.gitignore` added on day 40 does not protect the first 39 days,
and git history is append-only in exactly the way §2 says the map is."* The repository is the most
likely place a secret in this project actually escapes — not the webhook, not Cognito, a `git add .`
(§7 preamble, and O-005 in 0002 is the proof).

**`.gitignore`, verbatim from §7.1, present in the initial commit:**

```
# credentials and environment
.env
.env.*
!.env.example
*.pem
*.key
credentials
.aws/

# agent + editor tooling config  ← the O-005 class
.claude/
.cursor/
.vscode/
*.local.json
**/settings.local.json

# generated, environment-specific
amplify_outputs.json
.amplify/
node_modules/
.next/
```

Plus `.DS_Store` and build artifacts (`01-architecture.md` §6).

Two entries carry notes that must be preserved as comments in the file so nobody "fixes" them:

- **`.claude/` is gitignored wholesale.** Agent tool configuration is a credential-bearing surface
  and is machine-local by nature. Deny by default, allow by exception: the `/tickets` skill files
  (`.claude/skills/tickets/**`, created by 0003 and populated by 0007–0010) are re-admitted by
  explicit `!` lines and reviewed on the way in. **`.claude/*.local.json` and
  `**/settings.local.json` are never un-ignored.**
- **`amplify_outputs.json` is ignored because it is generated per-environment, not because it is
  sensitive** (`01-architecture.md` §7). It contains public identifiers — Cognito user pool ID, app
  client ID, identity pool ID, AppSync endpoint — protected by pool policy and AppSync auth rules,
  not by obscurity. Its presence in the client bundle is *correct*. A leak of it is not an incident.

**Scanning, in two places (§7.3):**

1. **Pre-commit, on staged content** — `gitleaks protect --staged` via `husky` + `lint-staged`, plus
   a literal check for `AKIA[0-9A-Z]{16}`, `ghp_`, `github_pat_`,
   `-----BEGIN .* PRIVATE KEY-----`, and `xox[baprs]-`. This is the layer that makes an accidental
   `git add .` survivable. It is bypassable with `--no-verify` and is not meant to stop a determined
   person — it is a control against **a tired person and a wildcard**, which is the actual threat.
2. **In CI, in the PR workflow** — `gitleaks detect` over the repo, plus a **full-history**
   `gitleaks detect` on the initial run so the repo starts from a known-clean state. The built-output
   grep of `.next/static` for secret literals is a different check and belongs to 0017.
3. **GitHub push protection + secret scanning** enabled on the repo. Worth the click: the capture
   endpoint (capability `03`) commits arbitrary dictated prose from a phone into `tickets/inbox/`,
   so the repo has a path by which text the operator never re-read gets committed automatically.

## Acceptance criteria

- [ ] `.gitignore` exists at the repo root containing every line from the §7.1 block above, plus
      `.DS_Store`, and is part of the **initial commit** (verify with `git log --diff-filter=A -- .gitignore`).
- [ ] The two explanatory comments (why `.claude/` is wholesale, why `amplify_outputs.json` is not
      a secret) are present in `.gitignore` as comments.
- [ ] `.claude/skills/tickets/**` is re-admitted by an explicit `!` line;
      `git check-ignore -v .claude/skills/tickets/SKILL.md` reports **not ignored**, while
      `git check-ignore -v .claude/settings.local.json` reports **ignored**.
- [ ] `git check-ignore -v` confirms ignored: `.env`, `.env.local`, `amplify_outputs.json`,
      `node_modules/`, `.next/`, `foo.pem`, `anything.local.json`.
- [ ] `git check-ignore -v .env.example` reports **not ignored** (the `!` exception works).
- [ ] `husky` + `lint-staged` are installed and a pre-commit hook runs `gitleaks protect --staged`.
- [ ] The pre-commit hook additionally greps staged content for the five literal patterns above and
      fails on a hit.
- [ ] A deliberate test proves the hook: staging a file containing `AKIA` + 16 uppercase
      alphanumerics causes `git commit` to **fail** with a message naming the file. The test file is
      then removed and is not committed.
- [ ] A `.github/workflows/` job runs `gitleaks detect` on every PR and fails the check on a hit.
- [ ] A full-history `gitleaks detect` has been run once over the whole repo and its clean output is
      pasted into `docs/capabilities/00-preflight-and-repo.md`.
- [ ] GitHub **secret scanning** and **push protection** are enabled in the repo's Settings →
      Code security, and a screenshot or the settings state is noted in the capability doc.
- [ ] `.env.example` exists with placeholder (never real) values for every key the app will need.

- [ ] **Only once the above passes: create the remote and make the first commit.**
      `gh repo create <owner>/lost-soles --private --source=. --remote=origin`, then
      `git add -A && git commit && git push -u origin main`.
- [ ] `gitleaks protect --staged` runs on that very first commit and passes.
- [ ] Verify on GitHub that no `.claude/`, no `*.local.json` and no `.env*` was pushed.

## Notes

**Required `.gitignore` content, handed over by ticket 0002 (D-154).** These are not suggestions —
they are the remediation of a live finding, and 0002 cannot close without 0004 carrying them:

```gitignore
# Agent / tool configuration — may contain credentials or machine-local paths.
# Deny by default; un-ignore individual files with an explicit ! line and review them in.
.claude/
*.local.json
!.claude/skills/tickets/

# Environment
.env
.env.*
!.env.example
```

The `!.claude/skills/tickets/` un-ignore is the tension `0003` flagged: `08-security-privacy.md`
§7.1 ignores `.claude/` wholesale, but the `/tickets` skill genuinely belongs in version control.
The directory exists and is empty as of 0003; `0007`-`0010` populate it. Verify after writing that
`git check-ignore -v .claude/settings.local.json` matches **and**
`git check-ignore .claude/skills/tickets/SKILL.md` does **not**.

Root cause worth carrying: the O-005 key was inlined into a config file because **no AWS profile
existed** — there was nowhere else to put it. A `.gitignore` alone would not have prevented it.


**This ticket owns the first commit in history** (moved here from 0003 during planning review).
A repository whose *first* commit leaks a secret is not fixable by a later commit — the history is
the artifact. So the gitignore and the scanner exist before `git add -A` is ever typed, and 0003
deliberately leaves the working tree uncommitted for this ticket to pick up.


Test fixtures are a repo-hygiene trap specific to this project (§7.2): **real GPS traces, GPX/FIT
files from actual runs, or a dump of `ExploredCell` must never be committed.** A "sample activity"
checked in for a unit test is a home address in git history forever. All fixtures use **synthetic
coordinates**. This is the rule most likely to be broken by someone being helpful — state it in
`CLAUDE.md` as well as here.

`package-lock.json` **is** committed and CI uses `npm ci` — reproducible builds are a supply-chain
control, not a convenience (§7.5).

The PR workflow file itself is fleshed out by 0013 (typecheck/lint/test gate). This ticket only adds
the gitleaks job; if 0013 has not landed yet, create the workflow with just that job.

## Operator validation

1. On the laptop, in the repo: create a throwaway file containing a fake key — the literal string
   `AKIA` followed by 16 uppercase alphanumerics. **The example is not written out here**, because
   this very hook rejects a key-shaped literal in a tracked file, and a ticket that cannot be
   committed is a poor ticket. Generate one instead:

   ```
   printf 'k=AKIA%s\n' "$(tr -dc 'A-Z0-9' </dev/urandom | head -c16)" > probe.txt
   git add probe.txt && git commit -m probe    # must be REFUSED, naming probe.txt
   git reset && rm probe.txt
   ```

   That this instruction had to be rewritten is itself the proof the hook works: the original
   wording used AWS's documentation key, gitleaks allowlisted it, and the literal-pattern layer
   caught it anyway on the initial commit.
2. Repeat with a file containing `ghp_` followed by 36 characters. Same refusal.
3. In a desktop browser, open a PR containing a similar fake secret. The **Checks** tab must show
   the gitleaks job red and the merge button blocked. Close the PR without merging.
4. In a desktop browser, GitHub → repo → Settings → Code security: confirm "Secret scanning" and
   "Push protection" both read **Enabled**.
5. On the laptop, run `git status` in a working tree where `npm install` has been run and
   `amplify_outputs.json` exists. Neither `node_modules/` nor `amplify_outputs.json` may appear.
