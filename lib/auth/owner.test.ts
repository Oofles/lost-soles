import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Ticket 0330, criterion 3. `currentUserId()` reads the Auth.js session first, through BOTH of
 * D-471's gates (`AUTH_ALLOWED_EMAILS`, then `IDENTITIES`), and otherwise falls back to today's
 * Cognito cookie, then the bearer token, unchanged.
 *
 * Stubbed: next-auth's `auth()` (the cookie decryption), Amplify's session read and the bearer
 * verification (proved in `bearer.test.ts`). Real: `config.ts`'s `isAllowedEmail`, `identity.ts`
 * and `owner-ids.ts`'s `IDENTITIES`, which are what this criterion is about.
 */

const OWNER_UID = "5488e4b8-d081-7014-748e-edd1937f8083"
const OWNER_EMAIL = "amazingbrandon@gmail.com"

let authjsSession: unknown = null
let authjsThrows = false
let cognitoSub: string | undefined = undefined
let bearerSub: string | undefined = undefined

vi.mock("@/lib/auth", () => ({
  auth: async () => {
    if (authjsThrows) throw new Error("MissingSecret")
    return authjsSession
  },
}))
vi.mock("next/headers", () => ({
  cookies: async () => ({}),
  headers: async () => new Headers({ authorization: "Bearer x.y.z" }),
}))
vi.mock("aws-amplify/auth/server", () => ({
  fetchAuthSession: async () => ({ tokens: cognitoSub ? { idToken: { payload: { sub: cognitoSub } } } : undefined }),
}))
vi.mock("@/lib/amplify-server", () => ({
  runWithAmplifyServerContext: async ({ operation }: { operation: (spec: unknown) => unknown }) => operation({}),
}))
vi.mock("@/lib/auth/bearer", () => ({ verifiedBearerSub: async () => bearerSub }))

const { currentUserId } = await import("./owner")
const { IDENTITIES, uidForEmail } = await import("./owner-ids")

const signedInAs = (email: string) => {
  authjsSession = { user: { email }, expires: "2099-01-01T00:00:00.000Z" }
}

beforeEach(() => {
  authjsSession = null
  authjsThrows = false
  cognitoSub = undefined
  bearerSub = undefined
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

  it("an auth() that throws (a config error) fails closed to the Cognito path", async () => {
    authjsThrows = true
    await expect(currentUserId()).resolves.toBeUndefined()
    cognitoSub = OWNER_UID
    await expect(currentUserId()).resolves.toBe(OWNER_UID)
  })
})

describe("no Auth.js session: today's Cognito path, unchanged (0330)", () => {
  it("the Cognito cookie's sub", async () => {
    cognitoSub = "cognito-sub-1"
    await expect(currentUserId()).resolves.toBe("cognito-sub-1")
  })

  it("then a verified bearer token", async () => {
    bearerSub = "bearer-sub-1"
    await expect(currentUserId()).resolves.toBe("bearer-sub-1")
  })

  it("the cookie wins over the bearer token", async () => {
    cognitoSub = "cognito-sub-1"
    bearerSub = "bearer-sub-1"
    await expect(currentUserId()).resolves.toBe("cognito-sub-1")
  })

  it("neither is undefined", async () => {
    await expect(currentUserId()).resolves.toBeUndefined()
  })

  it("an unmapped Auth.js session still falls through to the Cognito cookie", async () => {
    signedInAs("stranger@example.com")
    cognitoSub = "cognito-sub-1"
    await expect(currentUserId()).resolves.toBe("cognito-sub-1")
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
