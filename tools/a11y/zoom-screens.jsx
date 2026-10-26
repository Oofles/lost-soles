// Ticket 0112 — every screen, rendered by its real components over synthetic data, as static HTML.
// Bundled for node by run-zoom.mjs (with `stubs.tsx` in place of the router, the session and the
// map) and printed as JSON `{ name: html }`. The runner lays each one out in headless Chromium at
// 200% zoom and measures it.
//
// The screens are composed exactly as their routes compose them; where a route reads a session or
// a network, its data is handed in here instead. The map is the one thing absent: a flat pane.
import { renderToStaticMarkup } from "react-dom/server"

import { MapControls } from "../../components/map/map-controls.tsx"
import { ModeToggle } from "../../components/map/mode-toggle.tsx"
import { RegionJumpControl } from "../../components/map/region-jump-control.tsx"
import { ChroniclePanel } from "../../components/chronicle/chronicle-panel.tsx"
import { Plinth, PLINTH_CSS } from "../../components/plinth/plinth.tsx"
import { LogPage } from "../../app/log/log-page.tsx"
import { TallyView } from "../../app/run/[activityId]/run-ledger.tsx"
import { FrontierLine } from "../../app/run/[activityId]/run-lines.tsx"
import { EndState } from "../../app/run/[activityId]/run-moment.tsx"
import Settings from "../../app/settings/page.tsx"
import { SkillSheet } from "../../app/skills/skill-sheet.tsx"
import { SkillsPanel } from "../../app/skills/skills-panel.tsx"
import { plinthModel } from "../../lib/plinth/model.ts"
import { tallyFor } from "../../lib/run-moment/tally.ts"
import { EMPTY_COLLECTION } from "../../lib/runs/wire.ts"
import { skillDetail } from "../../lib/skills/detail.ts"
import { nextLine } from "../../lib/skills/next.ts"
import { skillsPanel } from "../../lib/skills/panel.ts"
import { BUNDLED_RULES } from "../../rules/xp-rules.bundled.ts"
import { cumulativeXp } from "../../src/scoring/levels.ts"

const noop = () => {}
const rules = BUNDLED_RULES[Math.max(...Object.keys(BUNDLED_RULES).map(Number))]
const enabled = rules.skills.filter((s) => s.enabled).sort((a, b) => a.displayOrder - b.displayOrder)
const activity = enabled.filter((s) => s.kind === "activity")
const meta = enabled.filter((s) => s.kind === "meta")
const NOW = Date.parse("2026-10-07T12:00:00Z")

// Every enabled skill trained, at levels with two- and three-digit XP figures, so the widest
// realistic numbers are the ones laid out.
const skills = enabled.map((s, i) => ({ skillId: s.id, xp: cumulativeXp(Math.min(98, 12 + i * 9)) + 1234 }))

const run = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates: [] },
      properties: {
        activityId: "a-9",
        startedAt: "2026-08-28T11:00:00.000Z",
        startedAtLocal: "2026-08-28T07:00:00",
        name: "Morning Run",
        distanceM: 18400,
        newCellCount: 1214,
      },
    },
  ],
}

const homeModel = plinthModel({
  skills,
  cells: 112480,
  latest: run,
  seen: true,
  // The one failure `/` shows, so its line is laid out too.
  sources: [{ sourceId: "strava", name: "Strava", state: "reconnect" }],
})

/** `/`'s chrome as `HomeScreen` composes it, around a flat map pane. */
function homeChrome(children) {
  return (
    <>
      <style>{PLINTH_CSS}</style>
      {children}
      <ModeToggle />
      <a href="/settings" className="home-gear" aria-label="Settings">
        <span aria-hidden="true">⚙</span>
      </a>
      {/* The jump-to control as `RegionJump` draws it once the trace web has regions in it. */}
      <RegionJumpControl regions={[{ id: "r1", label: "Example Town" }, { id: "r2", label: "Somewhere Else" }]} onChoose={noop} />
      <MapControls map={null} latest={run} onSelect={noop} />
      <div className="home-pane" data-testid="map-shell" />
    </>
  )
}

function history(n) {
  const out = []
  const t0 = Date.UTC(2026, 7, 28, 11)
  for (let i = 0; i < n; i++) {
    const iso = new Date(t0 - i * 86_400_000).toISOString()
    const logged = i % 5 === 3
    out.push({
      activityId: `a-${i}`,
      startedAt: iso,
      startedAtLocal: iso.slice(0, 19),
      name: logged ? null : i % 2 ? "Long Sunday Run Along The River And Back Again" : "Morning Run",
      kind: logged ? "strength" : "run",
      distanceM: logged ? null : 15000 + (i % 7) * 400,
      durationS: logged ? 300 : 5400,
      newCellCount: logged ? 0 : (i % 3) * 412,
      traced: !logged,
      sets: logged ? [{ exercise: "pushup", reps: 40 }] : [],
    })
  }
  return out
}

const panel = skillsPanel(rules, skills)
function sheet(skillId) {
  const rows = Array.from({ length: 12 }, (_, i) => {
    const startedAt = new Date(NOW - (1 + i * 2) * 86_400_000).toISOString()
    return { skillId, activityId: `a${i}`, reason: "distance", units: 5, xpAwarded: 12500, xpRulesVersion: rules.version, isFloor: false, seq: `${startedAt}#a${i}#00` }
  })
  const detail = skillDetail(rules, skillId, [{ skillId, xp: cumulativeXp(87) + 12345 }], rows, [], NOW)
  return <SkillSheet skillId={skillId} detail={detail} onDismiss={noop} onFly={noop} />
}

const SUMMARY = {
  activityId: "a-9",
  startedAt: "2026-08-28T11:00:00.000Z",
  startedAtLocal: "2026-08-28T07:00:00",
  name: "Long Sunday Run Along The River And Back Again",
  kind: "run",
  distanceM: 18400,
  elapsedS: 6600,
  movingS: 6530,
  source: "manual",
  newCellCount: 1214,
  rearmedCellCount: 87,
  cellCount: 1400,
  route: EMPTY_COLLECTION,
  reveal: { new: [], rearmed: [] },
}
const row = (skillId, reason, xpAwarded) => ({ skillId, reason, xpAwarded, xpRulesVersion: rules.version, isFloor: false })
const tally = tallyFor(
  activity.slice(0, 3).map((s, i) => row(s.id, "new_ground", 12840 - i * 3000)),
  Object.fromEntries(skills.map((s) => [s.skillId, s.xp])),
  rules,
)
const nameOf = (id) => rules.skills.find((s) => s.id === id)?.name ?? id

const render = (el) => renderToStaticMarkup(el)

export async function screens() {
  globalThis.__pathname = "/"
  const out = {
    home: render(homeChrome(<Plinth model={homeModel} />)),
  }
  globalThis.__pathname = "/chronicle"
  out.chronicle = render(homeChrome(<ChroniclePanel initial={{ items: history(60), next: "more" }} />))
  globalThis.__pathname = "/skills"
  out.skills = render(<SkillsPanel model={panel} next={nextLine(rules, panel.activity, { [activity[0].id]: [50] })} />)
  out["skill-sheet"] = render(
    <>
      <SkillsPanel model={panel} next={null} />
      {sheet(activity[0].id)}
    </>,
  )
  out["skill-sheet-meta"] = render(
    <>
      <SkillsPanel model={panel} next={null} />
      {sheet(meta[0].id)}
    </>,
  )
  globalThis.__pathname = "/log"
  out.log = render(<LogPage />)
  globalThis.__pathname = "/run/a-9"
  out.run = render(
    <main data-phase="end">
      <EndState
        summary={SUMMARY}
        map={<div style={{ position: "relative", height: "55vh", minHeight: "16rem", width: "100%", background: "var(--bg)" }} />}
        ledger={<TallyView summary={SUMMARY} tally={tally} skillName={nameOf} />}
        chronicle="Old roads, run well. The map holds them still, and the river remembers the long way round."
        frontier={<FrontierLine text="Unclaimed ground 1.2 km north of Riverside Gardens Allotments" />}
        kind={null}
        onRelive={noop}
      />
    </main>,
  )
  globalThis.__pathname = "/settings"
  out.settings = render(await Settings({ searchParams: Promise.resolve({}) }))
  return out
}

screens().then((s) => process.stdout.write(JSON.stringify(s)))
