import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { STARTING_SPECIES } from '../../game/content/species'
import { createRun } from '../../game/engine/createRun'
import { useGameStore } from '../../game/store'
import type { LayoutId, RunState } from '../../game/types'
import { MiniMap } from './MiniMap'

/** The 3D map's corner minimap draws a layout's river or cliffs, as the main maps do. */

function runOn(layout: LayoutId): RunState {
  return createRun({ seed: 4242, species: [...STARTING_SPECIES], layout, biome: 'woodland', modifiers: [] })
}

function show(run: RunState) {
  useGameStore.setState({ run, version: useGameStore.getState().version + 1 })
  return render(<MiniMap run={run} controls={{ current: null }} />)
}

afterEach(cleanup)

describe('minimap barriers', () => {
  it.each([
    ['river', 'river'],
    ['ridge', 'cliff'],
  ] as const)('draws the %s layout’s %s and its crossings', (layout, kind) => {
    const run = runOn(layout)
    const barriers = run.world.barriers ?? []
    expect(barriers.length).toBeGreaterThan(0)
    show(run)
    const groups = document.querySelectorAll(`svg.minimap .minimap-barriers g[data-barrier="${kind}"]`)
    expect(groups.length).toBe(barriers.filter((b) => b.kind === kind).length)
    const barrier = barriers.find((b) => b.kind === kind)!
    const group = groups[0]
    // A bank and a body, each one path holding every segment of the course.
    const paths = group.querySelectorAll('path')
    expect(paths.length).toBe(2)
    const d = paths[1].getAttribute('d')!
    expect(d.match(/M/g)!.length).toBe(barrier.segments.length)
    const [a, b] = barrier.segments[0]
    expect(d.startsWith(`M${a.x} ${a.y}L${b.x} ${b.y}`)).toBe(true)
    // Every ford or pass is marked where the main maps put it.
    const crossings = group.querySelectorAll(`circle[data-crossing="${kind}"]`)
    expect(crossings.length).toBe(barrier.crossings.length)
    expect(Number(crossings[0].getAttribute('cx'))).toBe(barrier.crossings[0].x)
    expect(Number(crossings[0].getAttribute('cy'))).toBe(barrier.crossings[0].y)
  })

  it('draws them once: a sim step leaves the same elements in place', () => {
    const run = runOn('river')
    show(run)
    const before = document.querySelector('svg.minimap .minimap-barriers path')
    expect(before).not.toBeNull()
    act(() => useGameStore.setState({ version: useGameStore.getState().version + 1 }))
    expect(document.querySelector('svg.minimap .minimap-barriers path')).toBe(before)
  })

  it('draws nothing extra on the rings', () => {
    const run = runOn('rings')
    expect(run.world.barriers ?? []).toEqual([])
    show(run)
    expect(document.querySelector('svg.minimap')).not.toBeNull()
    expect(document.querySelector('svg.minimap .minimap-barriers')).toBeNull()
  })
})
