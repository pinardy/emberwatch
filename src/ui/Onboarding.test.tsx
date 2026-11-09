import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { SPECIES } from '../game/content/species'
import { assignWorker, findPlacement } from '../game/engine/actions'
import { loadSettings } from '../game/persistence'
import { useGameStore } from '../game/store'
import { showFoundedRun } from '../test/foundedRun'
import type { RunState, SpeciesId } from '../game/types'
import { useFirstStepsStatus } from './FirstSteps'
import { GameScreen } from './GameScreen'
import { useSeenTips } from './TipsCoach'

/**
 * The first ten minutes: the First steps checklist, the welcome tip it folds
 * in, and the blueprint draft naming who wants what.
 */

/** "Humans and Beavers", "Humans, Beavers and Foxes". */
function speciesNames(species: SpeciesId[]): string {
  const names = species.map((sp) => SPECIES[sp].name)
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

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

/** A founded run on the game screen, for what follows the founding. */
function foundedOnScreen() {
  showFoundedRun()
  render(<GameScreen />)
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

describe('first steps checklist', () => {
  it('waits for the founding picks, then shows instead of the welcome tip', () => {
    startRun()
    // The founding is being made: the checklist waits until the clock can run.
    expect(screen.getByRole('region', { name: /^The Founding/ })).toBeTruthy()
    expect(screen.queryByRole('region', { name: /First steps/i })).toBeNull()
    takeOpeningDraft()

    const card = screen.getByRole('region', { name: /First steps/i })
    expect(within(card).getByText(/Reputation meter/)).toBeTruthy()
    expect(within(card).getByText(/Impatience/)).toBeTruthy()
    // Full reputation sends the envoy; the win is holding until she arrives.
    expect(card.textContent).toMatch(/sends her envoy, and you win by holding until she arrives after the next Storm/)
    expect(card.textContent).not.toMatch(/meter to win/)
    expect(within(card).getByText('0/4')).toBeTruthy()
    // The checklist carries the welcome, so the generic tip stays away.
    expect(screen.queryByText(/Welcome, Viceroy$/)).toBeNull()
    expect(screen.queryByRole('status', { name: 'Tip' })).toBeNull()
  })

  it('takes the player to each step and ticks it off from the run', () => {
    foundedOnScreen()
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
    foundedOnScreen()
    fireEvent.click(screen.getByRole('button', { name: /Dismiss first steps/i }))
    expect(screen.queryByRole('region', { name: /First steps/i })).toBeNull()
    expect(localStorage.getItem('emberwatch.firstSteps.v1')).toBe('dismissed')
  })

  it('without the checklist, the welcome names the real meters and goes once the player acts', () => {
    useFirstStepsStatus.setState({ status: 'dismissed' })
    foundedOnScreen()
    const tip = screen.getByRole('status', { name: 'Tip' })
    expect(within(tip).getByText(/Reputation meter/)).toBeTruthy()
    expect(within(tip).getByText(/Impatience fills/)).toBeTruthy()
    expect(tip.textContent).toMatch(/sends her envoy, and you win by holding until she arrives after the next Storm/)
    expect(tip.textContent).not.toMatch(/meter to win/)
    expect(tip.textContent).not.toMatch(/crown meter|hourglass/)

    placeNow('shelter')
    expect(screen.queryByRole('status', { name: 'Tip' })).toBeNull()
  })
})

describe('the founding panel', () => {
  it('shows the settlers and the land beside the first draft, with its tip', () => {
    useGameStore.setState({ screen: 'menu' })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.change(screen.getByLabelText(/Map seed/i), { target: { value: '4242' } })
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    const run = currentRun()
    const panel = screen.getByRole('region', { name: /^The Founding/ })
    expect(within(panel).getByRole('heading', { level: 2 }).textContent).toBe('The Founding')
    // Its parts at a glance, each a jump to its picks.
    const steps = within(panel).getByRole('list', { name: 'Founding picks' })
    expect(within(steps).getAllByRole('button').map((b) => b.textContent)).toEqual([
      '1 Blueprints ×3',
      '2 Cornerstone',
      '3 The founding writ',
    ])
    for (const sp of run.speciesPool) expect(within(panel).getByText(SPECIES[sp].name)).toBeTruthy()
    expect(within(panel).getByRole('list', { name: /Lay of the land/i })).toBeTruthy()
    // The founding's own tip comes first, under its heading; the first-draft
    // tip waits its turn, so the panel never holds two tips at once.
    const foundingTip = within(panel).getByRole('note', { name: 'Tip' })
    expect(within(foundingTip).getByText('The Founding')).toBeTruthy()
    expect(within(panel).getAllByRole('note', { name: 'Tip' })).toHaveLength(1)
    expect(within(panel).queryByText(/Drafting a blueprint/)).toBeNull()
    fireEvent.click(within(foundingTip).getByRole('button', { name: 'Got it' }))
    expect(useSeenTips.getState().seen).toContain('founding')
    // The first-draft tip then sits with the blueprints, not under a dialog.
    const blueprints = within(panel).getByRole('region', { name: /Blueprints/ })
    expect(within(blueprints).getByText(/Drafting a blueprint/)).toBeTruthy()
    expect(within(panel).getAllByRole('note', { name: 'Tip' })).toHaveLength(1)
    // Each blueprint card says what it does for services, as in a draft.
    const cards = within(blueprints).getAllByRole('button').filter((b) => b.className.includes('option'))
    expect(cards.length).toBe(run.pendingChoices[0].options.length)
    expect(within(blueprints).queryAllByTestId('draft-need').length).toBeGreaterThan(0)
    // Picking one lists it as chosen, and deals the next draft in its place.
    const name = cards[0].querySelector('strong')!.textContent!
    fireEvent.click(cards[0])
    const chosen = within(within(panel).getByRole('region', { name: /Blueprints/ })).getByRole('list', {
      name: /Blueprints chosen/,
    })
    expect(within(chosen).getByText(new RegExp(name))).toBeTruthy()
    expect(within(panel).getByText(/4 picks left/)).toBeTruthy()
    expect(within(steps).getAllByRole('button')[0].textContent).toBe('1 Blueprints ×2')
    // The jump takes focus to that part's first card.
    fireEvent.click(within(steps).getByRole('button', { name: /founding writ/ }))
    const writ = within(panel).getByRole('region', { name: /founding writ/i })
    expect(writ.contains(document.activeElement)).toBe(true)
    expect(document.activeElement?.className).toMatch(/option/)
  })
})

describe('the founding holds the clock', () => {
  it('shows the held state on the speed controls, then the set speed once the picks are made', () => {
    startRun()
    useGameStore.setState({ speed: 1 })
    const group = screen.getByRole('group', { name: 'Game speed' })
    // While the founding is open the clock waits, and the bar says so.
    expect(within(group).getByRole('status').textContent).toMatch(/Founding — clock waits/)
    expect(group.className).toMatch(/is-held/)
    // No speed is lit while none is running.
    expect(within(group).queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Game speed: held for the founding' })).toBeTruthy()
    // The speed already set is kept, unshown, for when the clock starts.
    act(() => useGameStore.setState({ speed: 3 }))
    expect(within(group).getByRole('status').textContent).toMatch(/Founding — clock waits/)
    expect(within(group).queryAllByRole('button')).toHaveLength(0)

    takeOpeningDraft()
    const after = screen.getByRole('group', { name: 'Game speed' })
    expect(within(after).queryByRole('status')).toBeNull()
    expect(after.className).not.toMatch(/is-held/)
    expect(after.querySelector('button.is-active')?.textContent).toBe('3×')
    expect(screen.getByRole('button', { name: 'Game speed: 3×' })).toBeTruthy()
  })
})

describe('blueprint draft', () => {
  it('says what a card does for services, but not which species want it', () => {
    foundedOnScreen()
    act(() => {
      currentRun().pendingChoices.push({ kind: 'blueprint', options: ['tavern', 'brewery'] })
      bump()
    })
    const run = currentRun()
    const dialog = screen.getByRole('dialog')
    const chips = within(dialog).getAllByTestId('draft-need')

    // The venue chip leads with the Luxury need's drawn icon, then what it does.
    const venue = chips.find(
      (c) =>
        c.querySelector('svg[data-icon]')?.getAttribute('data-icon') === 'luxury' &&
        c.textContent?.trim().startsWith('Serves Luxury'),
    )!
    expect(venue).toBeTruthy()
    const supplier = chips.find((c) => c.textContent?.includes('Supplies Luxury'))!
    expect(supplier).toBeTruthy()
    // Which needs to chase is the draft's decision: no "wanted by" tell, no
    // species icons, no wanted/unwanted colouring. The People panel shows needs.
    for (const chip of [venue, supplier]) {
      expect(chip.textContent).not.toMatch(/wanted/)
      expect(chip.getAttribute('title') ?? '').not.toContain(speciesNames(run.speciesPool))
      for (const sp of run.speciesPool) {
        expect(chip.querySelector(`svg[data-icon="${SPECIES[sp].art}"]`)).toBeNull()
      }
      expect(chip.className).toBe('draft-need')
    }
  })

  it('a milestone draft can offer a cornerstone beside the blueprints', () => {
    foundedOnScreen()
    act(() => {
      currentRun().pendingChoices.push({
        kind: 'blueprint',
        options: ['tavern', 'campfireTales', 'brewery'],
        mixed: true,
      })
      bump()
    })
    const unlocked = currentRun().unlockedBuildings.length
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/or lay a cornerstone/)).toBeTruthy()
    const card = within(dialog).getByRole('button', { name: /Campfire Tales/ })
    expect(card.textContent).toMatch(/cornerstone/)
    fireEvent.click(card)
    expect(currentRun().cornerstones).toContain('campfireTales')
    expect(currentRun().unlockedBuildings).toHaveLength(unlocked)
  })
})

describe('how to play', () => {
  it('explains the current game in short headed sections on the menu', () => {
    render(<App />)
    const howTo = screen.getByTestId('how-to-play')
    expect(within(howTo).getByText('How to play')).toBeTruthy()
    const parts = Array.from(howTo.querySelectorAll('section.how-to-part'))
    expect(parts.map((p) => p.getAttribute('aria-label'))).toEqual([
      'The goal',
      'The race',
      'Needs and expectations',
      'Glades and the forest',
      'The lie of the land',
      'The Storm',
      'Orders, decrees and commissions',
      'Trade and amber',
    ])
    for (const part of parts) expect(part.querySelector('h2')?.textContent).toBe(part.getAttribute('aria-label'))
    const text = howTo.textContent ?? ''
    for (const idea of [
      /Reputation/,
      /Impatience/,
      /reputation stalls/,
      /expect more/,
      /left to the forest/,
      /blight/,
      /cold/,
      /decrees/,
      /commission/,
      /amber/,
      /the Founding/,
      /refined/,
      /Style achievements/,
      /river vale/,
      /Cinderwood/,
      /does not win yet: it sends her envoy/,
      /Hold until she arrives/,
    ]) {
      expect(text).toMatch(idea)
    }
    // Skimmable: every point is a line or two, not a paragraph.
    for (const li of Array.from(howTo.querySelectorAll('li'))) {
      expect((li.textContent ?? '').length).toBeLessThanOrEqual(240)
    }
  })
})
