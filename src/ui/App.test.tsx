import { envoyArrivesNextTick } from '../test/envoy'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { BUILDINGS } from '../game/content/buildings'
import { DECREES } from '../game/content/decrees'
import { GLADE_EVENTS, GLADE_EVENT_LIST } from '../game/content/gladeEvents'
import type { defaultAutoPause } from '../game/autoPause'
import { defaultSettings, loadSettings } from '../game/persistence'
import { RUN_MODIFIERS } from '../game/content/runModifiers'
import { findPlacement } from '../game/engine/actions'
import { drawRunModifiers } from '../game/engine/runModifiers'
import { pushLog } from '../game/engine/runLog'
import { CHARTER_REPUTATION, REWARD_MILESTONES } from '../game/engine/balance'
import { offerDecrees } from '../game/engine/structure'
import { addCondition } from '../game/engine/outcomes'
import { proclaimFirstDecree } from '../test/decrees'
import { offerOrders } from '../game/engine/orders'
import { MAX_FRAME_REAL_SECONDS, frameBudget, useGameStore } from '../game/store'
import type { BuildingInstance, RunState } from '../game/types'
import { newTestRun, showFoundedRun, showRun, startClock } from '../test/foundedRun'
import { GameScreen } from './GameScreen'
import { TopBar } from './TopBar'
import { CONFIRM_WINDOW_MS } from './useConfirm'

/**
 * UI smoke tests. Typechecking cannot catch a component that throws on render or
 * a handler wired to the wrong action, so these mount the real app and click
 * through the path a player actually takes: menu → setup → play → build.
 * Tests about what comes after the founding start from a founded run in the
 * store (src/test/foundedRun.ts) and render the game screen or the part they
 * test; the ones about the loop's clock and the auto-pause read only the store.
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
/** Answers whatever the run is waiting on through the store, as a player would. */
function answerPendingChoices() {
  let guard = 0
  while (currentRun().pendingChoices.length > 0 && guard++ < 20) {
    const choice = currentRun().pendingChoices[0]
    const before = currentRun().pendingChoices.length
    act(() => {
      const store = useGameStore.getState()
      if (choice.kind !== 'gladeEvent') {
        store.chooseOption(choice.options[0])
        return
      }
      // Some options need goods the stockpile lacks; take the first it can pay.
      for (let i = 0; i < 4 && currentRun().pendingChoices.length === before; i++) store.chooseEventOption(i)
    })
  }
  expect(currentRun().pendingChoices).toEqual([])
}

/** Makes every founding pick from the Founding panel beside the map, as a player would. */
function takeOpeningDraft() {
  let guard = 0
  while (currentRun().pendingChoices.length > 0 && guard++ < 10) {
    const panel = screen.getByRole('region', { name: /^The Founding/ })
    // The founding is not a pop-up: no dialog covers the map meanwhile.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('img', { name: /Settlement map/i })).toBeTruthy()
    // Each option is a button whose accessible name starts with the icon+name.
    const options = within(panel)
      .getAllByRole('button')
      .filter((b) => b.className.includes('option'))
    expect(options.length).toBeGreaterThan(0)
    fireEvent.click(options[0])
  }
  expect(screen.queryByRole('region', { name: /^The Founding/ })).toBeNull()
}

beforeEach(() => {
  localStorage.clear()
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

    // Game shell is up: meters, map, and the build panel. (The map's glade
    // stake chips can say "Reputation" too, so the meters are read in the top bar.)
    const topBar = within(document.querySelector<HTMLElement>('header.topbar')!)
    expect(topBar.getByText('Reputation')).toBeTruthy()
    expect(topBar.getByText('Impatience')).toBeTruthy()
    expect(topBar.getByText('Hostility')).toBeTruthy()
    expect(screen.getByRole('img', { name: /Settlement map/i })).toBeTruthy()
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
    const svg = screen.getByRole('img', { name: /Settlement map/i })
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
    const svg = screen.getByRole('img', { name: /Settlement map/i })
    expect(svg.querySelectorAll('circle.warmth-ring').length).toBe(2)
  })

  it('zooms the map on wheel and consumes the event', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    takeOpeningDraft()

    const svg = screen.getByRole('img', { name: /Settlement map/i })
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

    const svg = screen.getByRole('img', { name: /Settlement map/i })
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

  it('keeps real time at display frame rates, where one frame is shorter than a tick', () => {
    // The loop is the store's: nothing needs to be on screen.
    showFoundedRun()

    for (const [fps, speed] of [
      [60, 1],
      [144, 1],
      [60, 3],
      [60, 4],
      [144, 4],
      [60, 5],
      [144, 5],
      // A struggling device: every frame is as long as the loop allows, so
      // the per-frame budget, not the frame count, decides whether 5× holds.
      [2, 5],
      [3, 5],
      [8, 4],
    ] as const) {
      // A choice (a decree, an order, a glade event) or an auto-pause halts
      // the world by design, and a run of this length meets several at random
      // times. The loop is what's measured here, so answer any choice first,
      // and measure the row again if one arrives mid-row.
      let simulated: number
      for (let attempt = 0; ; attempt++) {
        expect(attempt, 'interrupted on every attempt').toBeLessThan(10)
        answerPendingChoices()
        const clockBefore = currentRun().clock
        let interrupted = false
        act(() => {
          useGameStore.getState().setSpeed(speed)
          // Ten real seconds of frames, exactly as requestAnimationFrame delivers them.
          for (let i = 0; i < fps * 10; i++) {
            useGameStore.getState().advance(1 / fps)
            if (currentRun().pendingChoices.length > 0 || useGameStore.getState().speed !== speed) {
              interrupted = true
              break
            }
          }
        })
        simulated = currentRun().clock - clockBefore
        if (!interrupted) break
      }
      expect(simulated).toBeGreaterThanOrEqual(10 * speed - 0.125 - 1e-9)
      expect(simulated).toBeLessThanOrEqual(10 * speed + 0.125 + 1e-9)
    }
  })

  it('offers every speed in the top bar and on the number keys', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    takeOpeningDraft()

    const group = screen.getByRole('group', { name: 'Game speed' })
    for (const speed of [4, 5]) {
      fireEvent.click(within(group).getByRole('button', { name: `${speed}×` }))
      expect(useGameStore.getState().speed).toBe(speed)
    }
    for (const key of ['1', '4', '5', '2']) {
      fireEvent.keyDown(window, { key, code: `Digit${key}` })
      expect(useGameStore.getState().speed).toBe(Number(key))
    }
    // Keys past the top speed do nothing.
    fireEvent.keyDown(window, { key: '6', code: 'Digit6' })
    fireEvent.keyDown(window, { key: '0', code: 'Digit0' })
    expect(useGameStore.getState().speed).toBe(2)

    // The phone bar folds the speeds behind a toggle naming the current one;
    // picking a speed there closes it again.
    const toggle = screen.getByRole('button', { name: 'Game speed: 2×' })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(group.className).toMatch(/is-open/)
    fireEvent.click(within(group).getByRole('button', { name: '5×' }))
    expect(useGameStore.getState().speed).toBe(5)
    expect(group.className).not.toMatch(/is-open/)
    expect(screen.getByRole('button', { name: 'Game speed: 5×' })).toBeTruthy()
  })

  it('never fast-forwards a long-stalled frame, even at top speed', () => {
    showFoundedRun()

    for (const speed of [1, 5] as const) {
      const clockBefore = currentRun().clock
      act(() => {
        useGameStore.getState().setSpeed(speed)
        // A tab that slept for a minute hands the store one enormous frame.
        useGameStore.getState().advance(60)
      })
      const simulated = currentRun().clock - clockBefore
      expect(simulated).toBeLessThanOrEqual(frameBudget(speed) + 1e-9)
      // A minute away costs at most a few seconds of the world, at any speed.
      expect(simulated).toBeLessThanOrEqual(5 * MAX_FRAME_REAL_SECONDS + 0.125 + 1e-9)
    }
  })

  it("previews the seed's map modifiers, then shows them in the run and at its end", () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    // No seed yet: the land is a surprise.
    expect(screen.getByText(/reveals them when you set out/i)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Map seed/i), { target: { value: '4242' } })
    const expected = drawRunModifiers(4242).map((id) => RUN_MODIFIERS[id].name)
    const preview = screen.getByRole('list', { name: /Lay of the land/i })
    for (const name of expected) expect(within(preview).getByText(name)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    expect(currentRun().runModifiers).toEqual(drawRunModifiers(4242))
    // The opening draft names the land too.
    const strip = screen.getByRole('list', { name: /Lay of the land/i })
    for (const name of expected) expect(within(strip).getByText(new RegExp(name))).toBeTruthy()
    takeOpeningDraft()

    fireEvent.click(within(screen.getByRole('tablist')).getByRole('tab', { name: /Orders/i }))
    expect(screen.getByRole('heading', { name: /Lay of the land/i })).toBeTruthy()
    for (const name of expected) expect(screen.getAllByText(name).length).toBeGreaterThan(0)

    // And the end screen remembers it.
    act(() => {
      useGameStore.setState({ run: { ...currentRun(), phase: 'won' } })
    })
    const land = screen.getByRole('region', { name: /Lay of the land/i })
    for (const name of expected) expect(within(land).getByText(new RegExp(name))).toBeTruthy()
  })

  it('shows the end-of-run summary when a run is won', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    takeOpeningDraft()

    act(() => {
      const run = currentRun()
      envoyArrivesNextTick(run)
      useGameStore.getState().setSpeed(1)
      useGameStore.getState().advance(0.5)
    })
    expect(screen.getByText(/The settlement holds/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Return to the Citadel/i })).toBeTruthy()
  })

  it('toasts sim events as they happen, but not the opening entries', () => {
    foundOnScreen()
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
    foundOnScreen()
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
    playOnScreen()
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
    showFoundedRun({ started: true })
    render(<TopBar />)
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

/**
 * A founded run on the game screen with its clock started, as `startPlaying`
 * leaves it, without the menu, setup and founding clicks.
 */
function playOnScreen() {
  showFoundedRun({ started: true })
  render(<GameScreen />)
}

/**
 * The founding made through the store while the game screen is up, then the
 * clock started: the opening's log lines arrive on screen, as for a player.
 */
function foundOnScreen() {
  const run = showRun(newTestRun())
  render(<GameScreen />)
  expect(screen.getByRole('region', { name: /^The Founding/ })).toBeTruthy()
  for (let guard = 0; run.pendingChoices.length > 0 && guard < 20; guard++) {
    act(() => useGameStore.getState().chooseOption(run.pendingChoices[0].options[0]))
  }
  expect(run.pendingChoices).toEqual([])
  act(() => startClock())
}

/** Tells subscribers the run changed, as every sim step and command does. */
function bump() {
  useGameStore.setState({ version: useGameStore.getState().version + 1 })
}

describe("the Queen's offers", () => {
  /** The option cards in the open dialog. */
  const cardsIn = (dialog: HTMLElement) =>
    within(dialog)
      .queryAllByRole('button')
      .filter((b) => b.className.includes('option'))

  it('opens on the founding beside the map: every pick at once, in any order, then the clock', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    // The map is up and no dialog covers it; the picks stand beside it.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('[aria-modal="true"]')).toBeNull()
    expect(screen.getByRole('img', { name: /Settlement map/i })).toBeTruthy()
    const panel = screen.getByRole('region', { name: /^The Founding/ })
    // A labelled panel, not a modal: it takes focus but does not trap it.
    expect(panel.getAttribute('aria-modal')).toBeNull()
    expect(panel.contains(document.activeElement)).toBe(true)
    // Its first pick is one Tab away, and nothing holds Tab inside it.
    const firstCard = within(panel).getAllByRole('button').filter((b) => b.className.includes('option'))[0]
    firstCard.focus()
    expect(document.activeElement).toBe(firstCard)
    const tabbed = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    panel.dispatchEvent(tabbed)
    expect(tabbed.defaultPrevented).toBe(false)
    // The top bar stays reachable meanwhile.
    expect(screen.getByRole('group', { name: 'Game speed' })).toBeTruthy()
    // It cannot be dismissed: Esc leaves every pick waiting.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('region', { name: /^The Founding/ })).toBeTruthy()
    // Every part of the founding is on show together.
    const part = (name: RegExp) => within(panel).getByRole('region', { name })
    const blueprints = part(/Blueprints/)
    const stone = part(/Cornerstone/)
    const writ = part(/founding writ/i)
    expect(cardsIn(blueprints).length).toBeGreaterThan(0)
    expect(within(blueprints).getByRole('button', { name: /Reroll/ })).toBeTruthy()
    expect(cardsIn(stone).length).toBeGreaterThan(0)
    expect(within(stone).getByRole('button', { name: /Reroll/ })).toBeTruthy()
    const writCards = cardsIn(writ)
    expect(writCards).toHaveLength(3)
    for (const card of writCards) {
      expect(card.textContent).toMatch(/% done now/)
      expect(card.textContent).toMatch(/\+1/)
    }
    // The writ cannot be swapped for another.
    expect(within(writ).queryByText(/Ask for different orders/)).toBeNull()
    expect(within(writ).queryByRole('button', { name: /Reroll/ })).toBeNull()
    expect(within(panel).getByText(/5 picks left/)).toBeTruthy()

    // The writ first: it is marked made, and the drafts stay as they were.
    const draft = cardsIn(blueprints).map((c) => c.textContent)
    fireEvent.click(writCards[0])
    expect(currentRun().orders.some((o) => o.writ)).toBe(true)
    expect(within(part(/founding writ/i)).getByText('Done')).toBeTruthy()
    expect(cardsIn(part(/founding writ/i))).toHaveLength(0)
    expect(cardsIn(part(/Blueprints/)).map((c) => c.textContent)).toEqual(draft)
    expect(within(panel).getByText(/4 picks left/)).toBeTruthy()

    // The clock waits for the founding, whatever the speed.
    act(() => {
      useGameStore.getState().setSpeed(1)
      useGameStore.getState().advance(2)
      useGameStore.getState().setSpeed(0)
    })
    expect(currentRun().clock).toBe(0)

    // The cornerstone next; the chosen one is listed in its part.
    const stoneName = cardsIn(part(/Cornerstone/))[0].querySelector('strong')!.textContent!
    fireEvent.click(cardsIn(part(/Cornerstone/))[0])
    expect(within(part(/Cornerstone/)).getByText(new RegExp(stoneName))).toBeTruthy()
    // Focus follows the player to the next open pick.
    expect(document.activeElement?.className).toMatch(/option/)
    expect(part(/Blueprints/).contains(document.activeElement)).toBe(true)
    // After a blueprint, focus moves on to the next card rather than being lost.
    fireEvent.click(cardsIn(part(/Blueprints/))[0])
    expect(document.activeElement?.className).toMatch(/option/)
    expect(screen.getByRole('region', { name: /^The Founding/ }).contains(document.activeElement)).toBe(true)

    takeOpeningDraft()
    expect(screen.queryByRole('dialog')).toBeNull()
    // Done: the side rail is back, with focus on its tab, and the clock runs.
    expect(document.activeElement?.id).toBe('tab-build')
    act(() => {
      useGameStore.getState().setSpeed(1)
      useGameStore.getState().advance(0.5)
      useGameStore.getState().setSpeed(0)
    })
    expect(currentRun().clock).toBeGreaterThan(0)
    act(() => useGameStore.getState().setPanel('orders'))
    expect(screen.getByText('founding writ')).toBeTruthy()
  })

  it('rerolls a founding draft for amber from the panel', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    act(() => {
      currentRun().stock.amber = 40
      bump()
    })
    const stone = within(screen.getByRole('region', { name: /^The Founding/ })).getByRole('region', {
      name: /Cornerstone/,
    })
    const before = cardsIn(stone).map((c) => c.textContent)
    fireEvent.click(within(stone).getByRole('button', { name: /Reroll/ }))
    const after = cardsIn(stone).map((c) => c.textContent)
    expect(after.length).toBeGreaterThan(0)
    for (const card of after) expect(before).not.toContain(card)
    expect(currentRun().stock.amber).toBeLessThan(40)
  })

  it('offers two orders inline in the Orders panel, without stopping the clock, with one swap a year', () => {
    playOnScreen()
    act(() => {
      const run = currentRun()
      run.orders.pop()
      offerOrders(run)
      bump()
    })
    // No pop-up: the offer waits, flagged on the Orders tab.
    expect(screen.queryByRole('dialog')).toBeNull()
    const tab = within(screen.getByRole('tablist')).getByRole('tab', { name: /Orders/i })
    expect(within(tab).getByLabelText(/a new order to choose/)).toBeTruthy()
    // The clock keeps running, and the slot stays empty until a pick.
    const clock = currentRun().clock
    act(() => {
      useGameStore.getState().setSpeed(1)
      useGameStore.getState().advance(1)
      useGameStore.getState().setSpeed(0)
    })
    expect(currentRun().clock).toBeGreaterThan(clock)
    expect(currentRun().orders).toHaveLength(2)
    expect(currentRun().orderOffers).toHaveLength(1)

    fireEvent.click(tab)
    const offer = screen.getByRole('group', { name: /Open slot — choose an order/ })
    expect(cardsIn(offer)).toHaveLength(2)
    for (const card of cardsIn(offer)) {
      expect(card.textContent).toMatch(/% done now/)
      expect(card.textContent).toMatch(/\+\d/)
    }
    const swap = within(offer).getByRole('button', { name: /Ask for different orders/ })
    const before = currentRun().impatienceProgress + currentRun().impatience
    fireEvent.click(swap)
    expect(currentRun().impatienceProgress + currentRun().impatience).toBeCloseTo(before + 0.5)
    const again = within(screen.getByRole('group', { name: /Open slot/ })).getByRole('button', {
      name: /Ask for different orders/,
    }) as HTMLButtonElement
    expect(again.disabled).toBe(true)
    const picked = currentRun().orderOffers[0].options[0]
    fireEvent.click(cardsIn(screen.getByRole('group', { name: /Open slot/ }))[0])
    expect(screen.queryByRole('group', { name: /Open slot/ })).toBeNull()
    expect(currentRun().orders).toHaveLength(3)
    expect(currentRun().orders.at(-1)!.id).toBe(picked)
    expect(within(tab).queryByLabelText(/to choose/)).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('toasts a new order when one awaits a choice', () => {
    playOnScreen()
    act(() => {
      const run = currentRun()
      const order = run.orders[0]
      order.goal = { kind: 'stock', resource: 'wood', amount: 1 }
      order.baseline = undefined
      run.stock.wood = 50
      // No milestone draft on the way: this is about the order alone.
      run.cornerstonesTaken = REWARD_MILESTONES.length
      useGameStore.getState().setSpeed(1)
      useGameStore.getState().advance(0.25)
      useGameStore.getState().setSpeed(0)
    })
    expect(currentRun().orderOffers.length).toBeGreaterThan(0)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText(/new order awaits your choice in the Orders panel/)).toBeTruthy()
  })

  it('offers two decrees, each with its countdown, reward and miss cost', () => {
    playOnScreen()
    act(() => {
      offerDecrees(currentRun())
      bump()
    })
    const dialog = screen.getByRole('dialog', { name: /Royal Decree/i })
    const cards = cardsIn(dialog)
    expect(cards.length).toBeGreaterThan(0)
    for (const card of cards) expect(card.textContent).toMatch(/within \d+:\d\d.*Miss it/)
    expect(within(dialog).getByRole('button', { name: /Beg off both/ })).toBeTruthy()
    const id = currentRun().pendingChoices[0].options[0]
    fireEvent.click(cards[0])
    expect(currentRun().decree?.id).toBe(id)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('mid-run structure UI', () => {
  it('shows decrees and lingering conditions, and takes the charter', () => {
    showFoundedRun()
    render(<GameScreen />)

    act(() => {
      const run = currentRun()
      run.decreeTimer = 0
      proclaimFirstDecree(run)
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

  /** A founded run on the game screen with a finished woodcutters' camp, selected. */
  function settleWithCamp(): string {
    showFoundedRun()
    render(<GameScreen />)
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

  it('presents a milestone draft as a labelled modal dialog that holds focus', () => {
    playOnScreen()
    act(() => {
      currentRun().pendingChoices.push({ kind: 'blueprint', options: ['tavern', 'brewery'], mixed: true })
      bump()
    })

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

    fireEvent.click(within(dialog).getAllByRole('button').filter((b) => b.className.includes('option'))[0])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('switches side panels by tab and hotkey, ignoring modifiers and held keys', () => {
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

    // Clicking the tabs switches panels too.
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
    fireEvent.click(within(tabs).getByRole('tab', { name: /Build/i }))

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

describe('construction refunds in the inspector', () => {
  /** A woodcutters' camp site nobody has worked on yet, selected. */
  function selectFreshSite(): { siteId: string; woodBefore: number } {
    playOnScreen()
    const run = currentRun()
    const woodBefore = run.stock.wood ?? 0
    const spot = findPlacement(run, 'woodcuttersCamp')!
    act(() => {
      useGameStore.getState().setBuildMode('woodcuttersCamp')
      useGameStore.getState().place(spot)
      useGameStore.getState().setBuildMode(null)
    })
    const site = Object.values(currentRun().buildings).find(
      (b) => b.defId === 'woodcuttersCamp',
    )!
    expect(site.built).toBe(false)
    act(() => useGameStore.getState().selectBuilding(site.id))
    return { siteId: site.id, woodBefore }
  }

  /** The amount next to a resource's drawn icon in a refund label. */
  function refundOf(button: HTMLElement, art: string): string | undefined {
    return button.querySelector(`.bag-label svg[data-icon="${art}"]`)?.parentElement?.textContent ?? undefined
  }

  it('cancels an untouched site for every material back', () => {
    const { siteId, woodBefore } = selectFreshSite()
    const inspector = document.querySelector('.inspector') as HTMLElement
    expect(within(inspector).queryByRole('button', { name: /^Demolish$/ })).toBeNull()

    const cancel = within(inspector).getByRole('button', { name: 'Cancel construction' })
    fireEvent.click(cancel)
    const cost = BUILDINGS.woodcuttersCamp.cost.wood!
    expect(cancel.textContent).toMatch(/Confirm\? Refund/)
    expect(refundOf(cancel, 'wood')).toBe(`${cost}`)
    expect(cancel.textContent).toContain('(100%)')

    // Confirmed through the store's single demolish action: nothing is lost.
    fireEvent.click(cancel)
    expect(currentRun().buildings[siteId]).toBeUndefined()
    expect(currentRun().stock.wood).toBe(woodBefore)
  })

  it('shows the sliding refund while building, and half once finished', () => {
    const { siteId } = selectFreshSite()
    const inspector = document.querySelector('.inspector') as HTMLElement
    act(() => {
      currentRun().buildings[siteId].buildProgress = BUILDINGS.woodcuttersCamp.buildSeconds / 2
      bump()
    })
    const cancel = within(inspector).getByRole('button', { name: 'Cancel construction' })
    fireEvent.click(cancel)
    expect(cancel.textContent).toContain('(75%)')

    // Finishing the site disarms the button and renames it.
    act(() => {
      const site = currentRun().buildings[siteId]
      site.built = true
      site.buildProgress = BUILDINGS.woodcuttersCamp.buildSeconds
      bump()
    })
    const demolish = within(inspector).getByRole('button', { name: 'Demolish' })
    fireEvent.click(demolish)
    expect(demolish.textContent).toContain('(50%)')
    expect(refundOf(demolish, 'wood')).toBe(`${BUILDINGS.woodcuttersCamp.cost.wood! / 2}`)
  })
})

describe('auto-pause', () => {
  beforeEach(() => {
    useGameStore.setState({ settings: defaultSettings() })
  })

  function enable(trigger: keyof ReturnType<typeof defaultAutoPause>) {
    const settings = useGameStore.getState().settings
    act(() =>
      useGameStore
        .getState()
        .updateSettings({ autoPause: { ...settings.autoPause, [trigger]: true } }),
    )
  }

  /** Runs the sim at 1× until it stops itself, or gives up. */
  function runUntilPaused(maxSeconds = 5) {
    act(() => {
      useGameStore.getState().setSpeed(1)
      for (let t = 0; t < maxSeconds && useGameStore.getState().speed !== 0; t += 0.5) {
        useGameStore.getState().advance(0.5)
      }
    })
  }

  /** Answers a glade event with its threat-unleashing option. */
  function unleashThreat(): string {
    const event = GLADE_EVENT_LIST.find((e) => e.options.some((o) => o.threat))!
    const index = event.options.findIndex((o) => o.threat)
    act(() => {
      const run = currentRun()
      for (const [id, amount] of Object.entries(event.options[index].cost ?? {})) {
        run.stock[id as keyof typeof run.stock] = (amount ?? 0) + 50
      }
      run.pendingChoices.unshift({ kind: 'gladeEvent', options: [event.id], gladeId: 'glade1' })
      bump()
    })
    act(() => useGameStore.getState().chooseEventOption(index))
    return event.options[index].threat!.name
  }

  it('defaults to pausing for threats only, and migrates older settings', () => {
    expect(defaultSettings().autoPause).toEqual({
      threat: true,
      decree: false,
      departure: false,
      storm: false,
      caravan: false,
    })
    // Saved before auto-pause existed.
    localStorage.setItem(
      'emberwatch.settings.v1',
      JSON.stringify({ pauseOnBlur: false, sound: false, renderer: '2d', shadows: true }),
    )
    expect(loadSettings().autoPause).toEqual(defaultSettings().autoPause)
    expect(loadSettings().pauseOnBlur).toBe(false)
    // A partial or malformed set keeps what it can.
    localStorage.setItem(
      'emberwatch.settings.v1',
      JSON.stringify({ autoPause: { storm: true, threat: 'yes' } }),
    )
    expect(loadSettings().autoPause).toMatchObject({ storm: true, threat: true, caravan: false })
  })

  it('pauses when a threat is unleashed, and says why', () => {
    // On screen, so the notice is seen to reach the player; the other
    // triggers below read the store alone.
    playOnScreen()
    const name = unleashThreat()
    const clock = currentRun().clock
    runUntilPaused()
    expect(useGameStore.getState().speed).toBe(0)
    // Caught before the world moved on.
    expect(currentRun().clock).toBe(clock)
    const notice = useGameStore.getState().notice!
    expect(notice).toBe(`Paused: ${name} is loose.`)
    expect(screen.getByText(notice)).toBeTruthy()

    // Resuming does not pause again for the same threat.
    runUntilPaused(2)
    expect(useGameStore.getState().speed).toBe(1)
    expect(currentRun().clock).toBeGreaterThan(clock)
  })

  /** Puts the run a moment before the Storm. */
  function stormAlmostHere() {
    const season = currentRun().season
    season.season = 'clearance'
    season.elapsed = season.length - 0.2
  }

  it('pauses when the Storm begins, on the very tick at top speed, however long the frame', () => {
    showFoundedRun({ started: true })
    enable('storm')
    // At 1×, frame by frame.
    stormAlmostHere()
    runUntilPaused()
    expect(currentRun().season.season).toBe('storm')
    expect(useGameStore.getState().speed).toBe(0)
    expect(useGameStore.getState().notice).toBe('Paused: the Storm has begun.')

    // At 5×, in one long frame.
    useGameStore.setState({ notice: null })
    stormAlmostHere()
    act(() => {
      useGameStore.getState().setSpeed(5)
      // One long frame at 5× owes about twenty ticks; the pause must cut it short.
      useGameStore.getState().advance(MAX_FRAME_REAL_SECONDS)
    })
    expect(useGameStore.getState().speed).toBe(0)
    expect(currentRun().season.season).toBe('storm')
    // Stopped within a tick of the Storm, not at the end of the frame.
    expect(currentRun().season.elapsed).toBeLessThanOrEqual(0.125 + 1e-9)
    expect(useGameStore.getState().notice).toBe('Paused: the Storm has begun.')
  })

  it('does not fight a pause the player chose', () => {
    showFoundedRun({ started: true })
    // Paused, the player answers the event and the frame loop keeps running.
    unleashThreat()
    act(() => useGameStore.getState().advance(0.5))
    runUntilPaused(2)
    expect(useGameStore.getState().speed).toBe(1)
  })

  it('stays out of the way when the trigger is off', () => {
    showFoundedRun({ started: true })
    act(() =>
      useGameStore
        .getState()
        .updateSettings({ autoPause: { ...defaultSettings().autoPause, threat: false } }),
    )
    unleashThreat()
    runUntilPaused(2)
    expect(useGameStore.getState().speed).toBe(1)
  })

  it('pauses when the Queen issues a decree', () => {
    showFoundedRun({ started: true })
    enable('decree')
    act(() => {
      currentRun().decree = null
      currentRun().decreeTimer = 0.2
    })
    runUntilPaused()
    expect(useGameStore.getState().speed).toBe(0)
    // The herald's choice of decrees is what arrives; the clock stays stopped
    // while the player picks one.
    expect(currentRun().pendingChoices[0]?.kind).toBe('decree')
    expect(useGameStore.getState().notice).toBe(
      "Paused: the Queen's herald brings a choice of decrees.",
    )
    act(() => useGameStore.getState().chooseOption(currentRun().pendingChoices[0].options[0]))
    expect(currentRun().decree).not.toBeNull()
    expect(useGameStore.getState().speed).toBe(0)
  })

  it('pauses when a species starts to despair', () => {
    showFoundedRun({ started: true })
    enable('departure')
    const species = currentRun().speciesPool[0]
    act(() => {
      currentRun().resolve[species] = -20
    })
    runUntilPaused()
    expect(useGameStore.getState().speed).toBe(0)
    expect(useGameStore.getState().notice).toMatch(/in despair and will start leaving/)
  })

  it('pauses when a caravan arrives', () => {
    showFoundedRun({ started: true })
    enable('caravan')
    act(() => {
      const run = currentRun()
      const hearth = Object.values(run.buildings)[0]
      run.buildings.post = {
        ...hearth,
        id: 'post',
        defId: 'tradingPost',
        pos: { x: hearth.pos.x + 4, y: hearth.pos.y },
        built: true,
        workers: [],
      }
      run.caravan.here = false
      run.caravan.timer = 0.2
    })
    runUntilPaused()
    expect(currentRun().caravan.here).toBe(true)
    expect(useGameStore.getState().speed).toBe(0)
    expect(useGameStore.getState().notice).toBe('Paused: a caravan has arrived.')
  })

  it('lets the player change the triggers mid-run', () => {
    startPlaying()
    const settingsButton = screen.getByRole('button', { name: 'Game settings' })
    expect(settingsButton.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(settingsButton)
    const popover = screen.getByRole('group', { name: 'Game settings' })
    fireEvent.click(within(popover).getByRole('checkbox', { name: 'The Storm begins' }))
    expect(useGameStore.getState().settings.autoPause.storm).toBe(true)
    expect(loadSettings().autoPause.storm).toBe(true)

    // Esc closes it again.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'Game settings' })).toBeNull()
  })

  it('shows the same triggers in the menu settings', () => {
    render(<App />)
    const box = screen.getByRole('checkbox', { name: 'A caravan arrives' })
    fireEvent.click(box)
    expect(useGameStore.getState().settings.autoPause.caravan).toBe(true)
  })
})

describe('top-bar status toggle', () => {
  it('flags a danger on the folded status toggle without opening it', () => {
    showFoundedRun({ started: true })
    render(<TopBar />)
    const toggle = () => document.querySelector('.status-toggle') as HTMLElement
    expect(toggle().className).not.toMatch(/is-danger/)

    act(() => {
      currentRun().coldHearth = true
      bump()
    })
    expect(toggle().className).toMatch(/is-danger/)
    expect(toggle().getAttribute('aria-label')).toMatch(/The hearth is out/)
    expect(toggle().querySelector('.status-badge')?.textContent).toBe('1')

    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('#topbar-status')?.className).toMatch(/is-open/)
  })

  it('marks the impatience meter when the Queen is nearly out of patience', () => {
    showFoundedRun({ started: true })
    render(<TopBar />)
    act(() => {
      const run = currentRun()
      run.impatience = run.maxImpatience - 1
      bump()
    })
    expect(document.querySelector('.meter-bad')?.className).toMatch(/is-critical/)
  })
})
