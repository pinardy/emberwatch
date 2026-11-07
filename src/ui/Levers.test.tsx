import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BUILDINGS } from '../game/content/buildings'
import {
  ARCHITECT_PLANS_GROWTH,
  ARCHITECT_PLANS_PRICE,
  PETITION_AMBER,
  PETITION_RELIEF,
  YEAR_SECONDS,
} from '../game/engine/balance'
import { offerBlueprint, targetedRedrawCost } from '../game/engine/events'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import { ChoiceModal } from './ChoiceModal'
import { EndModal } from './EndModal'
import { Inspector } from './Inspector'
import { OrdersPanel } from './SidePanels'

/**
 * The levers' controls, driven through the store the way a player drives
 * them: the Queen's Architect on the hearth, the targeted redraw on a
 * blueprint draft, the Grand Petition and the Retreat in the Orders panel,
 * and the end screen that says how the run ended.
 */

function currentRun(): RunState {
  const run = useGameStore.getState().run
  if (!run) throw new Error('expected a run to be in progress')
  return run
}

/** Tells the HUD the run changed under it (the sim loop does this each frame). */
function refresh() {
  act(() => {
    const { version, hudVersion } = useGameStore.getState()
    useGameStore.setState({ version: version + 1, hudVersion: hudVersion + 1 })
  })
}

/** A run past its founding picks, with the luxury chain still to draft. */
function startedRun(): RunState {
  useGameStore.getState().startRun(4242)
  for (const choice of [...currentRun().pendingChoices]) {
    useGameStore.getState().chooseOption(choice.options[0])
  }
  const run = currentRun()
  run.speciesPool = ['human', 'beaver', 'lizard']
  run.unlockedBuildings = run.unlockedBuildings.filter((id) => id !== 'tavern' && id !== 'brewery')
  return run
}

/** Late in a run with the Queen's patience nearly spent. */
function slipping(run: RunState): void {
  run.season.year = 4
  run.clock = 3 * YEAR_SECONDS + 10
  run.reputation = 10
  run.impatience = 15
  run.impatienceProgress = 0
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
    panel: 'orders',
    notice: null,
  })
})

afterEach(cleanup)

describe("the Queen's Architect on the hearth", () => {
  it('sells plans for a named service, then asks more for the next set', () => {
    const run = startedRun()
    run.stock.amber = ARCHITECT_PLANS_PRICE - 1
    act(() => useGameStore.setState({ selectedBuilding: 'hearth' }))
    render(<Inspector />)
    const section = screen.getByTestId('architect')
    expect(within(section).getByText("The Queen's Architect")).toBeTruthy()
    const luxury = within(section).getByRole('button', { name: /Plans for Luxury: .*Tavern/ })
    expect((luxury as HTMLButtonElement).disabled).toBe(true)

    run.stock.amber = 1000
    refresh()
    expect((luxury as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(luxury)
    expect(currentRun().unlockedBuildings).toContain('tavern')
    expect(currentRun().stock.amber).toBe(1000 - ARCHITECT_PLANS_PRICE)
    // The same service's next piece, at the higher price.
    const next = within(screen.getByTestId('architect')).getByRole('button', { name: /Plans for Luxury: .*Brewery/ })
    expect(next.textContent).toContain(String(ARCHITECT_PLANS_PRICE + ARCHITECT_PLANS_GROWTH))
  })

  it('waits while a blueprint draft is open', () => {
    const run = startedRun()
    run.stock.amber = 1000
    run.clock = 100
    offerBlueprint(run)
    act(() => useGameStore.setState({ selectedBuilding: 'hearth' }))
    render(<Inspector />)
    const section = screen.getByTestId('architect')
    expect(within(section).getByText(/Finish the open blueprint draft first/)).toBeTruthy()
    for (const button of within(section).getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })
})

describe('the targeted redraw on a blueprint draft', () => {
  it('redraws the offer around the named service', () => {
    const run = startedRun()
    run.clock = 100
    run.stock.amber = 500
    offerBlueprint(run)
    const choice = run.pendingChoices[0]
    choice.options = choice.options.filter((id) => id !== 'tavern')
    refresh()
    render(<ChoiceModal />)
    const steer = screen.getByTestId('targeted-redraw')
    const cost = targetedRedrawCost(run)
    expect(steer.textContent).toContain(`Ask the architect for — ${cost}`)
    fireEvent.click(within(steer).getByRole('button', { name: /Luxury/ }))
    expect(currentRun().pendingChoices[0].options).toContain('tavern')
    expect(currentRun().stock.amber).toBe(500 - cost)
    // The card is on the redrawn offer.
    expect(screen.getByRole('button', { name: new RegExp(BUILDINGS.tavern.name) })).toBeTruthy()
  })

  it('is disabled without the amber', () => {
    const run = startedRun()
    run.clock = 100
    run.stock.amber = 0
    offerBlueprint(run)
    refresh()
    render(<ChoiceModal />)
    for (const button of within(screen.getByTestId('targeted-redraw')).getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })
})

describe('the Grand Petition and the Retreat in the Orders panel', () => {
  it('says when the petition will open, then makes it and tracks the vow', () => {
    const run = startedRun()
    render(<OrdersPanel />)
    expect(screen.getByTestId('grand-petition-later')).toBeTruthy()
    expect(screen.queryByTestId('retreat')).toBeNull()

    slipping(run)
    run.stock.amber = PETITION_AMBER
    refresh()
    const card = screen.getByTestId('grand-petition')
    fireEvent.click(within(card).getByRole('button', { name: /Make the Grand Petition/ }))
    expect(currentRun().petition).toBeTruthy()
    expect(currentRun().impatience).toBe(15 - PETITION_RELIEF)
    expect(currentRun().stock.amber ?? 0).toBe(0)
    expect(within(screen.getByTestId('grand-petition')).getByText(/your vow/)).toBeTruthy()
    expect(within(screen.getByTestId('grand-petition')).queryByRole('button')).toBeNull()
  })

  it('retreats to the Citadel on a second click, and the end screen says so', () => {
    const run = startedRun()
    slipping(run)
    run.architectPlans = 1
    render(<OrdersPanel />)
    const retreat = within(screen.getByTestId('retreat')).getByRole('button', { name: 'Retreat to the Citadel' })
    fireEvent.click(retreat)
    expect(currentRun().phase).toBe('playing')
    fireEvent.click(within(screen.getByTestId('retreat')).getByRole('button', { name: /Click again to retreat/ }))
    expect(currentRun().phase).toBe('lost')
    expect(currentRun().retreated).toBe(true)

    cleanup()
    render(<EndModal />)
    expect(screen.getByRole('heading', { name: 'Retreated to the Citadel' })).toBeTruthy()
    expect(within(screen.getByTestId('end-levers')).getByText(/1 set of plans/)).toBeTruthy()
  })
})
