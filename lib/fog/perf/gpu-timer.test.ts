import { describe, expect, it } from "vitest"

import { GpuTimer } from "./gpu-timer"

/**
 * Ticket `0059`, §6.4 item 2.
 *
 * A recording fake context, the same technique `mask.test.ts` uses. It cannot prove a nanosecond is a
 * nanosecond — only a driver can — but every failure mode this class actually has is a sequencing
 * one: a nested window, a disjoint result folded into the mean, a blocking read, a query leaked on a
 * context change. Those are all visible in the call log.
 */

const TIME_ELAPSED = 0x88bf
const DISJOINT = 0x8fbb

interface FakeQuery {
  id: number
  available: boolean
  result: number
  deleted: boolean
}

function fakeGl(options: { supported?: boolean } = {}) {
  const supported = options.supported ?? true
  let next = 1
  const queries: FakeQuery[] = []
  const calls: string[] = []
  let disjoint = false

  const gl = {
    QUERY_RESULT_AVAILABLE: 0x9194,
    QUERY_RESULT: 0x8866,
    getExtension: (name: string) =>
      supported && name === "EXT_disjoint_timer_query_webgl2"
        ? { TIME_ELAPSED_EXT: TIME_ELAPSED, GPU_DISJOINT_EXT: DISJOINT }
        : null,
    createQuery: () => {
      const query: FakeQuery = { id: next++, available: false, result: 0, deleted: false }
      queries.push(query)
      return query
    },
    deleteQuery: (query: FakeQuery) => {
      query.deleted = true
      calls.push(`delete ${query.id}`)
    },
    beginQuery: (target: number, query: FakeQuery) => {
      calls.push(`begin ${target === TIME_ELAPSED ? "time" : target} ${query.id}`)
    },
    endQuery: (target: number) => {
      calls.push(`end ${target === TIME_ELAPSED ? "time" : target}`)
    },
    getParameter: (pname: number) => {
      calls.push(`getParameter ${pname === DISJOINT ? "disjoint" : pname}`)
      return pname === DISJOINT ? disjoint : null
    },
    getQueryParameter: (query: FakeQuery, pname: number) => {
      calls.push(`getQueryParameter ${query.id} ${pname === 0x9194 ? "available" : "result"}`)
      return pname === 0x9194 ? query.available : query.result
    },
  }

  return {
    gl: gl as unknown as WebGL2RenderingContext,
    queries,
    calls,
    setDisjoint: (value: boolean) => {
      disjoint = value
    },
  }
}

describe("when the extension is missing — the expected path on Chrome for Android", () => {
  it("reports unsupported with a reason, and every call is a no-op", () => {
    const { gl, calls } = fakeGl({ supported: false })
    const timer = new GpuTimer()
    timer.attach(gl)

    timer.begin("mask")
    timer.end()
    timer.poll()

    expect(timer.supported).toBe(false)
    expect(calls).toEqual([])
    const stats = timer.stats()
    expect(stats.passes).toEqual([])
    expect(stats.reason).toContain("EXT_disjoint_timer_query_webgl2 unavailable")
    // The reason names what still stands, so a missing row is not read as a broken shader.
    expect(stats.reason).toContain("frame time")
  })
})

describe("when it is available", () => {
  it("records a mean and a max per label, in milliseconds", () => {
    const fake = fakeGl()
    const timer = new GpuTimer()
    timer.attach(fake.gl)

    timer.begin("mask")
    timer.end()
    timer.begin("composite")
    timer.end()

    // 400,000 ns = 0.4 ms; 1,800,000 ns = 1.8 ms.
    fake.queries[0]!.available = true
    fake.queries[0]!.result = 400_000
    fake.queries[1]!.available = true
    fake.queries[1]!.result = 1_800_000
    timer.poll()

    const stats = timer.stats()
    expect(stats.supported).toBe(true)
    const mask = stats.passes.find((p) => p.label === "mask")!
    expect(mask.samples).toBe(1)
    expect(mask.meanMs).toBeCloseTo(0.4)
    const composite = stats.passes.find((p) => p.label === "composite")!
    expect(composite.maxMs).toBeCloseTo(1.8)
  })

  /**
   * THE ONE THAT MATTERS MOST. A disjoint window is *no measurement*, and the tempting bug is to read
   * its `QUERY_RESULT` anyway — which the driver is entitled to return as garbage, typically a very
   * large number. Folded into a mean it reports a GPU stall that never happened, on the device where
   * nobody can attach a profiler to disagree.
   */
  it("discards disjoint windows rather than averaging their garbage in", () => {
    const fake = fakeGl()
    const timer = new GpuTimer()
    timer.attach(fake.gl)

    timer.begin("mask")
    timer.end()
    fake.queries[0]!.available = true
    fake.queries[0]!.result = 999_999_999
    fake.setDisjoint(true)
    timer.poll()

    const stats = timer.stats()
    expect(stats.disjoint).toBe(1)
    expect(stats.passes).toEqual([])
    expect(fake.calls).not.toContain("getQueryParameter 1 result")
  })

  it("reads GPU_DISJOINT_EXT once per poll, because reading it clears it", () => {
    const fake = fakeGl()
    const timer = new GpuTimer()
    timer.attach(fake.gl)
    for (let i = 0; i < 3; i++) {
      timer.begin("mask")
      timer.end()
    }
    for (const query of fake.queries) {
      query.available = true
      query.result = 100_000
    }
    timer.poll()
    expect(fake.calls.filter((c) => c === "getParameter disjoint")).toHaveLength(1)
  })

  it("never reads a result before the driver says it is available", () => {
    const fake = fakeGl()
    const timer = new GpuTimer()
    timer.attach(fake.gl)
    timer.begin("mask")
    timer.end()
    timer.poll()

    expect(fake.calls).toContain("getQueryParameter 1 available")
    expect(fake.calls).not.toContain("getQueryParameter 1 result")
    expect(timer.stats().passes).toEqual([])

    // And it is still pending, so the sample is not lost — just late.
    fake.queries[0]!.available = true
    fake.queries[0]!.result = 250_000
    timer.poll()
    expect(timer.stats().passes[0]!.samples).toBe(1)
  })

  /**
   * `prerender` can `return` between a `begin` and its `end` — a shader error, or the `maskDirty`
   * short-circuit landing after a begin in some future edit. WebGL2 allows one active
   * `TIME_ELAPSED_EXT` query, so the second `begin` would be a GL error rather than a lost sample.
   */
  it("drops a nested window instead of raising a GL error", () => {
    const fake = fakeGl()
    const timer = new GpuTimer()
    timer.attach(fake.gl)
    timer.begin("mask")
    timer.begin("composite")
    expect(fake.calls.filter((c) => c.startsWith("begin"))).toHaveLength(1)
    timer.end()
    expect(fake.calls.filter((c) => c.startsWith("end"))).toHaveLength(1)
  })

  it("reuses query objects rather than allocating one per frame", () => {
    const fake = fakeGl()
    const timer = new GpuTimer()
    timer.attach(fake.gl)
    for (let frame = 0; frame < 5; frame++) {
      timer.begin("mask")
      timer.end()
      for (const query of fake.queries) {
        query.available = true
        query.result = 100_000
      }
      timer.poll()
    }
    expect(fake.queries).toHaveLength(1)
    expect(timer.stats().passes[0]!.samples).toBe(5)
  })

  it("deletes its queries when the context changes, rather than leaking them into a dead one", () => {
    const first = fakeGl()
    const timer = new GpuTimer()
    timer.attach(first.gl)
    timer.begin("mask")
    timer.end()

    const second = fakeGl()
    timer.attach(second.gl)

    expect(first.queries.every((q) => q.deleted)).toBe(true)
    expect(timer.stats().passes).toEqual([])
  })

  it("clear() keeps the context binding but drops the samples", () => {
    const fake = fakeGl()
    const timer = new GpuTimer()
    timer.attach(fake.gl)
    timer.begin("mask")
    timer.end()
    fake.queries[0]!.available = true
    fake.queries[0]!.result = 500_000
    timer.poll()
    expect(timer.stats().passes).toHaveLength(1)

    timer.clear()
    expect(timer.stats().passes).toEqual([])
    expect(timer.supported).toBe(true)
  })
})
