import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { ACHIEVEMENT_LIST } from '../game/content/achievements'
import { dailyExpedition } from '../game/content/daily'
import { META_UPGRADES, citadelLoadout, defaultMeta } from '../game/content/meta'
import { SPECIES } from '../game/content/species'
import { landFor } from '../game/engine/runModifiers'
import { createRun } from '../game/engine/createRun'
import { saveMeta } from '../game/persistence'
import { SLOTS_FULL_NOTICE, useGameStore } from '../game/store'
import type { MetaState, RunState } from '../game/types'

/** UI for the reasons to come back: the daily, achievements and the new Citadel options. */

const TODAY = '2026-11-05'
const NOW = Date.UTC(2026, 10, 5, 15, 30)

function currentRun(): RunState {
  const run = useGameStore.getState().run
  if (!run) throw new Error('expected a run')
  return run
}

function owning(...ids: string[]): MetaState {
  const out = new Set<string>()
  const visit = (id: string) => {
    for (const req of META_UPGRADES[id]?.requires ?? []) visit(req)
    out.add(id)
  }
  ids.forEach(visit)
  return { ...defaultMeta(), upgrades: [...out] }
}

/** The app reloads meta from storage on boot, so tests seed it there. */
function useMeta(meta: MetaState) {
  saveMeta(meta)
  useGameStore.setState({ meta })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  localStorage.clear()
  useGameStore.setState({
    screen: 'menu',
    run: null,
    meta: defaultMeta(),
    speed: 0,
    selectedGlade: null,
    selectedBuilding: null,
    selectedDeposit: null,
    notice: null,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the daily expedition', () => {
  it('shows today on the menu, sets out, and posts a shareable result when won', () => {
    render(<App />)
    const day = dailyExpedition(TODAY)
    const entry = screen.getByRole('button', { name: /Daily expedition/i })
    expect(entry.textContent).toContain(TODAY)
    expect(entry.textContent).toContain('Not attempted yet')
    expect(entry.textContent).toContain('Edict II')

    fireEvent.click(entry)
    expect(screen.getByRole('heading', { name: /Daily expedition/i })).toBeTruthy()
    for (const id of day.species)
      expect(screen.getAllByText(new RegExp(SPECIES[id].name)).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Set out on ${TODAY}`) }))

    const run = currentRun()
    expect(run.daily).toBe(TODAY)
    expect(run.seed).toBe(day.seed)
    expect(run.edict).toBe(2)

    // Win it on the spot.
    act(() => {
      run.pendingChoices = []
      run.clock = 19 * 60
      run.reputation = run.maxReputation
      useGameStore.getState().setSpeed(1)
      useGameStore.getState().advance(0.5)
    })
    const end = screen.getByRole('region', { name: /Daily expedition/i })
    const share = within(end).getByRole('textbox', {
      name: /Share text/i,
    }) as HTMLInputElement
    expect(share.value).toMatch(/^Emberwatch Daily 2026-11-05 — won in Y1, 19 min, 0 lost$/)
    const earned = screen.getByRole('region', { name: /Achievements earned/i })
    expect(earned.textContent).toContain('First Embers')
    expect(earned.textContent).toContain('Daily Bread')
    // A daily never promises an edict rung.
    expect(screen.queryByText(/unlocks Edict/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Return to the Citadel/i }))
    // Back on the daily page, with the result and its share line.
    expect(screen.getByRole('heading', { name: /Daily expedition/i })).toBeTruthy()
    const today = screen.getByRole('region', { name: /Today's result/i })
    expect(today.textContent).toContain('Held in Y1')
    expect((within(today).getByRole('textbox') as HTMLInputElement).value).toContain('won in Y1')
    expect(useGameStore.getState().meta.edictUnlocked).toBe(0)
    expect(screen.getByRole('button', { name: /Try again/i })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Back to menu/i }))
    const after = screen.getByRole('button', { name: /Daily expedition/i })
    expect(after.textContent).toContain('Held in Y1')
    expect(after.textContent).toContain('1-day streak')
  })

  it('says a refused start is a problem, not a result, and offers the saves screen', () => {
    useGameStore.setState({ screen: 'daily', notice: SLOTS_FULL_NOTICE })
    render(<App />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Every save slot holds a settlement')
    expect(alert.className).toContain('is-bad')
    expect(screen.queryByRole('status', { name: /Every save slot/i })).toBeNull()
    fireEvent.click(within(alert).getByRole('button', { name: /Manage saves/i }))
    expect(useGameStore.getState().screen).toBe('saves')
  })

  it('copies the share line, or leaves it selected without clipboard access', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    useGameStore.setState({ screen: 'daily' })
    useMeta({
      ...defaultMeta(),
      daily: {
        results: [
          {
            date: TODAY,
            seed: 1,
            won: true,
            years: 4,
            reputation: 20,
            villagersLost: 0,
            seconds: 1140,
            attempts: 2,
            at: 1,
          },
          {
            date: '2026-11-04',
            seed: 2,
            won: false,
            years: 5,
            reputation: 11,
            villagersLost: 3,
            seconds: 2000,
            attempts: 1,
            at: 1,
          },
        ],
        bestStreak: 2,
      },
    })
    render(<App />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Copy/i }))
    })
    expect(writeText).toHaveBeenCalledWith(
      'Emberwatch Daily 2026-11-05 — won in Y4, 19 min, 0 lost · 2-day streak',
    )
    expect(screen.getByRole('button', { name: /Copied/i })).toBeTruthy()
    // Past dailies are listed.
    const table = screen.getByRole('table')
    expect(table.textContent).toContain('2026-11-04')
    vi.unstubAllGlobals()
  })
})

describe('achievements view', () => {
  it('opens from the menu and the Citadel, with progress and a title picker', () => {
    useMeta({
      ...defaultMeta(),
      achievements: {
        unlocked: { firstEmbers: Date.UTC(2026, 10, 1), noOneLeftBehind: 0 },
        progress: { seasonedViceroy: 4 },
      },
    })
    render(<App />)
    fireEvent.click(
      screen.getByRole('button', {
        name: new RegExp(`Achievements \\(2/${ACHIEVEMENT_LIST.length}\\)`),
      }),
    )
    expect(screen.getByRole('heading', { name: /Achievements/i })).toBeTruthy()
    expect(screen.getByText('✓ Earned 2026-11-01')).toBeTruthy()
    const bar = screen.getByRole('progressbar', { name: /Seasoned Viceroy/i })
    expect(bar.getAttribute('aria-valuenow')).toBe('4')
    expect(bar.getAttribute('aria-valuemax')).toBe('10')

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'the Shepherd' },
    })
    expect(useGameStore.getState().meta.title).toBe('the Shepherd')

    fireEvent.click(screen.getByRole('button', { name: /The Citadel/i }))
    fireEvent.click(screen.getByRole('button', { name: /Achievements/i }))
    expect(screen.getByRole('heading', { name: /Achievements/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Back to menu/i }))
    expect(screen.getByText(/Viceroy the Shepherd/)).toBeTruthy()
  })
})

describe('Citadel land options on the setup screen', () => {
  it('shows nothing extra without the upgrades', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    expect(screen.queryByRole('button', { name: /Re-roll the land/i })).toBeNull()
    expect(screen.queryByText(/Chosen ground/i)).toBeNull()
  })

  it('re-rolls once and picks a land, and the run gets what the preview showed', () => {
    const meta = owning('chosenGround')
    useMeta(meta)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.change(screen.getByRole('textbox', { name: /Map seed/i }), {
      target: { value: '4242' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Re-roll the land/i }))
    expect(screen.getByRole('button', { name: /Back to the seed's own land/i })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'longStorms' },
    })
    const expected = landFor(4242, citadelLoadout(meta.upgrades), {
      reroll: true,
      chosen: 'longStorms',
    })
    expect(expected[0]).toBe('longStorms')
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    expect(currentRun().runModifiers).toEqual(expected)
  })

  it('pins a random seed when the land is re-rolled with the seed left blank', () => {
    useMeta(owning('secondSurvey'))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    const seed = screen.getByRole('textbox', {
      name: /Map seed/i,
    }) as HTMLInputElement
    expect(seed.value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: /Re-roll the land/i }))
    expect(seed.value).toMatch(/^\d+$/)
  })
})

describe("Scouts' Report in the Inspector", () => {
  it('names what waits in a first-ring glade', () => {
    const run = createRun({
      seed: 1234,
      species: ['human', 'beaver', 'lizard'],
      meta: owning('scoutsReport'),
    })
    run.pendingChoices = []
    const ring = run.glades.glade0.neighbors
    const withEvent = ring.find((id) => run.glades[id].eventId)
    const quiet = ring.find((id) => !run.glades[id].eventId)
    useGameStore.setState({
      run,
      screen: 'game',
      selectedGlade: withEvent ?? quiet ?? null,
      version: 1,
    })
    render(<App />)
    expect(screen.getByText(/Scouts' report:/)).toBeTruthy()
  })
})
