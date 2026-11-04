import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { BUILDINGS } from '../game/content/buildings'
import { findPlacement } from '../game/engine/actions'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import { CONFIRM_WINDOW_MS } from './useConfirm'

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

    // H jumps the camera home.
    fireEvent.keyDown(window, { code: 'KeyH' })
    expect(panOf()).toEqual({ x: 0, y: 0 })
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

  it('keeps real time at display frame rates, where one frame is shorter than a tick', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    takeOpeningDraft()

    for (const [fps, speed] of [
      [60, 1],
      [144, 1],
      [60, 3],
    ] as const) {
      const clockBefore = currentRun().clock
      act(() => {
        useGameStore.getState().setSpeed(speed)
        // Ten real seconds of frames, exactly as requestAnimationFrame delivers them.
        for (let i = 0; i < fps * 10; i++) useGameStore.getState().advance(1 / fps)
      })
      const simulated = currentRun().clock - clockBefore
      expect(simulated).toBeGreaterThanOrEqual(10 * speed - 0.125 - 1e-9)
      expect(simulated).toBeLessThanOrEqual(10 * speed + 0.125 + 1e-9)
    }
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

  /** Starts a run, takes the draft, and stands up a finished woodcutters' camp. */
  function settleWithCamp(): string {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    takeOpeningDraft()
    const spot = findPlacement(currentRun(), 'woodcuttersCamp')
    expect(spot).toBeTruthy()
    act(() => {
      useGameStore.getState().setBuildMode('woodcuttersCamp')
      useGameStore.getState().place(spot!)
      useGameStore.getState().setBuildMode(null)
    })
    const camp = Object.values(currentRun().buildings).find(
      (b) => b.defId === 'woodcuttersCamp',
    )!
    act(() => {
      camp.built = true
      camp.buildProgress = BUILDINGS.woodcuttersCamp.buildSeconds
      useGameStore.getState().selectBuilding(camp.id)
    })
    return camp.id
  }

  it('lets the player choose which villager works a building', () => {
    const campId = settleWithCamp()
    const inspector = document.querySelector('.inspector') as HTMLElement
    const camp = () => currentRun().buildings[campId]

    // Open the picker for an empty slot: idle villagers, ranked fastest first.
    fireEvent.click(within(inspector).getAllByRole('button', { name: /Choose a worker/i })[0])
    const picker = within(inspector).getByRole('group', { name: /Choose a worker/i })
    const options = within(picker).getAllByRole('button').filter((b) =>
      b.className.includes('picker-option'),
    )
    expect(options.length).toBe(Object.keys(currentRun().villagers).length)

    // Deliberately pick the last-ranked villager, not the default "best".
    const lastName = options[options.length - 1].querySelector('strong')!.textContent!
    fireEvent.click(options[options.length - 1])
    const chosen = Object.values(currentRun().villagers).find((v) => v.name === lastName)!
    expect(camp().workers).toEqual([chosen.id])
    expect(chosen.assignment).toBe(campId)

    // Swap that worker for someone specific.
    fireEvent.click(within(inspector).getByRole('button', { name: `Swap ${lastName}` }))
    const swapPicker = within(inspector).getByRole('group', { name: /Choose a worker/i })
    const swapOption = within(swapPicker)
      .getAllByRole('button')
      .find((b) => b.className.includes('picker-option'))!
    const swapName = swapOption.querySelector('strong')!.textContent!
    fireEvent.click(swapOption)
    expect(camp().workers.map((id) => currentRun().villagers[id].name)).toEqual([swapName])
    expect(chosen.assignment).toBeNull()

    // Remove that specific worker again.
    fireEvent.click(within(inspector).getByRole('button', { name: `Remove ${swapName}` }))
    expect(camp().workers).toEqual([])

    // From the People panel, send a named villager to the camp.
    fireEvent.click(screen.getByRole('tab', { name: /People/i }))
    const target = Object.values(currentRun().villagers)[2]
    fireEvent.change(screen.getByRole('combobox', { name: `Assign ${target.name}` }), {
      target: { value: campId },
    })
    expect(camp().workers).toEqual([target.id])
    // ...and back to idle.
    fireEvent.change(screen.getByRole('combobox', { name: `Assign ${target.name}` }), {
      target: { value: '' },
    })
    expect(target.assignment).toBeNull()
  })

  it('asks for a second click before demolishing, and shows the refund', () => {
    vi.useFakeTimers()
    try {
      const campId = settleWithCamp()
      const inspector = document.querySelector('.inspector') as HTMLElement

      const demolish = within(inspector).getByRole('button', { name: /Demolish/i })
      fireEvent.click(demolish)
      // Armed, not gone: the button now says what comes back.
      expect(currentRun().buildings[campId]).toBeTruthy()
      expect(demolish.textContent).toMatch(/Confirm\? Refund/)

      // Left alone, it disarms again.
      act(() => {
        vi.advanceTimersByTime(CONFIRM_WINDOW_MS + 100)
      })
      expect(demolish.textContent).toBe('Demolish')
      fireEvent.click(demolish)
      expect(currentRun().buildings[campId]).toBeTruthy()

      // The second click inside the window tears it down.
      fireEvent.click(within(inspector).getByRole('button', { name: /Confirm\? Refund/ }))
      expect(currentRun().buildings[campId]).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('presents the draft as a labelled modal dialog that holds focus', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))

    const dialog = screen.getByRole('dialog', { name: /New Blueprint/i })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.contains(document.activeElement)).toBe(true)

    // Tab wraps from the last control back to the first, and Shift+Tab back.
    const focusables = within(dialog)
      .getAllByRole('button')
      .filter((b) => !(b as HTMLButtonElement).disabled)
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    last.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)

    // The draft is mandatory: Esc does not dismiss it.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: /New Blueprint/i })).toBeTruthy()
    expect(currentRun().pendingChoices.length).toBeGreaterThan(0)

    takeOpeningDraft()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('switches side panels with hotkeys, ignoring modifiers and held keys', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    takeOpeningDraft()

    const tab = (name: RegExp) => screen.getByRole('tab', { name })
    for (const [code, name] of [
      ['KeyP', /People/],
      ['KeyO', /Orders/],
      ['KeyT', /Trade/],
      ['KeyL', /Log/],
      ['KeyB', /Build/],
    ] as const) {
      fireEvent.keyDown(window, { code, key: code.slice(3).toLowerCase() })
      expect(tab(name).getAttribute('aria-selected')).toBe('true')
    }
    // Tabs advertise their shortcut.
    expect(tab(/People/).getAttribute('title')).toMatch(/\(P\)/)

    // Pressing the open panel's key again closes it; Ctrl+P is the browser's.
    fireEvent.keyDown(window, { code: 'KeyB', key: 'b' })
    expect(useGameStore.getState().panel).toBeNull()
    fireEvent.keyDown(window, { code: 'KeyP', key: 'p', ctrlKey: true })
    expect(useGameStore.getState().panel).toBeNull()

    // Speed keys ignore modifiers; a held Space pauses once instead of flickering.
    act(() => useGameStore.getState().setSpeed(1))
    fireEvent.keyDown(window, { key: '3', code: 'Digit3', metaKey: true })
    expect(useGameStore.getState().speed).toBe(1)
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    expect(useGameStore.getState().speed).toBe(0)
    for (let i = 0; i < 3; i++) {
      fireEvent.keyDown(window, { key: ' ', code: 'Space', repeat: true })
      expect(useGameStore.getState().speed).toBe(0)
    }
  })
})
