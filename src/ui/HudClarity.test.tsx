import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GLADE_EVENTS } from '../game/content/gladeEvents'
import { SEASON_LENGTH, YEAR_SECONDS } from '../game/engine/balance'
import { createRun } from '../game/engine/createRun'
import { collectWarnings } from '../game/engine/diagnostics'
import { takeChoice } from '../game/engine/drafts'
import { QUEEN_DEADLINE_SECONDS } from '../game/engine/society'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import { ChoiceModal } from './ChoiceModal'
import { TopBar } from './TopBar'
import { Warnings } from './Warnings'

/**
 * Things the HUD used to leave unsaid: what a food-priced glade option costs
 * and why it is out of reach, the phone warning strip's full text, and the
 * Queen's deadline.
 */

function newRun(): RunState {
  const run = createRun({ seed: 4242, species: ['human', 'beaver', 'lizard'], modifiers: [] })
  while (run.pendingChoices.length > 0) takeChoice(run, run.pendingChoices[0].options[0])
  return run
}

function show(run: RunState) {
  act(() => useGameStore.setState({ run, version: useGameStore.getState().version + 1 }))
}

/** A run with only `stock` in its stockpile and a glade event waiting. */
function eventRun(eventId: string, stock: RunState['stock']): RunState {
  const run = newRun()
  run.stock = stock
  run.pendingChoices.unshift({ kind: 'gladeEvent', options: [eventId] })
  return run
}

function optionButton(label: string): HTMLButtonElement {
  const strong = screen.getByText(label, { selector: 'strong' })
  return strong.closest('button') as HTMLButtonElement
}

beforeEach(() => {
  localStorage.clear()
  useGameStore.setState({ screen: 'game', run: null, speed: 0, panel: 'build', notice: null })
})

afterEach(cleanup)

describe('glade-event prices', () => {
  it('shows a food cost in the Cost row and says why it cannot be paid', () => {
    const event = GLADE_EVENTS.queensSurveyors
    const feed = event.options.find((o) => o.foodCost && !o.requires)!
    show(eventRun(event.id, { berry: 3, meat: 2 }))
    render(<ChoiceModal />)

    const button = optionButton(feed.label)
    expect(button.disabled).toBe(true)
    const cost = within(button).getByText(/^Cost:/)
    // The food glyph is drawn, and announced as "food".
    expect(within(cost).getByRole('img', { name: 'food' })).toBeTruthy()
    expect(cost.textContent).toContain(` ${feed.foodCost} food`)
    expect(cost.getAttribute('title')).toBe(
      `Costs ${feed.foodCost} food, paid from your largest food stacks`,
    )
    expect(within(button).getByText(`Needs ${feed.foodCost} food — you have 5`)).toBeTruthy()
  })

  it('names every missing part of a mixed price', () => {
    const event = GLADE_EVENTS.queensSurveyors
    const host = event.options.find((o) => o.foodCost && o.requires)!
    show(eventRun(event.id, { berry: 3, ale: 2 }))
    render(<ChoiceModal />)

    const button = optionButton(host.label)
    const cost = within(button).getByText(/^Cost:/)
    expect(within(cost).getByRole('img', { name: 'food' })).toBeTruthy()
    expect(cost.textContent).toMatch(/ 10 food .*5/)
    expect(
      within(button).getByText('Needs 10 food — you have 3; 5 Ale — you have 2'),
    ).toBeTruthy()
  })

  it('drops the reason once the stockpile can pay', () => {
    const event = GLADE_EVENTS.queensSurveyors
    const feed = event.options.find((o) => o.foodCost && !o.requires)!
    show(eventRun(event.id, { berry: 40 }))
    render(<ChoiceModal />)

    const button = optionButton(feed.label)
    expect(button.disabled).toBe(false)
    const cost = within(button).getByText(/^Cost:/)
    expect(within(cost).getByRole('img', { name: 'food' })).toBeTruthy()
    expect(cost.textContent).toContain(` ${feed.foodCost} food`)
    expect(within(button).queryByText(/^Needs/)).toBeNull()
  })

  it('explains a Citadel-only option the same way', () => {
    const run = eventRun('queensSurveyors', { amber: 10 })
    run.citadel = { ...run.citadel, eventOptions: ['callWardens'] }
    show(run)
    render(<ChoiceModal />)

    const button = optionButton('Call the wardens')
    expect(button.disabled).toBe(true)
    expect(within(button).getByText('Needs 25 Amber — you have 10')).toBeTruthy()
  })

  it('signs a calming option as a drop in impatience', () => {
    const event = GLADE_EVENTS.queensSurveyors
    const calming = event.options.find((o) => (o.impatience ?? 0) < 0)!
    show(eventRun(event.id, { berry: 40, ale: 10 }))
    render(<ChoiceModal />)

    // The impatience icon is announced by name; the number carries its sign.
    const icon = within(optionButton(calming.label)).getByRole('img', { name: 'impatience' })
    const effect = icon.parentElement as HTMLElement
    expect(effect.textContent?.trim()).toBe(`${calming.impatience}`)
    expect(effect.className).toBe('is-good')
  })
})

describe('warning strip', () => {
  /** Three warnings, one of them a danger, listed after the cautions. */
  function troubledRun(): RunState {
    const run = newRun()
    run.clock = QUEEN_DEADLINE_SECONDS - 200
    run.season = { year: 4, season: 'clearance', elapsed: 30, length: SEASON_LENGTH.clearance }
    for (const id of Object.keys(run.stock)) {
      if (id !== 'wood') delete run.stock[id as keyof typeof run.stock]
    }
    run.stock.berry = 15
    run.resolve.beaver = -20
    return run
  }

  it('folds to the two most urgent warnings, in full, and opens to show the rest', () => {
    const run = troubledRun()
    const expected = collectWarnings(run)
    expect(expected.length).toBeGreaterThanOrEqual(3)
    show(run)
    render(<Warnings />)

    // Every warning stays in the polite live region, dangers first.
    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
    const items = Array.from(region.querySelectorAll('.warning'))
    expect(items).toHaveLength(Math.min(4, expected.length))
    expect(items[0].className).toContain('is-danger')
    expect(items[0].textContent).toMatch(/Beavers will start leaving/)
    // The advice is in the text, not cut off.
    expect(region.textContent).toContain("Build a Foragers' Camp.")
    // Two show; the rest are folded (still in the live region).
    expect(items.map((el) => el.classList.contains('is-folded'))).toEqual(
      items.map((_, i) => i >= 2),
    )

    const strip = region.parentElement!
    const toggle = screen.getByRole('button', { name: `Show all ${items.length} warnings` })
    expect(toggle.textContent).toBe(`+${items.length - 2} more ▾`)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-controls')).toBe(region.id)
    expect(strip.className).not.toContain('is-expanded')

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.getAttribute('aria-label')).toBe('Show only the most urgent warnings')
    expect(strip.className).toContain('is-expanded')
    expect(region.querySelectorAll('.warning.is-folded')).toHaveLength(0)

    fireEvent.click(toggle)
    expect(strip.className).not.toContain('is-expanded')
    expect(region.querySelectorAll('.warning.is-folded')).toHaveLength(items.length - 2)
  })

  it('has nothing to fold with a single warning', () => {
    const run = newRun()
    run.resolve.beaver = -20
    expect(collectWarnings(run).map((w) => w.id)).toEqual(['leaving-beaver'])
    show(run)
    render(<Warnings />)
    expect(screen.getByRole('status').querySelectorAll('.warning')).toHaveLength(1)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe("the Queen's deadline in the top bar", () => {
  function deadlineNote(): HTMLElement | null {
    return document.querySelector('.deadline-note')
  }

  it('stays out of the way until its last year', () => {
    const run = newRun()
    run.clock = QUEEN_DEADLINE_SECONDS - YEAR_SECONDS - 30
    run.season = { year: 3, season: 'storm', elapsed: 80, length: SEASON_LENGTH.storm }
    show(run)
    render(<TopBar />)
    expect(deadlineNote()).toBeNull()
  })

  it('counts down through the year before it', () => {
    const run = newRun()
    run.clock = QUEEN_DEADLINE_SECONDS - YEAR_SECONDS
    run.season = { year: 4, season: 'drizzle', elapsed: 0, length: SEASON_LENGTH.drizzle }
    show(run)
    render(<TopBar />)
    const note = deadlineNote()!
    expect(note.className).not.toContain('is-passed')
    expect(within(note).getByText("Queen's deadline in 6m 40s")).toBeTruthy()
    expect(within(note).getByText('in 6m 40s')).toBeTruthy()
    const meter = note.closest('.meter')!
    expect(meter.getAttribute('title')).toContain(
      "The Queen's deadline falls in 6m 40s (Year 5, Drizzle)",
    )
  })

  it('says when it has passed, and what it adds', () => {
    const run = newRun()
    run.clock = QUEEN_DEADLINE_SECONDS + 100
    run.season = { year: 5, season: 'drizzle', elapsed: 100, length: SEASON_LENGTH.drizzle }
    show(run)
    render(<TopBar />)
    const note = deadlineNote()!
    expect(note.className).toContain('is-passed')
    // 0.008/s at the deadline plus 0.00006/s for each of the 100 seconds since.
    expect(within(note).getByText('Deadline passed · +0.84/min')).toBeTruthy()
    expect(within(note).getByText('Past +0.84/m')).toBeTruthy()
    expect(note.closest('.meter')!.getAttribute('title')).toContain(
      "The Queen's deadline has passed",
    )
  })
})
