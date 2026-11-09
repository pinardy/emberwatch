import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { showFoundedRun } from '../test/foundedRun'
import { BuildPanel } from './BuildPanel'
import { INTROS_SEEN_KEY, readIntrosSeen } from './PanelIntro'
import { OrdersPanel, TradePanel } from './SidePanels'

/**
 * Panel intros: open the first time a panel is shown in this browser, then
 * folded to an "About this panel" disclosure that still holds the text.
 */

const BUILD_INTRO = /Idle villagers build automatically/
const ORDERS_INTRO = /Completing an order grants reputation immediately/
const TRADE_INTRO = /Amber also soothes the Queen/

function intro(id: string): HTMLDetailsElement {
  const el = document.querySelector<HTMLDetailsElement>(`details.panel-intro[data-intro="${id}"]`)
  if (!el) throw new Error(`no ${id} intro`)
  return el
}

beforeEach(() => {
  localStorage.clear()
  showFoundedRun()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('panel intros', () => {
  it('opens the first time, then folds to a disclosure that still holds the text', () => {
    const first = render(<BuildPanel />)
    expect(intro('build').open).toBe(true)
    expect(intro('build').querySelector('p')!.textContent).toMatch(BUILD_INTRO)
    expect(readIntrosSeen()).toEqual(['build'])
    first.unmount()

    render(<BuildPanel />)
    const details = intro('build')
    expect(details.open).toBe(false)
    // Folded, not removed: the paragraph is inside the disclosure, on demand.
    expect(details.querySelector('p')!.textContent).toMatch(BUILD_INTRO)
    const summary = details.querySelector('summary')!
    expect(summary.textContent).toMatch(/About this panel/)
    fireEvent.click(summary)
    expect(details.open).toBe(true)
  })

  it('remembers each panel apart', () => {
    render(<BuildPanel />)
    cleanup()
    render(<OrdersPanel />)
    expect(intro('orders').open).toBe(true)
    expect(intro('orders').textContent).toMatch(ORDERS_INTRO)
    expect(intro('orders').textContent).toMatch(/Once a year you may ask her for a different pair/)
    cleanup()
    render(<TradePanel />)
    expect(intro('trade').open).toBe(true)
    expect(intro('trade').textContent).toMatch(TRADE_INTRO)
    expect(JSON.parse(localStorage.getItem(INTROS_SEEN_KEY)!)).toEqual(['build', 'orders', 'trade'])
    cleanup()
    render(<OrdersPanel />)
    expect(intro('orders').open).toBe(false)
  })

  it('keeps this year’s refused pair in view outside the disclosure', () => {
    const run = showFoundedRun()
    run.orderDeclineYear = run.season.year
    render(<OrdersPanel />)
    const line = screen.getByText('You have already asked her for different orders this year.')
    expect(line.closest('details')).toBeNull()
  })

  it('opens every time when storage cannot be read or written, and shrugs off a mangled value', () => {
    localStorage.setItem(INTROS_SEEN_KEY, '{not json')
    const first = render(<BuildPanel />)
    expect(intro('build').open).toBe(true)
    first.unmount()

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(readIntrosSeen()).toEqual([])
    render(<BuildPanel />)
    expect(intro('build').open).toBe(true)
  })
})
