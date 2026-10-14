import { gunzipSync } from "node:zlib"

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import table from "@/rules/chronicle.json"
import { BEAT1_MS, beat1At, beat1ReducedAt } from "@/lib/run-moment/beat1"
import { tallyFor } from "@/lib/run-moment/tally"
import type { ActivityLedgerRow } from "@/lib/runs/ledger"
import { buildWeb, WEAR } from "@/lib/trace-web/web"
import { assertChronicleTable, chronicleFacts, chronicleLine } from "@/src/domain/chronicle"
import { JOB, LEDGER_TABLE, REGISTRY, TRACE, rig, type Options } from "@/src/pipeline/__fixtures__/process-rig"
import { processActivity } from "@/src/pipeline/process-activity"
import { traceWebKey, type TraceWeb } from "@/src/pipeline/trace-web-store"

import { ChronicleLine } from "./run-lines"
import { TallyView } from "./run-ledger"

/**
 * TICKET `0085`, CRITERION 10 — the same route, played twice, end to end.
 *
 * *"An end-to-end test replays the same route twice and asserts the second play produces: half
 * Wayfaring XP, zero Cartography rows, a 2.9 s beat 1, a trace-layer write, and no string anywhere
 * on screen matching `0 cells`, `No new`, or `(halved)`."*
 *
 * The pipeline half runs the real `processActivity` over the shared rig, twice: the first play over
 * unknown ground, the second over the ground the first one wrote, with the permanent web carried
 * between them. The screen half renders what `/run/:id` renders from the second play's ledger rows
 * — the tally and the chronicle line — and reads beat 1's clock, which never sees the reveal.
 *
 * Synthetic geography, Point Nemo (08 §7.2, D-199).
 */

const ROUTE: Options["ingest"] = { kind: "run", hasTrace: true, trace: TRACE, distanceM: 5100 }
/** The first play's date: the ground the second play crosses was run then. */
const FIRST_PLAY = "2026-08-26T07:00:00.000Z"

type Transact = { TransactItems?: { Put?: { TableName?: string; Item?: Record<string, unknown> } }[] }
const ledgerRows = (transacts: unknown[]) =>
  (transacts as Transact[])[0]!.TransactItems!.filter((i) => i.Put?.TableName === LEDGER_TABLE).map((i) => i.Put!.Item!)

async function playTwice() {
  const web = new Map<string, { body: Uint8Array; etag: string }>()
  const first = rig({ ingest: ROUTE, traces: true, traceWeb: web })
  const one = await processActivity(JOB, first.deps)
  const second = rig({
    ingest: ROUTE,
    traces: true,
    traceWeb: web,
    known: (cells) => Object.fromEntries(cells.map((c) => [c, FIRST_PLAY])),
  })
  const two = await processActivity(JOB, second.deps)
  return { first, second, one, two, web }
}

describe("the same route, twice (0085 criterion 10)", () => {
  it("the second play pays half Wayfaring and no Cartography", async () => {
    const { first, second } = await playTwice()
    const one = ledgerRows(first.transacts)
    const two = ledgerRows(second.transacts)

    const wayfaring = (rows: Record<string, unknown>[]) =>
      rows.filter((r) => r.skillId === "wayfaring").reduce((s, r) => s + (r.xpAwarded as number), 0)
    expect(wayfaring(one)).toBeGreaterThan(0)
    expect(wayfaring(two)).toBeCloseTo(wayfaring(one) / 2, 0)
    expect(two.filter((r) => r.skillId === "cartography")).toEqual([])
    expect(one.filter((r) => r.skillId === "cartography").length).toBeGreaterThan(0)
  })

  it("the second play writes the trace layer, and the web holds the route darker", async () => {
    const { first, second, web } = await playTwice()
    expect(first.traceWebPuts).toHaveLength(1)
    expect(second.traceWebPuts).toHaveLength(1)
    expect(second.calls.indexOf("traceWeb")).toBeLessThan(second.calls.indexOf("persist"))

    const stored = JSON.parse(gunzipSync(web.get(traceWebKey(JOB.userId))!.body).toString("utf8")) as TraceWeb
    const runs = Object.entries(stored.runs).map(([activityId, r]) => ({ activityId, ...r }))
    expect(runs.length).toBeGreaterThan(0)
    // A second, distinct play of the same route darkens the line rather than drawing it twice.
    const twice = buildWeb([...runs, { ...runs[0]!, activityId: "a-2", startedAt: "2026-09-07T03:00:00.000Z" }])
    expect(Math.max(...twice.features.map((f) => f.properties.wear))).toBe(WEAR[1])
  })

  it("beat 1 lasts 2.9 s on it — the clock never sees the reveal", () => {
    expect(BEAT1_MS).toBe(2900)
    for (const at of [beat1At, beat1ReducedAt]) {
      expect(at(BEAT1_MS - 100).phase).not.toBe("done")
      expect(at(BEAT1_MS).phase).toBe("done")
    }
    // The line joins the web over the settle, not at the start and not after.
    expect(beat1At(2600).web).toBe(0)
    expect(beat1At(2750).web).toBeGreaterThan(0)
    expect(beat1At(BEAT1_MS).web).toBe(1)
  })

  it("the screen leads with Wayfaring, frames the run in distance, and says nothing of a lack", async () => {
    const { two, second } = await playTwice()
    if (two.outcome !== "persisted") throw new Error("expected persisted")
    const rows = ledgerRows(second.transacts).map(
      (r): ActivityLedgerRow => ({
        skillId: r.skillId as string,
        reason: r.reason as string,
        xpAwarded: r.xpAwarded as number,
        xpRulesVersion: r.xpRulesVersion as number,
        isFloor: false,
        units: r.units as number | undefined,
      }),
    )
    const rules = REGISTRY
    const names = Object.fromEntries(rules.skills.map((s) => [s.id, s.name]))
    const tally = tallyFor(rows, { wayfaring: 7748, constitution: 6560 }, rules)
    const summary = {
      startedAtLocal: "2026-09-02T07:00:00",
      distanceM: 5100,
      newCellCount: two.award.newCellCount,
      rearmedCellCount: two.award.rearmedCellCount,
    }
    expect(summary.newCellCount).toBe(0)

    const facts = chronicleFacts(
      { activityId: "a-1", startedAt: "2026-09-02T07:00:00Z", distanceM: 5100, newCellCount: 0, rearmedCellCount: 0, cellCount: two.award.cellCount, traced: true },
      [],
    )
    const choice = chronicleLine(facts, assertChronicleTable(table), "a-1")
    expect(choice.set).toBe("no-new-ground")

    const html = renderToStaticMarkup(
      <>
        <TallyView summary={summary} tally={tally} skillName={(id) => names[id] ?? id} />
        <ChronicleLine text={choice.text} opacity={1} />
      </>,
    )
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

    expect(html).not.toContain('data-skill="cartography"')
    expect(html.indexOf('data-skill="wayfaring"')).toBeLessThan(html.indexOf('data-skill="constitution"'))
    expect(text).toContain("5.10 km added to the record")
    expect(text).toMatch(/Total XP [\d,]+ → [\d,]+ \(\+[1-9][\d,]*\)/)
    expect(text).not.toMatch(/0 cells|No new|\(halved\)/i)
  })
})
