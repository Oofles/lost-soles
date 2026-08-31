---
id: 2
slug: rotate-o-005-aws-key-and-gitignore-agent-config
title: Rotate the O-005 AWS access key and gitignore the agent config that contains it
type: chore
priority: high
status: closed
size: m
capability: 00-preflight-and-repo
depends_on: []
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
closed: 2026-08-30T00:00:00Z
---

## Description

**O-005**, verified 2026-08-30 and recorded in `docs/decisions/DECISIONS.md` under OPEN:
`~/devaultsecurity/.claude/settings.local.json` contains a **complete AWS credential pair in
plaintext** — both the access key id and the secret access key — embedded in the *command strings*
the permission allowlist matches on. 6 occurrences of the id, of which **5 also carry the secret**.
One key, repeated.

> ⚠️ **Severity corrected 2026-08-30, after this ticket was written.** The original finding read
> "6 occurrences of a live-format access key ID", because the scan grepped for the id pattern only.
> That under-reports it: an access key id is a semi-public identifier and unusable on its own; the
> secret is what makes it a credential. **Both are present.**
>
> **Additional exposure:** during inspection, part of the secret was printed to a Claude Code
> session transcript. Nothing left the machine, but it now exists in one more place than it did.

Status, precisely (`08-security-privacy.md` §7.4):

- The file is **not tracked** (`git ls-files` returns nothing) and **not in git history**
  (`git log --all -- <path>` is empty). **Nothing has leaked.** This is a near-miss, not an
  incident; the §8 incident playbook is *not* invoked.
- **But `.claude/` is not gitignored in that repo.** The file sits untracked in a git working tree.
  It is one `git add .` from being committed and one `git push` from being unrecoverable — a secret
  in git history is not removed by deleting the file, it is removed by rewriting history and
  rotating the credential, and in practice only by rotating the credential.
- That repo is unrelated to Lost Soles. It is remediated here because **the mechanism is identical**
  and Lost Soles runs the same tooling on the same machine.

**The remediation order is the whole point of this ticket and must not be reordered.** Rotate
first, then gitignore, then de-inline. Rotating first is what makes the window closed regardless of
what happens to the file in between; de-inlining first would leave a live key in an un-ignored tree
for the duration of the edit, and would also destroy the evidence needed for step 4's CloudTrail
check while the key is still identifiable.

The standing rule this establishes, which applies to Lost Soles from its first commit:

> A credential value never appears in a configuration file, and tool/agent configuration
> directories are gitignored from the repository's first commit. Config files hold **references** —
> an AWS profile name, an SSM parameter path, an env var name — never the material itself.

## Root cause, found 2026-08-30 while executing this ticket

**There is no configured AWS profile on this machine at all.** No `~/.aws` for the user, none for
root, no `AWS_*` environment variables; `aws iam list-access-keys` fails with "Unable to locate
credentials" in both the agent's shell and the operator's own shell.

So the inlined key is not a careless storage choice — it is the *only* copy of the credential on
this machine, and it is inlined **because there was nowhere else to put it.** With no profile,
every AWS command required the credentials pasted inline, and Claude Code's permission allowlist
recorded those command strings verbatim. The allowlist became the credential store by accident.

Two consequences, both of which change this ticket:

1. **Step 5 (de-inline) must not run before a working profile exists**, or the operator loses
   access to their own account. The ordering below is amended accordingly.
2. **Fixing the instance is not fixing the class.** The class is "no credential store, therefore
   credentials live in command strings". A profile — or better, IAM Identity Center short-lived
   credentials — is the actual remedy, and it is now a required step rather than the optional
   recommendation it was in Notes.

**Amended step 1: do the rotation from the IAM console in a browser, not the CLI.** The CLI cannot
authenticate, and bootstrapping it with the exposed key just to rotate that key is a needless extra
use of a compromised credential. The console needs no local credential at all.

## Acceptance criteria

Ordered. Each step is done before the next begins.

- [ ] **1 (ROTATE FIRST — from the IAM console, in a browser).** A new access key is created for
      the same IAM principal via **IAM → Users → *user* → Security credentials → Create access key**.
      The CLI cannot do this: there is no working local credential (see Root cause above), and
      bootstrapping the CLI with the exposed key merely to rotate it is an avoidable extra use of a
      compromised credential.
- [ ] **1b (NEW — the class fix, and a prerequisite for step 5).** The new key is written to a real
      credential store: `aws configure --profile devault`, which creates `~/.aws/credentials` with
      `0600` permissions. Verified with `aws sts get-caller-identity --profile devault`.
      **This must exist before step 5**, or de-inlining destroys the only copy of the credential on
      the machine. Prefer IAM Identity Center (`aws configure sso`) if the account supports it —
      then no long-lived key exists locally at all and the class is closed rather than relocated.
- [ ] **2.** The old key is **deactivated (not deleted) the SAME DAY** — revised from "after 24
      hours of normal use" by the severity correction above. Deactivate-before-delete is still the
      reversible step and still how you discover what was using the key; that discovery now happens
      *after* deactivation (something breaks → reactivate briefly, note the consumer, fix it,
      deactivate again) rather than by leaving a fully-exposed credential live for a day.
- [ ] **3.** After 24-48h deactivated with nothing broken, the old key is **deleted** in IAM.
      `aws iam list-access-keys` shows the old `AccessKeyId` is gone.
- [ ] **4 (THEN GITIGNORE).** `.claude/` is added to `.gitignore` in `~/devaultsecurity`, and that
      `.gitignore` change is committed. `git check-ignore -v .claude/settings.local.json` in that
      repo reports the rule as matching.
- [ ] **5 (THEN DE-INLINE).** The key is removed from `~/devaultsecurity/.claude/settings.local.json`.
      Every allowlist entry that referenced it now matches on a **command prefix or pattern**, never
      on a literal credential. `grep -c 'AKIA' ~/devaultsecurity/.claude/settings.local.json`
      returns 0.
- [ ] **6.** `grep -rn 'AKIA[0-9A-Z]\{16\}' ~/devaultsecurity` returns no hits outside
      `~/.aws` — and `~/.aws/credentials` itself is reviewed.
- [ ] **7.** CloudTrail is queried for use of the old `AccessKeyId` over the period it existed. If
      every use comes from the expected machine/IP, the near-miss reading is confirmed and recorded.
      If CloudTrail shows use from an unexpected source IP, this stops being a near-miss, §8.3
      applies, and a new `bug` ticket is filed rather than closing this one quietly.
- [ ] **8.** O-005 is closed in `docs/decisions/DECISIONS.md` with the rotation date and the
      CloudTrail verdict from step 7.
- [ ] **9.** The same `.claude/` + `*.local.json` ignore rules are recorded as required content for
      the Lost Soles `.gitignore` (implemented by 0004), so this class of finding cannot recur in
      the new repo.

## Notes

Recommended and cheap while the account is open: move this machine to **IAM Identity Center
short-lived credentials** so no long-lived `AKIA…` exists on the laptop at all
(`01-architecture.md` §7, S8). Then the worst case next time is an expired token rather than a
standing key. If that is done, note it in the O-005 closure; if it is not, say why, because it is
the difference between fixing this instance and fixing the class.

This ticket touches a repo outside Lost Soles. That is intentional and is the only ticket in the
backlog that does. Do not "tidy" `~/devaultsecurity` beyond the five steps above.

`08-security-privacy.md` §7.1 gitignores `.claude/` **wholesale** for Lost Soles, deny-by-default:
if some part of it later genuinely should be committed (a shared skill, a project `CLAUDE.md`),
that file is un-ignored by an explicit `!` line and reviewed on the way in. 0004 owns that list.

## Operator validation

1. In a desktop browser, open the **AWS IAM console → Users → the affected user → Security
   credentials**. Confirm exactly one active access key, and that its ID is the new one. The old
   `AKIA…` must not be listed at all.
2. On the laptop, open `~/devaultsecurity/.claude/settings.local.json` in an editor and read it end
   to end. No string starting `AKIA` appears anywhere in it. The permission entries still read
   sensibly as command patterns.
3. On the laptop, in `~/devaultsecurity`, run `git status`. `.claude/` must not appear in the
   untracked list — it is ignored now. Then run `git add -A && git status` (and **do not commit**):
   nothing under `.claude/` is staged. `git reset` afterwards.
4. On the laptop, run any routine `aws` command that previously used the old key. It must succeed
   with the new credential, proving the rotation did not silently break the workflow.

## Resolution

O-005 remediated. Steps 1-3 were completed by the operator via the IAM console; steps 4-9 by the
agent.

| Step | Outcome |
|---|---|
| 1 · rotate | New key created in the IAM console; profile `devault` in `~/.aws/credentials` (`0600`). `sts get-caller-identity` → `arn:aws:iam::286588821906:user/cli-user`. |
| 1b · class fix | A real credential store now exists. **Partial** — IAM Identity Center not adopted, so a long-lived key still exists, merely stored correctly. Revisit under 0122. |
| 2-3 · deactivate, delete | Old key is **absent from IAM entirely**. |
| 4 · gitignore | `.claude/` + `*.local.json` added to `~/devaultsecurity/.gitignore`, commit `81a79b0`. Verified by staging, not by inspection: `git add -A` stages **0** files under `.claude/`. |
| 5 · de-inline | Allowlist 33 → 28 entries. Both `Bash(export AWS_…_KEY="…")` entries **deleted outright**; five amplify entries rewritten as prefix patterns. JSON still valid, perms preserved. |
| 6 · sweep | `grep -rE 'AKIA[0-9A-Z]{16}'` across `~/devaultsecurity` returns nothing. |
| 7 · CloudTrail | **Near-miss confirmed, with a stated limit** — zero events attributable to the old key in the 90-day lookback. Retention is 90 days and the key existed far longer, so this is absence of evidence. §8 not invoked. |
| 8 · close O-005 | Closed in `DECISIONS.md` with the CloudTrail verdict and the partial class-fix status. New standing rule recorded as **D-154**. |
| 9 · hand to 0004 | Required `.gitignore` content written into ticket 0004, including the `!.claude/skills/tickets/` un-ignore. |

**The finding that mattered more than the fix.** There was **no configured AWS profile on the
machine at all** — no `~/.aws`, no env vars, `aws` unusable in both the agent's shell and the
operator's. The key was inlined *because there was nowhere else to put it*: every command needed
credentials pasted inline, and Claude Code's permission allowlist recorded those command strings
verbatim. The allowlist became a credential store by accident.

This inverted the ticket's own ordering. As written, step 5 (de-inline) would have destroyed the
only copy of the credential on the machine and locked the operator out of their own account. Step
1b was added mid-ticket to make a profile a prerequisite rather than a recommendation.

**Two corrections to the original finding, both recorded in the ticket body above rather than only
here:** the exposure was a **complete credential pair**, not six occurrences of an access key ID —
the first scan grepped the `AKIA` pattern and an ID alone is unusable. And part of the secret was
printed to a session transcript during inspection, which is why the 24-hour soak was cut to
same-day deactivation.

**Follow-on filed:** 0122 — a dormant 2022 access key on `cli-user`, still Active, zero CloudTrail
activity. Separate finding; not fixed here (D-152).

**Files touched outside Lost Soles:** `~/devaultsecurity/.gitignore` (committed),
`~/devaultsecurity/.claude/settings.local.json` (not tracked, now ignored). Nothing else in that
repo was modified.

## Operator validation

1. IAM console → Users → `cli-user` → Security credentials. You will see **two** keys, not one:
   the new one (`…WPBV`) and the dormant 2022 key (`…EHYC`). That is expected — the second is
   ticket 0122, deliberately not touched here.
2. Open `~/devaultsecurity/.claude/settings.local.json`. No `AKIA`, no `AWS_SECRET_ACCESS_KEY`.
   The amplify entries now read as command patterns. **Note:** the two `export` entries are gone,
   so if a workflow relied on them it will now prompt — that is the intended outcome, not a
   regression.
3. In `~/devaultsecurity`: `git status` shows a clean tree and `.claude/` is absent from untracked.
4. Run an amplify command against the `devault` profile to confirm the new credential works end to
   end — this is also the first real exercise of the profile that replaced the inline pattern.
