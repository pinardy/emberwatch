import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ERRANDS } from '../game/content/errands'
import { PETITION_AMBER, YEAR_SECONDS } from '../game/engine/balance'
import { createRun } from '../game/engine/createRun'
import { takeChoice } from '../game/engine/drafts'
import { useGameStore } from '../game/store'
import type { Errand, RunState } from '../game/types'
import { GameScreen } from './GameScreen'
import { OrdersPanel } from './SidePanels'

/**
 * Errands in the HUD and the Orders panel (cards with what they pay, the
 * time left and a hand-over button that says why it is off; the chip that
 * opens the panel; never a dialog), and the Queen's court entry that names
 * her three levers from Year 2.
 */

function newRun(): RunState {
  const run = createRun({ seed: 7171, species: ['human', 'beaver', 'lizard'], modifiers: [] })
  while (run.pendingChoices.length > 0) takeChoice(run, run.pendingChoices[0].options[0])
  return run
}

function show(run: RunState) {
  act(() => {
    const { version, hudVersion } = useGameStore.getState()
    useGameStore.setState({ run, version: version + 1, hudVersion: hudVersion + 1 })
  })
}

function currentRun(): RunState {
  const run = useGameStore.getState().run
  if (!run) throw new Error('expected a run')
  return run
}

function haul(run: RunState): Errand {
  const glade = Object.values(run.glades).find((g) => !g.cleared)!
  const errand: Errand = {
    id: 'e1',
    defId: 'haulToClearers',
    title: `Carry 10 Wood to the ${glade.name} clearers`,
    goal: { kind: 'deliver', resource: 'wood', amount: 10 },
    progress: 0,
    timeLeft: 48,
    timeLimit: 75,
    reward: { reputation: 0.35 },
    gladeId: glade.id,
  }
  run.errands = [errand]
  return errand
}

beforeEach(() => {
  localStorage.clear()
  useGameStore.setState({ screen: 'game', run: null, speed: 0, panel: 'orders', notice: null })
})

afterEach(cleanup)

describe('errands in the Orders panel', () => {
  it('says when errands come while none is open', () => {
    show(newRun())
    render(<OrdersPanel />)
    expect(within(screen.getByTestId('errands')).getByTestId('errands-none').textContent).toMatch(
      /reputation has stood still for \d+ seconds/,
    )
  })

  it('shows an open errand with its reward and clock, and hands the goods over', () => {
    const run = newRun()
    const errand = haul(run)
    run.stock.wood = 4
    show(run)
    render(<OrdersPanel />)
    const card = screen.getByTestId('errand')
    expect(card.textContent).toContain(errand.title)
    expect(card.textContent).toContain('+0.35 reputation')
    expect(card.textContent).toContain('0:48 left')
    const button = within(card).getByRole('button', { name: 'Hand over 10 Wood' }) as HTMLButtonElement
    // Short of goods: off, and it says why in words.
    expect(button.disabled).toBe(true)
    expect(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent).toBe(
      'Needs 10 Wood; you have 4.',
    )

    currentRun().stock.wood = 25
    show(currentRun())
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(currentRun().stock.wood).toBe(15)
    expect(currentRun().errands).toEqual([])
    expect(currentRun().errandBook?.met).toBe(1)
    expect(screen.queryByTestId('errand')).toBeNull()
  })

  it('lets an errand go without penalty, and shows its place on the map', () => {
    const run = newRun()
    const errand = haul(run)
    show(run)
    render(<OrdersPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Show on map' }))
    expect(useGameStore.getState().cameraFocus).toEqual(run.glades[errand.gladeId!].center)
    const impatience = currentRun().impatience
    fireEvent.click(screen.getByRole('button', { name: 'Let it go' }))
    expect(currentRun().errands).toEqual([])
    expect(currentRun().impatience).toBe(impatience)
  })

  it('a staffing errand shows how long it has held, with no button to press', () => {
    const run = newRun()
    run.errands = [
      {
        id: 'e2',
        defId: 'staffWorkplace',
        title: 'Staff the Lumber Mill north of the hearth',
        goal: { kind: 'staff', buildingId: 'hearth', seconds: 30 },
        held: 12,
        progress: 0.4,
        timeLeft: 30,
        timeLimit: 60,
        reward: { amber: 12 },
      },
    ]
    show(run)
    render(<OrdersPanel />)
    const card = screen.getByTestId('errand')
    expect(card.textContent).toContain('12/30s held')
    expect(card.textContent).toContain('+12 amber')
    expect(within(card).queryByRole('button', { name: /Hand over|Sell/ })).toBeNull()
  })
})

describe('the errand chip over the map', () => {
  it('shows the first open errand, never as a dialog, and opens the Orders panel', () => {
    const run = newRun()
    haul(run)
    show(run)
    act(() => useGameStore.setState({ panel: 'build' }))
    render(<GameScreen />)
    const chip = screen.getByTestId('errand-chip')
    expect(chip.closest('.bottom-stack')).toBeTruthy()
    expect(chip.textContent).toContain('Carry 10 Wood')
    expect(chip.textContent).toContain('+0.35 reputation')
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(chip)
    expect(useGameStore.getState().panel).toBe('orders')
    // Nothing open, no chip.
    currentRun().errands = []
    show(currentRun())
    expect(screen.queryByTestId('errand-chip')).toBeNull()
  })

  it('every template has drawn art', () => {
    for (const def of Object.values(ERRANDS)) expect(def.art, def.id).toBeTruthy()
  })
})

describe("the Queen's court", () => {
  it('is not shown in Year 1', () => {
    show(newRun())
    render(<OrdersPanel />)
    expect(screen.queryByTestId('queens-court')).toBeNull()
  })

  it('from Year 2 names the three levers, their state and when each opens', () => {
    const run = newRun()
    run.season.year = 2
    run.clock = YEAR_SECONDS + 5
    run.impatience = 4
    run.stock.amber = 0
    show(run)
    render(<OrdersPanel />)
    const court = screen.getByTestId('queens-court')
    expect(within(court).getByText("The Queen's court")).toBeTruthy()
    const soothe = within(court).getByTestId('court-soothe')
    expect(soothe.textContent).toContain('Soothe the Queen')
    expect(soothe.textContent).toContain('Needs amber')
    const petition = within(court).getByTestId('court-petition')
    expect(petition.textContent).toContain('Not yet')
    expect(petition.textContent).toMatch(/Opens when impatience reaches \d+ \(now 4\)/)
    const retreat = within(court).getByTestId('court-retreat')
    expect(retreat.textContent).toMatch(/Offered if impatience reaches \d+/)
    // The controls themselves are still where they were.
    expect(screen.getByRole('button', { name: /Soothe the Queen —/ })).toBeTruthy()
    expect(screen.getByTestId('grand-petition-later')).toBeTruthy()
  })

  it('leads to each lever’s control, which still works', () => {
    const run = newRun()
    run.season.year = 4
    run.clock = 3 * YEAR_SECONDS + 10
    run.reputation = 8
    run.impatience = run.maxImpatience - 3
    run.impatienceProgress = 0
    run.stock.amber = PETITION_AMBER + 60
    show(run)
    render(<OrdersPanel />)
    const court = screen.getByTestId('queens-court')
    expect(court.textContent).toContain('3 open')
    fireEvent.click(within(court).getByRole('button', { name: 'The Grand Petition' }))
    const make = screen.getByRole('button', { name: /Make the Grand Petition/ })
    expect(document.activeElement).toBe(make)
    fireEvent.click(make)
    expect(currentRun().petition).toBeTruthy()
    expect(within(screen.getByTestId('queens-court')).getByTestId('court-petition').textContent).toContain('Used')
    fireEvent.click(within(screen.getByTestId('queens-court')).getByRole('button', { name: 'Soothe the Queen' }))
    expect(document.activeElement?.id).toBe('soothe-button')
  })
})
