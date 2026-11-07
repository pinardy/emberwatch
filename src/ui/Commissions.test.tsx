import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { COMMISSIONS, commissionOffer, unlockedCommissions } from '../game/content/commissions'
import { META_UPGRADES, defaultMeta } from '../game/content/meta'
import { createRun } from '../game/engine/createRun'
import { saveMeta } from '../game/persistence'
import { useGameStore } from '../game/store'
import type { MetaState, RunState } from '../game/types'

/** Citadel commissions in the UI: the pick, the Orders card, the verdict, the board. */

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

function useMeta(meta: MetaState) {
  saveMeta(meta)
  useGameStore.setState({ meta })
}

/** A run on `commission` with no choices pending, shown in the game. */
function playing(commission: string): RunState {
  const run = createRun({ seed: 4242, species: ['human', 'beaver', 'lizard'], commission })
  run.pendingChoices = []
  useGameStore.setState({ run, screen: 'game', panel: 'orders', version: 1 })
  return run
}

beforeEach(() => {
  localStorage.clear()
  useGameStore.setState({
    screen: 'menu',
    run: null,
    meta: defaultMeta(),
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

describe('choosing a commission on the setup screen', () => {
  it('offers no commission (chosen by default) and the open board', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    const group = screen.getByRole('radiogroup', { name: /Commission/i })
    const options = within(group).getAllByRole('radio')
    expect(options).toHaveLength(1 + unlockedCommissions([]).length)
    expect(within(group).getByRole('radio', { name: /No commission/i }).getAttribute('aria-checked')).toBe('true')
    for (const id of commissionOffer(defaultMeta())) {
      expect(within(group).getByRole('radio', { name: new RegExp(COMMISSIONS[id].name) })).toBeTruthy()
    }
    // The default founds the standard settlement.
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    expect(currentRun().commission).toBeUndefined()
  })

  it('sets out on the chosen commission, its twist applied', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    const pick = screen.getByRole('radio', { name: /Hold the Frontier/i })
    expect(pick.textContent).toMatch(/Clear 12 glades/)
    expect(pick.textContent).toMatch(/\+60% supplies if met/)
    fireEvent.click(pick)
    expect(pick.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    expect(currentRun().commission).toBe('holdFrontier')
    expect(currentRun().hostility).toBe(8)
  })

  it('shows a commission an upgrade opened, and the store refuses one not on offer', async () => {
    useMeta(owning('merchantCharter'))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    expect(screen.getByRole('radio', { name: /Found a Trade Town/i })).toBeTruthy()
    cleanup()
    useMeta(defaultMeta())
    await act(() => useGameStore.getState().startRun(1, undefined, 0, {}, undefined, 'tradeTown'))
    expect(currentRun().commission).toBeUndefined()
  })
})

describe('the commission in the run', () => {
  it('sits at the top of the Orders panel with each term and where it stands', () => {
    const run = playing('holdFrontier')
    act(() => {
      run.stats.gladesCleared = 5
    })
    render(<App />)
    const card = screen.getByRole('group', { name: /Commission: Hold the Frontier/i })
    expect(card.textContent).toMatch(/hostility 8/)
    expect(card.textContent).toMatch(/Hold the settlement/)
    expect(card.textContent).toMatch(/Clear 12 glades\s*5\/12/)
    expect(within(card).getAllByRole('img', { name: 'in progress' }).length).toBe(3)
    // Its twist is not repeated among the pacts.
    expect(screen.queryByRole('heading', { name: /Pacts/i })).toBeNull()
  })

  it('marks a broken rule as failed at once', () => {
    const run = playing('lightWagons')
    run.stats.villagersLost = 1
    render(<App />)
    const card = screen.getByRole('group', { name: /Commission: Light Wagons/i })
    expect(within(card).getByRole('img', { name: 'failed' })).toBeTruthy()
  })
})

describe('the commission on the end screen', () => {
  it('says it was met and pays the bonus in the supplies sent home', () => {
    const run = playing('holdFrontier')
    run.stats.gladesCleared = 12
    run.phase = 'won'
    run.reputation = run.maxReputation
    render(<App />)
    const verdict = screen.getByRole('region', { name: 'Commission' })
    expect(verdict.textContent).toMatch(/Met: \+\d+ supplies/)
    expect(within(verdict).getAllByRole('img', { name: 'met' })).toHaveLength(3)
    const supplies = screen.getByRole('region', { name: /Citadel supplies/i })
    expect(supplies.textContent).toMatch(/Commission met: Hold the Frontier \(\+60%\)/)
  })

  it('says it was not met, and pays nothing extra, when the run is lost', () => {
    const run = playing('holdFrontier')
    run.phase = 'lost'
    render(<App />)
    const verdict = screen.getByRole('region', { name: 'Commission' })
    expect(verdict.textContent).toMatch(/Not met: no bonus/)
    expect(screen.getByRole('region', { name: /Citadel supplies/i }).textContent).not.toMatch(/Commission/)
  })

  it('records the result in the Citadel ledger', () => {
    const run = playing('holdFrontier')
    run.stats.gladesCleared = 12
    run.phase = 'won'
    run.reputation = run.maxReputation
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Return to the Citadel/i }))
    expect(useGameStore.getState().meta.history[0].commission).toEqual({ id: 'holdFrontier', met: true })
    expect(screen.getByTitle('Hold the Frontier: met')).toBeTruthy()
  })
})

describe('the commission board in the Citadel', () => {
  it('shows what is on offer and which upgrade opens each closed commission', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /The Citadel/i }))
    const board = screen.getByRole('region', { name: 'Commissions' })
    expect(within(board).getAllByText(/On offer next run/)).toHaveLength(3)
    expect(board.textContent).toMatch(/Found a Trade Town[\s\S]*Opened by\s*Merchant Charter/)
    // The upgrade card says what it opens.
    const card = screen.getByRole('button', { name: /Merchant Charter/ })
    expect(card.textContent).toMatch(/Opens the commission\s*Found a Trade Town/)
  })
})
