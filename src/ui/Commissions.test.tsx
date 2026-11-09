import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import App from '../App'
import { COMMISSIONS, commissionOffer, unlockedCommissions } from '../game/content/commissions'
import { META_UPGRADES } from '../game/content/meta'
import { defaultMeta } from '../game/engine/meta'
import { createRun } from '../game/engine/createRun'
import { saveMeta } from '../game/persistence'
import { useGameStore } from '../game/store'
import type { MetaState, RunState } from '../game/types'
import { CommissionPicker } from './Commissions'

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
    expect(pick.textContent).toMatch(/\+65% supplies if met/)
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

describe('the compact commission rows (phones)', () => {
  // On phones setup.css draws each option as a one-line row with its terms
  // behind the toggle beside it, like the species tiles; the DOM is the same
  // at every width (wide screens hide the toggle and the detail area).
  function Picker({ meta, initial = null }: { meta: MetaState; initial?: string | null }) {
    const [value, setValue] = useState<string | null>(initial)
    return <CommissionPicker meta={meta} value={value} onPick={setValue} />
  }
  const meta = owning('merchantCharter', 'openRoads', 'wardensWrit')

  it('picks with a single tap on the row, the row named with its reward and whether it is chosen', () => {
    render(<Picker meta={meta} />)
    const group = screen.getByRole('radiogroup', { name: 'Commission' })
    const offer = commissionOffer(meta)
    expect(offer).toHaveLength(3)
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(4)

    const none = within(group).getByRole('radio', { name: /^No commission.*✓ Chosen Base supplies$/ })
    expect(none.getAttribute('aria-checked')).toBe('true')
    const def = COMMISSIONS[offer[0]]
    const row = within(group).getByRole('radio', { name: new RegExp(def.name) })
    expect(row.getAttribute('aria-checked')).toBe('false')
    expect(row.querySelector('.commission-chosen')).toBeNull()
    expect(row.querySelector('.commission-reward')!.textContent).toBe(`+${def.bonusPercent}% supplies if met`)

    fireEvent.click(row)
    expect(row.getAttribute('aria-checked')).toBe('true')
    expect(none.getAttribute('aria-checked')).toBe('false')
    expect(within(group).getAllByRole('radio', { checked: true })).toEqual([row])
    // The chosen state is in the row's name and its toggle's.
    expect(within(group).getByRole('radio', { name: new RegExp(`${def.name}.*✓ Chosen \\+${def.bonusPercent}% supplies`) })).toBe(row)
    expect(within(group).queryByRole('radio', { name: /No commission ✓ Chosen/ })).toBeNull()
    expect(within(group).getByRole('button', { name: `Terms of ${def.name} (chosen)` })).toBeTruthy()
    expect(within(group).getByRole('button', { name: 'Terms of No commission' })).toBeTruthy()

    // Tapping it again keeps it chosen, as a radio does.
    fireEvent.click(row)
    expect(row.getAttribute('aria-checked')).toBe('true')
  })

  it('opens one option’s full terms at a time from its toggle, without picking it', () => {
    render(<Picker meta={meta} />)
    const group = screen.getByRole('radiogroup', { name: 'Commission' })
    const [first, second] = commissionOffer(meta).map((id) => COMMISSIONS[id])
    const toggleOf = (name: string) => within(group).getByRole('button', { name: new RegExp(`^Terms of ${name}`) })
    const detailOf = (name: string) => document.getElementById(toggleOf(name).getAttribute('aria-controls')!)!

    // All folded to start.
    for (const toggle of within(group).getAllByRole('button', { name: /^Terms of/ })) {
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(document.getElementById(toggle.getAttribute('aria-controls')!)!.hidden).toBe(true)
    }

    fireEvent.click(toggleOf(first.name))
    expect(toggleOf(first.name).getAttribute('aria-expanded')).toBe('true')
    const detail = detailOf(first.name)
    expect(detail.hidden).toBe(false)
    expect(detail.getAttribute('role')).toBe('group')
    expect(detail.getAttribute('aria-label')).toBe(`Terms of ${first.name}`)
    // Its full terms: patron, twist, the objective and the reward.
    expect(detail.textContent).toContain(first.patron)
    expect(detail.textContent).toContain(first.twist)
    expect(detail.textContent).toContain('Hold the settlement')
    expect(detail.textContent).toContain(`+${first.bonusPercent}% supplies if met`)
    // Opening the terms picks nothing.
    expect(within(group).getByRole('radio', { name: /No commission/ }).getAttribute('aria-checked')).toBe('true')

    // Another option's terms close the first.
    fireEvent.click(toggleOf(second.name))
    expect(detailOf(second.name).hidden).toBe(false)
    expect(detailOf(first.name).hidden).toBe(true)
    expect(toggleOf(first.name).getAttribute('aria-expanded')).toBe('false')
    expect(group.querySelectorAll('.commission-detail:not([hidden])')).toHaveLength(1)

    // Its toggle again folds it; picking a row leaves the terms as they are.
    fireEvent.click(toggleOf(second.name))
    expect(group.querySelectorAll('.commission-detail:not([hidden])')).toHaveLength(0)
    fireEvent.click(toggleOf('No commission'))
    fireEvent.click(within(group).getByRole('radio', { name: new RegExp(second.name) }))
    expect(detailOf('No commission').hidden).toBe(false)
    expect(group.querySelectorAll('.commission-detail:not([hidden])')).toHaveLength(1)
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
    expect(supplies.textContent).toMatch(/Commission met: Hold the Frontier \(\+65%\)/)
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
