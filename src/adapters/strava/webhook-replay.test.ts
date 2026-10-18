import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it, vi } from "vitest"

import type { RawArchiveRef } from "@/src/domain/activity"
import { computeActivityId } from "@/src/domain/activity-id"
import { ledgerId } from "@/src/scoring/ledger"

import type { IngestJob, InboundRequest } from "../types"
import { acceptStravaEvent } from "./accept"
import { normalizeStrava } from "./normalize"

/**
 * Ticket 0093 criterion 6 — A REPLAYED EVENT CANNOT DOUBLE-AWARD XP, via the deterministic
 * `activityId` (D-140, `08-security-privacy.md` §4.3).
 *
 * Strava retries an event up to three times, and the receipt gate (layer 1) normally stops the
 * retries before SQS. This test is about what happens if every gate in front of scoring were
 * bypassed — a receipt aged out, a retry arriving 91 days later: the three deliveries still
 * become three jobs that normalize to ONE `activityId`, and therefore to the SAME ledger row ids,
 * which `xp-ledger.ts` writes with `attribute_not_exists(id)`. A second write of a row is a no-op;
 * there is no second row to award.
 *
 * The pipeline half — a second delivery through `processActivity` keeps the first award and does
 * not re-score — is `src/pipeline/process-activity.test.ts`, "a second delivery keeps the first
 * award (0220, D-260)". That rig stubs `normalize`, so it cannot show where the id comes from;
 * this file shows exactly that, through the real adapter.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const RAW = readFileSync(join(HERE, "__fixtures__", "run-continuous.json"))
const KNOWN_OWNER = 51449053
const OWNER_SUB = "5488e4b8-d081-7014-748e-edd1937f8083"
const OURS = 120475

vi.spyOn(console, "info").mockImplementation(() => {})

const REF: RawArchiveRef = {
  bucket: "lost-soles-raw",
  key: "raw/x/strava/18736594040/deadbeef.json",
  contentType: "application/json",
  bytes: 1024,
  sha256: "deadbeef",
  archivedAt: "2026-06-01T03:20:11.482Z",
}

function delivery(): InboundRequest {
  return {
    source: "strava",
    method: "POST",
    headers: { "content-type": "application/json" },
    query: {},
    rawBody: Buffer.from(
      `{"object_type":"activity","object_id":18736594040,"aspect_type":"create","updates":{},` +
        `"owner_id":${KNOWN_OWNER},"subscription_id":${OURS},"event_time":1748746428}`,
    ),
  }
}

describe("a replayed webhook event resolves to one activity and one set of ledger rows", () => {
  it("three deliveries, at three different times, normalize to the same activityId", async () => {
    const clocks = ["2026-06-01T03:19:00Z", "2026-06-01T03:19:30Z", "2026-09-01T00:00:00Z"]
    const jobs: IngestJob[] = []
    for (const at of clocks) {
      const ack = await acceptStravaEvent(delivery(), { subscriptionId: OURS, now: () => new Date(at) })
      const [command] = ack.commands
      if (command?.kind !== "ingest") throw new Error("expected an ingest command")
      jobs.push(command.job)
    }

    // The jobs differ only in when they were enqueued.
    expect(new Set(jobs.map((j) => j.enqueuedAt)).size).toBe(3)
    expect(new Set(jobs.map((j) => j.ingestKey)).size).toBe(1)

    const ids = jobs.map((job) => normalizeStrava(RAW, REF, job).activity.activityId)
    expect(new Set(ids).size).toBe(1)
    expect(ids[0]).toBe(computeActivityId(OWNER_SUB, "strava", "18736594040"))

    // And so every ledger row the activity can earn has one id, whichever delivery wrote it.
    const rows = ids.map((activityId) =>
      ledgerId({ activityId, skillId: "wayfaring", reason: "new_ground", xpRulesVersion: 1 }),
    )
    expect(new Set(rows).size).toBe(1)
  })

  it("nothing in the event but the ids reaches the activity: event_time is not its start", async () => {
    const ack = await acceptStravaEvent(delivery(), { subscriptionId: OURS })
    const [command] = ack.commands
    if (command?.kind !== "ingest") throw new Error("expected an ingest command")
    const activity = normalizeStrava(RAW, REF, command.job).activity
    // 1748746428 is 2025-06-01T02:53:48Z — one year before the fixture's real start.
    expect(activity.startedAt).toBe("2026-06-01T02:53:48.000Z")
  })
})
