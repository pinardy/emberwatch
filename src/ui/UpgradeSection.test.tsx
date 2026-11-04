import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BUILDINGS } from '../game/content/buildings'
import { useGameStore } from '../game/store'
import type { BuildingInstance, RunState } from '../game/types'
import { BuildPanel } from './BuildPanel'
import { Inspector } from './Inspector'

/**
 * The Inspector's upgrade block, driven through the store the way a player
 * drives it: see the next tier and its price, start it, watch it, rush it.
 */

function currentRun(): RunState {
  const run = useGameStore.getState().run
  if (!run) throw new Error('expected a run to be in progress')
  return run
}

function bump() {
  useGameStore.setState({ version: useGameStore.getState().version + 1 })
}

/** A run past its opening draft, with a finished shelter selected. */
function withShelter(): BuildingInstance {
  const store = useGameStore.getState()
  store.startRun(77)
  for (const choice of [...currentRun().pendingChoices]) {
    useGameStore.getState().chooseOption(choice.options[0])
  }
  const run = currentRun()
  const shelter: BuildingInstance = {
    id: 'test-shelter',
    defId: 'shelter',
    pos: { x: 2, y: 2 },
    gladeId: 'glade0',
    built: true,
    buildProgress: BUILDINGS.shelter.buildSeconds,
    workers: [],
    activeRecipeId: '',
    recipeProgress: 0,
    paused: false,
    tier: 0,
    depositsInRange: {},
  }
  run.buildings[shelter.id] = shelter
  run.stock.plank = 0
  run.stock.amber = 0
  useGameStore.getState().selectBuilding(shelter.id)
  return shelter
}

function section(): HTMLElement {
  return screen.getByRole('region', { name: 'Upgrade' })
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

describe('Inspector upgrade section', () => {
  it('shows the next tier, its cost in words, what changes, progress and the rush', () => {
    const shelter = withShelter()
    render(<Inspector />)

    // Next tier and what it changes.
    expect(within(section()).getByText(/tier 1 of 2/)).toBeTruthy()
    expect(within(section()).getByText('Reinforced Shelter')).toBeTruthy()
    expect(within(section()).getByText('+2 housing')).toBeTruthy()
    expect(within(section()).getByText(/Stays warm in the Storm/)).toBeTruthy()

    // Unaffordable: said in text, not only colour, and the button is off.
    expect(within(section()).getByText(/Not enough materials yet/)).toBeTruthy()
    expect(within(section()).getByText(/5 short/)).toBeTruthy()
    const button = within(section()).getByRole('button', { name: /Upgrade to Reinforced Shelter/ })
    expect((button as HTMLButtonElement).disabled).toBe(true)

    act(() => {
      currentRun().stock.plank = 10
      currentRun().stock.wood = 10
      bump()
    })
    expect(within(section()).getByText(/You can afford it/)).toBeTruthy()
    fireEvent.click(within(section()).getByRole('button', { name: /Upgrade to Reinforced Shelter/ }))
    expect(currentRun().buildings[shelter.id].upgradeProgress).toBe(0)
    expect(currentRun().stock.plank).toBe(5)

    // Under way: progress, builders, and the rush with its amber in words.
    expect(within(section()).getByText(/Upgrading to/)).toBeTruthy()
    expect(within(section()).getByRole('progressbar', { name: 'Upgrade progress' })).toBeTruthy()
    const rush = within(section()).getByRole('button', { name: /Rush upgrade for/ })
    expect(rush.textContent).toMatch(/amber short/)
    expect((rush as HTMLButtonElement).disabled).toBe(true)

    act(() => {
      currentRun().stock.amber = 50
      bump()
    })
    fireEvent.click(within(section()).getByRole('button', { name: /Rush upgrade for/ }))
    expect(currentRun().buildings[shelter.id].tier).toBe(1)

    // The header takes the new name and tier mark; the next tier is offered.
    const inspector = document.querySelector('.inspector') as HTMLElement
    expect(within(inspector).getByRole('heading', { hidden: true, level: 4, name: /tier 2 of 2/ })).toBeTruthy()
    expect(inspector.querySelector('.inspector-head strong')?.textContent).toBe('Reinforced Shelter')
    expect(inspector.querySelector('.inspector-head .tier-stars')?.textContent).toMatch('★')
    expect(within(section()).getByText('Snug Lodge')).toBeTruthy()
  })

  it('says when a building is fully upgraded, and is absent where there are none', () => {
    const shelter = withShelter()
    shelter.tier = 2
    render(<Inspector />)
    expect(within(section()).getByText(/Fully upgraded — tier 2 of 2/)).toBeTruthy()

    act(() => useGameStore.getState().selectBuilding('hearth'))
    expect(screen.queryByRole('region', { name: 'Upgrade' })).toBeNull()
  })

  it('build cards mention the upgrades a building can take', () => {
    withShelter()
    render(<BuildPanel />)
    const card = Array.from(document.querySelectorAll('button.build-card')).find(
      (el) => el.querySelector('strong')?.textContent === 'Shelter',
    ) as HTMLElement
    const tag = card.querySelector('.tag-upgrade') as HTMLElement
    expect(tag.textContent).toMatch(/2 upgrades/)
    expect(tag.title).toMatch(/Reinforced Shelter → Snug Lodge/)
  })
})
