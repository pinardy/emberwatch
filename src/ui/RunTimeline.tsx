import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { SPECIES, speciesSingular } from '../game/content/species'
import { RESOLVE_LEAVE_THRESHOLD } from '../game/engine/balance'
import { formatClock } from '../game/engine/forecast'
import { COL, describeOutcome, inStorm, raceAt, stormPeriods } from '../game/engine/timeline'
import type { RunState, SpeciesId, TimelineEvent } from '../game/types'
import { Icon } from './Icon'
import { linePath } from './RaceSparkline'

// The live sparkline moved to its own module; re-exported for existing callers.
export { RaceSparkline } from './RaceSparkline'

/*
 * The end-of-run timeline: why the run ended, not just how. Two views share
 * one time axis — the race between reputation and impatience (each as a share
 * of its goal, on one axis), and resolve per species against its threshold as
 * small multiples with population beneath. Storms are shaded, key moments are
 * marked, and a crosshair readout follows pointer, tap or arrow keys. A plain
 * sentence and a data table carry everything for readers who cannot see it.
 */

type View = 'race' | 'villagers'

const PAD_LEFT = 38
const PAD_RIGHT = 10
const PAD_TOP = 12
const RACE_H = 168
const LANE_H = 30
const AXIS_H = 18
const ROW_TITLE = 16
const ROW_H = 48
const ROW_GAP = 10

/** Markers drawn on the event lane; the rest live in the readout and table. */
const MARKED: Record<string, MarkerKind> = {
  left: 'lost',
  lost: 'lost',
  threat: 'threat',
  cornerstone: 'boon',
  charter: 'boon',
  decreeMissed: 'missed',
}
type MarkerKind = 'lost' | 'threat' | 'boon' | 'missed'

const MARKER_LABEL: Record<MarkerKind, string> = {
  lost: 'Villager lost',
  threat: 'Threat unleashed',
  boon: 'Cornerstone or charter',
  missed: 'Decree missed',
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function singular(sp: string | undefined): string {
  return sp && sp in SPECIES ? speciesSingular(sp as SpeciesId) : 'Villager'
}

export function eventLabel(e: TimelineEvent): string {
  switch (e.k) {
    case 'storm':
      return 'The Storm broke'
    case 'year':
      return `Year ${e.d} began`
    case 'left':
      return `A ${singular(e.d)} left in despair`
    case 'lost':
      return `A ${singular(e.d)} was lost`
    case 'threat':
      return `${e.d ?? 'A threat'} unleashed`
    case 'appeased':
      return `${e.d ?? 'A threat'} appeased`
    case 'glade':
      return 'Glade cleared'
    case 'cornerstone':
      return `Cornerstone: ${e.d}`
    case 'charter':
      return `Charter: ${e.d}`
    case 'decreeMet':
      return `Decree met: ${e.d}`
    case 'decreeMissed':
      return `Decree missed: ${e.d}`
  }
}

const fmt1 = (x: number) => (Math.round(x * 10) / 10).toString()
const signed = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${fmt1(Math.abs(x))}`

/**
 * Groups events on the same lane track that land too close to tell apart on
 * screen; a group draws one marker with a count. Losses get their own track.
 */
function clusterEvents(events: TimelineEvent[], x: (t: number) => number) {
  const out: { kind: MarkerKind; track: number; x: number; events: TimelineEvent[] }[] = []
  for (const e of events) {
    const kind = MARKED[e.k]
    if (!kind) continue
    const track = kind === 'lost' ? 0 : 1
    const ex = x(e.t)
    const last = [...out].reverse().find((c) => c.track === track)
    // A marker needs ~13px, plus room for its count label once it has one.
    const room = last ? (last.events.length > 1 ? 22 : 13) : 0
    if (last && last.kind === kind && ex - last.x < room) last.events.push(e)
    else out.push({ kind, track, x: last ? Math.max(ex, last.x + room) : ex, events: [e] })
  }
  return out
}

/** Summarises a handful of events, e.g. "3 villagers lost · Wolf Pack unleashed". */
function summariseEvents(events: TimelineEvent[]): string {
  if (events.length === 0) return ''
  const losses = events.filter((e) => e.k === 'left' || e.k === 'lost').length
  const glades = events.filter((e) => e.k === 'glade').length
  const parts: string[] = []
  if (losses === 1) parts.push(eventLabel(events.find((e) => e.k === 'left' || e.k === 'lost')!))
  else if (losses > 1) parts.push(`${losses} villagers lost`)
  if (glades === 1) parts.push('Glade cleared')
  else if (glades > 1) parts.push(`${glades} glades cleared`)
  for (const e of events) {
    if (e.k !== 'left' && e.k !== 'lost' && e.k !== 'glade') parts.push(eventLabel(e))
  }
  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function useElementWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const w = el.getBoundingClientRect().width
      if (w > 0) setWidth(Math.round(w))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

function Marker({ kind, x, y }: { kind: MarkerKind; x: number; y: number }) {
  switch (kind) {
    case 'lost':
      return (
        <path
          className="tl-mark is-lost"
          d={`M${x - 5} ${y - 4}L${x + 5} ${y - 4}L${x} ${y + 5}Z`}
        />
      )
    case 'threat':
      return (
        <path
          className="tl-mark is-threat"
          d={`M${x} ${y - 5.5}L${x + 5} ${y}L${x} ${y + 5.5}L${x - 5} ${y}Z`}
        />
      )
    case 'boon':
      return <circle className="tl-mark is-boon" cx={x} cy={y} r={4.5} />
    case 'missed':
      return <rect className="tl-mark is-missed" x={x - 4} y={y - 4} width={8} height={8} rx={1} />
  }
}

function LegendMarker({ kind }: { kind: MarkerKind }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <Marker kind={kind} x={7} y={7} />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// The chart
// ---------------------------------------------------------------------------

export function RunTimelineChart({ run }: { run: RunState }) {
  const tl = run.timeline
  const [view, setView] = useState<View>('race')
  const [focus, setFocus] = useState<number | null>(null)
  const [wrapRef, width] = useElementWidth(600)
  const uid = useId()
  const summary = useMemo(() => describeOutcome(run), [run])

  const samples = tl?.samples ?? []
  const t0 = samples[0]?.[COL.clock] ?? 0
  const t1 = samples[samples.length - 1]?.[COL.clock] ?? 0
  const chartable = samples.length >= 2 && t1 - t0 >= 1

  const fallback: [number, number] = [run.maxReputation, run.maxImpatience]
  const storms = useMemo(() => (tl ? stormPeriods(tl, t1) : []), [tl, t1])

  if (!tl || !chartable) {
    return (
      <section className="run-timeline" aria-labelledby={`${uid}-h`}>
        <h3 id={`${uid}-h`}>How the run unfolded</h3>
        <p className="tl-summary">{summary}</p>
        <p className="muted tl-empty">
          This run was too short, or began before the timeline was kept, so there is nothing to
          chart.
        </p>
      </section>
    )
  }

  const plotW = Math.max(120, width - PAD_LEFT - PAD_RIGHT)
  const x = (t: number) => PAD_LEFT + ((t - t0) / (t1 - t0)) * plotW
  const narrow = width < 480

  // Year spans for the x-axis: from the first sample and each new year.
  const yearMarks: { t: number; year: number }[] = [{ t: t0, year: samples[0][COL.year] }]
  for (const e of tl.events) {
    if (e.k === 'year' && e.t > t0 && e.t <= t1) yearMarks.push({ t: e.t, year: Number(e.d) })
  }

  const index = focus ?? samples.length - 1
  const sample = samples[index]
  const prevClock = index > 0 ? samples[index - 1][COL.clock] : -Infinity
  const near = tl.events.filter((e) => e.t > prevClock && e.t <= sample[COL.clock])

  // ---- pointer & keyboard ---------------------------------------------------
  /** The sample nearest to clock `t`. */
  const indexAt = (t: number) => {
    let best = 0
    for (let i = 1; i < samples.length; i++) {
      if (Math.abs(samples[i][COL.clock] - t) < Math.abs(samples[best][COL.clock] - t)) best = i
    }
    return best
  }
  const nearestIndex = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * width
    return indexAt(t0 + ((px - PAD_LEFT) / plotW) * (t1 - t0))
  }
  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    setFocus(nearestIndex(e.clientX, e.currentTarget.getBoundingClientRect()))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = samples.length - 1
    const step = e.shiftKey ? 5 : 1
    let next: number | null
    if (e.key === 'ArrowLeft') next = Math.max(0, index - step)
    else if (e.key === 'ArrowRight') next = Math.min(last, index + step)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = last
    else if (e.key === 'Escape') next = null
    else return
    e.preventDefault()
    setFocus(next)
  }

  // ---- shared chrome: storms, years, crosshair ------------------------------
  const plotBottom = (h: number) => PAD_TOP + h
  const stormRects = (top: number, h: number, labelled: boolean) =>
    storms.map(([a, b], i) => {
      const xa = x(Math.max(a, t0))
      const xb = x(Math.min(b, t1))
      if (xb <= xa) return null
      return (
        <g key={`s${i}`}>
          <rect className="tl-storm" x={xa} y={top} width={xb - xa} height={h} />
          {labelled && xb - xa >= 40 && (
            <text className="tl-storm-label" x={xa + 4} y={top + 11}>
              Storm
            </text>
          )}
        </g>
      )
    })
  const yearAxis = (top: number, bottom: number) => (
    <g>
      {yearMarks.map((m, i) => {
        const xa = x(m.t)
        const xb = i + 1 < yearMarks.length ? x(yearMarks[i + 1].t) : x(t1)
        const label = xb - xa >= 46 ? `Year ${m.year}` : xb - xa >= 18 ? `Y${m.year}` : ''
        return (
          <g key={`y${i}`}>
            {i > 0 && <line className="tl-grid" x1={xa} x2={xa} y1={top} y2={bottom} />}
            {label && (
              <text className="tl-axis" x={(xa + xb) / 2} y={bottom + 13} textAnchor="middle">
                {label}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
  const crosshair = (top: number, bottom: number) =>
    focus !== null && (
      <line
        className="tl-crosshair"
        x1={x(sample[COL.clock])}
        x2={x(sample[COL.clock])}
        y1={top}
        y2={bottom}
      />
    )

  // ---- the race --------------------------------------------------------------
  const yRace = (pct: number) => PAD_TOP + (1 - pct) * RACE_H
  const race = samples.map((smp) => raceAt(tl, smp, fallback))
  const repPts = samples.map(
    (smp, i) => [x(smp[COL.clock]), yRace(race[i].reputation)] as [number, number],
  )
  const impPts = samples.map(
    (smp, i) => [x(smp[COL.clock]), yRace(race[i].impatience)] as [number, number],
  )
  const endRep = repPts[repPts.length - 1]
  const endImp = impPts[impPts.length - 1]
  const labelsFit = Math.abs(endRep[1] - endImp[1]) >= 15
  /** End labels sit on the outside of the pair, unless that leaves the plot. */
  const labelY = (own: number, other: number) => {
    const above = own < other ? own - 7 >= PAD_TOP + 4 : own + 14 > PAD_TOP + RACE_H
    return above ? own - 7 : own + 14
  }
  const laneY = (track: number) => PAD_TOP + RACE_H + 9 + track * 13
  const clusters = clusterEvents(tl.events, x)
  const raceH = PAD_TOP + RACE_H + LANE_H + AXIS_H
  const kindsPresent = (Object.keys(MARKER_LABEL) as MarkerKind[]).filter((k) =>
    clusters.some((c) => c.kind === k),
  )
  const focusRace = race[index]

  const raceChart = (
    <svg
      viewBox={`0 0 ${width} ${raceH}`}
      className="tl-svg"
      aria-hidden="true"
      onPointerMove={onPointer}
      onPointerDown={onPointer}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setFocus(null)}
    >
      {stormRects(PAD_TOP, RACE_H + LANE_H, true)}
      {[0, 0.5, 1].map((p) => (
        <g key={p}>
          <line
            className={p === 0 ? 'tl-baseline' : 'tl-grid'}
            x1={PAD_LEFT}
            x2={PAD_LEFT + plotW}
            y1={yRace(p)}
            y2={yRace(p)}
          />
          <text className="tl-axis" x={PAD_LEFT - 6} y={yRace(p) + 3.5} textAnchor="end">
            {p * 100}%
          </text>
        </g>
      ))}
      {yearAxis(PAD_TOP, plotBottom(RACE_H + LANE_H))}
      <path className="tl-line is-impatience" d={linePath(impPts)} />
      <path className="tl-line is-reputation" d={linePath(repPts)} />
      {labelsFit && !narrow && (
        <>
          <text
            className="tl-direct"
            x={endRep[0] - 4}
            y={labelY(endRep[1], endImp[1])}
            textAnchor="end"
          >
            Reputation
          </text>
          <text
            className="tl-direct"
            x={endImp[0] - 4}
            y={labelY(endImp[1], endRep[1])}
            textAnchor="end"
          >
            Impatience
          </text>
        </>
      )}
      {clusters.map((c, i) => (
        <g key={`m${i}`}>
          <Marker kind={c.kind} x={c.x} y={laneY(c.track)} />
          {c.events.length > 1 && (
            <text className="tl-count" x={c.x + 7} y={laneY(c.track) + 3.5}>
              {c.events.length}
            </text>
          )}
        </g>
      ))}
      {crosshair(PAD_TOP, plotBottom(RACE_H + LANE_H))}
      {focus !== null && (
        <>
          <circle
            className="tl-dot is-impatience"
            cx={impPts[index][0]}
            cy={impPts[index][1]}
            r={4}
          />
          <circle
            className="tl-dot is-reputation"
            cx={repPts[index][0]}
            cy={repPts[index][1]}
            r={4}
          />
        </>
      )}
    </svg>
  )

  // ---- villagers: resolve vs threshold per species, then population ---------
  const species = tl.species
  const diffs = species.map((sp, si) =>
    samples.map((smp) => (smp[COL.species + si] ?? 0) - SPECIES[sp].resolveTarget),
  )
  const flat = diffs.flat()
  const lo = Math.min(-6, Math.floor(Math.min(...flat)) - 2)
  const hi = Math.max(6, Math.ceil(Math.max(...flat)) + 2)
  const rowTop = (r: number) => PAD_TOP + r * (ROW_TITLE + ROW_H + ROW_GAP) + ROW_TITLE
  const yRow = (r: number, v: number, min: number, max: number) =>
    rowTop(r) + (1 - (v - min) / (max - min)) * ROW_H
  const pops = samples.map((smp) => smp[COL.population])
  const popMax = Math.max(4, ...pops)
  const rows = species.length + 1
  const villagersH = PAD_TOP + rows * (ROW_TITLE + ROW_H + ROW_GAP) - ROW_GAP + AXIS_H
  const losses = tl.events.filter((e) => e.k === 'left' || e.k === 'lost')

  const villagersChart = (
    <svg
      viewBox={`0 0 ${width} ${villagersH}`}
      className="tl-svg"
      aria-hidden="true"
      onPointerMove={onPointer}
      onPointerDown={onPointer}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setFocus(null)}
    >
      {stormRects(PAD_TOP, villagersH - PAD_TOP - AXIS_H, false)}
      {yearAxis(PAD_TOP, villagersH - AXIS_H)}
      {species.map((sp, r) => {
        const def = SPECIES[sp]
        const leave = RESOLVE_LEAVE_THRESHOLD - def.resolveTarget
        const pts = diffs[r].map(
          (v, i) => [x(samples[i][COL.clock]), yRow(r, v, lo, hi)] as [number, number],
        )
        const gone = losses.filter((e) => e.d === sp)
        return (
          <g key={sp}>
            <text className="tl-row-title" x={PAD_LEFT} y={rowTop(r) - 5}>
              <Icon of={def} /> {def.name}
              {gone.length > 0 && <tspan className="tl-row-note"> · {gone.length} lost</tspan>}
            </text>
            {leave >= lo && (
              <>
                <rect
                  className="tl-despair"
                  x={PAD_LEFT}
                  width={plotW}
                  y={yRow(r, leave, lo, hi)}
                  height={rowTop(r) + ROW_H - yRow(r, leave, lo, hi)}
                />
                {yRow(r, leave, lo, hi) - yRow(r, 0, lo, hi) >= 11 && (
                  <text
                    className="tl-axis"
                    x={PAD_LEFT - 6}
                    y={yRow(r, leave, lo, hi) + 3.5}
                    textAnchor="end"
                  >
                    leaves
                  </text>
                )}
              </>
            )}
            <line
              className="tl-threshold"
              x1={PAD_LEFT}
              x2={PAD_LEFT + plotW}
              y1={yRow(r, 0, lo, hi)}
              y2={yRow(r, 0, lo, hi)}
            />
            <text
              className="tl-axis"
              x={PAD_LEFT - 6}
              y={yRow(r, 0, lo, hi) + 3.5}
              textAnchor="end"
            >
              0
            </text>
            {yRow(r, 0, lo, hi) - rowTop(r) >= 12 && (
              <text className="tl-axis" x={PAD_LEFT - 6} y={rowTop(r) + 8} textAnchor="end">
                {signed(hi)}
              </text>
            )}
            <path className="tl-line" style={{ stroke: def.color }} d={linePath(pts)} />
            {gone.map((e, i) => (
              <Marker key={i} kind="lost" x={x(e.t)} y={yRow(r, diffs[r][indexAt(e.t)], lo, hi)} />
            ))}
            {focus !== null && (
              <circle
                className="tl-dot"
                style={{ fill: def.color }}
                cx={pts[index][0]}
                cy={pts[index][1]}
                r={4}
              />
            )}
          </g>
        )
      })}
      {(() => {
        const r = species.length
        const pts = pops.map(
          (p, i) => [x(samples[i][COL.clock]), yRow(r, p, 0, popMax)] as [number, number],
        )
        return (
          <g>
            <text className="tl-row-title" x={PAD_LEFT} y={rowTop(r) - 5}>
              👥 Population
            </text>
            <line
              className="tl-baseline"
              x1={PAD_LEFT}
              x2={PAD_LEFT + plotW}
              y1={rowTop(r) + ROW_H}
              y2={rowTop(r) + ROW_H}
            />
            <text className="tl-axis" x={PAD_LEFT - 6} y={rowTop(r) + ROW_H + 3.5} textAnchor="end">
              0
            </text>
            <text className="tl-axis" x={PAD_LEFT - 6} y={rowTop(r) + 8} textAnchor="end">
              {popMax}
            </text>
            <path className="tl-line is-population" d={linePath(pts)} />
            {focus !== null && (
              <circle
                className="tl-dot is-population"
                cx={pts[index][0]}
                cy={pts[index][1]}
                r={4}
              />
            )}
          </g>
        )
      })()}
      {crosshair(PAD_TOP, villagersH - AXIS_H)}
    </svg>
  )

  // ---- readout ---------------------------------------------------------------
  const when = (
    <span className="tl-when">
      {focus === null ? 'At the end' : `Year ${sample[COL.year]}`} ·{' '}
      {formatClock(sample[COL.clock], Math.round)}
      {inStorm(storms, sample[COL.clock]) ? ' · Storm' : ''}
    </span>
  )
  const readout: ReactNode =
    view === 'race' ? (
      <>
        {when}
        <span className="tl-value">
          <i className="tl-key is-reputation" aria-hidden="true" />
          <b>
            {fmt1(Math.min(sample[COL.reputation], focusRace.maxRep))}/{focusRace.maxRep}
          </b>{' '}
          reputation
        </span>
        <span className="tl-value">
          <i className="tl-key is-impatience" aria-hidden="true" />
          <b>
            {fmt1(Math.min(sample[COL.impatience], focusRace.maxImp))}/{focusRace.maxImp}
          </b>{' '}
          impatience
        </span>
        <span className="tl-value">
          <b>{Math.round(sample[COL.hostility])}</b> hostility
        </span>
      </>
    ) : (
      <>
        {when}
        {species.map((sp, si) => (
          <span className="tl-value" key={sp}>
            <i className="tl-key" style={{ background: SPECIES[sp].color }} aria-hidden="true" />
            <b>{signed(diffs[si][index])}</b> {SPECIES[sp].name.toLowerCase()}
          </span>
        ))}
        <span className="tl-value">
          <b>{sample[COL.population]}</b> villagers
        </span>
        <span className="tl-value">
          <b>{sample[COL.food]}</b> food · <b>{sample[COL.wood]}</b> wood
        </span>
      </>
    )
  const nearText = summariseEvents(near)

  const describedBy = `${uid}-sum`
  return (
    <section className="run-timeline" aria-labelledby={`${uid}-h`}>
      <div className="tl-head">
        <h3 id={`${uid}-h`}>How the run unfolded</h3>
        <div className="tl-switch" role="group" aria-label="Chart view">
          {(
            [
              ['race', 'The race'],
              ['villagers', 'Villagers'],
            ] as [View, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              className={view === id ? 'is-active' : ''}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="tl-summary" id={describedBy}>
        {summary}
      </p>
      <p className="tl-subtitle">
        {view === 'race'
          ? 'Reputation and impatience as a share of their goals — whichever fills first decides the run.'
          : 'Resolve above or below the reputation threshold (0) for each species, and population.'}
      </p>

      <div
        ref={wrapRef}
        className="tl-plot"
        tabIndex={0}
        role="img"
        aria-label={`${view === 'race' ? 'Reputation and impatience' : 'Resolve per species and population'} over the run. Use the arrow keys to step through time.`}
        aria-describedby={describedBy}
        onKeyDown={onKey}
      >
        {view === 'race' ? raceChart : villagersChart}
      </div>

      <div className="tl-readout" aria-live="polite">
        {readout}
        {nearText && <span className="tl-near">{nearText}</span>}
      </div>

      {view === 'race' && (
        <ul className="tl-legend" aria-label="Legend">
          <li>
            <i className="tl-key is-reputation" aria-hidden="true" /> Reputation
          </li>
          <li>
            <i className="tl-key is-impatience" aria-hidden="true" /> Impatience
          </li>
          {storms.length > 0 && (
            <li>
              <i className="tl-swatch" aria-hidden="true" /> Storm
            </li>
          )}
          {kindsPresent.map((k) => (
            <li key={k}>
              <LegendMarker kind={k} /> {MARKER_LABEL[k]}
            </li>
          ))}
        </ul>
      )}

      <details className="tl-table">
        <summary>Show the numbers</summary>
        <div className="tl-table-scroll">
          <table>
            <caption>Key moments</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">What happened</th>
              </tr>
            </thead>
            <tbody>
              {tl.events
                .filter((e) => e.k !== 'glade')
                .map((e, i) => (
                  <tr key={i}>
                    <td>{formatClock(e.t, Math.round)}</td>
                    <td>{eventLabel(e)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="tl-table-scroll">
          <table>
            <caption>Samples</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Year</th>
                <th scope="col">Reputation</th>
                <th scope="col">Impatience</th>
                <th scope="col">Hostility</th>
                <th scope="col">Villagers</th>
                {species.map((sp) => (
                  <th scope="col" key={sp}>
                    {SPECIES[sp].name} vs threshold
                  </th>
                ))}
                <th scope="col">Food</th>
                <th scope="col">Wood</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((smp, i) => (
                <tr key={i}>
                  <td>{formatClock(smp[COL.clock], Math.round)}</td>
                  <td>{smp[COL.year]}</td>
                  <td>
                    {fmt1(Math.min(smp[COL.reputation], race[i].maxRep))}/{race[i].maxRep}
                  </td>
                  <td>
                    {fmt1(Math.min(smp[COL.impatience], race[i].maxImp))}/{race[i].maxImp}
                  </td>
                  <td>{Math.round(smp[COL.hostility])}</td>
                  <td>{smp[COL.population]}</td>
                  {species.map((sp, si) => (
                    <td key={sp}>{signed(diffs[si][i])}</td>
                  ))}
                  <td>{smp[COL.food]}</td>
                  <td>{smp[COL.wood]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

