import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { defaultSettings } from '../game/persistence'
import { slotKey } from '../game/saveSlots'
import { useGameStore } from '../game/store'
import type { RunState } from '../game/types'
import { ErrorBoundary, GuardedApp } from './ErrorBoundary'
import { LoadBoundary } from './lazyScreens'
import { useEscapeLayer } from './useGameLoop'

/*
 * What the player sees when something goes wrong: a run that is not being
 * saved says so until it is, a crash in the game loop or a screen stops play
 * and saving and offers a way back, a chunk that will not load is told apart
 * from a bug, and overlays give way to the dialog that owns the keyboard.
 */

function currentRun(): RunState {
  const run = useGameStore.getState().run
  if (!run) throw new Error('expected a run')
  return run
}

/** Starts a run past its founding picks, on the 2D map, paused. */
function startRun(): RunState {
  act(() => {
    void useGameStore.getState().startRun(4242)
  })
  let guard = 0
  while (currentRun().pendingChoices.length > 0 && guard++ < 10) {
    act(() => useGameStore.getState().chooseOption(currentRun().pendingChoices[0].options[0]))
  }
  return currentRun()
}

function bump() {
  act(() => {
    const { version, hudVersion } = useGameStore.getState()
    useGameStore.setState({ version: version + 1, hudVersion: hudVersion + 1 })
  })
}

const original = useGameStore.getState()

beforeEach(() => {
  localStorage.clear()
  useGameStore.setState({
    screen: 'menu',
    run: null,
    activeSlot: null,
    speed: 0,
    notice: null,
    saveError: null,
    crash: null,
    buildMode: null,
    selectedBuilding: null,
    selectedDeposit: null,
    selectedGlade: null,
    panel: 'build',
    settings: { ...defaultSettings(), renderer: '2d', sound: false },
    advance: original.advance,
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the "not saving" chip', () => {
  it('stays in the top bar while saves fail and goes once one lands', () => {
    render(<App />)
    startRun()
    expect(screen.queryByRole('button', { name: /Not saving/ })).toBeNull()

    const full = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const error = new Error('The quota has been exceeded.')
      error.name = 'QuotaExceededError'
      throw error
    })
    act(() => useGameStore.getState().saveNow())
    expect(useGameStore.getState().saveError).toMatchObject({ reason: 'quota' })
    const chip = screen.getByRole('button', { name: /Not saving — storage full/ })
    // The passing notice goes; the chip does not.
    act(() => useGameStore.getState().dismissNotice())
    act(() => useGameStore.getState().saveNow())
    expect(screen.getByRole('button', { name: /Not saving/ })).toBe(chip)

    fireEvent.click(chip)
    expect(screen.getByText(/browser storage is full/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Export this run' })).toBeTruthy()

    full.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.queryByRole('button', { name: /Not saving/ })).toBeNull()
  })
})

describe('a crash in the game loop', () => {
  it('stops the loop and every save, and reloads the last good save', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<App />)
    startRun()
    act(() => useGameStore.getState().saveNow())
    const slot = slotKey(useGameStore.getState().activeSlot!)
    const goodSave = localStorage.getItem(slot)
    expect(goodSave).not.toBeNull()

    // The next step throws, leaving the run in memory half-updated.
    currentRun().clock = 777
    const advance = vi.fn(() => {
      throw new Error('tick exploded')
    })
    useGameStore.setState({ advance })
    /** Runs every frame callback queued so far (the loop's among them). */
    const flushFrames = () => {
      const queued = frames.splice(0)
      act(() => queued.forEach((cb) => cb(performance.now() + 100)))
    }
    expect(frames.length).toBeGreaterThan(0)
    flushFrames()
    expect(advance).toHaveBeenCalledTimes(1)
    expect(useGameStore.getState().crash).toMatch(/tick exploded/)
    // The loop asked for no further frame: it never steps again.
    flushFrames()
    flushFrames()
    expect(advance).toHaveBeenCalledTimes(1)
    const dialog = screen.getByRole('alertdialog', { name: 'Something went wrong' })
    expect(dialog.textContent).toMatch(/last good save/)
    expect(logged).toHaveBeenCalled()

    // Nothing writes the half-updated run: not the autosave, not leaving the page.
    act(() => useGameStore.getState().saveNow())
    act(() => useGameStore.getState().saveSoon())
    window.dispatchEvent(new Event('pagehide'))
    expect(localStorage.getItem(slot)).toBe(goodSave)

    useGameStore.setState({ advance: original.advance })
    fireEvent.click(screen.getByRole('button', { name: 'Reload the last save' }))
    expect(useGameStore.getState().crash).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(currentRun().clock).not.toBe(777)
    expect(useGameStore.getState().screen).toBe('game')
  })

  it('offers the menu and an export when there is no save to go back to', () => {
    render(<App />)
    act(() => useGameStore.getState().reportCrash(new Error('boom')))
    expect(screen.queryByRole('button', { name: 'Reload the last save' })).toBeNull()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Back to the menu' }))
    expect(useGameStore.getState().crash).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Emberwatch')
  })
})

describe('a screen that throws while rendering', () => {
  it('shows the recovery overlay instead of a white screen, and starts afresh', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    let broken = true
    function Fragile() {
      if (broken) throw new Error('Cannot read properties of undefined')
      return <p>All well</p>
    }
    render(
      <GuardedApp>
        <Fragile />
      </GuardedApp>,
    )
    expect(screen.getByRole('alertdialog', { name: 'Something went wrong' })).toBeTruthy()
    expect(useGameStore.getState().crash).toMatch(/Cannot read properties/)
    expect(logged).toHaveBeenCalled()
    broken = false
    fireEvent.click(screen.getByRole('button', { name: 'Back to the menu' }))
    expect(screen.getByText('All well')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

describe('a lazy screen that fails', () => {
  function Throws({ error }: { error: Error }): never {
    throw error
  }

  it('says a chunk that will not load is about the connection or an update', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <LoadBoundary>
          <Throws error={new TypeError('Failed to fetch dynamically imported module: /assets/x.js')} />
        </LoadBoundary>
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert').textContent).toMatch(/offline, or the game was updated/)
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(useGameStore.getState().crash).toBeNull()
  })

  it('passes any other error on to the recovery overlay', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <LoadBoundary>
          <Throws error={new TypeError("Cannot read properties of undefined (reading 'options')")} />
        </LoadBoundary>
      </ErrorBoundary>,
    )
    expect(screen.queryByText(/offline/)).toBeNull()
    expect(screen.getByRole('alertdialog', { name: 'Something went wrong' })).toBeTruthy()
  })
})

describe('one dialog at a time', () => {
  it('closes an overlay such as the controls help when a blocking dialog opens', () => {
    function Help() {
      const [open, setOpen] = useState(true)
      useEscapeLayer(open, () => setOpen(false))
      return open ? <p>Controls help</p> : null
    }
    render(<App />)
    const run = startRun()
    render(<Help />)
    expect(screen.getByText('Controls help')).toBeTruthy()
    // A founding pick is a side panel, not a dialog: the help stays.
    act(() => {
      run.pendingChoices = [{ kind: 'blueprint', options: ['brazier'], founding: true }]
      useGameStore.setState({ version: useGameStore.getState().version + 1 })
    })
    expect(screen.getByText('Controls help')).toBeTruthy()
    act(() => {
      run.pendingChoices = [{ kind: 'cornerstone', options: ['sturdyScaffolds'] }]
      useGameStore.setState({ version: useGameStore.getState().version + 1 })
    })
    expect(screen.queryByText('Controls help')).toBeNull()
  })

  it('shows only the end of the run, not a choice left open behind it', () => {
    render(<App />)
    const run = startRun()
    act(() => {
      run.pendingChoices = [{ kind: 'cornerstone', options: ['sturdyScaffolds'] }]
      run.phase = 'lost'
    })
    bump()
    expect(screen.queryByRole('heading', { name: 'Lay a Cornerstone' })).toBeNull()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })
})
