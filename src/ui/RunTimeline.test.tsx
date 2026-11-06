import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createRun } from '../game/engine/createRun'
import { resolveGladeEvent, takeChoice } from '../game/engine/events'
import { tick } from '../game/engine/tick'
import { GLADE_EVENTS } from '../game/content/gladeEvents'
import type { RunState } from '../game/types'
import { formatClock } from '../game/engine/forecast'
import { RaceSparkline, RunTimelineChart, eventLabel } from './RunTimeline'

afterEach(cleanup)

/** A run played for `seconds`, answering every choice, then decided. */
function playedRun(seconds: number, phase: 'won' | 'lost'): RunState {
  // Base season pacing: the seed's map modifiers (an Early Frost) would bring
  // a second Storm into the window. Modifiers have their own tests.
  const s = createRun({ seed: 4242, species: ['human', 'fox', 'harpy'], modifiers: [] })
  for (let t = 0; t < seconds; t += 0.125) {
    while (s.pendingChoices.length > 0) {
      const choice = s.pendingChoices[0]
      if (choice.kind === 'gladeEvent') {
        resolveGladeEvent(s, GLADE_EVENTS[choice.options[0]].options.length - 1)
      } else takeChoice(s, choice.options[0])
    }
    tick(s, 0.125)
  }
  if (phase === 'won') s.reputation = s.maxReputation
  else s.impatience = s.maxImpatience
  tick(s, 0.125)
  return s
}

describe('RunTimelineChart', () => {
  it('captions the chart with a plain-language summary and offers a data table', () => {
    const run = playedRun(600, 'lost')
    render(<RunTimelineChart run={run} />)
    expect(screen.getByRole('heading', { name: /How the run unfolded/i })).toBeTruthy()
    const plot = screen.getByRole('img', { name: /Reputation and impatience over the run/i })
    expect(plot.getAttribute('aria-describedby')).toBeTruthy()
    const summary = document.getElementById(plot.getAttribute('aria-describedby')!)!
    expect(summary.textContent).toMatch(/patience ran out in Year/)

    const samples = within(screen.getByRole('table', { name: 'Samples' })).getAllByRole('row')
    // A header row plus one row per sample.
    expect(samples).toHaveLength(run.timeline.samples.length + 1)
    const moments = screen.getByRole('table', { name: 'Key moments' })
    expect(within(moments).getByText('The Storm broke')).toBeTruthy()
  })

  it('reads out any moment from the keyboard', () => {
    const run = playedRun(300, 'won')
    render(<RunTimelineChart run={run} />)
    const plot = screen.getByRole('img', { name: /over the run/i })
    const readout = document.querySelector('.tl-readout')!
    expect(readout.textContent).toMatch(/^At the end/)
    fireEvent.keyDown(plot, { key: 'Home' })
    expect(readout.textContent).toMatch(/^Year 1 · 0:00/)
    fireEvent.keyDown(plot, { key: 'ArrowRight' })
    expect(readout.textContent).toMatch(/^Year 1 · 0:12/)
    fireEvent.keyDown(plot, { key: 'Escape' })
    expect(readout.textContent).toMatch(/^At the end/)
  })

  it('switches to resolve per species and population', () => {
    const run = playedRun(300, 'won')
    render(<RunTimelineChart run={run} />)
    const button = screen.getByRole('button', { name: 'Villagers' })
    fireEvent.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('img', { name: /Resolve per species and population/i })).toBeTruthy()
    expect(document.querySelector('.tl-readout')!.textContent).toMatch(/foxes/)
  })

  it('explains itself when a run has no timeline to draw', () => {
    const run = createRun({ seed: 1 })
    run.phase = 'lost'
    render(<RunTimelineChart run={run} />)
    expect(screen.getByText(/nothing to chart/i)).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })
})

describe('RaceSparkline', () => {
  it('summarises the live race in its label', () => {
    const run = playedRun(120, 'won')
    run.phase = 'playing'
    render(<RaceSparkline run={run} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(
      /reputation \d+% of its goal, impatience \d+%/,
    )
  })
})

describe('timeline text', () => {
  it('formats clocks and names events', () => {
    expect(formatClock(754, Math.round)).toBe('12:34')
    expect(eventLabel({ t: 0, k: 'left', d: 'harpy' })).toBe('A Harpy left in despair')
    expect(eventLabel({ t: 0, k: 'lost', d: 'fox' })).toBe('A Fox was lost')
    expect(eventLabel({ t: 0, k: 'year', d: '3' })).toBe('Year 3 began')
  })
})
