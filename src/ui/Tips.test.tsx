import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { BUILDINGS } from '../game/content/buildings'
import { COMMISSIONS } from '../game/content/commissions'
import { STORM_BLIGHTS, STORM_BLIGHT_LIST } from '../game/content/stormBlights'
import { gainReputation } from '../game/engine/reputation'
import { isReachable, spareGlade } from '../game/engine/actions'
import { IMPATIENCE_STAGNATION_GRACE, PETITION_WITHIN, YEAR_SECONDS } from '../game/engine/balance'
import { architectPrice, buyArchitectPlans, grandPetition } from '../game/engine/levers'
import { announceBlight } from '../game/engine/blights'
import { createRun } from '../game/engine/createRun'
import { addVillager } from '../game/engine/newcomers'
import { takeChoice } from '../game/engine/drafts'
import { gladeAt } from '../game/engine/mapgen'
import { HEARTH_STORM_END_REACH, population, totalHousing } from '../game/engine/queries'
import { offerDecrees } from '../game/engine/structure'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import { useFirstStepsStatus } from './FirstSteps'
import { useSeenTips } from './TipsCoach'
import { TIPS, currentDialogTip, nextCornerTip, tipById, tipCopy } from './tips'

/**
 * The tips coach's newer tips: each fires once, the first time its situation
 * arises, and only one tip shows at a time — in the corner or in a dialog.
 */

/** A founded run (every opening pick made), with no land modifiers. */
function newRun(opts: { commission?: string } = {}): RunState {
  const s = createRun({ seed: 4711, species: ['human', 'beaver', 'lizard'], modifiers: [], ...opts })
  let guard = 0
  while (s.pendingChoices.length > 0 && guard++ < 20) takeChoice(s, s.pendingChoices[0].options[0])
  return s
}

/** Every tip id but these, as if already seen. */
function seenAllBut(...ids: string[]): string[] {
  return TIPS.map((t) => t.id).filter((id) => !ids.includes(id))
}

/** Whether the corner coach would pick `id` now, were it the only tip not yet seen. */
function fires(run: RunState, id: string, checklist = false): boolean {
  return nextCornerTip(run, seenAllBut(id), checklist)?.id === id
}

function put(s: RunState, defId: string, pos: { x: number; y: number }) {
  const id = `test_${defId}_${Object.keys(s.buildings).length}`
  s.buildings[id] = {
    id,
    defId,
    pos,
    gladeId: gladeAt(s.glades, pos)?.id ?? Object.keys(s.glades)[0],
    built: true,
    buildProgress: BUILDINGS[defId].buildSeconds,
    workers: [],
    activeRecipeId: BUILDINGS[defId].recipes[0]?.id ?? '',
    recipeProgress: 0,
    paused: false,
    depositsInRange: {},
  }
}

describe('tip list', () => {
  it('has unique ids, and short words for every tip', () => {
    const ids = TIPS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    const run = newRun({ commission: 'holdFrontier' })
    announceBlight(run, STORM_BLIGHT_LIST[0])
    for (const tip of TIPS) {
      // Phones give the card a few lines: keep every tip to a short paragraph.
      expect(tipCopy(tip.text, run).length).toBeLessThanOrEqual(240)
      expect(tipCopy(tip.title, run).length).toBeLessThanOrEqual(48)
    }
  })

  it('covers the systems added since the first tips', () => {
    for (const id of [
      'founding',
      'decree-choice',
      'commission',
      'frost',
      'storm-blight',
      'caravan-amber',
      'order-offer',
      'stagnation',
      'expectations',
      'refined-needs',
      'glade-truce',
      'architect',
      'grand-petition',
      'retreat',
      'errand',
      'queens-court',
      'envoy',
      'long-night',
      'land-profile',
    ]) {
      expect(tipById(id), id).toBeTruthy()
    }
  })
})

describe('tip triggers', () => {
  it('the Founding: inside its panel while picks are open, and never in the corner', () => {
    const s = createRun({ seed: 4711, species: ['human', 'beaver', 'lizard'], modifiers: [] })
    expect(currentDialogTip(s, [])?.id).toBe('founding')
    // The first draft's tip waits its turn behind it.
    expect(currentDialogTip(s, ['founding'])?.id).toBe('first-draft')
    expect(nextCornerTip(s, [], false)).toBeNull()
    while (s.pendingChoices.length > 0) takeChoice(s, s.pendingChoices[0].options[0])
    expect(tipById('founding')!.when(s)).toBe(false)
  })

  it('a decree choice: inside the herald’s dialog', () => {
    const s = newRun()
    expect(tipById('decree-choice')!.when(s)).toBe(false)
    expect(offerDecrees(s)).toBe(true)
    expect(currentDialogTip(s, seenAllBut('decree-choice'))?.id).toBe('decree-choice')
  })

  it('a commission: once the founding is done, naming it', () => {
    const plain = newRun()
    expect(fires(plain, 'commission')).toBe(false)
    const s = createRun({
      seed: 4711,
      species: ['human', 'beaver', 'lizard'],
      modifiers: [],
      commission: 'holdFrontier',
    })
    expect(tipById('commission')!.when(s)).toBe(false) // still founding
    while (s.pendingChoices.length > 0) takeChoice(s, s.pendingChoices[0].options[0])
    expect(fires(s, 'commission')).toBe(true)
    expect(tipCopy(tipById('commission')!.title, s)).toBe(`Commission: ${COMMISSIONS.holdFrontier.name}`)
  })

  it('reputation stagnation: after a point, once the stall has run past the grace', () => {
    const s = newRun()
    s.reputation = 1
    s.reputationRise = { at: 100, level: 1 }
    s.clock = 100 + IMPATIENCE_STAGNATION_GRACE
    expect(fires(s, 'stagnation')).toBe(false)
    s.clock = 100 + IMPATIENCE_STAGNATION_GRACE + 30
    expect(fires(s, 'stagnation')).toBe(true)
    // Not before the first point: the opening's slow start is not a stall.
    s.reputation = 0
    s.reputationRise = { at: 100, level: 0 }
    expect(fires(s, 'stagnation')).toBe(false)
  })

  it('rising expectations: from Year 2', () => {
    const s = newRun()
    expect(fires(s, 'expectations')).toBe(false)
    s.season.year = 2
    expect(fires(s, 'expectations')).toBe(true)
  })

  it('refined needs: once the settlement wants them (Year 3 or 20 villagers), naming each', () => {
    const s = newRun()
    s.season.year = 2
    expect(fires(s, 'refined-needs')).toBe(false)
    s.season.year = 3
    expect(fires(s, 'refined-needs')).toBe(true)
    const text = tipCopy(tipById('refined-needs')!.text, s)
    expect(text).toContain('Humans: spiced ale')
    expect(text).toContain('Beavers: blueprint folios')
    const crowd = newRun()
    while (Object.keys(crowd.villagers).length < 20) addVillager(crowd)
    expect(fires(crowd, 'refined-needs')).toBe(true)
  })

  it('glade truces: after three glades reclaimed, and done once one is spared', () => {
    const s = newRun()
    s.stats.gladesCleared = 2
    expect(fires(s, 'glade-truce')).toBe(false)
    s.stats.gladesCleared = 3
    expect(fires(s, 'glade-truce')).toBe(true)
    const border = Object.values(s.glades).find(
      (g) => !g.cleared && g.kind !== 'settlement' && isReachable(s, g.id),
    )!
    expect(spareGlade(s, border.id)).toBeNull()
    expect(fires(s, 'glade-truce')).toBe(false)
    expect(tipById('glade-truce')!.doneWhen!(s)).toBe(true)
  })

  it('a Storm blight: while one is forecast', () => {
    const s = newRun()
    expect(fires(s, 'storm-blight')).toBe(false)
    const def = STORM_BLIGHT_LIST[0]
    announceBlight(s, def)
    expect(fires(s, 'storm-blight')).toBe(true)
    expect(tipCopy(tipById('storm-blight')!.title, s)).toContain(def.name)
    // Urgent: a timed prep may interrupt the First steps checklist.
    expect(fires(s, 'storm-blight', true)).toBe(true)
  })

  it('the envoy: while she rides, urgent, naming this Storm or the next', () => {
    const s = newRun()
    expect(fires(s, 'envoy')).toBe(false)
    s.reputation = s.maxReputation - 1
    gainReputation(s, 1, 'orders')
    expect(fires(s, 'envoy')).toBe(true)
    expect(fires(s, 'envoy', true)).toBe(true)
    expect(tipCopy(tipById('envoy')!.text, s)).toMatch(/the next Storm ends/)
    s.season.season = 'storm'
    expect(tipCopy(tipById('envoy')!.text, s)).toMatch(/this Storm ends/)
    s.envoy!.outcome = 'arrived'
    expect(fires(s, 'envoy')).toBe(false)
  })

  it('the Long Night: while it is forecast or has fallen', () => {
    const s = newRun()
    expect(fires(s, 'long-night')).toBe(false)
    announceBlight(s, STORM_BLIGHTS.longNight)
    expect(fires(s, 'long-night')).toBe(true)
    expect(fires(s, 'long-night', true)).toBe(true)
  })

  it('the land’s reputation profile: once the clock runs, on a land that has one', () => {
    const plain = newRun()
    plain.clock = 5
    expect(fires(plain, 'land-profile')).toBe(false)
    const s = createRun({ seed: 4711, species: ['human', 'beaver', 'lizard'], modifiers: ['wildFrontier'] })
    expect(fires(s, 'land-profile')).toBe(false) // still founding
    while (s.pendingChoices.length > 0) takeChoice(s, s.pendingChoices[0].options[0])
    s.clock = 5
    expect(fires(s, 'land-profile')).toBe(true)
    expect(tipCopy(tipById('land-profile')!.text, s)).toMatch(/reclaimed land ×2/)
  })

  it('frost: from Clearance, when the Storm’s shrinking reach will leave someone cold', () => {
    const s = newRun()
    put(s, 'shelter', { x: HEARTH_STORM_END_REACH + 0.6, y: 0 })
    s.season.season = 'clearance'
    while (population(s) > 1) delete s.villagers[Object.keys(s.villagers)[0]]
    expect(fires(s, 'frost')).toBe(false) // room to spare in warm homes
    while (population(s) < totalHousing(s)) addVillager(s)
    expect(fires(s, 'frost')).toBe(true)
    expect(fires(s, 'frost', true)).toBe(true) // urgent
    s.season.season = 'drizzle'
    expect(fires(s, 'frost')).toBe(false)
  })

  it('trade: a caravan carrying a rare find, put away when it leaves', () => {
    const s = newRun()
    s.caravan.here = true
    s.caravan.rare = null
    expect(fires(s, 'caravan-amber')).toBe(false)
    s.caravan.rare = { kind: 'blueprint', id: 'tavern', price: 40, sold: false }
    expect(fires(s, 'caravan-amber')).toBe(true)
    s.caravan.rare.sold = true
    expect(fires(s, 'caravan-amber')).toBe(false)
    s.caravan.rare.sold = false
    s.caravan.here = false
    expect(fires(s, 'caravan-amber')).toBe(false)
  })

  it("the Queen's Architect: once plans are affordable, done once a set is bought", () => {
    const s = newRun()
    s.clock = 120
    s.unlockedBuildings = s.unlockedBuildings.filter((id) => id !== 'tavern' && id !== 'brewery')
    s.stock.amber = architectPrice(s) - 1
    expect(fires(s, 'architect')).toBe(false)
    s.stock.amber = architectPrice(s)
    expect(fires(s, 'architect')).toBe(true)
    expect(buyArchitectPlans(s, 'luxury')).toBeNull()
    expect(fires(s, 'architect')).toBe(false)
  })

  it('the Grand Petition: while it is open, urgent, done once made', () => {
    const s = newRun()
    s.season.year = 4
    s.clock = 3 * YEAR_SECONDS + 10
    s.stock.amber = 500
    s.impatience = s.maxImpatience - PETITION_WITHIN - 1
    expect(fires(s, 'grand-petition')).toBe(false)
    s.impatience = s.maxImpatience - PETITION_WITHIN
    expect(fires(s, 'grand-petition')).toBe(true)
    expect(fires(s, 'grand-petition', true)).toBe(true)
    expect(grandPetition(s)).toBeNull()
    expect(fires(s, 'grand-petition')).toBe(false)
  })

  it('the Retreat: while the run is lost in all but name', () => {
    const s = newRun()
    s.season.year = 5
    s.clock = 4 * YEAR_SECONDS + 10
    s.reputation = 10
    s.impatience = 10
    expect(fires(s, 'retreat')).toBe(false)
    s.impatience = 15
    expect(fires(s, 'retreat')).toBe(true)
    s.reputation = s.maxReputation - 2
    expect(fires(s, 'retreat')).toBe(false)
  })

  it('an inline order choice: while a slot waits, done once it is filled', () => {
    const s = newRun()
    expect(fires(s, 'order-offer')).toBe(false)
    s.orderOffers = [{ kind: 'order', options: ['o1', 'o2'], orders: [] }]
    expect(fires(s, 'order-offer')).toBe(true)
    s.orderOffers = []
    expect(tipById('order-offer')!.doneWhen!(s)).toBe(true)
  })

  it('an errand: while one is open, done once one is met', () => {
    const s = newRun()
    expect(fires(s, 'errand')).toBe(false)
    s.errands = [
      {
        id: 'e1',
        defId: 'staffWorkplace',
        title: 'Staff the Lumber Mill north of the hearth',
        goal: { kind: 'staff', buildingId: 'hearth', seconds: 30 },
        progress: 0,
        timeLeft: 60,
        timeLimit: 60,
        reward: { reputation: 0.3 },
      },
    ]
    expect(fires(s, 'errand')).toBe(true)
    s.errandBook = { next: 0, lastOffer: 0, cursor: 0, counter: 1, offered: 1, met: 1, lapsed: 0, reputation: 0.3, amber: 0 }
    expect(tipById('errand')!.doneWhen!(s)).toBe(true)
  })

  it("the Queen's court: from Year 2, when no dialog is open", () => {
    const s = newRun()
    expect(fires(s, 'queens-court')).toBe(false)
    s.season.year = 2
    expect(fires(s, 'queens-court')).toBe(true)
    expect(tipCopy(tipById('queens-court')!.text, s)).toContain('Orders panel')
    offerDecrees(s)
    expect(fires(s, 'queens-court')).toBe(false)
  })

  it('a seen tip never fires again', () => {
    const s = newRun()
    s.season.year = 2
    expect(nextCornerTip(s, [...seenAllBut('expectations'), 'expectations'], false)).toBeNull()
  })
})

function currentRun(): RunState {
  const run = useGameStore.getState().run
  if (!run) throw new Error('expected a run to be in progress')
  return run
}

function bump() {
  useGameStore.setState({ version: useGameStore.getState().version + 1 })
}

function startFounded() {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
  fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
  let guard = 0
  while (currentRun().pendingChoices.length > 0 && guard++ < 10) {
    const options = screen.getAllByRole('button').filter((b) => b.className.includes('option'))
    fireEvent.click(options[0])
  }
}

describe('tips coach in play', () => {
  beforeEach(() => {
    localStorage.clear()
    useFirstStepsStatus.setState({ status: 'dismissed' })
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

  it('shows one tip at a time: the next waits until the first is dismissed', () => {
    useSeenTips.setState({ seen: seenAllBut('stagnation', 'expectations') })
    startFounded()
    act(() => {
      const run = currentRun()
      run.season.year = 2
      run.reputation = 1
      run.reputationRise = { at: run.clock, level: 1 }
      run.clock += IMPATIENCE_STAGNATION_GRACE + 60
      bump()
    })
    const tips = screen.getAllByRole('status', { name: 'Tip' })
    expect(tips).toHaveLength(1)
    expect(within(tips[0]).getByText('The Queen notices a stall')).toBeTruthy()
    fireEvent.click(within(tips[0]).getByRole('button', { name: 'Got it' }))
    act(() => bump())
    const next = screen.getAllByRole('status', { name: 'Tip' })
    expect(next).toHaveLength(1)
    expect(within(next[0]).getByText('Rising expectations')).toBeTruthy()
    expect(useSeenTips.getState().seen).toContain('stagnation')
  })

  it('puts a tip away by itself once its job is done', () => {
    useSeenTips.setState({ seen: seenAllBut('order-offer') })
    startFounded()
    const offer = { kind: 'order' as const, options: ['x'], orders: [] }
    act(() => {
      currentRun().orderOffers = [offer]
      bump()
    })
    expect(screen.getByRole('status', { name: 'Tip' }).textContent).toMatch(/An order slot is open/)
    act(() => {
      currentRun().orderOffers = []
      bump()
    })
    expect(screen.queryByRole('status', { name: 'Tip' })).toBeNull()
    expect(useSeenTips.getState().seen).toContain('order-offer')
  })

  it('shows the decree tip inside the herald’s dialog, never under it in the corner', () => {
    useSeenTips.setState({ seen: seenAllBut('decree-choice', 'expectations') })
    startFounded()
    act(() => {
      const run = currentRun()
      run.season.year = 2
      expect(offerDecrees(run)).toBe(true)
      bump()
    })
    const dialog = screen.getByRole('dialog')
    const tip = within(dialog).getByRole('note', { name: 'Tip' })
    expect(within(tip).getByText('A royal decree')).toBeTruthy()
    expect(tip.textContent).toMatch(/begging off/)
    // The corner coach waits while the dialog is up.
    expect(screen.queryByRole('status', { name: 'Tip' })).toBeNull()
  })
})

describe('the ground: layout and biome tips', () => {
  /** A founded run on this layout and biome, with no land modifiers. */
  function onGround(layout: 'rings' | 'river' | 'ridge' | 'ruins', biome: 'woodland' | 'cinderwood' = 'woodland'): RunState {
    const s = createRun({ seed: 4711, species: ['human', 'beaver', 'lizard'], modifiers: [], layout, biome })
    let guard = 0
    while (s.pendingChoices.length > 0 && guard++ < 20) takeChoice(s, s.pendingChoices[0].options[0])
    return s
  }

  it('the river and the ridge: once founded, on their own layout only', () => {
    for (const [id, layout] of [['river-vale', 'river'], ['long-ridge', 'ridge']] as const) {
      const founding = createRun({ seed: 4711, species: ['human', 'beaver', 'lizard'], modifiers: [], layout })
      expect(tipById(id)!.when(founding), `${id} during the founding`).toBe(false)
      expect(fires(onGround(layout), id), id).toBe(true)
      expect(fires(onGround('rings'), id), `${id} on the rings`).toBe(false)
    }
    expect(tipCopy(tipById('river-vale')!.text, onGround('river'))).toMatch(/ford/)
    expect(tipCopy(tipById('long-ridge')!.text, onGround('ridge'))).toMatch(/pass/)
  })

  it('the ruins: once tumbled stonework stands on cleared ground', () => {
    const s = onGround('ruins')
    for (const g of Object.values(s.glades)) if (g.kind !== 'settlement') g.cleared = false
    const ruin = Object.values(s.deposits).find((d) => d.kind === 'ruins')!
    expect(fires(s, 'ruins-field')).toBe(false)
    s.glades[ruin.gladeId].cleared = true
    expect(fires(s, 'ruins-field')).toBe(true)
    expect(fires(onGround('rings'), 'ruins-field')).toBe(false)
  })

  it('the Cinderwood: once a glade of its warm ash is in view', () => {
    const s = onGround('rings', 'cinderwood')
    for (const g of Object.values(s.glades)) if (g.kind !== 'settlement') g.discovered = false
    expect(fires(s, 'cinderwood')).toBe(false)
    const ash = Object.values(s.glades).find((g) => g.terrain === 'cinder')!
    ash.discovered = true
    expect(fires(s, 'cinderwood')).toBe(true)
    expect(tipCopy(tipById('cinderwood')!.text, s)).toMatch(/warm/)
    expect(fires(onGround('rings', 'woodland'), 'cinderwood')).toBe(false)
  })
})
