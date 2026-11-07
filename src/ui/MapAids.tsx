import { memo, useId, useRef, useState, type ReactNode } from 'react'
import { BUILDINGS } from '../game/content/buildings'
import { displayName, workerSlotsOf } from '../game/engine/upgrades'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import { requestInspectorFocus } from './focusRequests'
import { GladeList } from './map3d/GladeList'
import { buildingLayer, gladePlateKey, useRunKey, type BuildingView } from './map3d/layerKeys'
import { STATUS_BADGE, gladeAccess, gladeLook, useHudValue, useMapKey } from './mapShared'
import { useEscapeLayer } from './useGameLoop'

/**
 * What the keyboard and screen readers have in place of pointing at the map,
 * shared by both renderers: a short live summary, the glade list, the
 * building list, the hearth hotkey and the controls help.
 */

/** Hotkey that opens the hearth (H is taken by "camera home"). */
export const HEARTH_KEY = { code: 'KeyF', label: 'F' } as const

/** Opens the hearth in the Inspector, glides the camera there and focuses it. */
export function inspectHearth(): void {
  const store = useGameStore.getState()
  const hearth = Object.values(store.run?.buildings ?? {}).find(
    (b) => BUILDINGS[b.defId]?.category === 'hearth',
  )
  if (!hearth) return
  store.setBuildMode(null)
  store.focusCamera(hearth.pos)
  store.selectBuilding(hearth.id)
  requestInspectorFocus()
}

/**
 * A one-Tab-stop list whose items move with the arrow keys, Home and End,
 * like a toolbar; Enter (or a click) picks the item.
 */
function useRovingList(count: number) {
  const [active, setActive] = useState(0)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const current = Math.max(0, Math.min(active, count - 1))
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>, pick: (i: number) => void) => {
    const last = count - 1
    const step: Record<string, number> = {
      ArrowDown: Math.min(last, current + 1),
      ArrowRight: Math.min(last, current + 1),
      ArrowUp: Math.max(0, current - 1),
      ArrowLeft: Math.max(0, current - 1),
      Home: 0,
      End: last,
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      pick(current)
      return
    }
    if (!(e.key in step)) return
    // The arrows move through the list, not the camera or a build ghost.
    e.preventDefault()
    e.stopPropagation()
    setActive(step[e.key])
    buttons.current[step[e.key]]?.focus()
  }
  return { current, setActive, buttons, onKeyDown }
}

const PROBLEM_FIRST: Record<string, number> = {
  noWorkers: 0,
  noDeposit: 1,
  storageFull: 2,
  waitingInputs: 3,
  offSeason: 4,
  paused: 5,
  construction: 6,
  working: 7,
  none: 8,
}

/** "No workers · 0/2 workers · cold": a building's state in words. */
export function buildingStateWords(view: BuildingView): string {
  const words: string[] = []
  const badge = view.status !== 'none' ? STATUS_BADGE[view.status] : null
  if (badge) {
    words.push(
      view.status === 'construction' ? `${badge.label}, ${Math.round(view.progress * 100)}%` : badge.label,
    )
  }
  const slots = workerSlotsOf(view.building)
  if (slots > 0) words.push(`${view.workers}/${slots} workers`)
  if (view.cold) words.push('cold')
  return words.join(' · ')
}

function chooseBuilding(view: BuildingView): void {
  const store = useGameStore.getState()
  store.focusCamera(view.building.pos)
  store.selectBuilding(view.building.id)
  requestInspectorFocus()
}

/**
 * Every building on the map for the keyboard: one Tab stop, hidden until it
 * has focus (like the glade list), the hearth first and then whatever needs
 * attention. Enter picks a building as clicking it would, glides the camera
 * there and moves focus to the Inspector.
 */
export const BuildingList = memo(function BuildingList() {
  const views = useHudValue(buildingLayer) ?? []
  const selected = useGameStore((s) => s.selectedBuilding)
  const hintId = useId()
  const sorted = [...views].sort((a, b) => {
    const ha = BUILDINGS[a.building.defId]?.category === 'hearth' ? -1 : 0
    const hb = BUILDINGS[b.building.defId]?.category === 'hearth' ? -1 : 0
    if (ha !== hb) return ha - hb
    const pa = PROBLEM_FIRST[a.status] ?? 9
    const pb = PROBLEM_FIRST[b.status] ?? 9
    if (pa !== pb) return pa - pb
    return displayName(a.building).localeCompare(displayName(b.building))
  })
  const { current, setActive, buttons, onKeyDown } = useRovingList(sorted.length)
  if (sorted.length === 0) return null
  return (
    <nav className="building-list map-list" aria-label="Buildings" aria-describedby={hintId}>
      <p id={hintId} className="glade-list-hint">
        Buildings: ↑ ↓ to move, Enter to inspect
      </p>
      <ul onKeyDown={(e) => onKeyDown(e, (i) => chooseBuilding(sorted[i]))}>
        {sorted.map((view, i) => {
          const state = buildingStateWords(view)
          return (
            <li key={view.building.id}>
              <button
                ref={(el) => {
                  buttons.current[i] = el
                }}
                type="button"
                tabIndex={i === current ? 0 : -1}
                aria-current={selected === view.building.id ? 'true' : undefined}
                onFocus={() => setActive(i)}
                onClick={() => chooseBuilding(view)}
              >
                <strong>{displayName(view.building)}</strong>
                {state && <small>{state}</small>}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
})

/** The summary's sentence, from counts only, so it changes only when they do. */
export function mapSummaryText(run: RunState, views: readonly BuildingView[]): string {
  let reachable = 0
  let clearing = 0
  for (const glade of Object.values(run.glades)) {
    if (gladeLook(glade) !== 'fogged') continue
    const access = gladeAccess(run, glade)
    if (access === 'reachable') reachable++
    else if (access === 'clearing') clearing++
  }
  const short = views.filter((v) => v.status === 'noWorkers').length
  const threats = run.threats.map((t) => t.name)
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const parts = [
    `${plural(reachable, 'glade', 'glades')} in reach${clearing > 0 ? `, ${clearing} being cleared` : ''}.`,
    short > 0
      ? `${plural(short, 'building needs', 'buildings need')} workers.`
      : 'Every workplace has workers.',
    threats.length > 0
      ? `${plural(threats.length, 'threat', 'threats')} loose: ${threats.join(', ')}.`
      : 'No threats.',
  ]
  return parts.join(' ')
}

/**
 * A short spoken overview of the map — glades in reach, buildings short of
 * workers, threats loose — that updates politely when one of those counts
 * changes (never on a timer).
 */
const MapSummary = memo(function MapSummary({ run }: { run: RunState }) {
  useRunKey(gladePlateKey)
  useRunKey((r) => r.threats.map((t) => t.id).join(','))
  const views = useHudValue(buildingLayer) ?? []
  return (
    <p className="sr-only map-summary" role="status">
      {mapSummaryText(run, views)}
    </p>
  )
})

/** The lists, the summary and the hearth hotkey, for either map. */
export function MapAids({ run }: { run: RunState }) {
  useMapKey(HEARTH_KEY.code, inspectHearth)
  return (
    <div className="map-aids">
      <MapSummary run={run} />
      <GladeList run={run} />
      <BuildingList />
    </div>
  )
}

/** The controls help: its "?" map button and the panel it opens. */
export function useControlsHelp(renderer: '2d' | '3d'): { button: ReactNode; panel: ReactNode } {
  const [open, setOpen] = useState(false)
  useEscapeLayer(open, () => setOpen(false))
  const button = (
    <button
      type="button"
      aria-label="Controls help"
      aria-expanded={open}
      aria-controls="controls-help"
      title="Controls (Esc closes)"
      className={open ? 'is-active' : ''}
      onClick={() => setOpen((v) => !v)}
    >
      ?
    </button>
  )
  const panel = open ? (
    <div className="controls-help" id="controls-help" role="dialog" aria-labelledby="controls-help-title">
      <strong id="controls-help-title">Controls</strong>
      <ul>
        {renderer === '3d' ? (
          <>
            <li><em>Pan</em> — drag · WASD / arrows · mouse at edge</li>
            <li><em>Rotate</em> — right-drag · Q / E</li>
            <li><em>Zoom</em> — wheel toward cursor · pinch · + / −</li>
            <li><em>Home</em> — H or ⌖ · <em>North</em> — 🧭</li>
          </>
        ) : (
          <>
            <li><em>Pan</em> — drag · WASD / arrows</li>
            <li><em>Zoom</em> — wheel · pinch · + / −</li>
            <li><em>Home</em> — H or ⌖</li>
          </>
        )}
        <li><em>Warmth radius</em> — R or 🔥</li>
        <li><em>Hearth</em> — {HEARTH_KEY.label} or the Hearth button: the Architect, dumping and upgrades</li>
        <li><em>Select</em> — click · <em>Deselect / cancel</em> — right-click or Esc</li>
        <li><em>Glades and buildings</em> — Tab to their lists, arrows to move, Enter to inspect</li>
        <li><em>Place a building</em> — arrows move the ghost, Enter places, Esc cancels, or “Place at the nearest valid spot”</li>
        {renderer === '3d' && <li><em>Jump</em> — click the minimap</li>}
        <li><em>Pause</em> — Space · <em>Speed</em> — 1 / 2 / 3 / 4 / 5</li>
        <li><em>Panels</em> — B build · P people · O orders · T trade · L log</li>
        <li><em>Close</em> — Esc closes this help and tips</li>
      </ul>
      <button type="button" onClick={() => setOpen(false)}>
        Close
      </button>
    </div>
  ) : null
  return { button, panel }
}
