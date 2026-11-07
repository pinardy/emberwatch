import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BUILDINGS } from '../game/content/buildings'
import { createRun } from '../game/engine/createRun'
import { takeChoice } from '../game/engine/events'
import { useGameStore } from '../game/store'
import type { BuildingInstance, RunState } from '../game/types'
import { GameScreen } from './GameScreen'
import { ResourceBar } from './ResourceBar'
import { TopBar } from './TopBar'
import { FALLING_FAST_SECONDS, TREND_MIN_SPAN, trendsBetween } from './stockTrends'

/**
 * The overlay dock and the resource bar: one region per kind of overlay, the
 * side panel as a foldable sheet, stock grouped by purpose with trends, and
 * the goods that hold a building up.
 */

function newRun(): RunState {
  const run = createRun({ seed: 7171, species: ['human', 'beaver', 'lizard'], modifiers: [] })
  while (run.pendingChoices.length > 0) takeChoice(run, run.pendingChoices[0].options[0])
  return run
}

function show(run: RunState) {
  act(() => useGameStore.setState({ run, version: useGameStore.getState().version + 1 }))
}

beforeEach(() => {
  localStorage.clear()
  useGameStore.setState({ screen: 'game', run: null, speed: 0, panel: 'build', notice: null })
})

afterEach(cleanup)

describe('stock trends', () => {
  it('needs a minimum span before calling a direction', () => {
    const a = { clock: 0, stock: { wood: 100 } }
    expect(trendsBetween(a, { clock: TREND_MIN_SPAN - 1, stock: { wood: 10 } })).toEqual({})
  })

  it('calls rising, falling and steady stocks, and flags one about to run dry', () => {
    const t = trendsBetween(
      { clock: 0, stock: { wood: 100, plank: 10, stone: 50, berry: 200 } },
      { clock: 30, stock: { wood: 40, plank: 30, stone: 50, berry: 190 } },
    )
    // Wood: −60 in 30 s is −120/min, so 40 lasts 20 s.
    expect(t.wood).toMatchObject({
      direction: 'down',
      perMinute: -120,
      runway: 20,
      fallingFast: true,
    })
    expect(t.plank).toMatchObject({
      direction: 'up',
      perMinute: 40,
      runway: null,
      fallingFast: false,
    })
    expect(t.stone).toMatchObject({ direction: 'flat', fallingFast: false })
    // Berries fall 20/min: a direction, but 190 lasts well past the flag.
    expect(t.berry!.direction).toBe('down')
    expect(t.berry!.runway!).toBeGreaterThan(FALLING_FAST_SECONDS)
    expect(t.berry!.fallingFast).toBe(false)
  })
})

describe('resource bar', () => {
  it('groups the stock by purpose, with amber among the trade goods', () => {
    const run = newRun()
    run.stock = { wood: 30, plank: 5, berry: 12, meat: 3, resin: 4, ale: 2, amber: 9 }
    show(run)
    render(<ResourceBar />)
    const group = (name: string) => screen.getByRole('group', { name })
    expect(within(group('Food')).getByTitle(/^Berries: 12/)).toBeTruthy()
    expect(within(group('Food')).getByTitle(/^Meat: 3/)).toBeTruthy()
    expect(within(group('Building materials')).getByTitle(/^Wood: 30/)).toBeTruthy()
    expect(within(group('Crafted goods & parts')).getByTitle(/^Resin: 4/)).toBeTruthy()
    const trade = group('Trade goods & amber')
    expect(
      Array.from(trade.querySelectorAll('.resource')).map((el) => el.getAttribute('title')),
    ).toEqual(['Amber: 9', 'Ale: 2'])
    // Low-priority groups are the ones that fold on narrow bars.
    expect(group('Crafted goods & parts').className).toContain('is-low')
    expect(group('Food').className).toContain('is-high')
    // The food runway reads on its own.
    expect(screen.getByLabelText(/^Food runway: /)).toBeTruthy()
  })

  it('marks a falling stock and flags one about to run dry', () => {
    const run = newRun()
    run.clock = 100
    run.stock = { wood: 100, plank: 10 }
    show(run)
    render(<ResourceBar />)
    // Snapshots are taken as the clock moves; 30 game seconds later wood is going fast.
    for (let t = 103; t <= 130; t += 3) {
      act(() => {
        run.clock = t
        run.stock.wood = 100 - (t - 100) * 2
        run.stock.plank = 10 + (t - 100)
        useGameStore.setState({ version: useGameStore.getState().version + 1 })
      })
    }
    const wood = screen.getByTitle(/^Wood: 40/)
    expect(wood.className).toContain('is-falling')
    expect(wood.className).toContain('is-falling-fast')
    expect(wood.className).toContain('is-flagged')
    expect(wood.getAttribute('title')).toMatch(/falling −120\/min — runs out in about 20s/)
    expect(within(wood).getByLabelText('falling')).toBeTruthy()
    const plank = screen.getByTitle(/^Planks: 40/)
    expect(plank.className).toContain('is-rising')
    expect(within(plank).getByLabelText('rising')).toBeTruthy()
    // The drawer's toggle says something needs attention.
    expect(
      screen.getByRole('button', { name: /All stock: 2 goods, 1 need attention/ }),
    ).toBeTruthy()
  })

  it('shows an empty good that holds a building up, and lists everything in the drawer', () => {
    const run = newRun()
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
      recipeProgress: 0,
      paused: false,
      depositsInRange: {},
    }
    worker.assignment = mill.id
    run.buildings[mill.id] = mill
    run.stock = { berry: 20, stone: 5 }
    show(run)
    render(<ResourceBar />)

    const wood = screen.getByTitle(/^Wood: 0/)
    expect(wood.className).toContain('is-blocking')
    expect(wood.getAttribute('title')).toContain(`holding up ${BUILDINGS.lumberMill.name}`)
    expect(
      within(screen.getByRole('group', { name: 'Building materials' })).getByTitle(/^Wood: 0/),
    ).toBe(wood)

    const toggle = screen.getByRole('button', { name: /^All stock: 2 goods, 1 need attention/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const drawer = screen.getByRole('group', { name: 'All stock' })
    expect(within(drawer).getByText('Berries')).toBeTruthy()
    expect(within(drawer).getByText('Stone')).toBeTruthy()
    expect(within(drawer).getByText(`Holding up ${BUILDINGS.lumberMill.name}`)).toBeTruthy()
    // A tap inside keeps it open; a tap anywhere else closes it.
    fireEvent.pointerDown(drawer)
    expect(screen.getByRole('group', { name: 'All stock' })).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('group', { name: 'All stock' })).toBeNull()
  })
})

describe('overlay dock', () => {
  it('puts each overlay in its region and folds the side panel to its tabs', () => {
    const run = newRun()
    show(run)
    render(<GameScreen />)
    const dock = document.querySelector('.hud-stack')!
    expect(Array.from(dock.children).map((el) => el.className)).toEqual([
      'hud-top',
      'hud-context',
      'bottom-stack',
      // The news log stays mounted, empty, so its first toast is announced.
      'event-toasts is-empty',
    ])
    expect(dock.querySelector('.hud-top > .warnings')).toBeTruthy()

    const handle = screen.getByRole('button', { name: 'Fold the panel away' })
    expect(handle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(handle)
    expect(useGameStore.getState().panel).toBeNull()
    expect(document.querySelector('.sidebar')!.className).toContain('is-folded')
    expect(handle.getAttribute('aria-label')).toBe('Open the panel')
    fireEvent.click(handle)
    expect(useGameStore.getState().panel).toBe('build')
  })
})

describe('meters', () => {
  it('give the rate its own line, and carry a short label for narrow meters', () => {
    show(newRun())
    render(<TopBar />)
    const meter = (name: string) => screen.getByRole('meter', { name }).closest('.meter')!
    const labels = (name: string) => [
      meter(name).querySelector('.meter-label-long')!.textContent,
      meter(name).querySelector('.meter-label-short')!.textContent,
    ]
    expect(labels('Reputation')).toEqual(['Reputation', 'Rep.'])
    expect(labels('Impatience')).toEqual(['Impatience', 'Impat.'])
    expect(labels('Hostility')).toEqual(['Hostility', 'Host.'])
    // The rate sits under the bar, never in the label line it used to truncate.
    for (const name of ['Impatience', 'Hostility']) {
      expect(meter(name).querySelector('.meter-label .meter-rate')).toBeNull()
      expect(meter(name).querySelector('.meter-sub .meter-rate')!.textContent).toMatch(
        /^\+\d+\.\d+\/min$/,
      )
    }
    expect(meter('Reputation').querySelector('.meter-sub')).toBeNull()
  })
})
