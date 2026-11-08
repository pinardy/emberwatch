import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SEASON_LENGTH } from '../game/engine/balance'
import { createRun } from '../game/engine/createRun'
import { takeChoice } from '../game/engine/drafts'
import { gainReputation } from '../game/engine/reputation'
import { tick } from '../game/engine/tick'
import { defaultMeta } from '../game/engine/meta'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import { envoyArrivesNextTick } from '../test/envoy'
import { EndModal } from './EndModal'
import { FoundingPanel } from './FoundingPanel'
import { RunModifierList } from './RunModifierList'
import { TopBar } from './TopBar'

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

  it('shows the impatience meter again for an ordinary run', () => {
    show(newRun())
    render(<TopBar />)
    expect(screen.getByRole('meter', { name: 'Impatience' })).toBeTruthy()
    expect(screen.queryByTestId('envoy-meter')).toBeNull()
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
