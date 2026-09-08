import { UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import { mirrorGeneration, repairGenerationMirror, type MirrorDeps } from "./explored-mirror"

/**
 * `0051` criterion 7. `02-data-model.md` T1 and §6.4: *"The manifest is authoritative; the
 * Profile attribute is a notification channel. If they ever disagree, the manifest wins and
 * the mirror is repaired."*
 */
class FakeProfileTable {
  readonly rows = new Map<string, number>()
  readonly commands: UpdateCommand[] = []
  /** Set to make every write fail the way a missing grant or a throttle would. */
  fail?: Error

  send = async (command: UpdateCommand): Promise<unknown> => {
    this.commands.push(command)
    if (this.fail) throw this.fail

    const input = command.input
    if (input.UpdateExpression !== "SET exploredGeneration = :g") {
      throw new Error(`unexpected mirror expression: ${input.UpdateExpression}`)
    }
    const id = String(input.Key!.id)
    const next = input.ExpressionAttributeValues![":g"] as number
    const current = this.rows.get(id)

    // The condition, EVALUATED — not recorded for the test to assert a string on.
    if (current !== undefined && !(current < next)) {
      const e = new Error("The conditional request failed")
      e.name = "ConditionalCheckFailedException"
      throw e
    }
    this.rows.set(id, next)
    return {}
  }
}

const deps = (table: FakeProfileTable): MirrorDeps => ({ ddb: table, table: "Profile-test" })

describe("mirrorGeneration — T1 does not exist yet", () => {
  /**
   * The state of the world today, and it is an ANSWER rather than a failure. `Profile`
   * arrives with the XP engine (capability 09); until then the manifest carries the whole
   * contract and the subscription this attribute feeds does not exist either.
   */
  it("reports no-table when no Profile table is configured", async () => {
    expect(await mirrorGeneration("u1", 42, undefined)).toBe("no-table")
    expect(await mirrorGeneration("u1", 42, { ddb: new FakeProfileTable() })).toBe("no-table")
  })

  it("writes nothing at all in that case", async () => {
    const table = new FakeProfileTable()
    await mirrorGeneration("u1", 42, { ddb: table })
    expect(table.commands).toHaveLength(0)
  })
})

describe("mirrorGeneration — when there is somewhere to write", () => {
  it("sets the attribute on a row that does not exist yet", async () => {
    const table = new FakeProfileTable()
    expect(await mirrorGeneration("u1", 42, deps(table))).toBe("mirrored")
    expect(table.rows.get("u1")).toBe(42)
  })

  it("advances it", async () => {
    const table = new FakeProfileTable()
    await mirrorGeneration("u1", 42, deps(table))
    expect(await mirrorGeneration("u1", 43, deps(table))).toBe("mirrored")
    expect(table.rows.get("u1")).toBe(43)
  })

  /**
   * The manifest's `IfMatch` serialises PUBLISHES, not these writes. Worker A can publish 42,
   * be descheduled, and reach here after worker B has published and mirrored 43. An
   * unconditional `SET` would drag the mirror back to 42 while the manifest said 43 — and the
   * subscription would then push a generation the client already holds.
   */
  it("REFUSES to lower the mirror, and calls that stale rather than failed", async () => {
    const table = new FakeProfileTable()
    await mirrorGeneration("u1", 43, deps(table))
    expect(await mirrorGeneration("u1", 42, deps(table))).toBe("stale")
    expect(table.rows.get("u1")).toBe(43)
  })

  it("refuses an equal generation too — strictly greater, or nothing", async () => {
    const table = new FakeProfileTable()
    await mirrorGeneration("u1", 42, deps(table))
    expect(await mirrorGeneration("u1", 42, deps(table))).toBe("stale")
  })

  it("keeps users independent", async () => {
    const table = new FakeProfileTable()
    await mirrorGeneration("a", 99, deps(table))
    expect(await mirrorGeneration("b", 1, deps(table))).toBe("mirrored")
    expect(table.rows.get("a")).toBe(99)
  })

  it("keys the row by id, which is the userId (02 T1)", async () => {
    const table = new FakeProfileTable()
    await mirrorGeneration("u-abc", 5, deps(table))
    expect(table.commands[0]!.input.Key).toEqual({ id: "u-abc" })
  })

  /**
   * THE ONE THAT MATTERS MOST. This runs after the manifest PUT — after the commit point —
   * and the receipt is still `PROCESSING`. A throw here would send the message back, and the
   * redelivery would allocate a fresh generation and republish a byte-identical map. Forever,
   * on every attempt, for a missed push notification.
   */
  it("NEVER throws — a failed write is a value, because the publish is already committed", async () => {
    const table = new FakeProfileTable()
    table.fail = Object.assign(new Error("AccessDeniedException"), {
      name: "AccessDeniedException",
    })
    await expect(mirrorGeneration("u1", 42, deps(table))).resolves.toBe("failed")
  })

  it("reports a throttle as failed too, rather than letting it escape", async () => {
    const table = new FakeProfileTable()
    table.fail = Object.assign(new Error("slow down"), {
      name: "ProvisionedThroughputExceededException",
    })
    expect(await mirrorGeneration("u1", 42, deps(table))).toBe("failed")
  })
})

describe("repairGenerationMirror — the manifest wins (02 §6.4)", () => {
  it("drags a mirror that fell behind up to the manifest's number", async () => {
    const table = new FakeProfileTable()
    await mirrorGeneration("u1", 40, deps(table))

    const repair = await repairGenerationMirror("u1", 44, deps(table))
    expect(repair).toEqual({ manifest: 44, outcome: "mirrored" })
    expect(table.rows.get("u1")).toBe(44)
  })

  /**
   * CRITERION 7's *"a test asserts the manifest wins"*, in the direction that could actually
   * go wrong. A repair that read both sides and reconciled them would need a branch in which
   * the larger Profile value survives. There is no such branch: the Profile's value is never
   * read, the conditional write IS the comparison, and a mirror ahead of the manifest simply
   * stays where it is — which is the safe direction, since a mirror can only ever be ahead by
   * a generation that was published and then lost, and the next publish repairs it.
   */
  it("never lets a mirror ahead of the manifest pull the manifest's number down", async () => {
    const table = new FakeProfileTable()
    await mirrorGeneration("u1", 50, deps(table))

    const repair = await repairGenerationMirror("u1", 44, deps(table))
    expect(repair.manifest).toBe(44)
    expect(repair.outcome).toBe("stale")
    // And critically: nothing anywhere now believes the authoritative generation is 50.
    expect(table.rows.get("u1")).toBe(50)
  })

  it("is idempotent — repairing an already-correct mirror writes nothing new", async () => {
    const table = new FakeProfileTable()
    await mirrorGeneration("u1", 44, deps(table))
    const before = table.commands.length

    expect((await repairGenerationMirror("u1", 44, deps(table))).outcome).toBe("stale")
    expect(table.commands).toHaveLength(before + 1)
    expect(table.rows.get("u1")).toBe(44)
  })

  it("creates the mirror when the row has none at all", async () => {
    const table = new FakeProfileTable()
    expect((await repairGenerationMirror("u1", 7, deps(table))).outcome).toBe("mirrored")
    expect(table.rows.get("u1")).toBe(7)
  })

  it("reports no-table rather than pretending it repaired anything", async () => {
    expect(await repairGenerationMirror("u1", 44, undefined)).toEqual({
      manifest: 44,
      outcome: "no-table",
    })
  })
})
