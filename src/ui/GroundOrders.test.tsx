import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ORDERS } from '../game/content/orders'
import { useGameStore } from '../game/store'
import type { Order, RunState } from '../game/types'
import { foundedRun, showRun } from '../test/foundedRun'
import { OrdersPanel } from './SidePanels'

/**
 * The Orders panel's cards for the orders on the run's own ground and
 * systems: each says what it asks, how it is met, and where it stands in
 * its own units — on a live order and on an offered one alike.
 */

function order(id: string, extra: Partial<Order> = {}): Order {
  return { id: `o_${id}`, defId: id, progress: 0, complete: false, ...extra }
}

function withOrders(run: RunState, orders: Order[]): RunState {
  run.orders = orders
  run.orderOffers = []
  return run
}

afterEach(cleanup)

describe('ground orders on the order cards', () => {
  it('a live held order shows its goal, how it is met and the seconds held', () => {
    const run = withOrders(foundedRun({ species: ['human', 'beaver', 'lizard'] }), [
      order('refined_human', { held: 25, progress: 25 / 90 }),
      order('camps_full', { held: 12, progress: 12 / 90 }),
    ])
    act(() => {
      showRun(run, { store: { panel: 'orders' } })
    })
    render(<OrdersPanel />)
    const cards = document.querySelectorAll('.order-card')
    const ale = [...cards].find((c) => c.textContent?.includes(ORDERS.refined_human.name))!
    expect(ale.textContent).toContain("Meet the Humans' refined need (spiced ale) for 90 s")
    expect(ale.querySelector('.order-note')!.textContent).toMatch(/Copper Still.*Counts while it reaches at least 50% of your people/)
    expect(ale.textContent).toContain('25/90 s · 27%')
    const camps = [...cards].find((c) => c.textContent?.includes(ORDERS.camps_full.name))!
    expect(camps.textContent).toContain('Keep 5 camps at full crew for 90 s')
    expect(camps.textContent).toContain('12/90 s · 13%')
  })

  it('a counted order shows its count from the draw, and the warm Storm waits for one', () => {
    const run = foundedRun()
    run.orderTallies = { trades: 7, depositYield: {} }
    withOrders(run, [order('trades_10', { baseline: 4, progress: 3 / 10 }), order('warm_storm')])
    run.season = { ...run.season, season: 'clearance' }
    act(() => {
      showRun(run, { store: { panel: 'orders' } })
    })
    render(<OrdersPanel />)
    const cards = [...document.querySelectorAll('.order-card')]
    const trades = cards.find((c) => c.textContent?.includes(ORDERS.trades_10.name))!
    expect(trades.textContent).toContain('Buy or sell 10 lots at the caravan')
    expect(trades.textContent).toContain('Every lot bought from or sold to a caravan counts.')
    expect(trades.textContent).toContain('3/10 · 30%')
    const warm = cards.find((c) => c.textContent?.includes(ORDERS.warm_storm.name))!
    expect(warm.textContent).toContain('See a whole Storm through with no one sleeping cold')
    expect(warm.textContent).toMatch(/brazier or insulation/)
    expect(warm.textContent).toContain('Waits for the next Storm')
  })

  it('an offered order of a new kind says how it is met and where it stands before it is taken', () => {
    const run = withOrders(foundedRun(), [])
    run.orderOffers = [
      {
        kind: 'order',
        options: ['o_dangerous_glade_1', 'o_cross_ford'],
        orders: [order('dangerous_glade_1', { baseline: 0 }), order('cross_ford', { baseline: 0 })],
      },
    ]
    act(() => {
      showRun(run, { store: { panel: 'orders' } })
    })
    render(<OrdersPanel />)
    const offer = screen.getByRole('button', { name: new RegExp(ORDERS.dangerous_glade_1.name) })
    expect(offer.textContent).toContain('Clear a dangerous glade')
    expect(offer.textContent).toContain('Dangerous and forbidden glades both count')
    expect(within(offer).getByRole('img', { name: '0/1 · 0% done now' })).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(ORDERS.cross_ford.name) }).textContent).toContain('0/2')
    const ford = screen.getByRole('button', { name: new RegExp(ORDERS.cross_ford.name) })
    expect(ford.textContent).toContain('Clear 2 glades across the river')
    expect(ford.textContent).toContain('Only the fords lead across')
    expect(useGameStore.getState().run?.orderOffers).toHaveLength(1)
  })
})
