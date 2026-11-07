import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings, loadSettings } from '../game/persistence'
import { useGameStore } from '../game/store'
import { PERF_WINDOW_MS, PerfReadout, perfText, summarise } from './PerfReadout'
import { perfStats } from './perfStats'
import { PerfField } from './SettingsFields'

/**
 * Settings → Show performance: an opt-in fps / frame time / draw call
 * readout for checking the game on real hardware. Off by default, persisted
 * with the settings, and costing nothing (not even a frame callback) when off.
 */

const SETTINGS_KEY = 'emberwatch.settings.v1'

/** A hand-driven frame clock in place of requestAnimationFrame. */
function fakeFrames() {
  let queue: FrameRequestCallback[] = []
  const raf = vi.fn((cb: FrameRequestCallback) => {
    queue.push(cb)
    return queue.length
  })
  vi.stubGlobal('requestAnimationFrame', raf)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  return {
    raf,
    /** Runs `count` frames `gap` ms apart, starting after `from`. */
    run(from: number, gap: number, count: number) {
      for (let i = 1; i <= count; i++) {
        const due = queue
        queue = []
        for (const cb of due) cb(from + i * gap)
      }
    },
  }
}

beforeEach(() => {
  localStorage.clear()
  useGameStore.setState({ settings: defaultSettings() })
  perfStats.drawCalls = null
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('performance readout setting', () => {
  it('is off by default and for settings saved before it existed', () => {
    expect(defaultSettings().showPerf).toBe(false)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ sound: false, renderer: '2d' }))
    expect(loadSettings().showPerf).toBe(false)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ showPerf: 'yes' }))
    expect(loadSettings().showPerf).toBe(false)
  })

  it('the Settings toggle turns it on and off, and the choice is saved', () => {
    render(<PerfField />)
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: /Show performance/ })
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    expect(useGameStore.getState().settings.showPerf).toBe(true)
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).showPerf).toBe(true)
    expect(loadSettings().showPerf).toBe(true)
    fireEvent.click(box)
    expect(useGameStore.getState().settings.showPerf).toBe(false)
    expect(loadSettings().showPerf).toBe(false)
  })
})

describe('performance readout', () => {
  it('mounts nothing and asks for no frames while off', () => {
    const frames = fakeFrames()
    render(<PerfReadout />)
    expect(screen.queryByRole('group', { name: 'Performance' })).toBeNull()
    expect(frames.raf).not.toHaveBeenCalled()
  })

  it('shows fps, frame time and the 3D draw calls while on, then goes away', () => {
    const frames = fakeFrames()
    vi.spyOn(performance, 'now').mockReturnValue(0)
    act(() => useGameStore.getState().updateSettings({ showPerf: true }))
    render(<PerfReadout />)
    const panel = screen.getByRole('group', { name: 'Performance' })
    perfStats.drawCalls = 53
    // Just over one window of 20 ms frames: 50 fps.
    act(() => frames.run(0, 20, PERF_WINDOW_MS / 20 + 1))
    expect(panel.textContent).toContain('50 fps · 20.0 ms (max 20)')
    expect(panel.textContent).toContain('53 draw calls')

    act(() => useGameStore.getState().updateSettings({ showPerf: false }))
    expect(screen.queryByRole('group', { name: 'Performance' })).toBeNull()
  })

  it('summarises a window of frame gaps', () => {
    expect(summarise([])).toBeNull()
    const w = summarise([16, 16, 40])!
    expect(w.frameMs).toBe(24)
    expect(w.fps).toBeCloseTo(1000 / 24)
    expect(w.worstMs).toBe(40)
    expect(perfText(w, null)).toEqual(['42 fps · 24.0 ms (max 40)', '2D map: no draw calls'])
    expect(perfText(w, 7)[1]).toBe('7 draw calls')
  })
})
