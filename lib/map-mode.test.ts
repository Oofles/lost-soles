import { describe, expect, it, vi } from "vitest"

import { FogAnimator, type AnimationHost } from "./fog/animation"
import { ADVENTURE, ATLAS } from "./fog/fog-uniforms"
import {
  DEFAULT_MAP_MODE,
  MAP_MODE_STORAGE_KEY,
  MODE_CROSSFADE_MS,
  MODE_FRAMES,
  createMapModeStore,
  easeInOut,
  initialMapMode,
  isModeShortcut,
  lerpFrame,
  startModeTransition,
  type ModeFrame,
  type ModeStorage,
} from "./map-mode"
import { RUN_GLOW_METRICS } from "./map-layers"

/** A `localStorage` stand-in. `throws` models a private window, where every access throws. */
function memoryStorage(initial: Record<string, string> = {}, throws = false): ModeStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => {
      if (throws) throw new Error("SecurityError")
      return k in data ? data[k]! : null
    },
    setItem: (k, v) => {
      if (throws) throw new Error("QuotaExceededError")
      data[k] = v
    },
  }
}

/** A rAF clock at an exact display rate. `frame()` delivers the next callback at the next vsync. */
function fakeClock(hz = 60) {
  let now = 1000
  let next = 1
  const queue = new Map<number, (t: number) => void>()
  const raf = vi.fn((cb: (t: number) => void) => {
    queue.set(next, cb)
    return next++
  })
  return {
    raf,
    clock: {
      now: () => now,
      requestAnimationFrame: raf,
      cancelAnimationFrame: (h: number) => void queue.delete(h),
    },
    frame() {
      now += 1000 / hz
      const pending = [...queue.values()]
      queue.clear()
      for (const cb of pending) cb(now)
    },
    get pending() {
      return queue.size
    },
    get now() {
      return now
    },
  }
}

/** Every number a `ModeFrame` carries, flattened in a fixed order. */
function values(f: ModeFrame): number[] {
  const p = f.fog
  return [...p.fogDeep, ...p.fogEdge, ...p.rimGlow, p.maxOpacity, p.noiseAmp, p.rimAmt, f.routeGlowOpacity]
}

describe("the saved mode — criterion 6", () => {
  it("a fresh profile with no stored value gets adventure", () => {
    expect(DEFAULT_MAP_MODE).toBe("adventure")
    expect(initialMapMode("", memoryStorage())).toBe("adventure")
    expect(initialMapMode("", null)).toBe("adventure")
  })

  it("survives a reload: what one store saves, the next store starts in", () => {
    const storage = memoryStorage()
    const first = createMapModeStore("", storage)
    first.set("atlas")
    expect(storage.data[MAP_MODE_STORAGE_KEY]).toBe("atlas")
    // A reload is a new page, so a new store over the same storage.
    expect(createMapModeStore("", storage).get()).toBe("atlas")
    createMapModeStore("", storage).toggle()
    expect(createMapModeStore("", storage).get()).toBe("adventure")
  })

  it("ignores a stored value it does not recognise, and a storage that throws", () => {
    expect(initialMapMode("", memoryStorage({ [MAP_MODE_STORAGE_KEY]: "sepia" }))).toBe("adventure")
    const store = createMapModeStore("", memoryStorage({}, true))
    expect(store.get()).toBe("adventure")
    expect(() => store.set("atlas")).not.toThrow()
    expect(store.get()).toBe("atlas")
  })

  it("?basemap= outranks the saved mode, which outranks the default (D-370)", () => {
    const saved = memoryStorage({ [MAP_MODE_STORAGE_KEY]: "atlas" })
    expect(initialMapMode("?basemap=adventure", saved)).toBe("adventure")
    expect(initialMapMode("", saved)).toBe("atlas")
    expect(initialMapMode("?basemap=atlas", memoryStorage())).toBe("atlas")
  })

  it("notifies subscribers once per change, and not for a no-op", () => {
    const store = createMapModeStore("", memoryStorage())
    const seen: string[] = []
    const off = store.subscribe(() => seen.push(store.get()))
    store.toggle()
    store.set("atlas")
    store.toggle()
    off()
    store.toggle()
    expect(seen).toEqual(["atlas", "adventure"])
  })
})

describe("what each mode draws", () => {
  it("takes the fog straight from FOG_MODES, and atlas draws the route core alone (Q4)", () => {
    expect(MODE_FRAMES.atlas.fog).toBe(ATLAS)
    expect(MODE_FRAMES.adventure.fog).toBe(ADVENTURE)
    expect(MODE_FRAMES.adventure.routeGlowOpacity).toBe(RUN_GLOW_METRICS["line-opacity"])
    expect(MODE_FRAMES.atlas.routeGlowOpacity).toBe(0)
  })
})

describe("the cross-fade — criterion 3", () => {
  it("is ease-in-out: symmetric, flat at both ends, half way at half time", () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(1)).toBe(1)
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 6)
    expect(easeInOut(0.25) + easeInOut(0.75)).toBeCloseTo(1, 6)
    expect(easeInOut(0.05)).toBeLessThan(0.05)
  })

  for (const [from, to] of [
    ["adventure", "atlas"],
    ["atlas", "adventure"],
  ] as const) {
    it(`${from} → ${to} lasts 320 ms ± 16 ms, measured`, () => {
      const t = fakeClock(60)
      const start = t.now
      let end: number | null = null
      startModeTransition({
        from: MODE_FRAMES[from],
        to: MODE_FRAMES[to],
        reduced: false,
        clock: t.clock,
        apply: () => {},
        done: () => (end = t.now),
      })
      for (let i = 0; i < 60 && end === null; i++) t.frame()
      expect(end).not.toBeNull()
      expect(MODE_CROSSFADE_MS).toBe(320)
      expect(Math.abs(end! - start - MODE_CROSSFADE_MS)).toBeLessThanOrEqual(16)
      expect(t.pending).toBe(0)
    })

    it(`${from} → ${to}: every uniform and the glow share ONE progress value at t = 160 ms`, () => {
      // 125 Hz so a frame lands exactly on 160 ms.
      const t = fakeClock(125)
      const start = t.now
      let at160: ModeFrame | null = null
      startModeTransition({
        from: MODE_FRAMES[from],
        to: MODE_FRAMES[to],
        reduced: false,
        clock: t.clock,
        apply: (frame) => {
          if (Math.abs(t.now - start - 160) < 1e-6) at160 = frame
        },
      })
      for (let i = 0; i < 20; i++) t.frame()
      expect(at160).not.toBeNull()
      const a = values(MODE_FRAMES[from])
      const b = values(MODE_FRAMES[to])
      const mid = values(at160!)
      const progress = mid
        .map((v, i) => (a[i] === b[i] ? null : (v - a[i]!) / (b[i]! - a[i]!)))
        .filter((p): p is number => p !== null)
      // Every value that changes between the modes moved, and they all moved the same distance.
      expect(progress.length).toBeGreaterThanOrEqual(8)
      for (const p of progress) expect(p).toBeCloseTo(progress[0]!, 9)
      expect(progress[0]).toBeCloseTo(easeInOut(0.5), 9)
    })
  }

  it("a re-toggle mid-fade starts from the frame on screen, not from an end state", () => {
    const t = fakeClock(60)
    const first = startModeTransition({
      from: MODE_FRAMES.adventure,
      to: MODE_FRAMES.atlas,
      reduced: false,
      clock: t.clock,
      apply: () => {},
    })
    for (let i = 0; i < 8; i++) t.frame()
    first.cancel()
    const onScreen = first.current()
    const applied: ModeFrame[] = []
    startModeTransition({ from: onScreen, to: MODE_FRAMES.adventure, reduced: false, clock: t.clock, apply: (f) => applied.push(f) })
    t.frame()
    // The first frame of the reversal is within one frame's travel of where the fade stood.
    expect(Math.abs(applied[0]!.fog.maxOpacity - onScreen.fog.maxOpacity)).toBeLessThan(0.05)
    expect(lerpFrame(onScreen, MODE_FRAMES.adventure, 1)).toEqual(MODE_FRAMES.adventure)
  })
})

describe("reduced motion — criterion 7", () => {
  it("a toggle is a hard cut: the final frame at once, and requestAnimationFrame is never called", () => {
    const t = fakeClock()
    const applied: number[] = []
    let done = false
    startModeTransition({
      from: MODE_FRAMES.atlas,
      to: MODE_FRAMES.adventure,
      reduced: true,
      clock: t.clock,
      apply: (_f, p) => applied.push(p),
      done: () => (done = true),
    })
    expect(applied).toEqual([1])
    expect(done).toBe(true)
    expect(t.raf).not.toHaveBeenCalled()
  })

  /**
   * Adventure under reduced motion: adventure's COLOURS (the layer draws `MODE_FRAMES.adventure`,
   * the shell never swaps it for atlas's) and atlas's STATIC fog — the animator schedules no frame
   * and holds `u_time` at 0. The animator is the one `useFogMask` builds; this is its host contract.
   */
  it("adventure renders static fog in adventure colours and schedules no rAF", () => {
    const raf = vi.fn(() => 1)
    const host: AnimationHost = {
      requestAnimationFrame: raf,
      cancelAnimationFrame: () => {},
      isHidden: () => false,
      prefersReducedMotion: () => true,
      subscribe: () => () => {},
      repaint: () => {},
    }
    const animator = new FogAnimator(host)
    animator.setFrozen(!MODE_FRAMES.adventure.fog.animated)
    animator.start()
    expect(raf).not.toHaveBeenCalled()
    expect(animator.time()).toBe(0)
    expect(MODE_FRAMES.adventure.fog.fogDeep).toEqual(ADVENTURE.fogDeep)
    expect(MODE_FRAMES.adventure.fog.maxOpacity).toBe(0.9)
  })
})

describe("atlas freezes the mist where it is (D-NEW-a)", () => {
  function host(reduced = false) {
    let cb: ((t: number) => void) | null = null
    const h: AnimationHost & { fire(t: number): void; raf: ReturnType<typeof vi.fn> } = {
      raf: vi.fn(),
      requestAnimationFrame: (c) => {
        h.raf()
        cb = c
        return 1
      },
      cancelAnimationFrame: () => (cb = null),
      isHidden: () => false,
      prefersReducedMotion: () => reduced,
      subscribe: () => () => {},
      repaint: () => {},
      fire(t) {
        const c = cb
        cb = null
        c?.(t)
      },
    }
    return h
  }

  it("stops the loop and holds u_time at its current value, then resumes from it", () => {
    const h = host()
    const animator = new FogAnimator(h)
    animator.start()
    for (let t = 0; t <= 1000; t += 1000 / 60) h.fire(t)
    const drifted = animator.time()
    expect(drifted).toBeGreaterThan(0.5)
    animator.setFrozen(true)
    h.fire(2000)
    h.fire(3000)
    expect(animator.time()).toBe(drifted)
    const calls = h.raf.mock.calls.length
    h.fire(4000)
    expect(h.raf.mock.calls.length).toBe(calls)
    animator.setFrozen(false)
    expect(animator.time()).toBe(drifted)
    expect(h.raf.mock.calls.length).toBe(calls + 1)
  })
})

describe("the keyboard shortcut (06 §4.2, D-253)", () => {
  const key = (k: string, extra: Partial<Parameters<typeof isModeShortcut>[0]> = {}) =>
    isModeShortcut({ key: k, ctrlKey: false, metaKey: false, altKey: false, target: { tagName: "DIV" }, ...extra })

  it("is M, either case, with no modifier", () => {
    expect(key("m")).toBe(true)
    expect(key("M")).toBe(true)
    for (const mod of ["ctrlKey", "metaKey", "altKey"] as const) expect(key("m", { [mod]: true })).toBe(false)
    expect(key("m", { repeat: true })).toBe(false)
  })

  it("does not collide with MapLibre's keys (arrows, + and −)", () => {
    for (const k of ["ArrowUp", "ArrowLeft", "+", "-", "=", "Escape"]) expect(key(k)).toBe(false)
  })

  it("is ignored while a text field has focus", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) expect(key("m", { target: { tagName } })).toBe(false)
    expect(key("m", { target: { tagName: "DIV", isContentEditable: true } })).toBe(false)
  })
})
