import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { SPECIES } from '../game/content/species'
import { assignWorker, findPlacement } from '../game/engine/actions'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import { speciesNames } from './DraftAppealChips'
import { useFirstStepsStatus } from './FirstSteps'
import { useSeenTips } from './TipsCoach'

/**
 * The first ten minutes: the First steps checklist, the welcome tip it folds
 * in, and the blueprint draft naming who wants what.
 */

function currentRun(): RunState {
  const run = useGameStore.getState().run
  if (!run) throw new Error('expected a run to be in progress')
  return run
}

function bump() {
  useGameStore.setState({ version: useGameStore.getState().version + 1 })
}

function startRun() {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
  fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
}

function takeOpeningDraft() {
  let guard = 0
  while (currentRun().pendingChoices.length > 0 && guard++ < 10) {
    const options = screen.getAllByRole('button').filter((b) => b.className.includes('option'))
    fireEvent.click(options[0])
  }
}

function placeNow(defId: string) {
  act(() => {
    const store = useGameStore.getState()
    store.setBuildMode(defId)
    const pos = findPlacement(currentRun(), defId)
    expect(pos).toBeTruthy()
    store.place(pos!)
    store.setBuildMode(null)
  })
}

beforeEach(() => {
  localStorage.clear()
  // Module-level stores read localStorage once; start every test fresh.
  useFirstStepsStatus.setState({ status: 'open' })
  useSeenTips.setState({ seen: [] })
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

describe('first steps checklist', () => {
  it('waits behind the opening draft, then shows instead of the welcome tip', () => {
    startRun()
    // A dialog is up: nothing may sit underneath it.
    expect(screen.queryByRole('region', { name: /First steps/i })).toBeNull()
    takeOpeningDraft()

    const card = screen.getByRole('region', { name: /First steps/i })
    expect(within(card).getByText(/Reputation meter/)).toBeTruthy()
    expect(within(card).getByText(/Impatience/)).toBeTruthy()
    expect(within(card).getByText('0/4')).toBeTruthy()
    // The checklist carries the welcome, so the generic tip stays away.
    expect(screen.queryByText(/Welcome, Viceroy$/)).toBeNull()
    expect(screen.queryByRole('status', { name: 'Tip' })).toBeNull()
  })

  it('takes the player to each step and ticks it off from the run', () => {
    startRun()
    takeOpeningDraft()
    const card = () => screen.getByRole('region', { name: /First steps/i })

    act(() => useGameStore.getState().setPanel(null))
    fireEvent.click(within(card()).getByRole('button', { name: /Build a Foragers' Camp/ }))
    expect(useGameStore.getState().panel).toBe('build')
    expect(useGameStore.getState().buildMode).toBe('foragersCamp')
    // While placing, the card keeps to the step at hand and leaves the map be.
    expect(within(card()).getAllByRole('listitem')).toHaveLength(1)
    expect(within(card()).queryByText(/Reputation meter/)).toBeNull()

    act(() => {
      currentRun().stock.wood = 200
      bump()
    })
    placeNow('foragersCamp')
    expect(within(card()).getByRole('button', { name: /Build a Foragers' Camp.*done/ })).toBeTruthy()
    expect(within(card()).getByText('1/4')).toBeTruthy()

    // Staffing points at the camp that still needs hands.
    fireEvent.click(within(card()).getByRole('button', { name: /Assign workers/ }))
    const forager = Object.values(currentRun().buildings).find((b) => b.defId === 'foragersCamp')!
    expect(useGameStore.getState().selectedBuilding).toBe(forager.id)

    placeNow('woodcuttersCamp')
    placeNow('shelter')
    expect(within(card()).getByText('3/4')).toBeTruthy()

    act(() => {
      const run = currentRun()
      for (const b of Object.values(run.buildings)) {
        if (b.defId === 'foragersCamp' || b.defId === 'woodcuttersCamp') assignWorker(run, b.id)
      }
      bump()
    })
    // Done: the card goes, is remembered, and says so once.
    expect(screen.queryByRole('region', { name: /First steps/i })).toBeNull()
    expect(localStorage.getItem('emberwatch.firstSteps.v1')).toBe('done')
    expect(screen.getByText(/First steps done/)).toBeTruthy()
  })

  it('can be dismissed for good', () => {
    startRun()
    takeOpeningDraft()
    fireEvent.click(screen.getByRole('button', { name: /Dismiss first steps/i }))
    expect(screen.queryByRole('region', { name: /First steps/i })).toBeNull()
    expect(localStorage.getItem('emberwatch.firstSteps.v1')).toBe('dismissed')
  })

  it('without the checklist, the welcome names the real meters and goes once the player acts', () => {
    useFirstStepsStatus.setState({ status: 'dismissed' })
    startRun()
    takeOpeningDraft()
    const tip = screen.getByRole('status', { name: 'Tip' })
    expect(within(tip).getByText(/Reputation meter/)).toBeTruthy()
    expect(within(tip).getByText(/Impatience fills/)).toBeTruthy()
    expect(tip.textContent).not.toMatch(/crown meter|hourglass/)

    placeNow('shelter')
    expect(screen.queryByRole('status', { name: 'Tip' })).toBeNull()
  })
})

describe('blueprint draft', () => {
  it('names the species that want a service, and what a producer supplies', () => {
    startRun()
    takeOpeningDraft()
    act(() => {
      currentRun().pendingChoices.push({ kind: 'blueprint', options: ['tavern', 'brewery'] })
      bump()
    })
    const run = currentRun()
    const wanting = run.speciesPool.filter((sp) => SPECIES[sp].needs.includes('luxury'))
    const dialog = screen.getByRole('dialog')
    const chips = within(dialog).getAllByTestId('draft-need')

    // The venue chip leads with the Luxury need's drawn icon, then its name.
    const venue = chips.find(
      (c) =>
        c.querySelector('svg[data-icon]')?.getAttribute('data-icon') === 'luxury' &&
        c.textContent?.trim().startsWith('Luxury'),
    )!
    expect(venue).toBeTruthy()
    const supplier = chips.find((c) => c.textContent?.includes('Supplies Luxury'))!
    expect(supplier).toBeTruthy()
    for (const chip of [venue, supplier]) {
      if (wanting.length > 0) {
        // Text for screen readers and on hover, icons for the eye.
        expect(chip.textContent).toContain(`wanted by ${speciesNames(wanting)}`)
        expect(chip.getAttribute('title')).toContain(speciesNames(wanting))
        for (const sp of wanting) {
          expect(chip.querySelector(`svg[data-icon="${SPECIES[sp].art}"]`)).not.toBeNull()
        }
      } else {
        expect(chip.textContent).toContain('not wanted')
      }
    }
  })
})
