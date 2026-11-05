import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { defaultSettings, defaultVolume, loadSettings } from '../game/persistence'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import * as audio from './audio'
import { MUSIC_TENSE_IMPATIENCE_SHARE, musicMoodFor } from './useAudioCues'

vi.mock('./audio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./audio')>()
  return {
    ...actual,
    setMusicMood: vi.fn(),
    setMusicHeld: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
  }
})

const SETTINGS_KEY = 'emberwatch.settings.v1'

function currentRun(): RunState {
  const run = useGameStore.getState().run
  if (!run) throw new Error('expected a run')
  return run
}

function bump() {
  useGameStore.setState({ version: useGameStore.getState().version + 1 })
}

function startGame() {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
  fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
  let guard = 0
  while (currentRun().pendingChoices.length > 0 && guard++ < 10) {
    const option = screen.getAllByRole('button').find((b) => b.className.includes('option'))
    if (!option) break
    fireEvent.click(option)
  }
}

const lastCall = <T,>(fn: unknown): T => {
  const calls = vi.mocked(fn as (...args: unknown[]) => unknown).mock.calls
  return calls[calls.length - 1][0] as T
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  useGameStore.setState({
    screen: 'menu',
    run: null,
    speed: 0,
    panel: 'build',
    notice: null,
    settings: defaultSettings(),
  })
})

afterEach(cleanup)

describe('volume settings', () => {
  it('migrates settings saved before the mixer existed', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ pauseOnBlur: false, sound: false, renderer: '2d', shadows: true }),
    )
    const settings = loadSettings()
    expect(settings.volume).toEqual(defaultVolume())
    // Everything else they saved survives, mute included.
    expect(settings.sound).toBe(false)
    expect(settings.pauseOnBlur).toBe(false)

    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ volume: { music: 0.8, master: 7 } }))
    expect(loadSettings().volume).toEqual({ ...defaultVolume(), music: 0.8, master: 1 })
  })

  it('offers labelled sliders in the menu settings that save as they move', () => {
    render(<App />)
    for (const name of ['Master volume', 'Music', 'Effects', 'Rain']) {
      expect(screen.getByRole('slider', { name })).toBeTruthy()
    }
    const music = screen.getByRole('slider', { name: 'Music' }) as HTMLInputElement
    expect(music.value).toBe(String(Math.round(defaultVolume().music * 100)))
    expect(music.getAttribute('aria-valuetext')).toBe('30%')

    fireEvent.change(music, { target: { value: '65' } })
    expect(useGameStore.getState().settings.volume.music).toBeCloseTo(0.65)
    expect(loadSettings().volume.music).toBeCloseTo(0.65)

    // Muting keeps the levels and says so to screen readers.
    fireEvent.click(screen.getByRole('checkbox', { name: /Sound, music & rain/i }))
    expect(useGameStore.getState().settings.sound).toBe(false)
    expect(useGameStore.getState().settings.volume.music).toBeCloseTo(0.65)
    expect(music.getAttribute('aria-valuetext')).toBe('65%, muted')
  })

  it('offers the same sliders in the in-game settings popover', () => {
    startGame()
    fireEvent.click(screen.getByRole('button', { name: 'Game settings' }))
    const popover = screen.getByRole('group', { name: 'Game settings' })
    const rain = within(popover).getByRole('slider', { name: 'Rain' })
    fireEvent.change(rain, { target: { value: '20' } })
    expect(useGameStore.getState().settings.volume.ambience).toBeCloseTo(0.2)
    // ...and the live mix hears it at once.
    expect(lastCall<{ ambience: number }>(audio.setVolume).ambience).toBeCloseTo(0.2)
    for (const name of ['Master volume', 'Music', 'Effects']) {
      expect(within(popover).getByRole('slider', { name })).toBeTruthy()
    }
  })
})

describe('the score follows the run', () => {
  it('plays the season, and darkens when a threat is loose or the Queen is impatient', () => {
    startGame()
    const run = currentRun()
    expect(lastCall(audio.setMusicMood)).toEqual({
      season: run.season.season,
      tense: false,
      seed: run.seed,
    })

    act(() => {
      currentRun().impatience = currentRun().maxImpatience * MUSIC_TENSE_IMPATIENCE_SHARE
      bump()
    })
    expect(lastCall<{ tense: boolean }>(audio.setMusicMood).tense).toBe(true)

    act(() => {
      currentRun().impatience = 0
      currentRun().season.season = 'storm'
      bump()
    })
    expect(lastCall(audio.setMusicMood)).toMatchObject({ season: 'storm', tense: false })
  })

  it('reads a loose threat as tension and a finished run as silence', () => {
    startGame()
    const run = structuredClone(currentRun())
    expect(musicMoodFor(run)?.tense).toBe(false)
    run.threats = [{ id: 't1' } as RunState['threats'][number]]
    expect(musicMoodFor(run)?.tense).toBe(true)
    run.phase = 'lost'
    expect(musicMoodFor(run)).toBeNull()
  })

  it('holds while the game is paused or the tab is hidden', () => {
    startGame()
    act(() => useGameStore.getState().setSpeed(1))
    expect(lastCall(audio.setMusicHeld)).toBe(false)
    act(() => useGameStore.getState().setSpeed(0))
    expect(lastCall(audio.setMusicHeld)).toBe(true)
    act(() => useGameStore.getState().setSpeed(1))
    expect(lastCall(audio.setMusicHeld)).toBe(false)

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    try {
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(lastCall(audio.setMusicHeld)).toBe(true)
    } finally {
      hidden.mockRestore()
    }
  })

  it('stops the score when the run is left', () => {
    startGame()
    cleanup()
    expect(lastCall(audio.setMusicMood)).toBeNull()
  })
})
