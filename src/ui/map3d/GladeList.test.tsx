import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRun } from '../../game/engine/createRun'
import { takeChoice } from '../../game/engine/events'
import { useGameStore } from '../../game/store'
import type { RunState } from '../../game/types'
import { gladeAccess, gladeLook } from '../mapShared'
import { GladeList } from './GladeList'

/**
 * The 3D map paints its glade plates into a canvas, so the keyboard reaches
 * them through this list: one Tab stop, arrows to move, Enter to pick.
 */

function newRun(): RunState {
  const run = createRun({ seed: 7171, species: ['human', 'beaver', 'lizard'], modifiers: [] })
  while (run.pendingChoices.length > 0) takeChoice(run, run.pendingChoices[0].options[0])
  return run
}

/** Fogged glades as the list orders them: clearing, then reachable, then out of reach. */
function foggedInOrder(run: RunState) {
  const rank = { clearing: 0, reachable: 1, locked: 2 }
  return Object.values(run.glades)
    .filter((g) => gladeLook(g) === 'fogged')
    .sort((a, b) => rank[gladeAccess(run, a)] - rank[gladeAccess(run, b)])
}

let run: RunState

beforeEach(() => {
  localStorage.clear()
  run = newRun()
  useGameStore.setState({ screen: 'game', run, speed: 0, selectedGlade: null, cameraFocus: null })
})

afterEach(cleanup)

describe('3D glade list', () => {
  it('lists every fogged glade as a button, with one Tab stop', () => {
    render(<GladeList run={run} />)
    const fogged = foggedInOrder(run)
    expect(fogged.length).toBeGreaterThan(1)
    const nav = screen.getByRole('navigation', { name: 'Glades' })
    const buttons = within(nav).getAllByRole('button')
    expect(buttons.map((b) => b.querySelector('strong')?.textContent)).toEqual(fogged.map((g) => g.name))
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1)
    expect(buttons[0].tabIndex).toBe(0)
    // Each says what kind of glade it is and whether it can be reached.
    expect(buttons[0].textContent).toMatch(/reachable|out of reach|clearing/)
  })

  it('moves with the arrow keys without panning the camera, and Enter picks the glade', () => {
    render(<GladeList run={run} />)
    const buttons = within(screen.getByRole('navigation', { name: 'Glades' })).getAllByRole('button')
    const fogged = foggedInOrder(run)
    const windowKeys = vi.fn()
    window.addEventListener('keydown', windowKeys)
    try {
      buttons[0].focus()
      fireEvent.keyDown(buttons[0], { key: 'ArrowDown', code: 'ArrowDown' })
      expect(document.activeElement).toBe(buttons[1])
      expect(buttons[1].tabIndex).toBe(0)
      expect(buttons[0].tabIndex).toBe(-1)
      fireEvent.keyDown(buttons[1], { key: 'End', code: 'End' })
      expect(document.activeElement).toBe(buttons[buttons.length - 1])
      fireEvent.keyDown(document.activeElement!, { key: 'Home', code: 'Home' })
      expect(document.activeElement).toBe(buttons[0])
      fireEvent.keyDown(buttons[0], { key: 'ArrowRight', code: 'ArrowRight' })
      expect(windowKeys).not.toHaveBeenCalled()

      fireEvent.keyDown(buttons[1], { key: 'Enter', code: 'Enter' })
      expect(windowKeys).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', windowKeys)
    }
    const state = useGameStore.getState()
    expect(state.selectedGlade).toBe(fogged[1].id)
    expect(state.cameraFocus).toEqual(fogged[1].center)
    act(() => undefined)
    expect(buttons[1].getAttribute('aria-current')).toBe('true')
  })

  it('a click picks the glade too', () => {
    render(<GladeList run={run} />)
    const buttons = within(screen.getByRole('navigation', { name: 'Glades' })).getAllByRole('button')
    const fogged = foggedInOrder(run)
    fireEvent.click(buttons[0])
    expect(useGameStore.getState().selectedGlade).toBe(fogged[0].id)
  })
})
