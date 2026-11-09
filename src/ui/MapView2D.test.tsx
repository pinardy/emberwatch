import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { findPlacement, isReachable } from '../game/engine/actions'
import { loadSettings } from '../game/persistence'
import { HUD_INTERVAL_MS, useGameStore } from '../game/store'
import { showFoundedRun } from '../test/foundedRun'
import { GameScreen } from './GameScreen'
import type { RunState } from '../game/types'
import { gladeEdgeGeometry, mapStats, useStaticGeometry } from './map3d/staticGeometry'
import { districtOf, SPARED_STYLE, useHudValue, useMapOverlays } from './mapShared'
import { buildingViews, roadKey } from './map3d/layerKeys'
import { labelTile } from './map3d/sprites'
import { roadGeometry } from './map3d/Roads'
import { ROAD_TOOL, placeRoad } from '../game/engine/roads'
import { DISTRICT_STYLE, obstacleTitle, plateShape } from './map2dArt'
import { BUILDINGS } from '../game/content/buildings'
import { iconSymbolId } from './Icon'
import type { IconId } from '../art/icons'

/**
 * Map renderer checks that need a DOM: static geometry survives sim ticks,
 * and the 2D fallback carries the same visual states as the 3D scene.
 */

function currentRun(): RunState {
  const run = useGameStore.getState().run
  if (!run) throw new Error('expected a run to be in progress')
  return run
}

/**
 * A founded run on the game screen. The founding itself (and the map beside
 * it) is tested through the whole app below and in App.test.tsx.
 */
function startGame() {
  showFoundedRun()
  render(<GameScreen />)
}

beforeEach(() => {
  localStorage.clear()
  useMapOverlays.setState({ showWarmth: false })
  useGameStore.setState({
    // What the app's boot reads from the (cleared) storage.
    settings: loadSettings(),
    screen: 'menu',
    run: null,
    speed: 0,
    buildMode: null,
    selectedBuilding: null,
    selectedDeposit: null,
    selectedGlade: null,
    panel: 'build',
    notice: null,
  })
})

afterEach(cleanup)

describe('static map geometry', () => {
  it('is built once and survives re-renders driven by sim ticks', () => {
    useGameStore.getState().startRun(77)
    const glade = Object.values(currentRun().glades)[0]
    const created = mapStats.geometriesCreated
    const { result, rerender, unmount } = renderHook(() => {
      // Subscribe to the tick counter the way a careless layer would.
      useGameStore((s) => s.version)
      return useStaticGeometry(() => gladeEdgeGeometry(glade.polygon, null, 0.2), [glade.polygon])
    })
    const first = result.current
    expect(mapStats.geometriesCreated).toBe(created + 1)

    act(() => {
      const store = useGameStore.getState()
      for (const choice of [...currentRun().pendingChoices]) store.chooseOption(choice.options[0])
      store.setSpeed(1)
      for (let i = 0; i < 10; i++) useGameStore.getState().advance(0.25)
    })
    rerender()
    expect(useGameStore.getState().version).toBeGreaterThan(2)
    expect(result.current).toBe(first)
    expect(mapStats.geometriesCreated).toBe(created + 1)

    let disposed = false
    first.addEventListener('dispose', () => {
      disposed = true
    })
    unmount()
    expect(disposed).toBe(true)
  })
})

/** Lays a short road out from the hearth wherever the ground allows. */
function laySomeRoad(run: RunState): void {
  run.stock.wood = Math.max(run.stock.wood ?? 0, 40)
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2
    const at = (r: number) => ({ x: Math.cos(angle) * r, y: Math.sin(angle) * r })
    if (placeRoad(run, at(1.2), at(2.8)) === null) return
  }
  throw new Error('no clear ground for a road beside the hearth')
}

function tickSome(n = 10) {
  act(() => {
    const store = useGameStore.getState()
    store.setSpeed(1)
    for (let i = 0; i < n; i++) useGameStore.getState().advance(0.25)
  })
}

describe('roads and villagers on the maps', () => {
  it('road geometry is built once and survives sim ticks', () => {
    useGameStore.getState().startRun(77)
    const store = useGameStore.getState()
    for (const choice of [...currentRun().pendingChoices]) store.chooseOption(choice.options[0])
    laySomeRoad(currentRun())
    const created = mapStats.geometriesCreated
    const { result, rerender } = renderHook(() => {
      useGameStore((s) => s.version)
      const run = currentRun()
      return useStaticGeometry(() => roadGeometry(run.roads ?? []), [roadKey(run)])
    })
    const first = result.current
    tickSome()
    rerender()
    expect(useGameStore.getState().version).toBeGreaterThan(2)
    expect(result.current).toBe(first)
    expect(mapStats.geometriesCreated).toBe(created + 1)
  })

  it('draws roads and a dot per villager, and keeps them across ticks', () => {
    startGame()
    act(() => laySomeRoad(currentRun()))
    tickSome(2)
    const lines = document.querySelectorAll('g.roads-2d line')
    expect(lines.length).toBeGreaterThan(0)
    // Villagers walk on a canvas over the SVG: one route (dot) per villager.
    const canvas = document.querySelector('canvas.villagers-2d')
    expect(canvas).not.toBeNull()
    expect(Number(canvas!.getAttribute('data-villagers'))).toBe(
      Object.keys(currentRun().villagers).length,
    )
    // Nothing per villager is left in the SVG to lay out every frame.
    expect(document.querySelectorAll('svg.map circle.villager-dot').length).toBe(0)
    const building = document.querySelector('g.building')
    tickSome()
    // Memoised layers: the same DOM nodes, not re-created per tick.
    expect(document.querySelectorAll('g.roads-2d line')[0]).toBe(lines[0])
    expect(document.querySelector('canvas.villagers-2d')).toBe(canvas)
    expect(document.querySelector('g.building')).toBe(building)
  })

  it('lays a road with clicks through the store and ends it with Esc', () => {
    startGame()
    act(() => useGameStore.getState().setBuildMode(ROAD_TOOL))
    expect(screen.getByText(/Laying a road/)).toBeTruthy()
    const run = currentRun()
    run.stock.wood = 60
    const before = run.roads?.length ?? 0
    // Start on the hearth (snaps to its centre), then bend out to clear ground.
    act(() => useGameStore.getState().place({ x: 0.3, y: 0.2 }))
    expect(useGameStore.getState().roadAnchor).toEqual({ x: 0, y: 0 })
    let laid = false
    for (let i = 0; i < 16 && !laid; i++) {
      const angle = (i / 16) * Math.PI * 2
      act(() => useGameStore.getState().place({ x: Math.cos(angle) * 2.6, y: Math.sin(angle) * 2.6 }))
      laid = (currentRun().roads?.length ?? 0) > before
    }
    expect(laid).toBe(true)
    expect(useGameStore.getState().roadAnchor).not.toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useGameStore.getState().roadAnchor).toBeNull()
    expect(useGameStore.getState().buildMode).toBe(ROAD_TOOL)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useGameStore.getState().buildMode).toBeNull()
  })
})

describe('2D map parity', () => {
  it('labels fogged glades by kind and access', () => {
    startGame()
    const labels = Array.from(document.querySelectorAll('g.glade-label'))
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) {
      expect(label.querySelector('.glade-kind')?.textContent).toMatch(/Small|Dangerous|Forbidden/)
      expect(label.getAttribute('class')).toMatch(/is-(locked|reachable|clearing)/)
    }
    // Fogged glades get a kind border.
    expect(document.querySelectorAll('g.glade-edge').length).toBe(labels.length)
  })

  it('marks a glade left to the forest on its plate, border and ground', () => {
    startGame()
    const run = currentRun()
    const glade = Object.values(run.glades).find(
      (g) => g.discovered && !g.cleared && g.kind !== 'settlement' && isReachable(run, g.id),
    )!
    const label = () =>
      Array.from(document.querySelectorAll('g.glade-label')).find((l) =>
        l.querySelector('.glade-name')?.textContent === glade.name,
      )!
    expect(label().getAttribute('class')).not.toMatch(/is-spared/)
    act(() => useGameStore.getState().spareGlade(glade.id))
    // The plate says so in a line of its own, with a trees badge, and drops
    // its stake chips: what clearing would bring is moot while it stands.
    expect(label().getAttribute('class')).toMatch(/is-spared/)
    const line = label().querySelector('.glade-spared-line')!
    expect(line.textContent).toBe('Left to the forest')
    expect(line.querySelector(`use[href="#${iconSymbolId('trees')}"]`)).not.toBeNull()
    expect(label().querySelectorAll('.glade-stake-full, .glade-stake-dot').length).toBe(0)
    // Its kind is still named, in a muted voice.
    expect(label().querySelector('.glade-kind')?.textContent).toMatch(/Small|Dangerous|Forbidden/)
    // A soft, solid leaf-green border and a mossy wash.
    const edge = document.querySelector('g.glade-edge.is-spared > polygon')!
    expect(edge.getAttribute('stroke')).toBe(SPARED_STYLE.edge)
    expect(Number(edge.getAttribute('stroke-opacity'))).toBeLessThan(0.9)
    expect(edge.getAttribute('stroke-dasharray')).toBeNull()
    const poly = Array.from(document.querySelectorAll('polygon.glade-poly')).find(
      (p) => p.getAttribute('fill') === SPARED_STYLE.fog,
    )
    expect(poly).toBeTruthy()
    // Breaking the truce restores the ordinary plate.
    act(() => useGameStore.getState().reclaimGlade(glade.id))
    expect(label().getAttribute('class')).not.toMatch(/is-spared/)
    expect(label().querySelector('.glade-spared-line')).toBeNull()
  })

  it('toggles the warmth radius with R and the 🔥 button', () => {
    startGame()
    const ring = () => document.querySelector('circle.warmth-ring')
    expect(ring()).toBeNull()
    fireEvent.keyDown(window, { code: 'KeyR' })
    expect(ring()).not.toBeNull()
    const button = screen.getByRole('button', { name: /Show warmth radius/i })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(button)
    expect(ring()).toBeNull()
  })

  it('ignores map keys while a modal dialog is open', () => {
    startGame()
    // A milestone blueprint draft is a modal dialog.
    act(() => {
      currentRun().pendingChoices.push({ kind: 'blueprint', options: ['tavern', 'brewery'], mixed: true })
      useGameStore.setState({ version: useGameStore.getState().version + 1 })
    })
    expect(document.querySelector('[aria-modal="true"]')).not.toBeNull()
    fireEvent.keyDown(window, { code: 'KeyR' })
    expect(useMapOverlays.getState().showWarmth).toBe(false)
  })

  it('keeps the map in play during the founding, which is not a modal', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    // The opening picks stand beside the map, not over it.
    expect(screen.getByRole('region', { name: /^The Founding/ })).toBeTruthy()
    expect(document.querySelector('[aria-modal="true"]')).toBeNull()
    fireEvent.keyDown(window, { code: 'KeyR' })
    expect(useMapOverlays.getState().showWarmth).toBe(true)
  })

  it('badges buildings with what they are doing', () => {
    startGame()
    act(() => {
      const store = useGameStore.getState()
      store.setBuildMode('shelter')
    })
    // Place through the store, as the map's click handler would, at a spot
    // the engine says is legal. Maps are random, so fixed coordinates can land
    // on a deposit or a crag.
    const run = currentRun()
    const before = Object.keys(run.buildings).length
    const spot = findPlacement(run, 'shelter')
    expect(spot).not.toBeNull()
    act(() => {
      useGameStore.getState().place(spot!)
      useGameStore.getState().setBuildMode(null)
    })
    expect(Object.keys(currentRun().buildings).length).toBe(before + 1)
    const badge = document.querySelector('g.status-badge.is-construction')
    expect(badge?.querySelector('title')?.textContent).toBe('Under construction')
  })

  it('stands each building on a plate shaped and tinted by its district', () => {
    startGame()
    const run = currentRun()
    const spot = findPlacement(run, 'shelter')
    expect(spot).not.toBeNull()
    act(() => {
      useGameStore.getState().setBuildMode('shelter')
      useGameStore.getState().place(spot!)
      useGameStore.getState().setBuildMode(null)
    })
    const hearth = document.querySelector('g.building.is-hearth')
    const home = document.querySelector('g.building.is-housing')
    expect(hearth).not.toBeNull()
    expect(home).not.toBeNull()
    const outline = (g: Element) => g.querySelector('path.building-plate')!
    // Different silhouettes and tints, not one disc for everything.
    expect(outline(hearth!).getAttribute('d')).not.toBe(outline(home!).getAttribute('d'))
    expect(outline(home!).getAttribute('stroke')).toBe(DISTRICT_STYLE.housing.edge)
    expect(outline(hearth!).getAttribute('stroke')).toBe(DISTRICT_STYLE.hearth.edge)
    // Hovering names the building and its district.
    expect(home!.querySelector('title')?.textContent).toMatch(/Shelter — Housing/)
  })

  it('gives every district its own silhouette', () => {
    expect(districtOf(BUILDINGS.ancientHearth)).toBe('hearth')
    expect(districtOf(BUILDINGS.brazier)).toBe('fire')
    expect(districtOf(BUILDINGS.shelter)).toBe('housing')
    expect(districtOf(BUILDINGS.smallFarm)).toBe('farm')
    expect(districtOf(BUILDINGS.woodcuttersCamp)).toBe('camp')
    expect(districtOf(BUILDINGS.lumberMill)).toBe('industry')
    expect(districtOf(BUILDINGS.tavern)).toBe('service')
    expect(districtOf(BUILDINGS.warehouse)).toBe('storage')
    const shapes = Object.keys(DISTRICT_STYLE).map((d) => plateShape(d as keyof typeof DISTRICT_STYLE, 20).d)
    expect(new Set(shapes).size).toBe(shapes.length)
    const tints = Object.values(DISTRICT_STYLE).map((s) => s.edge)
    expect(new Set(tints).size).toBe(tints.length)
  })

  it('defines a symbol for every icon the map stamps, glade stakes included', async () => {
    startGame()
    // Every glade in view, so every glade's stakes are stamped (a map whose
    // first neighbours are all small glades would otherwise show none).
    act(() => {
      for (const glade of Object.values(currentRun().glades)) glade.discovered = true
      useGameStore.setState({ version: useGameStore.getState().version + 1 })
    })
    const stakes = document.querySelectorAll('g.glade-stakes use')
    expect(stakes.length).toBeGreaterThan(0)
    await waitFor(() => expect(document.querySelector('svg defs symbol')).not.toBeNull())
    const missing = [...document.querySelectorAll('svg use[data-icon]')]
      .map((u) => u.getAttribute('data-icon') as IconId)
      .filter((id) => !document.getElementById(iconSymbolId(id)))
    expect([...new Set(missing)]).toEqual([])
  })

  it('names obstacles and how to deal with them', () => {
    useGameStore.getState().startRun(77)
    const run = currentRun()
    const home = Object.values(run.glades).find((g) => g.cleared)!
    run.obstacles.push({ id: 'oTest', kind: 'crag', pos: home.center, radius: 0.5, gladeId: home.id })
    render(<App />)
    const crag = document.querySelector('g.obstacle-2d.is-crag')
    expect(crag).not.toBeNull()
    expect(crag!.querySelector('use')?.getAttribute('data-icon')).toBe('crag')
    expect(crag!.querySelector('title')?.textContent).toBe(obstacleTitle('crag'))
    expect(obstacleTitle('crag')).toMatch(/never be cleared/)
    expect(obstacleTitle('mire')).toMatch(/never be drained/)
  })

  it('darkens the ground in the Storm, under the buildings', () => {
    startGame()
    expect(document.querySelector('g.weather-ground.is-storm')).toBeNull()
    act(() => {
      currentRun().season.season = 'storm'
      useGameStore.setState({ version: useGameStore.getState().version + 1 })
    })
    const wash = document.querySelector('g.weather-ground.is-storm')
    expect(wash).not.toBeNull()
    // Drawn before (beneath) every building plate.
    const firstBuilding = document.querySelector('g.building')!
    expect(wash!.compareDocumentPosition(firstBuilding) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('crew counts on the maps', () => {
  /** A finished Woodcutters' Camp beside the hearth with one hand of its two. */
  function shortCamp(run: RunState): string {
    const spot = findPlacement(run, 'woodcuttersCamp')!
    const hearth = Object.values(run.buildings)[0]
    const worker = Object.values(run.villagers).find((v) => v.assignment === null)!
    run.buildings.crewTest = {
      id: 'crewTest',
      defId: 'woodcuttersCamp',
      pos: spot,
      gladeId: hearth.gladeId,
      built: true,
      buildProgress: BUILDINGS.woodcuttersCamp.buildSeconds,
      workers: [worker.id],
      activeRecipeId: BUILDINGS.woodcuttersCamp.recipes[0]?.id ?? null,
      recipeProgress: 0,
      tier: 0,
      paused: false,
      depositsInRange: {},
    }
    worker.assignment = 'crewTest'
    return 'crewTest'
  }

  const bump = () =>
    act(() => {
      const { version, hudVersion } = useGameStore.getState()
      useGameStore.setState({ version: version + 1, hudVersion: hudVersion + 1 })
    })

  const count = (id: string) => document.querySelector(`[data-marks="${id}"] text.worker-count`)!

  it('shows a short crew at full strength only while someone idle could fill it', () => {
    startGame()
    const run = currentRun()
    const id = shortCamp(run)
    bump()
    expect(Object.values(run.villagers).some((v) => v.assignment === null)).toBe(true)
    expect(count(id).textContent).toBe('1/2')
    expect(count(id).getAttribute('class')).toMatch(/is-short/)
    expect(count(id).getAttribute('class')).not.toMatch(/is-quiet/)

    // Nobody idle: still drawn, but quiet.
    act(() => {
      for (const v of Object.values(run.villagers)) if (v.assignment === null) delete run.villagers[v.id]
    })
    bump()
    expect(count(id).textContent).toBe('1/2')
    expect(count(id).getAttribute('class')).toMatch(/is-quiet/)

    // Selected or under the mouse, it speaks up again.
    act(() => useGameStore.getState().selectBuilding(id))
    expect(count(id).getAttribute('class')).not.toMatch(/is-quiet/)
    act(() => useGameStore.getState().selectBuilding(null))
    expect(count(id).getAttribute('class')).toMatch(/is-quiet/)
    const plate = document.querySelector(`[data-building="${id}"]`)!
    fireEvent.pointerOver(plate, { pointerType: 'mouse' })
    expect(count(id).getAttribute('class')).not.toMatch(/is-quiet/)
    fireEvent.pointerOut(plate, { pointerType: 'mouse' })
    expect(count(id).getAttribute('class')).toMatch(/is-quiet/)
  })

  it('keeps a full crew quiet, whoever is idle, and leaves the status badges alone', () => {
    startGame()
    const run = currentRun()
    const id = shortCamp(run)
    const other = Object.values(run.villagers).find((v) => v.assignment === null)!
    run.buildings[id].workers.push(other.id)
    other.assignment = id
    bump()
    expect(Object.values(run.villagers).some((v) => v.assignment === null)).toBe(true)
    expect(count(id).textContent).toBe('2/2')
    expect(count(id).getAttribute('class')).toMatch(/is-quiet/)
    // The status badges carry no quiet state of their own.
    expect(document.querySelectorAll('g.status-badge.is-quiet, g.status-badge .is-quiet').length).toBe(0)
  })

  it('derives the call from the shared building views (both maps read it)', () => {
    showFoundedRun()
    const run = currentRun()
    const id = shortCamp(run)
    let version = useGameStore.getState().version
    const view = () => buildingViews(run, ++version).find((v) => v.building.id === id)!
    expect(view().crewCall).toBe(true)
    for (const v of Object.values(run.villagers)) if (v.assignment === null) delete run.villagers[v.id]
    expect(view().crewCall).toBe(false)
    // The 3D map's crew label is the same tile painted faint: its own key,
    // so no extra draw call, and readable apart from the full-strength one.
    expect(labelTile('1/2', true).key).not.toBe(labelTile('1/2').key)
  })
})

describe('2D map subscriptions', () => {
  it('re-derives at once after a command, and at most once per HUD tick while the sim steps', async () => {
    await act(() => useGameStore.getState().startRun(77))
    const store = useGameStore.getState()
    for (const choice of [...currentRun().pendingChoices]) store.chooseOption(choice.options[0])
    act(() => useGameStore.getState().setSpeed(1))
    let derived = 0
    let structure = 'a'
    const { result } = renderHook(() =>
      useHudValue(() => {
        derived++
        return { key: structure, value: { structure } }
      }),
    )
    const held = result.current
    expect(held).toEqual({ structure: 'a' })
    const version = () => useGameStore.getState().version
    const hud = () => useGameStore.getState().hudVersion
    // The sim must actually be free to step; if not, say why rather than
    // failing below on a version that never moved.
    expect(useGameStore.getState().speed).toBe(1)
    expect(currentRun().phase).toBe('playing')
    expect(currentRun().pendingChoices.map((c) => c.kind)).toEqual([])
    // A burst of sim steps inside one HUD interval: every step moves the
    // version, only the HUD ticks derive, and an unchanged key keeps the value.
    const t0 = performance.now()
    const [v0, h0, d0] = [version(), hud(), derived]
    act(() => {
      for (let i = 0; i < 12; i++) useGameStore.getState().advance(0.25, t0)
    })
    expect(version() - v0).toBeGreaterThan(hud() - h0 + 4)
    expect(derived - d0).toBe(hud() - h0)
    expect(result.current).toBe(held)
    // The next HUD tick derives once more; the key held, so the value did too.
    const d1 = derived
    act(() => useGameStore.getState().advance(0.25, t0 + HUD_INTERVAL_MS))
    expect(derived).toBe(d1 + 1)
    expect(result.current).toBe(held)
    // A command (a placement, an assignment) lands immediately.
    structure = 'b'
    act(() => useGameStore.setState({ version: useGameStore.getState().version + 1 }))
    expect(derived).toBe(d1 + 2)
    expect(result.current).toEqual({ structure: 'b' })
  })
})

