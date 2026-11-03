import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { IDENTITIES, OWNER_USER_IDS } from "../../lib/auth/owner-ids"
import { emailsMappedTo, seedRefusal } from "./deletion"

/**
 * Ticket `0337`. `seed-throwaway.ts` no longer asks Cognito whether its throwaway exists (D-473:
 * the pool goes in `0334`). Its precondition is `seedRefusal`: the uid maps in `IDENTITIES` and is
 * not in `OWNER_USER_IDS` (D-471).
 *
 * The refusals are proven twice: the pure check, and the real script run as a subprocess with no
 * AWS credentials reachable. A refused run exits 2 before it prints the plan, reads
 * `amplify_outputs.json` or builds a client, so it cannot have written anything.
 */

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const OWNER = OWNER_USER_IDS[0]
const UNMAPPED = "00000000-0000-4000-8000-000000000337"
const THROWAWAY = "11111111-2222-4333-8444-555555555555"

describe("seedRefusal", () => {
  const identities = { "owner@example.com": OWNER, "throwaway@example.com": THROWAWAY }

  it("refuses the owner, even though the owner maps", () => {
    expect(seedRefusal(OWNER, identities, [OWNER])).toMatch(/OWNER_USER_IDS/)
  })

  it("refuses a uid IDENTITIES does not map, and names Trigger A", () => {
    expect(seedRefusal(UNMAPPED, identities, [OWNER])).toMatch(/IDENTITIES .* maps no email to .*Trigger A/)
  })

  it("passes a mapped uid that is not the owner", () => {
    expect(seedRefusal(THROWAWAY, identities, [OWNER])).toBeNull()
    expect(emailsMappedTo(THROWAWAY, identities)).toEqual(["throwaway@example.com"])
  })

  it("the real map has no throwaway: every non-owner uid is refused today", () => {
    // A second IDENTITIES entry is Trigger A (D-470). If this fails, D-123 must be reopened first.
    for (const uid of new Set(Object.values(IDENTITIES))) expect(OWNER_USER_IDS).toContain(uid)
    expect(seedRefusal(UNMAPPED, IDENTITIES, OWNER_USER_IDS)).not.toBeNull()
  })
})

describe("seed-throwaway.ts", () => {
  it("makes no Cognito call and reads nothing from amplify_outputs.json's auth block", () => {
    const src = readFileSync(new URL("seed-throwaway.ts", import.meta.url), "utf8")
    expect(src).not.toMatch(/cognito-idp|client-cognito|list-users|user_pool_id|userPoolId/)
    expect(src).not.toMatch(/\bauth\??\./)
    expect(src).not.toMatch(/\bauth\??:/)
  })

  function run(uid: string) {
    return spawnSync(
      join(ROOT, "node_modules/.bin/vite-node"),
      ["--config", "vitest.config.ts", "tools/account-deletion/seed-throwaway.ts", "--", "--user", uid, "--confirm"],
      {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 60_000,
        // No credentials anywhere: a write attempted would fail, but a refusal never gets that far.
        env: {
          NODE_ENV: "test",
          PATH: process.env.PATH,
          HOME: process.env.TMPDIR ?? "/nonexistent",
          TMPDIR: process.env.TMPDIR,
          AWS_CONFIG_FILE: "/dev/null",
          AWS_SHARED_CREDENTIALS_FILE: "/dev/null",
          AWS_EC2_METADATA_DISABLED: "true",
        },
      },
    )
  }

  it.each([
    ["the owner", OWNER, /OWNER_USER_IDS/],
    ["an unmapped uid", UNMAPPED, /maps no email/],
  ])("refuses %s with exit 2 and writes nothing, even with --confirm", (_, uid, why) => {
    const res = run(uid)
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(why)
    // The plan (`user …`, `activityId …`) is printed only past the precondition; the writes after it.
    expect(res.stdout).not.toMatch(/^(user|activityId|archived|receipt|enqueued)\s/m)
  }, 60_000)
})
