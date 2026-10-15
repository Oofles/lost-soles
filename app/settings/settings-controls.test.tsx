import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("aws-amplify/auth", () => ({ signOut: async () => {} }))

const {
  ACCOUNT_DELETION_RUNBOOK_URL,
  DELETION_PHRASE,
  DeletionEntry,
  DisconnectControl,
  deletionPhraseMatches,
  signOutAndLeave,
} = await import("./settings-controls")

/**
 * Ticket 0089. Each stage is rendered statically by passing it in. The repo has no DOM
 * test environment, and the transitions between stages are one `setStage` each. The
 * "Acme" display name is a stand-in, so this file names no vendor.
 */

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

describe("disconnect — one confirmation that reassures (criteria 3 and 4)", () => {
  it("starts as a single button that posts nothing", () => {
    const html = renderToStaticMarkup(<DisconnectControl action="/api/auth/acme/disconnect" displayName="Acme" />)
    expect(html).toContain('type="button"')
    expect(html).not.toContain("<form")
  })

  it("the confirmation says map, XP and history are kept, and that this is not deletion", () => {
    const t = text(
      renderToStaticMarkup(
        <DisconnectControl action="/api/auth/acme/disconnect" displayName="Acme" initialStage="confirming" />,
      ),
    )
    expect(t).toContain("Your map, your XP and levels, and your run history are all kept")
    expect(t).toContain("Nothing is deleted")
    expect(t).toContain("This is not account deletion")
    expect(t).toContain("Yes, disconnect")
    expect(t).toContain("Cancel")
  })
})

describe("sign out (criterion 6)", () => {
  it("signs out FIRST, then does a full navigation to the signed-out landing", async () => {
    const order: string[] = []
    await signOutAndLeave({
      signOut: async () => void order.push("signOut"),
      navigate: (href) => void order.push(`navigate ${href}`),
    })
    expect(order).toEqual(["signOut", "navigate /"])
  })

  it("does not navigate away when sign-out fails, so the screen does not lie", async () => {
    const navigate = vi.fn()
    await expect(
      signOutAndLeave({ signOut: async () => Promise.reject(new Error("offline")), navigate }),
    ).rejects.toThrow("offline")
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe("the account-deletion entry point (criterion 7)", () => {
  it("accepts only the typed phrase", () => {
    expect(deletionPhraseMatches(DELETION_PHRASE)).toBe(true)
    expect(deletionPhraseMatches(`  ${DELETION_PHRASE.toUpperCase()} `)).toBe(true)
    for (const near of ["", "delete", "delete account", "disconnect", `${DELETION_PHRASE}!`]) {
      expect(deletionPhraseMatches(near), near).toBe(false)
    }
  })

  it("the trigger opens a confirmation, not a deletion", () => {
    const html = renderToStaticMarkup(<DeletionEntry />)
    expect(html).toContain('type="button"')
    expect(html).not.toContain("<form")
    expect(html).not.toContain(ACCOUNT_DELETION_RUNBOOK_URL)
  })

  it("the confirmation demands the phrase, says it cannot be undone, and points at disconnect", () => {
    const html = renderToStaticMarkup(<DeletionEntry initialStage="confirming" />)
    const t = text(html)
    expect(t).toContain(`Type ${DELETION_PHRASE} to continue`)
    expect(t).toContain("cannot be undone")
    expect(t).toContain("use Disconnect")
    // Disabled until the phrase matches; a wrong phrase cannot submit.
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""/)
    expect(html).not.toContain(ACCOUNT_DELETION_RUNBOOK_URL)
    // The destructive colour is the CONFIRM, and only the confirm (06 §8.2).
    expect(html.match(/var\(--destructive\)/g)?.length).toBe(2) // border + fill, one button
  })

  it("the confirm enables once the phrase is typed", () => {
    const html = renderToStaticMarkup(<DeletionEntry initialStage="confirming" initialTyped={DELETION_PHRASE} />)
    expect(html).not.toMatch(/<button type="submit"[^>]*disabled=""/)
  })

  it("after confirming, it links to the runbook and says nothing has been deleted", () => {
    const html = renderToStaticMarkup(<DeletionEntry initialStage="acknowledged" />)
    expect(html).toContain(`href="${ACCOUNT_DELETION_RUNBOOK_URL}"`)
    expect(html).toContain('rel="noopener noreferrer"')
    expect(text(html)).toContain("Nothing has been deleted")
  })

  it("links to a runbook path that EXISTS in this repo, on main", () => {
    const prefix = "https://github.com/Oofles/lost-soles/blob/main/"
    expect(ACCOUNT_DELETION_RUNBOOK_URL.startsWith(prefix)).toBe(true)
    const path = join(process.cwd(), ACCOUNT_DELETION_RUNBOOK_URL.slice(prefix.length))
    expect(existsSync(path)).toBe(true)
    // It cites the normative section and says plainly who owns making it executable.
    const body = readFileSync(path, "utf8")
    expect(body).toContain("08-security-privacy.md` §6.4")
    expect(body).toContain("0106")
  })

  it("no deletion is reachable from the component: no fetch, no action, no server call", () => {
    const src = readFileSync(join(process.cwd(), "app/settings/settings-controls.tsx"), "utf8")
    const deletion = src.slice(src.indexOf("export function DeletionEntry"))
    expect(deletion).not.toMatch(/fetch\(|action=|"use server"|method="post"/)
  })
})
