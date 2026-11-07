import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { BUILDINGS } from '../game/content/buildings'
import { canPlaceBuilding, findPlacement, placeBuilding } from '../game/engine/actions'
import { createRun } from '../game/engine/createRun'
import { takeChoice } from '../game/engine/events'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import {
  evaluateSpot,
  nearestValidSpot,
  spokenVerdict,
  stepSpot,
  useKeyGhost,
} from './keyboardPlacement'
import { BuildingList, mapSummaryText } from './MapAids'
import { buildingViews } from './map3d/layerKeys'

/**
 * Playing without a pointer: placing a blueprint with the arrow keys and
 * Enter (or the nearest-spot button), the building list, the Hearth button,
 * Space on a focused control, and the live regions that announce it all.
 */

function newRun(): RunState {
  const run = createRun({ seed: 7171, species: ['human', 'beaver', 'lizard'], modifiers: [] })
  while (run.pendingChoices.length > 0) takeChoice(run, run.pendingChoices[0].options[0])
  // Plenty of materials, so every blueprint is affordable.
  for (const id of ['wood', 'planks', 'bricks', 'fabric', 'stone', 'clay']) run.stock[id as 'wood'] = 200
  return run
}

function run(): RunState {
  return useGameStore.getState().run!
}

function hearthOf(r: RunState) {
  return Object.values(r.buildings).find((b) => BUILDINGS[b.defId]?.category === 'hearth')!
}

function clickBuildCard(name: string) {
  const card = Array.from(document.querySelectorAll<HTMLButtonElement>('button.build-card')).find(
    (el) => el.querySelector('strong')?.textContent === name,
  )
  if (!card) throw new Error(`no build card named ${name}`)
  card.focus()
  fireEvent.click(card)
  return card
}

const liveRegion = () => document.querySelector('.build-banner [aria-live="polite"]') as HTMLElement

function key(target: Element, k: string) {
  fireEvent.keyDown(target, { key: k, code: k })
}

beforeEach(() => {
  localStorage.clear()
  useGameStore.setState({
    screen: 'game',
    run: newRun(),
    speed: 0,
    buildMode: null,
    selectedBuilding: null,
    selectedDeposit: null,
    selectedGlade: null,
    cameraFocus: null,
    panel: 'build',
    notice: null,
  })
})

afterEach(cleanup)

describe('keyboard placement helpers', () => {
  it('finds the nearest spot a building can stand on, and steps to the next one', () => {
    const r = run()
    const hearth = hearthOf(r)
    // The hearth's own spot is taken, and the verdict says why.
    const there = evaluateSpot(r, 'shelter', hearth.pos)
    expect(there.ok).toBe(false)
    expect(spokenVerdict(there)).toMatch(/^Cannot place here: Too close to another building/)

    const spot = nearestValidSpot(r, 'shelter', hearth.pos)!
    expect(spot).toBeTruthy()
    expect(canPlaceBuilding(r, 'shelter', spot)).toBeNull()
    expect(spokenVerdict(evaluateSpot(r, 'shelter', spot))).toMatch(/^Can place here/)

    // An arrow press snaps to the next valid spot in its direction.
    const right = stepSpot(r, 'shelter', spot, { x: 1, y: 0 }, 1)
    expect(right.x).toBeGreaterThan(spot.x)
    expect(canPlaceBuilding(r, 'shelter', right)).toBeNull()
  })

  it('snaps by where a building could stand even while the materials are short', () => {
    const r = run()
    r.stock = {}
    const spot = nearestValidSpot(r, 'shelter', hearthOf(r).pos)
    expect(spot).toBeTruthy()
    const verdict = evaluateSpot(r, 'shelter', spot!)
    expect(verdict.ok).toBe(false)
    expect(verdict.hint).toMatch(/Not enough materials/)
  })
})

describe('keyboard placement on the map', () => {
  it('arrows move the ghost, Enter places, Esc cancels, and each verdict is announced', () => {
    render(<App />)
    const card = clickBuildCard('Shelter')
    expect(useGameStore.getState().buildMode).toBe('shelter')

    // The banner takes focus so the keys work at once, and says what is in hand.
    const banner = document.querySelector('.build-banner') as HTMLElement
    expect(document.activeElement).toBe(banner)
    expect(banner.getAttribute('aria-label')).toBe('Placing Shelter')
    expect(liveRegion().textContent).toMatch(/Placing Shelter\. Arrow keys move the spot, Enter places/)

    // The arrows move the ghost, not the camera.
    const svg = screen.getByRole('img', { name: /Settlement map/i })
    const transform = () => svg.querySelector('g[transform]')!.getAttribute('transform')
    const before = transform()

    act(() => key(banner, 'ArrowRight'))
    const first = useKeyGhost.getState().ghost!
    expect(first).toBeTruthy()
    expect(first.ok).toBe(true)
    expect(liveRegion().textContent).toMatch(/^Can place here/)

    act(() => key(banner, 'ArrowRight'))
    const second = useKeyGhost.getState().ghost!
    expect(second.pos.x).toBeGreaterThan(first.pos.x)
    expect(canPlaceBuilding(run(), 'shelter', second.pos)).toBeNull()
    expect(transform()).toBe(before)

    // Enter places it where the ghost stands.
    const count = Object.keys(run().buildings).length
    act(() => key(banner, 'Enter'))
    expect(Object.keys(run().buildings).length).toBe(count + 1)
    const placed = Object.values(run().buildings).find((b) => b.defId === 'shelter')!
    expect(placed.pos).toEqual(second.pos)
    expect(liveRegion().textContent).toMatch(/Shelter placed/)

    // The same spot is taken now; the next press says so if it lands there.
    act(() => key(banner, 'ArrowLeft'))
    expect(liveRegion().textContent).toMatch(/place here/)

    // Esc puts the blueprint away and focus goes back to its card.
    act(() => key(document.activeElement!, 'Escape'))
    expect(useGameStore.getState().buildMode).toBeNull()
    expect(document.activeElement).toBe(card)
  })

  it('"Place at the nearest valid spot" places in one press', () => {
    render(<App />)
    clickBuildCard('Shelter')
    const count = Object.keys(run().buildings).length
    fireEvent.click(screen.getByRole('button', { name: 'Place at the nearest valid spot' }))
    expect(Object.keys(run().buildings).length).toBe(count + 1)
    const placed = Object.values(run().buildings).find((b) => b.defId === 'shelter')!
    expect(canPlaceBuilding(run(), 'shelter', placed.pos)).not.toBeNull() // now taken
    expect(liveRegion().textContent).toMatch(/Shelter placed/)
  })

  it('leaves the arrows to a list that uses them', () => {
    render(<App />)
    clickBuildCard('Shelter')
    const list = screen.getByRole('navigation', { name: 'Buildings' })
    const button = within(list).getAllByRole('button')[0]
    button.focus()
    act(() => key(button, 'ArrowDown'))
    expect(useKeyGhost.getState().ghost).toBeNull()
  })
})

describe('building list', () => {
  it('lists every building with one Tab stop, the hearth first; arrows move and Enter inspects', () => {
    const r = run()
    for (const defId of ['shelter', 'woodcuttersCamp']) {
      const at = findPlacement(r, defId)
      expect(at).toBeTruthy()
      expect(placeBuilding(r, defId, at!)).toBeNull()
    }
    render(<BuildingList />)
    const nav = screen.getByRole('navigation', { name: 'Buildings' })
    const buttons = within(nav).getAllByRole('button')
    expect(buttons).toHaveLength(buildingViews(r, 0).length)
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1)
    expect(buttons[0].querySelector('strong')?.textContent).toBe(BUILDINGS.ancientHearth.name)

    const windowKeys = vi.fn()
    window.addEventListener('keydown', windowKeys)
    try {
      buttons[0].focus()
      key(buttons[0], 'ArrowDown')
      expect(document.activeElement).toBe(buttons[1])
      key(buttons[1], 'End')
      expect(document.activeElement).toBe(buttons[buttons.length - 1])
      key(document.activeElement!, 'Home')
      expect(document.activeElement).toBe(buttons[0])
      key(buttons[0], 'Enter')
      expect(windowKeys).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', windowKeys)
    }
    const hearth = hearthOf(r)
    expect(useGameStore.getState().selectedBuilding).toBe(hearth.id)
    expect(useGameStore.getState().cameraFocus).toEqual(hearth.pos)
  })

  it('on the 2D map: a glade list and a building list, and picking moves focus to the Inspector', () => {
    render(<App />)
    expect(screen.getByRole('navigation', { name: 'Glades' })).toBeTruthy()
    const list = screen.getByRole('navigation', { name: 'Buildings' })
    const first = within(list).getAllByRole('button')[0]
    first.focus()
    act(() => key(first, 'Enter'))
    const title = document.querySelector('.inspector .inspector-title') as HTMLElement
    expect(title.textContent).toBe(BUILDINGS.ancientHearth.name)
    expect(document.activeElement).toBe(title)
  })

  it('the Hearth button (and F) opens the hearth in the Inspector', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Hearth' }))
    expect(useGameStore.getState().selectedBuilding).toBe(hearthOf(run()).id)
    expect(document.activeElement?.className).toContain('inspector-title')
    act(() => useGameStore.getState().clearSelection())
    ;(document.activeElement as HTMLElement | null)?.blur()
    act(() => key(document.body, 'f'))
    fireEvent.keyDown(window, { key: 'f', code: 'KeyF' })
    expect(useGameStore.getState().selectedBuilding).toBe(hearthOf(run()).id)
  })

  it('a short summary of the map, worded from counts', () => {
    const r = run()
    const text = mapSummaryText(r, buildingViews(r, 0))
    expect(text).toMatch(/\d+ glades? in reach\./)
    expect(text).toMatch(/workers\./)
    expect(text).toMatch(/No threats\.|threats? loose/)
    render(<App />)
    expect(screen.getByText(text).getAttribute('role')).toBe('status')
  })
})

describe('Space and the live log', () => {
  it('Space pauses from the map but is left to a focused control', () => {
    render(<App />)
    // Nothing focused: Space toggles the clock.
    act(() => key(document.body, ' '))
    expect(useGameStore.getState().speed).toBe(1)
    act(() => key(document.body, ' '))
    expect(useGameStore.getState().speed).toBe(0)

    // A focused tab, button or summary takes Space for itself.
    const tab = screen.getByRole('tab', { name: /People/ })
    tab.focus()
    const space = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })
    act(() => {
      tab.dispatchEvent(space)
    })
    expect(useGameStore.getState().speed).toBe(0)
    expect(space.defaultPrevented).toBe(false)
  })

  it('keeps the news log mounted while it is empty, so new toasts are announced', () => {
    render(<App />)
    const log = screen.getByRole('log', { name: 'Settlement news' })
    expect(log.children).toHaveLength(0)
    expect(log.getAttribute('aria-live')).toBe('polite')
  })
})
