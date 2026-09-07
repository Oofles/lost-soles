import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

/**
 * Ticket 0043 criterion 6 — the half of it a script can answer.
 *
 * The same split `app/settings/page.test.tsx` records: whether the button READS right
 * while standing outside after a run is a judgement only the operator can make (D-181),
 * and it stays in the ticket's Operator validation. Whether a pending state and a result
 * line exist on the page at all is mechanical, and it is asserted here.
 *
 * The action is mocked because importing it would pull `amplify_outputs.json`, an SQS
 * client and the credential store into a test about markup.
 */
vi.mock("@/app/sync-action", () => ({ syncNowAction: vi.fn() }))

const { SyncButton } = await import("./sync-button")

const markup = () => renderToStaticMarkup(<SyncButton />)

describe("the Sync button", () => {
  it("renders a submit button labelled Sync", () => {
    const html = markup()
    expect(html).toContain("<button")
    expect(html).toContain("Sync")
  })

  /**
   * The result line is present and EMPTY before the first press, with a reserved height.
   * Without the reservation the page reflows under the operator's thumb the moment the
   * answer arrives, which on a phone means pressing whatever moved into that spot.
   */
  it("reserves the result line before anything has happened", () => {
    const html = markup()
    expect(html).toContain("aria-live")
    expect(html).toContain("min-height")
  })

  /**
   * `aria-live`, because the whole point of this line is that it appears AFTER the press.
   * A screen-reader user who has just activated the button is not going to go looking for
   * text that silently arrived below it.
   */
  it("announces the result politely rather than silently", () => {
    expect(markup()).toContain('aria-live="polite"')
  })

  /**
   * Tokens only. `scripts/check-design-tokens.mjs` fails the build on a raw colour
   * outside `app/tokens.css`, and this asserts the positive: the button is drawn from
   * the 0016 palette rather than from nothing at all.
   */
  it("draws itself from the design tokens", () => {
    const html = markup()
    expect(html).toContain("var(--accent)")
    expect(html).toContain("var(--text-secondary)")
  })
})
