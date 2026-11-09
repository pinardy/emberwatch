import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STORM_BLIGHT_LIST } from '../game/content/stormBlights'
import { announceBlight } from '../game/engine/blights'
import { useGameStore } from '../game/store'
import type { ActiveThreat, Errand, RunState } from '../game/types'
import { foundedRun, showRun } from '../test/foundedRun'
import { proclaimFirstDecree } from '../test/decrees'
import { FIRST_STEPS_RETIRED_NOTICE, loadFirstStepsStatus, useFirstStepsStatus } from './FirstSteps'
import { GameScreen } from './GameScreen'
import { hudStripItems } from './HudStrip'
import { SHEET_KEY, resetPhoneSheetForTests, snapSheet, usePhoneSheet } from './phoneSheet'
import { TIPS } from './tips'
import { useSeenTips } from './TipsCoach'
import { setNarrowScreenForTests } from './useNarrowScreen'

/**
 * The HUD on a phone (the narrow layout, chosen here with
 * `setNarrowScreenForTests` since jsdom has no media queries): the bottom
 * stack folded into one strip, coach tips in the panel sheet, the sheet's
 * three heights and their memory, and First steps as a chip that retires
 * once the first Storm has passed. Desktop must stay as it was.
 */

function threat(run: RunState, id: string, timer: number): ActiveThreat {
  const glade = Object.values(run.glades).find((g) => !g.cleared)!
  return {
    id,
    gladeId: glade.id,
    name: `Menace ${id}`,
    icon: '🐺',
    description: '',
    interval: 60,
    timer,
    appease: { wood: 10 },
    strike: { hostility: 2 },
  }
}

function errand(run: RunState, timeLeft: number): Errand {
  const glade = Object.values(run.glades).find((g) => !g.cleared)!
  return {
    id: 'e1',
    defId: 'haulToClearers',
    title: `Carry 10 Wood to the ${glade.name} clearers`,
    goal: { kind: 'deliver', resource: 'wood', amount: 10 },
    progress: 0,
    timeLeft,
    timeLimit: 75,
    reward: { reputation: 0.35 },
    gladeId: glade.id,
  }
}

/** A run with a blight forecast, the decree, a lingering condition, a threat and an errand. */
function busyRun(): RunState {
  const run = foundedRun()
  expect(proclaimFirstDecree(run)).toBe(true)
  run.decree!.timeLeft = 90
  const blight = announceBlight(run, STORM_BLIGHT_LIST[0])
  blight.timeLeft = 140
  run.conditions.push({ ...blight, id: 'cLinger', name: 'Lingering Rot', breaksWithStorm: undefined, timeLeft: 40 })
  run.threats.push(threat(run, 't1', 200))
  run.errands = [errand(run, 15)]
  return run
}

beforeEach(() => {
  localStorage.clear()
  useFirstStepsStatus.setState({ status: 'dismissed' })
  useSeenTips.setState({ seen: [] })
  resetPhoneSheetForTests()
  setNarrowScreenForTests(true)
})

afterEach(() => {
  cleanup()
  setNarrowScreenForTests(null)
})

describe('the HUD strip', () => {
  it('orders items: a threat or blight soonest first, then the decree and conditions by time left, then errands', () => {
    const run = busyRun()
    const items = hudStripItems(run)
    expect(items.map((i) => i.kind)).toEqual(['blight', 'threat', 'condition', 'decree', 'errand'])
    // The errand is the closest to running out, yet still last: it is optional.
    expect(items.map((i) => i.seconds)).toEqual([140, 200, 40, 90, 15])

    // A threat about to strike goes ahead of the blight.
    run.threats[0].timer = 12
    expect(hudStripItems(run)[0]).toMatchObject({ kind: 'threat', name: 'Menace t1', urgent: true })
    // Without threats and blights the decree leads when it is soonest.
    run.threats = []
    run.conditions = run.conditions.filter((c) => !c.breaksWithStorm)
    run.decree!.timeLeft = 30
    expect(hudStripItems(run).map((i) => i.kind)).toEqual(['decree', 'condition', 'errand'])
  })

  it('shows the most urgent item with its clock, and "+N more" opens and closes the full stack', () => {
    const run = busyRun()
    showRun(run)
    render(<GameScreen />)
    const strip = screen.getByRole('group', { name: 'Decrees, conditions and threats' })
    const top = within(strip).getByTestId('hud-strip-top')
    expect(top.textContent).toContain(STORM_BLIGHT_LIST[0].name)
    expect(top.textContent).toContain('2:20')
    expect(top.textContent).toMatch(/Blight/)
    // Folded: none of the full cards is over the map.
    expect(screen.queryByRole('group', { name: 'Conditions and decrees' })).toBeNull()
    expect(document.querySelector('.threat-card')).toBeNull()
    expect(screen.queryByTestId('errand-chip')).toBeNull()

    const more = within(strip).getByRole('button', { name: /\+4 more/ })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    more.focus()
    fireEvent.click(more)
    // The same control, now "Show less", keeps focus.
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(more.textContent).toBe('Show less')
    expect(document.activeElement).toBe(more)
    const full = document.getElementById(more.getAttribute('aria-controls')!)!
    // Every card, with everything it had: the decree, conditions, the threat
    // with its Appease button, and the errand.
    const conditions = within(full).getByRole('group', { name: 'Conditions and decrees' })
    expect(conditions.querySelector('.is-decree')).toBeTruthy()
    expect(conditions.querySelector('.is-blight')!.textContent).toContain(STORM_BLIGHT_LIST[0].name)
    expect(within(full).getByRole('button', { name: /Appease/ })).toBeTruthy()
    expect(within(full).getByTestId('errand-chip')).toBeTruthy()
    expect(within(strip).queryByTestId('hud-strip-top')).toBeNull()

    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('group', { name: 'Conditions and decrees' })).toBeNull()
    expect(within(strip).getByTestId('hud-strip-top')).toBeTruthy()

    // Esc folds it again too.
    fireEvent.click(more)
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
  })

  it('takes the player to the item: the glade on the map, or the Orders panel', () => {
    const run = busyRun()
    showRun(run)
    render(<GameScreen />)
    // A blight belongs to no glade: a tap opens its full card, with what lifts it.
    fireEvent.click(screen.getByTestId('hud-strip-top'))
    expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('.hud-strip-full .is-blight')!.textContent).toMatch(/To lift/)
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))

    // A threat shows its glade.
    act(() => {
      run.conditions = run.conditions.filter((c) => !c.breaksWithStorm)
      run.threats[0].timer = 10
      useGameStore.setState({ hudVersion: useGameStore.getState().hudVersion + 1 })
    })
    // (The map takes the focus request at once, so record it as it is made.)
    const focused: unknown[] = []
    const stop = useGameStore.subscribe((s) => s.cameraFocus && focused.push(s.cameraFocus))
    fireEvent.click(screen.getByTestId('hud-strip-top'))
    stop()
    expect(focused[0]).toMatchObject(run.glades[run.threats[0].gladeId].center)

    act(() => {
      run.threats = []
      run.conditions = []
      useGameStore.setState({ hudVersion: useGameStore.getState().hudVersion + 1 })
    })
    const top = screen.getByTestId('hud-strip-top')
    expect(top.textContent).toMatch(/Decree/)
    // One item left besides it: the control says "+1 more".
    expect(screen.getByRole('button', { name: /\+1 more/ })).toBeTruthy()
    act(() => useGameStore.setState({ panel: 'build' }))
    fireEvent.click(top)
    expect(useGameStore.getState().panel).toBe('orders')
  })

  it('leaves the desktop stack as it was', () => {
    setNarrowScreenForTests(false)
    showRun(busyRun())
    render(<GameScreen />)
    expect(screen.queryByTestId('hud-strip')).toBeNull()
    const stack = document.querySelector('.bottom-stack')!
    expect(Array.from(stack.children).map((el) => el.className.split(' ')[0])).toEqual([
      'condition-card',
      'conditions-bar',
      'threat-bar',
    ])
    expect(screen.getByTestId('errand-chip')).toBeTruthy()
  })
})

describe('coach tips on a phone', () => {
  it('show in the open sheet, as a slim bar while it is folded, and in the corner on desktop', () => {
    showRun(foundedRun())
    render(<GameScreen />)
    const sheetTip = () => document.querySelector('.sidebar .sheet-tip')!
    // The welcome tip, in the sheet above the panel, not over the map.
    const tip = screen.getByRole('status', { name: 'Tip' })
    expect(sheetTip().contains(tip)).toBe(true)
    expect(document.querySelector('.hud-context .tip-coach')).toBeNull()
    expect(within(tip).getByText(/Reputation meter/)).toBeTruthy()

    // Folded: a one-line bar that opens the sheet.
    act(() => useGameStore.getState().setPanel(null))
    const bar = screen.getByRole('status', { name: 'Tip' })
    expect(bar.className).toContain('is-bar')
    expect(document.querySelector('.hud-context')!.contains(bar)).toBe(true)
    expect(within(bar).queryByText(/Reputation meter/)).toBeNull()
    fireEvent.click(within(bar).getByRole('button', { name: /read the tip/ }))
    expect(useGameStore.getState().panel).toBe('build')
    expect(sheetTip().contains(screen.getByRole('status', { name: 'Tip' }))).toBe(true)

    // "Got it" still puts it away for good.
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('status', { name: 'Tip' })).toBeNull()
    expect(useSeenTips.getState().seen).toContain('welcome')
  })

  it('keep their corner card on desktop', () => {
    setNarrowScreenForTests(false)
    showRun(foundedRun())
    render(<GameScreen />)
    const tip = screen.getByRole('status', { name: 'Tip' })
    expect(document.querySelector('.hud-context')!.contains(tip)).toBe(true)
    expect(tip.className).toBe('tip-coach')
    expect(document.querySelector('.sheet-tip')).toBeNull()
  })
})

describe('the panel sheet on a phone', () => {
  const sidebar = () => document.querySelector('.sidebar')!

  it('opens short, and the handle steps it taller, folded and open again, remembering each choice', () => {
    useSeenTips.setState({ seen: ['welcome'] })
    showRun(foundedRun())
    render(<GameScreen />)
    expect(sidebar().className).toContain('sheet-peek')
    fireEvent.click(screen.getByRole('button', { name: 'Expand the panel' }))
    expect(sidebar().className).toContain('sheet-full')
    expect(localStorage.getItem(SHEET_KEY)).toBe('full')

    const handle = screen.getByRole('button', { name: 'Fold the panel away' })
    expect(handle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(handle)
    expect(useGameStore.getState().panel).toBeNull()
    expect(sidebar().className).toContain('is-folded')
    expect(localStorage.getItem(SHEET_KEY)).toBe('folded')
    expect(handle.getAttribute('aria-expanded')).toBe('false')

    expect(handle.getAttribute('aria-label')).toBe('Open the panel')
    fireEvent.click(handle)
    expect(useGameStore.getState().panel).toBe('build')
    expect(sidebar().className).toContain('sheet-peek')
    expect(localStorage.getItem(SHEET_KEY)).toBe('peek')

    // Pressing the open tab again folds it, and that is remembered too.
    fireEvent.click(screen.getByRole('tab', { name: /Build/ }))
    expect(useGameStore.getState().panel).toBeNull()
    expect(localStorage.getItem(SHEET_KEY)).toBe('folded')
  })

  it('comes back folded, or tall, as the player left it', () => {
    localStorage.setItem(SHEET_KEY, 'folded')
    resetPhoneSheetForTests()
    showRun(foundedRun())
    const { unmount } = render(<GameScreen />)
    expect(useGameStore.getState().panel).toBeNull()
    unmount()

    localStorage.setItem(SHEET_KEY, 'full')
    resetPhoneSheetForTests()
    showRun(foundedRun())
    render(<GameScreen />)
    expect(useGameStore.getState().panel).toBe('build')
    expect(sidebar().className).toContain('sheet-full')
  })

  it('a stored value it does not know, or none, opens at the short default', () => {
    localStorage.setItem(SHEET_KEY, 'sideways')
    resetPhoneSheetForTests()
    expect(usePhoneSheet.getState().size).toBe('peek')
  })

  it('drags by its tab row and settles on the nearest height, without the drag counting as a tap', () => {
    useSeenTips.setState({ seen: ['welcome'] })
    showRun(foundedRun())
    render(<GameScreen />)
    const aside = sidebar() as HTMLElement
    // jsdom does no layout: the sheet is as tall as the drag makes it.
    aside.getBoundingClientRect = () =>
      ({ height: aside.style.height ? parseFloat(aside.style.height) : 170 }) as DOMRect
    const tab = screen.getByRole('tab', { name: /Orders/ })
    fireEvent.pointerDown(tab, { pointerId: 1, isPrimary: true, clientY: 700, button: 0, pointerType: 'touch' })
    fireEvent.pointerMove(tab, { pointerId: 1, isPrimary: true, clientY: 380, pointerType: 'touch' })
    expect(aside.style.height).toBe('490px')
    fireEvent.pointerUp(tab, { pointerId: 1, isPrimary: true, clientY: 380, pointerType: 'touch' })
    fireEvent.click(tab)
    expect(sidebar().className).toContain('sheet-full')
    expect(aside.style.height).toBe('')
    expect(useGameStore.getState().panel).toBe('build')
    expect(localStorage.getItem(SHEET_KEY)).toBe('full')

    // Dragged most of the way down: folded.
    fireEvent.pointerDown(tab, { pointerId: 2, isPrimary: true, clientY: 300, button: 0, pointerType: 'touch' })
    fireEvent.pointerMove(tab, { pointerId: 2, isPrimary: true, clientY: 750, pointerType: 'touch' })
    fireEvent.pointerUp(tab, { pointerId: 2, isPrimary: true, clientY: 750, pointerType: 'touch' })
    expect(useGameStore.getState().panel).toBeNull()
    expect(localStorage.getItem(SHEET_KEY)).toBe('folded')
  })

  it('snaps to folded, peek or tall by the nearest height', () => {
    // An 844px-tall phone: peek is 186px, tall 506px, the tabs 56px.
    expect(snapSheet(80, 56, 844)).toBe('folded')
    expect(snapSheet(200, 56, 844)).toBe('peek')
    expect(snapSheet(340, 56, 844)).toBe('peek')
    expect(snapSheet(360, 56, 844)).toBe('full')
  })

  it('keeps the desktop handle a plain fold and open', () => {
    setNarrowScreenForTests(false)
    showRun(foundedRun())
    render(<GameScreen />)
    expect(sidebar().className).not.toMatch(/sheet-/)
    const handle = screen.getByRole('button', { name: 'Fold the panel away' })
    fireEvent.click(handle)
    expect(handle.getAttribute('aria-label')).toBe('Open the panel')
    expect(localStorage.getItem(SHEET_KEY)).toBeNull()
  })
})

describe('first steps', () => {
  beforeEach(() => {
    useFirstStepsStatus.setState({ status: 'open' })
  })

  it('is a chip on a phone that opens the list on tap and folds again', () => {
    showRun(foundedRun())
    render(<GameScreen />)
    const region = screen.getByRole('region', { name: 'First steps' })
    const chip = within(region).getByRole('button', { name: /First steps\s*0\/4/ })
    expect(chip.getAttribute('aria-expanded')).toBe('false')
    expect(within(region).queryByRole('list')).toBeNull()

    chip.focus()
    fireEvent.click(chip)
    const open = within(region).getByRole('button', { name: /First steps\s*0\/4/ })
    expect(open.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(open)
    const list = within(region).getByRole('list')
    expect(open.getAttribute('aria-controls')).toBe(list.id)
    expect(within(list).getByRole('button', { name: /Build a Foragers' Camp/ })).toBeTruthy()

    fireEvent.click(open)
    expect(within(region).queryByRole('list')).toBeNull()
    expect(document.activeElement).toBe(within(region).getByRole('button', { name: /First steps/ }))
  })

  it('stays a card on desktop', () => {
    setNarrowScreenForTests(false)
    showRun(foundedRun())
    render(<GameScreen />)
    const region = screen.getByRole('region', { name: 'First steps' })
    expect(within(region).queryByRole('button', { name: /First steps\s*0\/4/ })).toBeNull()
    expect(within(region).getByRole('list')).toBeTruthy()
  })

  it('stays through the first Storm, then retires with a notice once Year 2 begins', () => {
    setNarrowScreenForTests(false)
    // No tip takes the checklist's place meanwhile.
    useSeenTips.setState({ seen: TIPS.map((t) => t.id) })
    const run = foundedRun()
    run.season.season = 'storm'
    showRun(run)
    render(<GameScreen />)
    expect(screen.getByRole('region', { name: 'First steps' })).toBeTruthy()

    // The Storm passes with steps still unticked.
    act(() => {
      run.season.year = 2
      run.season.season = 'drizzle'
      useGameStore.setState({ hudVersion: useGameStore.getState().hudVersion + 1 })
    })
    expect(screen.queryByRole('region', { name: 'First steps' })).toBeNull()
    expect(localStorage.getItem('emberwatch.firstSteps.v1')).toBe('retired')
    expect(useFirstStepsStatus.getState().status).toBe('retired')
    expect(useGameStore.getState().notice).toBe(FIRST_STEPS_RETIRED_NOTICE)
    expect(screen.getByText(/First steps put away/)).toBeTruthy()

    // Said once: it does not come back, nor does the notice.
    act(() => useGameStore.setState({ notice: null, hudVersion: useGameStore.getState().hudVersion + 1 }))
    expect(useGameStore.getState().notice).toBeNull()
    expect(screen.queryByRole('region', { name: 'First steps' })).toBeNull()
  })

  it('a save already past the first Storm retires it at once', () => {
    const run = foundedRun()
    run.season.year = 3
    showRun(run)
    render(<GameScreen />)
    expect(screen.queryByRole('region', { name: 'First steps' })).toBeNull()
    expect(localStorage.getItem('emberwatch.firstSteps.v1')).toBe('retired')
  })

  it('reads the values older versions stored, and the new one', () => {
    expect(loadFirstStepsStatus()).toBe('open')
    for (const value of ['done', 'dismissed', 'retired'] as const) {
      localStorage.setItem('emberwatch.firstSteps.v1', value)
      expect(loadFirstStepsStatus()).toBe(value)
    }
    localStorage.setItem('emberwatch.firstSteps.v1', 'something else')
    expect(loadFirstStepsStatus()).toBe('open')
  })
})
