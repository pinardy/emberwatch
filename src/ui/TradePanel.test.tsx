import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BUILDINGS } from '../game/content/buildings'
import { TRADE_AGREEMENTS } from '../game/content/tradeAgreements'
import { relevantBlueprints } from '../game/engine/serviceChains'
import {
  AGREEMENT_PRICE,
  COMMISSION_LOT,
  RARE_BLUEPRINT_PRICE,
  commissionPrice,
  stepCaravan,
} from '../game/engine/trade'
import { useGameStore } from '../game/store'
import type { BuildingInstance, RunState } from '../game/types'
import { TradePanel } from './TradePanel'

/**
 * The Trade panel, driven through the store the way a player drives it: the
 * caravan's rare item, a commission for the next caravan, and the run's one
 * trade agreement.
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

/** A run past its opening draft with a standing Trading Post. */
function withTradingPost(): RunState {
  useGameStore.getState().startRun(4242)
  for (const choice of [...currentRun().pendingChoices]) {
    useGameStore.getState().chooseOption(choice.options[0])
  }
  const run = currentRun()
  if (!run.unlockedBuildings.includes('tradingPost')) run.unlockedBuildings.push('tradingPost')
  const post: BuildingInstance = {
    id: 'test-post',
    defId: 'tradingPost',
    pos: { x: 3, y: 2 },
    gladeId: 'glade0',
    built: true,
    buildProgress: BUILDINGS.tradingPost.buildSeconds,
    workers: [],
    activeRecipeId: '',
    recipeProgress: 0,
    paused: false,
    tier: 0,
    depositsInRange: {},
  }
  run.buildings[post.id] = post
  run.stock.amber = 0
  // The opening stockpile fills the hearth's store; give deliveries room.
  run.storageCap = 400
  return run
}

/** Brings the next caravan into town. */
function arrive(run: RunState) {
  if (run.caravan.here) stepCaravan(run, run.caravan.timer + 0.01)
  stepCaravan(run, run.caravan.timer + 0.01)
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
    panel: 'trade',
    notice: null,
  })
})

afterEach(cleanup)

describe('Trade panel', () => {
  it('before a Trading Post, says what caravans would bring and offers no levers', () => {
    useGameStore.getState().startRun(4242)
    for (const choice of [...currentRun().pendingChoices]) {
      useGameStore.getState().chooseOption(choice.options[0])
    }
    currentRun().caravan.timer = 1e9
    render(<TradePanel />)
    expect(screen.getByText(/Build a Trading Post/)).toBeTruthy()
    expect(screen.getByText(/rare blueprint or cornerstone/)).toBeTruthy()
    expect(screen.queryByTestId('trade-commission')).toBeNull()
    expect(screen.queryByTestId('trade-agreement')).toBeNull()
  })

  it('sells the rare blueprint, with what it serves, and unlocks it on purchase', () => {
    const run = withTradingPost()
    arrive(run)
    arrive(run)
    const rare = run.caravan.rare!
    expect(rare.kind).toBe('blueprint')
    expect(relevantBlueprints(run)).toContain(rare.id)
    render(<TradePanel />)

    const card = screen.getByTestId('trade-rare')
    expect(within(card).getByText(`Blueprint: ${BUILDINGS[rare.id].name}`)).toBeTruthy()
    // The draft's need chips say why it matters.
    expect(within(card).getAllByTestId('draft-need').length).toBeGreaterThan(0)
    const buy = within(card).getByRole('button', { name: `Buy · ${RARE_BLUEPRINT_PRICE} amber` })
    expect((buy as HTMLButtonElement).disabled).toBe(true)

    run.stock.amber = RARE_BLUEPRINT_PRICE
    refresh()
    expect((buy as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(buy)
    expect(currentRun().unlockedBuildings).toContain(rare.id)
    expect(currentRun().stock.amber ?? 0).toBe(0)
    expect(within(screen.getByTestId('trade-rare')).getByRole('button', { name: 'Bought' })).toBeTruthy()
  })

  it('commissions the chosen good and shows it as on its way', () => {
    const run = withTradingPost()
    run.stock.amber = 1000
    render(<TradePanel />)
    const section = screen.getByTestId('trade-commission')
    fireEvent.change(within(section).getByLabelText('Good to commission'), { target: { value: 'brick' } })
    const price = commissionPrice(run, 'brick')
    fireEvent.click(within(section).getByRole('button', { name: `Commission ${COMMISSION_LOT} · ${price}` }))
    expect(currentRun().caravan.commission).toEqual({ resource: 'brick', amount: COMMISSION_LOT })
    expect(currentRun().stock.amber).toBe(1000 - price)
    expect(within(screen.getByTestId('trade-commission')).getByText(/paid for — it comes with the next caravan/)).toBeTruthy()
    expect(within(screen.getByTestId('trade-commission')).queryByRole('combobox')).toBeNull()

    // It arrives with the caravan and lands in the stockpile.
    const bricks = currentRun().stock.brick ?? 0
    arrive(currentRun())
    refresh()
    expect(currentRun().stock.brick).toBe(bricks + COMMISSION_LOT)
    expect(within(screen.getByTestId('trade-commission')).getByRole('combobox')).toBeTruthy()
  })

  it('offers three agreements, signs one, then shows only the signed one', () => {
    const run = withTradingPost()
    run.stock.amber = AGREEMENT_PRICE - 1
    render(<TradePanel />)
    const section = screen.getByTestId('trade-agreement')
    const buttons = within(section).getAllByRole('button')
    expect(buttons).toHaveLength(3)
    for (const b of buttons) expect((b as HTMLButtonElement).disabled).toBe(true)

    run.stock.amber = AGREEMENT_PRICE
    refresh()
    const barges = within(screen.getByTestId('trade-agreement')).getByRole('button', {
      name: new RegExp(TRADE_AGREEMENTS.barges.name),
    })
    fireEvent.click(barges)
    expect(currentRun().caravan.agreement).toBe('barges')
    const after = screen.getByTestId('trade-agreement')
    expect(within(after).queryAllByRole('button')).toHaveLength(0)
    expect(within(after).getByText(TRADE_AGREEMENTS.barges.name)).toBeTruthy()
    expect(within(after).getByText(/signed for this run/)).toBeTruthy()
  })

  it('shows a commissioned lot that did not fit as paid, to collect for nothing', () => {
    const run = withTradingPost()
    run.caravan.here = true
    run.caravan.timer = 60
    run.caravan.offers = [{ resource: 'ale', amount: 4, price: 0, sold: false, prepaid: true }]
    render(<TradePanel />)
    const collect = screen.getByRole('button', { name: /4 Ale\s*Paid — collect/ })
    expect((collect as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(collect)
    expect(currentRun().stock.ale).toBe(4)
    expect(screen.getByRole('button', { name: /4 Ale\s*Collected/ })).toBeTruthy()
  })
})
