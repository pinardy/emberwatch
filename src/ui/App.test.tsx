import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { BUILDINGS } from '../game/content/buildings'
import { DECREES } from '../game/content/decrees'
import { GLADE_EVENTS } from '../game/content/gladeEvents'
import { findPlacement } from '../game/engine/actions'
import { pushLog } from '../game/engine/createRun'
import { CHARTER_REPUTATION, REWARD_MILESTONES } from '../game/engine/balance'
import { addCondition, issueDecree } from '../game/engine/structure'
import { useGameStore } from '../game/store'
import type { BuildingInstance, RunState } from '../game/types'

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

  it('offers a brazier and shows its warmth beside the hearth’s', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    takeOpeningDraft()

    clickBuildCard('Brazier')
    expect(useGameStore.getState().buildMode).toBe('brazier')
    const target = findPlacement(currentRun(), 'brazier')
    expect(target).toBeTruthy()
    act(() => {
      useGameStore.getState().place(target!)
    })
    const brazier = Object.values(currentRun().buildings).find((b) => b.defId === 'brazier')!
    act(() => {
      useGameStore.getState().setBuildMode(null)
      useGameStore.getState().rush(brazier.id)
      useGameStore.getState().selectBuilding(brazier.id)
    })
    const inspector = document.querySelector('.inspector') as HTMLElement
    expect(within(inspector).getByText(/warm during the Storm/i)).toBeTruthy()
    // Selecting a fire shows every warmth source: the hearth and this brazier.
    const svg = screen.getByRole('application', { name: /Settlement map/i })
    expect(svg.querySelectorAll('circle.warmth-ring').length).toBe(2)
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

  it('toasts sim events as they happen, but not the opening entries', () => {
    startPlaying()
    // The opening narration and the blueprint draft are set-up, not news.
    expect(document.querySelector('.event-toast')).toBeNull()

    act(() => {
      pushLog(currentRun(), 'Ada the Human left the settlement.', 'bad')
      bump()
    })
    const toast = document.querySelector('.event-toast.is-bad') as HTMLElement | null
    expect(toast?.textContent).toContain('Ada the Human left the settlement.')

    // A repeat collapses into the same toast with a counter.
    act(() => {
      pushLog(currentRun(), 'Ada the Human left the settlement.', 'bad')
      bump()
    })
    expect(document.querySelectorAll('.event-toast')).toHaveLength(1)
    expect(document.querySelector('.event-toast-count')?.textContent).toBe('×2')

    // Clicking dismisses it.
    fireEvent.click(document.querySelector('.event-toast')!)
    expect(document.querySelector('.event-toast')).toBeNull()
  })

  it('counts unread chronicle entries on the Log tab until it is opened', () => {
    startPlaying()
    const tabs = screen.getByRole('tablist')
    const logTab = () => within(tabs).getByRole('tab', { name: /Log/i })
    expect(logTab().querySelector('.tab-badge')).toBeNull()

    act(() => {
      pushLog(currentRun(), 'The Wolf Pack strikes.', 'bad')
      pushLog(currentRun(), 'A caravan has arrived.', 'good')
      bump()
    })
    expect(logTab().querySelector('.tab-badge')?.textContent).toBe('2')

    fireEvent.click(logTab())
    expect(logTab().querySelector('.tab-badge')).toBeNull()
    const log = document.querySelector('.log-list') as HTMLElement
    expect(within(log).getByText('The Wolf Pack strikes.')).toBeTruthy()
  })

  it('tells the player what an input-starved workshop is waiting for', () => {
    startPlaying()
    const run = currentRun()
    const worker = Object.values(run.villagers).find((v) => v.assignment === null)!
    const hearth = Object.values(run.buildings)[0]
    const mill: BuildingInstance = {
      id: 'test-mill',
      defId: 'lumberMill',
      pos: { x: hearth.pos.x + 3, y: hearth.pos.y },
      gladeId: hearth.gladeId,
      built: true,
      buildProgress: BUILDINGS.lumberMill.buildSeconds,
      workers: [worker.id],
      activeRecipeId: 'plank',
      // Held at the brim: the bar looks full, which on its own reads as healthy.
      recipeProgress: 16,
      paused: false,
      depositsInRange: {},
    }
    act(() => {
      worker.assignment = mill.id
      run.buildings[mill.id] = mill
      delete run.stock.wood
      useGameStore.getState().selectBuilding(mill.id)
    })
    const inspector = document.querySelector('.inspector') as HTMLElement
    expect(within(inspector).getByText(/Waiting for 2 .*Wood/)).toBeTruthy()
  })

  it('fills the hostility meter in proportion to hostility', () => {
    startPlaying()
    const fill = () =>
      document.querySelector('.meter-warn .meter-fill') as HTMLElement
    const impatienceFill = document.querySelector('.meter-bad .meter-fill')

    act(() => {
      const run = currentRun()
      run.hostility = 37.5
      run.impatience += 1 // a pulse must not remount the meter
      bump()
    })
    expect(fill().style.width).toBe('37.5%')
    // The impatience bar is the same node, so its width transition keeps running.
    expect(document.querySelector('.meter-bad .meter-fill')).toBe(impatienceFill)
  })
})

/** Menu → setup → draft → a moment of play, so the clock has started. */
function startPlaying() {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
  fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
  takeOpeningDraft()
  act(() => {
    useGameStore.getState().setSpeed(1)
    useGameStore.getState().advance(0.5)
    useGameStore.getState().setSpeed(0)
  })
  expect(currentRun().clock).toBeGreaterThan(0)
}

/** Tells subscribers the run changed, as every sim step and command does. */
function bump() {
  useGameStore.setState({ version: useGameStore.getState().version + 1 })
}

describe('mid-run structure UI', () => {
  it('shows decrees and lingering conditions, and takes the charter', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    takeOpeningDraft()

    act(() => {
      const run = currentRun()
      run.decreeTimer = 0
      issueDecree(run)
      const option = GLADE_EVENTS.sunkenGranary.options.find((o) => o.condition)!
      addCondition(run, option.condition!, 'glade1')
      useGameStore.setState({ version: useGameStore.getState().version + 1 })
    })
    const decreeName = DECREES[currentRun().decree!.defId].name
    const bar = screen.getByLabelText(/Conditions and decrees/i)
    expect(within(bar).getByText(/Flooded Paths/)).toBeTruthy()
    expect(within(bar).getByText(decreeName)).toBeTruthy()

    // Clicking the decree card opens the Orders panel, where the countdown sits.
    fireEvent.click(within(bar).getByText(decreeName))
    expect(useGameStore.getState().panel).toBe('orders')
    expect(screen.getByText(/left · miss it/)).toBeTruthy()

    act(() => {
      const run = currentRun()
      run.reputation = CHARTER_REPUTATION
      run.cornerstonesTaken = REWARD_MILESTONES.length
      useGameStore.getState().setSpeed(1)
      useGameStore.getState().advance(0.5)
    })
    expect(screen.getByRole('heading', { name: /The Queen's Charter/i })).toBeTruthy()
    const options = screen.getAllByRole('button').filter((b) => b.className.includes('charter-'))
    expect(options).toHaveLength(3)
    fireEvent.click(options[1])
    expect(currentRun().charter).not.toBeNull()
    expect(currentRun().pendingChoices).toHaveLength(0)
  })
})
