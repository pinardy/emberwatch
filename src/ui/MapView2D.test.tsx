import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { findPlacement } from '../game/engine/actions'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import { gladeFillGeometry, mapStats, useStaticGeometry } from './map3d/staticGeometry'
import { useMapOverlays } from './mapShared'

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
