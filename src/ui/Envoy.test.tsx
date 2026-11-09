import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FINAL_CHARGE_RESOLVE_RATE, SEASON_LENGTH } from '../game/engine/balance'
import { createRun } from '../game/engine/createRun'
import { takeChoice } from '../game/engine/drafts'
import { gainReputation } from '../game/engine/reputation'
import { tick } from '../game/engine/tick'
import { defaultMeta } from '../game/engine/meta'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import { envoyArrivesNextTick } from '../test/envoy'
import { EndModal } from './EndModal'
import { repPoints } from './EnvoyStatus'
import { FoundingPanel } from './FoundingPanel'
import { RunModifierList } from './RunModifierList'
import { TopBar } from './TopBar'
import { Warnings } from './Warnings'

/**
 * The Envoy's approach in the HUD and on the end screen, and the land's
 * reputation profile where the player chooses and founds a run.
 */

function newRun(modifiers: string[] = []): RunState {
  const run = createRun({ seed: 4242, species: ['human', 'beaver', 'lizard'], modifiers })
  while (run.pendingChoices.length > 0) takeChoice(run, run.pendingChoices[0].options[0])
  run.stock.wood = 300
  return run
}

function show(run: RunState) {
  act(() => useGameStore.setState({ run, version: useGameStore.getState().version + 1, hudVersion: (useGameStore.getState().hudVersion ?? 0) + 1 }))
}

/** Fills reputation late in Year 3's Clearance (half a point spills over as Glory). */
function riding(): RunState {
  const run = newRun()
  run.season = { year: 3, season: 'clearance', elapsed: SEASON_LENGTH.clearance - 90, length: SEASON_LENGTH.clearance }
  run.reputation = run.maxReputation - 1
  gainReputation(run, 1.5, 'orders')
  return run
}

beforeEach(() => {
  localStorage.clear()
  useGameStore.setState({ screen: 'game', run: null, speed: 0, panel: 'orders', notice: null, meta: defaultMeta() })
})

afterEach(cleanup)

describe('the top bar while the envoy rides', () => {
  it('shows the countdown in place of the impatience meter, and the Glory under reputation', () => {
    const run = riding()
    show(run)
    render(<TopBar />)
    // 90 s of Clearance and a whole Storm to go.
    const left = 90 + SEASON_LENGTH.storm
    const time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
    const meter = screen.getByTestId('envoy-meter')
    expect(within(meter).getByText(`The envoy arrives in ${time}`)).toBeTruthy()
    expect(screen.getByRole('meter', { name: `The envoy arrives in ${time}` })).toBeTruthy()
    expect(screen.queryByRole('meter', { name: 'Impatience' })).toBeNull()
    expect(meter.getAttribute('title')).toMatch(/impatience no longer matters.*last stand.*fewer than \d+ villagers/)
    expect(screen.getByText(/Glory \+0\.5/)).toBeTruthy()
  })

  it('reads as the last stand once her Storm has broken, and counts down with the clock', () => {
    const run = riding()
    run.season = { year: 3, season: 'storm', elapsed: 20, length: SEASON_LENGTH.storm }
    run.envoy!.finalStorm = true
    show(run)
    render(<TopBar />)
    const meter = screen.getByTestId('envoy-meter')
    expect(meter.className).toMatch(/is-critical/)
    expect(within(meter).getByText(/Last stand · The envoy arrives in 1:30/)).toBeTruthy()
  })

  it('on a narrow meter the note carries the unrest clock, not the time the head already shows', () => {
    const run = riding()
    run.season = { year: 3, season: 'storm', elapsed: 20, length: SEASON_LENGTH.storm }
    run.envoy!.finalStorm = true
    run.envoy!.unrestSeconds = 25
    show(run)
    render(<TopBar />)
    const meter = screen.getByTestId('envoy-meter')
    const short = meter.querySelector('.deadline-note-short')!
    expect(short.textContent).toBe('Unrest 25/90s')
    expect(meter.querySelector('.deadline-note-long')!.textContent).toMatch(/^Unrest 25\/90s · The envoy arrives in 1:30/)
    // No unrest: the short note is the countdown, as before.
    run.envoy!.unrestSeconds = 0
    show(run)
    expect(screen.getByTestId('envoy-meter').querySelector('.deadline-note-short')!.textContent).toBe('in 1:30')
  })

  it("marks the Queen's final charge under the reputation meter", () => {
    const run = newRun()
    run.reputation = run.maxReputation - 2
    show(run)
    render(<TopBar />)
    expect(screen.queryByTestId('final-charge-note')).toBeNull()
    run.finalCharge = { at: run.clock }
    show(run)
    const note = screen.getByTestId('final-charge-note')
    expect(note.textContent).toBe(`Final charge ×${FINAL_CHARGE_RESOLVE_RATE}`)
    expect(note.getAttribute('title')).toContain(`contented villagers earn reputation ${FINAL_CHARGE_RESOLVE_RATE}× as fast`)
  })

  it('shows the impatience meter again for an ordinary run', () => {
    show(newRun())
    render(<TopBar />)
    expect(screen.getByRole('meter', { name: 'Impatience' })).toBeTruthy()
    expect(screen.queryByTestId('envoy-meter')).toBeNull()
  })
})

describe('the warning strip while the envoy rides', () => {
  it('names who the last stand would tip into unrest, and keeps the rules on screen for every device', () => {
    const run = riding()
    // A struggling settlement: everyone well under the threshold already.
    for (const sp of run.speciesPool) run.resolve[sp] = 5
    show(run)
    render(<Warnings />)
    const region = screen.getByRole('status')
    const resolve = Array.from(region.querySelectorAll('.warning')).find((el) => /in the last stand/i.test(el.textContent ?? ''))
    expect(resolve).toBeTruthy()
    expect(resolve!.textContent).toMatch(/\(\d+ of \d+ villagers\) in unrest/)
    expect(resolve!.textContent).toMatch(/want /)
    expect(region.textContent).toMatch(/Hold until the envoy arrives in .*: keep \d+\+ villagers/)
  })
})

describe('the end screen', () => {
  it('says the settlement held for the envoy, with its Glory by source', () => {
    const run = riding()
    gainReputation(run, 2, 'glades')
    envoyArrivesNextTick(run)
    tick(run, 0.125)
    expect(run.phase).toBe('won')
    show(run)
    render(<EndModal />)
    expect(screen.getByText(/The settlement holds/)).toBeTruthy()
    expect(screen.getByText(/envoy found the settlement standing/)).toBeTruthy()
    const held = screen.getByRole('region', { name: "The envoy's approach" })
    expect(within(held).getByRole('heading', { name: /Held for the envoy/ })).toBeTruthy()
    expect(held.textContent).toMatch(/set out in Year 3/)
    expect(held.textContent).toMatch(/Glory 2\.5/)
    expect(within(held).getByText('reclaimed land')).toBeTruthy()
  })

  it('reads the breakdown as reputation by source, not as counts', () => {
    const run = riding()
    run.reputationBy = { orders: 9, decrees: 3, resolve: 2.44 }
    envoyArrivesNextTick(run)
    tick(run, 0.125)
    expect(run.phase).toBe('won')
    const by = { ...run.reputationBy }
    show(run)
    render(<EndModal />)
    const held = screen.getByRole('region', { name: "The envoy's approach" })
    expect(within(held).getByRole('heading', { name: 'Reputation by source' })).toBeTruthy()
    const list = within(held).getByRole('list', { name: 'Reputation by source' })
    const rows = within(list).getAllByRole('listitem').map((li) => li.textContent)
    // The same numbers as the run's ledger: a whole point bare, a fraction to the tenth.
    expect(rows).toContain(`completed orders${repPoints(by.orders!)}`)
    expect(repPoints(9)).toBe('+9 rep')
    expect(repPoints(2.44)).toBe('+2.4 rep')
    for (const row of rows) expect(row).toMatch(/\+\d+(\.\d)? rep$/)
  })

  it('says how the settlement fell before she arrived', () => {
    const run = riding()
    run.envoy!.outcome = 'collapsed'
    run.envoy!.collapse = 'hearth'
    run.phase = 'lost'
    show(run)
    render(<EndModal />)
    expect(screen.getByText(/fell before her envoy arrived/)).toBeTruthy()
    const fell = screen.getByRole('region', { name: "The envoy's approach" })
    expect(within(fell).getByRole('heading', { name: /The envoy found ruins/ })).toBeTruthy()
    expect(fell.textContent).toMatch(/the hearth stood cold too long before she arrived/)
  })

  it('names who fell into unrest and the blight and dread that did it', () => {
    const run = riding()
    run.envoy!.outcome = 'collapsed'
    run.envoy!.collapse = 'unrest'
    run.envoy!.unrest = {
      species: ['beaver', 'lizard'],
      blows: [
        { name: 'Leaking Roofs', amount: -8 },
        { name: "The Forest's Dread", amount: -3 },
      ],
    }
    run.phase = 'lost'
    show(run)
    render(<EndModal />)
    const fell = screen.getByRole('region', { name: "The envoy's approach" })
    expect(fell.textContent).toMatch(
      /most of the settlement fell into unrest \(Beavers and Lizards, under Leaking Roofs −8 and The Forest's Dread −3\) before she arrived/,
    )
  })

  it('has no envoy section for a run that never filled its reputation', () => {
    const run = newRun()
    run.phase = 'lost'
    show(run)
    render(<EndModal />)
    expect(screen.queryByRole('region', { name: "The envoy's approach" })).toBeNull()
  })
})

describe('what the Queen values here', () => {
  it('on a land’s card, and in the Founding panel', () => {
    render(<RunModifierList ids={['wildFrontier']} />)
    expect(screen.getByText('Here the Queen values: completed orders ×0.75 · reclaimed land ×2')).toBeTruthy()
    cleanup()
    const run = createRun({ seed: 4242, species: ['human', 'beaver', 'lizard'], modifiers: ['wildFrontier'], commission: 'holdFrontier' })
    show(run)
    render(<FoundingPanel />)
    expect(screen.getByText('Here the Queen values: completed orders ×0.75 · reclaimed land ×3')).toBeTruthy()
  })
})
