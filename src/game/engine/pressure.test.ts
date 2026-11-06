import { describe, expect, it } from 'vitest'
import { GLADE_EVENTS } from '../content/gladeEvents'
import { createRun } from './createRun'
import { resolveGladeEvent, takeChoice } from './events'
import { addImpatience } from './society'
import type { RunState } from '../types'

/**
 * Mid-run pressure: the meters that push back on a settlement — the Queen's
 * impatience, the forest's hostility as Storm blights, threats that escalate
 * — and the levers a player has against them.
 */

const SEED = 4711

/** A run past its opening drafts, with no map modifiers to bend the rules. */
function newRun(): RunState {
  const s = createRun({ seed: SEED, species: ['human', 'beaver', 'lizard'], modifiers: [] })
  let guard = 0
  while (s.pendingChoices.length > 0 && guard++ < 20) {
    takeChoice(s, s.pendingChoices[0].options[0])
  }
  return s
}

describe('impatience relief', () => {
  it('borrows from whole points so the meter visibly drops', () => {
    const s = newRun()
    s.impatience = 7
    s.impatienceProgress = 0.5
    addImpatience(s, -2)
    expect(s.impatience).toBe(5)
    expect(s.impatienceProgress).toBeCloseTo(0.5)
    addImpatience(s, -0.75)
    expect(s.impatience).toBe(4)
    expect(s.impatienceProgress).toBeCloseTo(0.75)
  })

  it('never goes below zero', () => {
    const s = newRun()
    s.impatience = 1
    s.impatienceProgress = 0.25
    addImpatience(s, -3)
    expect(s.impatience).toBe(0)
    expect(s.impatienceProgress).toBe(0)
  })

  it('still carries upward overflow as before', () => {
    const s = newRun()
    s.impatience = 2
    s.impatienceProgress = 0.75
    addImpatience(s, 1.5)
    expect(s.impatience).toBe(4)
    expect(s.impatienceProgress).toBeCloseTo(0.25)
  })

  it('a glade event that calms the Queen lowers the meter the player sees', () => {
    const s = newRun()
    s.impatience = 7
    s.impatienceProgress = 0.5
    s.stock = { ...s.stock, berry: 40, ale: 10 }
    s.pendingChoices.push({ kind: 'gladeEvent', options: ['queensSurveyors'] })
    const host = GLADE_EVENTS.queensSurveyors.options.findIndex((o) => o.impatience === -2)
    resolveGladeEvent(s, host)
    expect(s.impatience + s.impatienceProgress).toBeCloseTo(5.5)
  })
})
