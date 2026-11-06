import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { findPlacement } from '../game/engine/actions'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import { gladeFillGeometry, mapStats, useStaticGeometry } from './map3d/staticGeometry'
import { useMapOverlays } from './mapShared'
import { roadKey } from './map3d/layerKeys'
import { roadGeometry } from './map3d/Roads'
import { ROAD_TOOL, placeRoad } from '../game/engine/roads'

/**
 * Map renderer checks that need a DOM: static geometry survives sim ticks,
 * and the 2D fallback carries the same visual states as the 3D scene.
 */

function currentRun(): RunState {
  const run = useGameStore.getState().run
  if (!run) throw new Error('expected a run to be in progress')
  return run
}

function startGame() {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
  fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
  let guard = 0
  while (currentRun().pendingChoices.length > 0 && guard++ < 10) {
    const option = screen.getAllByRole('button').find((b) => b.className.includes('option'))
    if (!option) break
    fireEvent.click(option)
  }
}

beforeEach(() => {
  localStorage.clear()
  useMapOverlays.setState({ showWarmth: false })
  useGameStore.setState({
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
      return useStaticGeometry(() => gladeFillGeometry(glade.polygon), [glade.polygon])
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
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    // The opening blueprint draft is a modal dialog.
    expect(document.querySelector('[aria-modal="true"]')).not.toBeNull()
    fireEvent.keyDown(window, { code: 'KeyR' })
    expect(useMapOverlays.getState().showWarmth).toBe(false)
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
})
