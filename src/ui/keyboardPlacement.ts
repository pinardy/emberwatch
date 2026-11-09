import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { BUILDINGS } from '../game/content/buildings'
import { canPlaceBuilding, findPlacement } from '../game/engine/actions'
import { dist } from '../game/engine/geometry'
import { describePlacement } from '../game/engine/placement'
import { ROAD_TOOL } from '../game/engine/roads'
import { useGameStore } from '../game/store'
import type { RunState, Vec2 } from '../game/types'
import { isMapKeyIgnored, placementHint } from './mapShared'

/**
 * Placing a blueprint without a pointer, on either map.
 *
 * While a building is in hand the arrow keys move a keyboard ghost (snapping
 * to the next spot the building could actually stand on, in steps the active
 * map chooses), Enter places it and Esc cancels (Esc lives with the other
 * hotkeys). Each move's verdict — the same hint the pointer ghost shows — is
 * announced through a polite live region in the build banner. The banner also
 * offers "Place at the nearest valid spot", the one-press path.
 *
 * The active renderer registers a `PlacementView` (where its camera looks,
 * which way is "up" on screen, the step that suits it, and how to keep a spot
 * in view) and draws `useKeyGhost`'s spot with its own ghost.
 */

export type PlacementDirection = 'up' | 'down' | 'left' | 'right'

export interface PlacementView {
  /** The world point at the centre of the view. */
  centre: () => Vec2
  /** World directions of screen-up and screen-right (unit vectors). */
  axes: () => { up: Vec2; right: Vec2 }
  /** One arrow press, in world units. */
  step: () => number
  /** Brings the spot into view if it has left it. */
  reveal: (pos: Vec2) => void
}

let activeView: PlacementView | null = null

/** Registers the mounted map's view for keyboard placement. */
export function usePlacementView(view: PlacementView): void {
  const latest = useRef(view)
  latest.current = view
  useEffect(() => {
    const proxy: PlacementView = {
      centre: () => latest.current.centre(),
      axes: () => latest.current.axes(),
      step: () => latest.current.step(),
      reveal: (p) => latest.current.reveal(p),
    }
    activeView = proxy
    return () => {
      if (activeView === proxy) activeView = null
    }
  }, [])
}

export interface KeyGhost {
  pos: Vec2
  ok: boolean
  hint: string | null
}

interface KeyGhostState {
  /** The keyboard-aimed spot, or null until an arrow key is pressed. */
  ghost: KeyGhost | null
  /** What the live region says; `seq` makes a repeated sentence re-announce. */
  announcement: string
  seq: number
}

export const useKeyGhost = create<KeyGhostState>(() => ({ ghost: null, announcement: '', seq: 0 }))

export function announcePlacement(text: string): void {
  const { seq } = useKeyGhost.getState()
  useKeyGhost.setState({ announcement: text, seq: seq + 1 })
}

export function resetKeyGhost(): void {
  useKeyGhost.setState({ ghost: null, announcement: '', seq: 0 })
}

/** The building in hand (not the road tool), or null. */
function heldBuilding(): { run: RunState; defId: string } | null {
  const { run, buildMode } = useGameStore.getState()
  if (!run || !buildMode || buildMode === ROAD_TOOL || !BUILDINGS[buildMode]) return null
  return { run, defId: buildMode }
}

/**
 * A copy of the run that can afford `defId`, so snapping finds where the
 * building could stand even while the materials are still short (the hint
 * still says so).
 */
function affordable(run: RunState, defId: string): RunState {
  return { ...run, stock: { ...run.stock, ...BUILDINGS[defId].cost } }
}

/** True when the building could stand at `pos` (materials aside). */
function isSite(probe: RunState, defId: string, pos: Vec2): boolean {
  return canPlaceBuilding(probe, defId, pos) === null
}

/** The verdict at a spot, worded as the pointer ghost words it. */
export function evaluateSpot(run: RunState, defId: string, pos: Vec2): KeyGhost {
  const reason = canPlaceBuilding(run, defId, pos)
  const parts = describePlacement(run, defId, pos).parts
  return { pos, ok: reason === null, hint: placementHint(reason, parts) }
}

/** "Can place here: +25% farming" / "Cannot place here: Too close to another building." */
export function spokenVerdict(ghost: KeyGhost): string {
  const head = ghost.ok ? 'Can place here' : 'Cannot place here'
  return ghost.hint ? `${head}: ${ghost.hint}` : `${head}.`
}

const SEARCH_SPACING = 0.5

/**
 * The closest spot to `from` where the building could stand; null only when
 * the engine could not place it anywhere either.
 *
 * A half-pace grid out to `maxRadius` comes first, nearest ring first. Valid
 * ground can be a sliver the grid steps over (a camp's few spots between its
 * deposits, the buildings already there and the rough ground), so when the
 * grid finds nothing the engine's own search answers: its rings around `from`
 * and around the building's deposits (or the hearth), keeping whichever spot
 * lies nearest `from`.
 */
export function nearestValidSpot(
  run: RunState,
  defId: string,
  from: Vec2,
  maxRadius = Math.max(run.world.width, run.world.height),
): Vec2 | null {
  const probe = affordable(run, defId)
  if (isSite(probe, defId, from)) return { x: from.x, y: from.y }
  const rings = Math.ceil(maxRadius / SEARCH_SPACING)
  for (let ring = 1; ring <= rings; ring++) {
    // Every grid point on this square ring, nearest first.
    const points: Vec2[] = []
    for (let i = -ring; i <= ring; i++) {
      points.push({ x: i, y: -ring }, { x: i, y: ring })
      if (i > -ring && i < ring) points.push({ x: -ring, y: i }, { x: ring, y: i })
    }
    points.sort((a, b) => a.x * a.x + a.y * a.y - (b.x * b.x + b.y * b.y))
    for (const p of points) {
      const pos = { x: from.x + p.x * SEARCH_SPACING, y: from.y + p.y * SEARCH_SPACING }
      if (isSite(probe, defId, pos)) return pos
    }
  }
  const within = (p: Vec2) => Math.max(Math.abs(p.x - from.x), Math.abs(p.y - from.y)) <= maxRadius
  const candidates = [findPlacement(probe, defId, from), findPlacement(probe, defId)].filter(
    (p): p is Vec2 => p !== null && within(p) && isSite(probe, defId, p),
  )
  if (candidates.length === 0) return null
  return candidates.reduce((best, p) => (dist(p, from) < dist(best, from) ? p : best))
}

/**
 * One arrow press from `from`: the first spot along `dir` (a step at a time,
 * up to sixteen steps, nudging a little to either side) where the building
 * could stand — so the ghost hops over deposits, buildings and rough ground
 * to the next place it can actually go. Null when there is none that way.
 */
export function stepSpot(
  run: RunState,
  defId: string,
  from: Vec2,
  dir: Vec2,
  step: number,
): Vec2 | null {
  const probe = affordable(run, defId)
  const side = { x: -dir.y, y: dir.x }
  for (let k = 1; k <= 16; k++) {
    for (const lateral of [0, 0.5, -0.5, 1, -1]) {
      const pos = {
        x: from.x + dir.x * step * k + side.x * step * lateral,
        y: from.y + dir.y * step * k + side.y * step * lateral,
      }
      if (isSite(probe, defId, pos)) return pos
    }
  }
  return null
}

function setKeyGhost(run: RunState, defId: string, pos: Vec2): KeyGhost {
  const ghost = evaluateSpot(run, defId, pos)
  // Pan first, so the renderer draws the ghost where it now is on screen.
  activeView?.reveal(pos)
  useKeyGhost.setState({ ghost })
  announcePlacement(spokenVerdict(ghost))
  return ghost
}

function startingSpot(run: RunState, defId: string): Vec2 {
  const centre = activeView?.centre() ?? { x: 0, y: 0 }
  return nearestValidSpot(run, defId, centre) ?? centre
}

/** Moves the keyboard ghost one press in a screen direction. */
export function moveKeyGhost(direction: PlacementDirection): void {
  const held = heldBuilding()
  if (!held) return
  const { run, defId } = held
  const current = useKeyGhost.getState().ghost
  // The first press shows the ghost at the nearest spot to the view's centre.
  if (!current) {
    setKeyGhost(run, defId, startingSpot(run, defId))
    return
  }
  const axes = activeView?.axes() ?? { up: { x: 0, y: -1 }, right: { x: 1, y: 0 } }
  const dir =
    direction === 'up'
      ? axes.up
      : direction === 'down'
        ? { x: -axes.up.x, y: -axes.up.y }
        : direction === 'right'
          ? axes.right
          : { x: -axes.right.x, y: -axes.right.y }
  const step = activeView?.step() ?? 1
  const next = stepSpot(run, defId, current.pos, dir, step)
  if (!next) {
    // The ghost stays where it is: say so, and what that spot is like.
    announcePlacement(`Nothing free further ${direction}. ${spokenVerdict(evaluateSpot(run, defId, current.pos))}`)
    return
  }
  setKeyGhost(run, defId, next)
}

/** Places the building at `pos` and says what happened. */
function placeAt(run: RunState, defId: string, pos: Vec2): boolean {
  const before = Object.keys(run.buildings).length
  useGameStore.getState().place(pos)
  const placed = Object.keys(run.buildings).length > before
  const name = BUILDINGS[defId].name
  if (placed) {
    const ghost = evaluateSpot(run, defId, pos)
    useKeyGhost.setState({ ghost })
    announcePlacement(`${name} placed. Arrow keys choose the next spot; Esc puts the blueprint away.`)
  } else {
    announcePlacement(spokenVerdict(evaluateSpot(run, defId, pos)))
  }
  return placed
}

/** Enter: places at the keyboard ghost (showing it first if it is not up yet). */
export function placeAtKeyGhost(): void {
  const held = heldBuilding()
  if (!held) return
  const ghost = useKeyGhost.getState().ghost
  if (!ghost) {
    setKeyGhost(held.run, held.defId, startingSpot(held.run, held.defId))
    return
  }
  placeAt(held.run, held.defId, ghost.pos)
}

/**
 * The simple path: place at the valid spot nearest the keyboard ghost, or the
 * centre of the view, and bring it into view.
 */
export function placeAtNearest(): void {
  const held = heldBuilding()
  if (!held) return
  const { run, defId } = held
  const from = useKeyGhost.getState().ghost?.pos ?? activeView?.centre() ?? { x: 0, y: 0 }
  const spot = nearestValidSpot(run, defId, from)
  if (!spot) {
    announcePlacement(`There is nowhere left to put a ${BUILDINGS[defId].name}.`)
    useGameStore.setState({ notice: `There is nowhere left to put a ${BUILDINGS[defId].name}.` })
    return
  }
  activeView?.reveal(spot)
  placeAt(run, defId, spot)
}

const ARROWS: Record<string, PlacementDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

/** Widgets that use the arrow keys themselves. */
const OWN_ARROWS =
  '.glade-list, .building-list, [role="tablist"], [role="radiogroup"], [role="listbox"], [role="menu"], [role="slider"], [role="grid"], [role="tree"]'

/** Elements Enter activates by itself. */
const OWN_ENTER = 'button, a[href], summary, input, select, textarea, [role="button"], [role="tab"], [role="link"]'

/**
 * The keys of keyboard placement, while a building is in hand. Registered on
 * the window in the capture phase so the arrows move the ghost rather than
 * the camera (WASD still pans); widgets with arrow keys of their own, and
 * Enter on a focused control, are left alone.
 */
export function useKeyboardPlacement(): void {
  const buildMode = useGameStore((s) => s.buildMode)
  const active = !!buildMode && buildMode !== ROAD_TOOL

  // A fresh blueprint starts without a keyboard ghost.
  useEffect(() => {
    resetKeyGhost()
  }, [buildMode])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (isMapKeyIgnored(e) || e.shiftKey) return
      const target = e.target as Element | null
      const el = target && target.nodeType === 1 ? target : null
      const direction = ARROWS[e.key]
      if (direction) {
        if (el?.closest(OWN_ARROWS)) return
        e.preventDefault()
        e.stopPropagation()
        moveKeyGhost(direction)
        return
      }
      if (e.key === 'Enter') {
        if (el?.closest(OWN_ENTER)) return
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) placeAtKeyGhost()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active])
}
