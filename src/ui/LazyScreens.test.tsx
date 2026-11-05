import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The setup, Citadel, saves, achievements and game screens and the
 * end-of-run modal are lazily loaded chunks. The other UI tests run with them preloaded (see
 * src/test/setup-ui.ts); these start from a fresh module graph so each screen
 * is genuinely cold: it suspends, shows its fallback, then renders once its
 * code arrives.
 */

async function coldApp() {
  vi.resetModules()
  const { default: App } = await import('../App')
  const { useGameStore } = await import('../game/store')
  return { App, useGameStore }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(cleanup)

describe('lazily loaded screens', () => {
  it('shows a loading state, then the setup screen', async () => {
    const { App } = await coldApp()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    expect(screen.getByRole('status').textContent).toMatch(/Loading/)
    expect(await screen.findByLabelText(/Map seed/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Set out with/i })).toBeTruthy()
  })

  it('loads the Citadel from the menu', async () => {
    const { App } = await coldApp()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /The Citadel/i }))
    expect(await screen.findByRole('heading', { name: /The Citadel/i })).toBeTruthy()
    expect(screen.getByText(/Harpy Charter/i)).toBeTruthy()
  })

  it('loads the game, then the end-of-run summary and its timeline only when the run ends', async () => {
    const { App, useGameStore } = await coldApp()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(await screen.findByRole('button', { name: /Set out with/i }))
    expect(await screen.findByRole('application', { name: /Settlement map/i })).toBeTruthy()
    expect(screen.queryByText(/The settlement holds/i)).toBeNull()

    act(() => {
      const run = useGameStore.getState().run!
      useGameStore.setState({ run: { ...run, phase: 'won', pendingChoices: [] } })
    })
    expect(await screen.findByText(/The settlement holds/i)).toBeTruthy()
    expect(screen.getByRole('heading', { name: /How the run unfolded/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Return to the Citadel/i })).toBeTruthy()
  })

  it('renders a screen straight away once its code has arrived', async () => {
    const { App, useGameStore } = await coldApp()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    await screen.findByLabelText(/Map seed/i)

    act(() => useGameStore.getState().goToScreen('menu'))
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    // No fallback this time: the screen is there in the same render.
    expect(screen.queryByText(/Loading…/)).toBeNull()
    expect(screen.getByLabelText(/Map seed/i)).toBeTruthy()
  })

  it('preloads every screen in idle time after the menu appears', async () => {
    vi.useFakeTimers()
    try {
      vi.resetModules()
      const lazy = await import('./lazyScreens')
      const spies = [
        lazy.SetupScreen,
        lazy.GameScreen,
        lazy.CitadelScreen,
        lazy.SavesScreen,
        lazy.AchievementsScreen,
        lazy.EndModal,
      ].map((s) => vi.spyOn(s, 'preload'))
      const { default: App } = await import('../App')
      render(<App />)
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
      await act(async () => {
        await vi.runAllTimersAsync()
      })
      for (const spy of spies) expect(spy).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
