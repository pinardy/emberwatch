import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { BUILDINGS } from '../game/content/buildings'
import { findPlacement } from '../game/engine/actions'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'

/**
 * UI smoke tests. Typechecking cannot catch a component that throws on render or
 * a handler wired to the wrong action, so these mount the real app and click
 * through the path a player actually takes: menu → setup → play → build.
 */

function currentRun(): RunState {
  const run = useGameStore.getState().run
  if (!run) throw new Error('expected a run to be in progress')
  return run
}

/**
 * Clicks a build-panel card by its exact name. Matching on accessible name is
 * ambiguous here — a card's name includes its description and cost — so we go
 * by the card's title element.
 */
function clickBuildCard(name: string) {
  const card = Array.from(document.querySelectorAll('button.build-card')).find(
    (el) => el.querySelector('strong')?.textContent === name,
  )
  if (!card) throw new Error(`no build card named ${name}`)
  fireEvent.click(card)
}

/** Answers the opening blueprint draft the way a player would. */
function takeOpeningDraft() {
  let guard = 0
  while (currentRun().pendingChoices.length > 0 && guard++ < 10) {
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.textContent).toMatch(/New Blueprint|Cornerstone/)
    // Each option is a button whose accessible name starts with the icon+name.
    const options = screen
      .getAllByRole('button')
      .filter((b) => b.className.includes('option'))
    expect(options.length).toBeGreaterThan(0)
    fireEvent.click(options[0])
  }
}

beforeEach(() => {
  localStorage.clear()
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

describe('app shell', () => {
  it('renders the menu with the game title', () => {
    render(<App />)
    // The wordmark is split across elements for the accent colour.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Emberwatch')
    expect(screen.getByRole('button', { name: /New settlement/i })).toBeTruthy()
  })

  it('walks menu → setup → a live settlement', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))

    // Setup screen: species picks and a seed field.
    expect(screen.getByLabelText(/Map seed/i)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Map seed/i), {
      target: { value: 'emberwatch-ui-test' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))

    // The run opens on the blueprint draft.
    expect(currentRun().pendingChoices.length).toBeGreaterThan(0)
    takeOpeningDraft()
    expect(currentRun().pendingChoices).toHaveLength(0)

    // Game shell is up: meters, map, and the build panel.
    expect(screen.getByText('Reputation')).toBeTruthy()
    expect(screen.getByText('Impatience')).toBeTruthy()
    expect(screen.getByText('Hostility')).toBeTruthy()
    expect(screen.getByRole('application', { name: /Settlement map/i })).toBeTruthy()
    expect(
      Array.from(document.querySelectorAll('button.build-card strong')).map(
        (el) => el.textContent,
      ),
    ).toContain('Shelter')
  })

  it('places a building through the map and shows it in the inspector', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    takeOpeningDraft()

    // Enter build mode for a shelter.
    clickBuildCard('Shelter')
    expect(useGameStore.getState().buildMode).toBe('shelter')
    expect(screen.getByText(/click on cleared ground/i)).toBeTruthy()

    // The map draws the continuous world: glade polygons and feature markers.
    const svg = screen.getByRole('application', { name: /Settlement map/i })
    expect(svg.querySelectorAll('polygon.glade-poly').length).toBeGreaterThan(10)
    expect(svg.querySelectorAll('g.deposit').length).toBeGreaterThan(0)

    // Ask the engine for a legal spot, then place there — the same call the
    // map's click handler makes with the cursor's world position.
    const run = currentRun()
    const target = findPlacement(run, 'shelter')
    expect(target).toBeTruthy()

    const before = Object.keys(currentRun().buildings).length
    act(() => {
      useGameStore.getState().place(target!)
    })
    expect(Object.keys(currentRun().buildings).length).toBe(before + 1)

    // Select the new site; the inspector should describe it. Scope the query —
    // "Shelter" also appears on the build card behind it.
    const shelter = Object.values(currentRun().buildings).find(
      (b) => b.defId === 'shelter',
    )!
    act(() => {
      useGameStore.getState().setBuildMode(null)
      useGameStore.getState().selectBuilding(shelter.id)
    })
    const inspector = document.querySelector('.inspector') as HTMLElement | null
    expect(inspector).toBeTruthy()
    expect(within(inspector!).getByText(BUILDINGS.shelter.name)).toBeTruthy()
    expect(within(inspector!).getByText(/Under construction/i)).toBeTruthy()
  })

  it('zooms the map on wheel and consumes the event', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    takeOpeningDraft()

    const svg = screen.getByRole('application', { name: /Settlement map/i })
    const scaleOf = () => {
      const g = svg.querySelector('g[transform]') as SVGGElement
      return Number(/scale\(([\d.]+)\)/.exec(g.getAttribute('transform') ?? '')?.[1])
    }
    const before = scaleOf()

    /*
     * Dispatched natively rather than via fireEvent so the listener really is
     * the one registered with `{ passive: false }`. React attaches its own wheel
     * listener at the root as passive, so an `onWheel` prop cannot call
     * preventDefault — the page would scroll instead of the map zooming.
     */
    const zoomIn = new WheelEvent('wheel', { deltaY: -120, cancelable: true, bubbles: true })
    act(() => {
      svg.dispatchEvent(zoomIn)
    })
    expect(zoomIn.defaultPrevented).toBe(true)
    const zoomedIn = scaleOf()
    expect(zoomedIn).toBeGreaterThan(before)

    const zoomOut = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true })
    act(() => {
      svg.dispatchEvent(zoomOut)
    })
    expect(zoomOut.defaultPrevented).toBe(true)
    expect(scaleOf()).toBeLessThan(zoomedIn)
  })

  it('pans the camera with WASD and arrow keys', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    takeOpeningDraft()

    const svg = screen.getByRole('application', { name: /Settlement map/i })
    const panOf = () => {
      const g = svg.querySelector('g[transform]') as SVGGElement
      const m = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(g.getAttribute('transform') ?? '')
      return { x: Number(m?.[1]), y: Number(m?.[2]) }
    }

    const start = panOf()
    // D pans the camera right: the world slides left.
    fireEvent.keyDown(window, { code: 'KeyD' })
    expect(panOf().x).toBeLessThan(start.x)
    // ArrowLeft pans back the other way.
    fireEvent.keyDown(window, { code: 'ArrowLeft' })
    fireEvent.keyDown(window, { code: 'ArrowLeft' })
    expect(panOf().x).toBeGreaterThan(start.x)
    // W moves the camera up: the world slides down.
    fireEvent.keyDown(window, { code: 'KeyW' })
    expect(panOf().y).toBeGreaterThan(start.y)

    // Typing in a form field must not move the camera.
    const before = panOf()
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { code: 'KeyD' })
    expect(panOf()).toEqual(before)
    input.remove()
  })

  it('advances the simulation when unpaused', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    takeOpeningDraft()

    const clockBefore = currentRun().clock
    act(() => {
      useGameStore.getState().setSpeed(1)
      // Drive the store directly rather than waiting on requestAnimationFrame.
      for (let i = 0; i < 20; i++) useGameStore.getState().advance(0.5)
    })
    expect(currentRun().clock).toBeGreaterThan(clockBefore)
  })

  it('switches side panels without crashing', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    takeOpeningDraft()

    const tabs = screen.getByRole('tablist')
    for (const label of ['People', 'Orders', 'Trade', 'Log']) {
      fireEvent.click(within(tabs).getByRole('tab', { name: new RegExp(label, 'i') }))
      expect(useGameStore.getState().panel).toBeTruthy()
    }
    // The people panel is where resolve is diagnosed. (The tips coach can also
    // mention "resolve", so target the panel heading specifically.)
    fireEvent.click(within(tabs).getByRole('tab', { name: /People/i }))
    expect(screen.getByRole('heading', { name: /Resolve/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Recall all/i })).toBeTruthy()
  })

  it('reaches the Citadel from the menu and lists upgrades', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /The Citadel/i }))
    expect(screen.getByRole('heading', { name: /The Citadel/i })).toBeTruthy()
    expect(screen.getByText(/Harpy Charter/i)).toBeTruthy()
  })

  it('shows the end-of-run summary when a run is won', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    takeOpeningDraft()

    act(() => {
      const run = currentRun()
      run.reputation = run.maxReputation
      useGameStore.getState().setSpeed(1)
      useGameStore.getState().advance(0.5)
    })
    expect(screen.getByText(/The settlement holds/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Return to the Citadel/i })).toBeTruthy()
  })
})
