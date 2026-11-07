import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isReachable } from '../game/engine/actions'
import { SPARED_GLADE_RECLAIM_HOSTILITY } from '../game/engine/balance'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import { Inspector } from './Inspector'

/**
 * The glade section's second choice: leave a border glade to the forest
 * instead of clearing it, and the costly way back.
 */

function currentRun(): RunState {
  const run = useGameStore.getState().run
  if (!run) throw new Error('expected a run to be in progress')
  return run
}

/** A run past its opening draft, with an uncleared border glade selected. */
function withBorderGlade(): string {
  useGameStore.getState().startRun(77)
  for (const choice of [...currentRun().pendingChoices]) {
    useGameStore.getState().chooseOption(choice.options[0])
  }
  const run = currentRun()
  const glade = Object.values(run.glades).find(
    (g) => !g.cleared && g.kind !== 'settlement' && isReachable(run, g.id),
  )
  if (!glade) throw new Error('expected a border glade')
  useGameStore.getState().selectGlade(glade.id)
  return glade.id
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
    panel: 'build',
    notice: null,
  })
})

afterEach(cleanup)

describe('Inspector glade section: leave it to the forest', () => {
  it('offers the choice with its trade-off, and sparing calls the crew home', () => {
    const id = withBorderGlade()
    render(<Inspector />)
    expect(screen.getByText('Or leave it to the forest')).toBeTruthy()
    // The trade-off is spelled out: what clearing costs, what sparing calms.
    expect(screen.getByText(/makes the forest grow \d+% faster/)).toBeTruthy()
    expect(screen.getByText(/calms hostility by [\d.]+ a minute/)).toBeTruthy()

    act(() => useGameStore.getState().clearGladeAdd(id))
    expect(currentRun().glades[id].clearers).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: /Leave to the forest/ }))
    const glade = currentRun().glades[id]
    expect(glade.spared).toBe(true)
    expect(glade.clearers).toBe(0)
    // The clearing crew controls give way to the truce.
    expect(screen.getByText('Left to the forest')).toBeTruthy()
    expect(screen.queryByText(/Clearing crew/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Leave to the forest/ })).toBeNull()
  })

  it('breaking the truce asks twice, costs hostility and brings the crew back', () => {
    const id = withBorderGlade()
    act(() => useGameStore.getState().spareGlade(id))
    render(<Inspector />)
    const before = currentRun().hostility

    const button = screen.getByRole('button', { name: /Break the truce/ })
    expect(button.textContent).toContain(`+${SPARED_GLADE_RECLAIM_HOSTILITY} hostility`)
    fireEvent.click(button)
    // Armed, not done: one stray click does not anger the forest.
    expect(currentRun().glades[id].spared).toBe(true)
    expect(screen.getByRole('button', { name: /Click again/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Click again/ }))
    expect(currentRun().glades[id].spared).toBe(false)
    expect(currentRun().hostility).toBeCloseTo(before + SPARED_GLADE_RECLAIM_HOSTILITY)
    expect(screen.getByText(/Clearing crew/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Leave to the forest/ })).toBeTruthy()
  })

  it('is not offered on a glade out of reach', () => {
    withBorderGlade()
    const run = currentRun()
    const far = Object.values(run.glades).find((g) => !g.cleared && !isReachable(run, g.id))!
    act(() => useGameStore.getState().selectGlade(far.id))
    render(<Inspector />)
    expect(screen.getByText(/Too far/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Leave to the forest/ })).toBeNull()
  })
})
