import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Ticket 0330, criterion 3; ticket 0332 (D-473). `currentUserId()` reads the Auth.js session,
 * through BOTH of D-471's gates (`AUTH_ALLOWED_EMAILS`, then `IDENTITIES`), and nothing else: the
 * Cognito cookie and the bearer token are gone.
 *
 * Stubbed: next-auth's `auth()` (the cookie decryption). Real: `config.ts`'s `isAllowedEmail`,
 * `identity.ts` and `owner-ids.ts`'s `IDENTITIES`, which are what this criterion is about.
 */

const OWNER_UID = "5488e4b8-d081-7014-748e-edd1937f8083"
const OWNER_EMAIL = "amazingbrandon@gmail.com"

let authjsSession: unknown = null
let authjsThrows = false

vi.mock("@/lib/auth", () => ({
  auth: async () => {
    if (authjsThrows) throw new Error("MissingSecret")
    return authjsSession
  },
}))
/**
 * A bearer header and a forged `ls-uid` cookie (0332, D-476) are offered on every request here. Nothing may read either: if
 * `currentUserId()` ever looked at headers again, the tests below would still have to pass.
 */
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ name: "ls-uid", value: "5488e4b8-d081-7014-748e-edd1937f8083" }) }),
  headers: async () => new Headers({ authorization: "Bearer x.y.z", cookie: "ls-uid=5488e4b8-d081-7014-748e-edd1937f8083" }),
}))

const { currentUserId } = await import("./owner")
const { IDENTITIES, uidForEmail } = await import("./owner-ids")

const signedInAs = (email: string) => {
  authjsSession = { user: { email }, expires: "2099-01-01T00:00:00.000Z" }
}

beforeEach(() => {
  authjsSession = null
  authjsThrows = false
  process.env.AUTH_ALLOWED_EMAILS = OWNER_EMAIL
})

describe("currentUserId() and the Auth.js session (0330)", () => {
  it("a mapped, allowlisted email is the owner's uid", async () => {
    signedInAs(OWNER_EMAIL)
    await expect(currentUserId()).resolves.toBe(OWNER_UID)
  })

  it("ignores case in the email", async () => {
    signedInAs("AmazingBrandon@Gmail.com")
    await expect(currentUserId()).resolves.toBe(OWNER_UID)
  })

  it("an allowlisted email with no IDENTITIES entry is undefined", async () => {
    process.env.AUTH_ALLOWED_EMAILS = `${OWNER_EMAIL},stranger@example.com`
    signedInAs("stranger@example.com")
    await expect(currentUserId()).resolves.toBeUndefined()
  })

  it("a mapped email removed from the allowlist is undefined", async () => {
    process.env.AUTH_ALLOWED_EMAILS = "stranger@example.com"
    signedInAs(OWNER_EMAIL)
    await expect(currentUserId()).resolves.toBeUndefined()
  })

  it("an empty or unset allowlist is undefined, even for the mapped email", async () => {
    signedInAs(OWNER_EMAIL)
    process.env.AUTH_ALLOWED_EMAILS = ""
    await expect(currentUserId()).resolves.toBeUndefined()
    process.env.AUTH_ALLOWED_EMAILS = " , "
    await expect(currentUserId()).resolves.toBeUndefined()
    delete process.env.AUTH_ALLOWED_EMAILS
    await expect(currentUserId()).resolves.toBeUndefined()
  })

  it("a session with no email is undefined", async () => {
    authjsSession = { user: {}, expires: "2099-01-01T00:00:00.000Z" }
    await expect(currentUserId()).resolves.toBeUndefined()
  })

  it("an auth() that throws (a config error) fails closed", async () => {
    authjsThrows = true
    await expect(currentUserId()).resolves.toBeUndefined()
  })
})

describe("no Auth.js session (0332, D-473)", () => {
  it("is undefined, though a bearer header AND a forged ls-uid cookie are present (D-476)", async () => {
    await expect(currentUserId()).resolves.toBeUndefined()
  })

  it("the module no longer imports Amplify or a bearer verifier", async () => {
    const { readFileSync } = await import("node:fs")
    const src = readFileSync(new URL("./owner.ts", import.meta.url), "utf8")
    expect(src).not.toMatch(/from\s*["'][^"']*(?:aws-amplify|amplify-server|bearer|next\/headers)/)
  })
})

describe("IDENTITIES (D-470, D-471)", () => {
  it("holds the owner only, mapped to the existing uid", () => {
    expect(IDENTITIES).toEqual({ [OWNER_EMAIL]: OWNER_UID })
  })

  it("is not fooled by an inherited property name", () => {
    expect(uidForEmail("constructor")).toBeUndefined()
    expect(uidForEmail("__proto__")).toBeUndefined()
    expect(uidForEmail("")).toBeUndefined()
    expect(uidForEmail(undefined)).toBeUndefined()
  })
})
