import { useEffect, useRef } from 'react'
import { useGameStore } from '../game/store'

const AUTOSAVE_INTERVAL_MS = 8000

/**
 * Drives the simulation from requestAnimationFrame and autosaves periodically.
 *
 * The store clamps how much time a single call may consume, so a backgrounded
 * tab resumes where it left off rather than fast-forwarding.
 */
export function useGameLoop(active: boolean): void {
  const lastFrame = useRef(0)
  const lastSave = useRef(0)

  useEffect(() => {
    if (!active) return
    let frame = 0
    lastFrame.current = performance.now()
    lastSave.current = performance.now()

    const step = (now: number) => {
      const dt = Math.min((now - lastFrame.current) / 1000, 0.5)
      lastFrame.current = now
      useGameStore.getState().advance(dt)

      if (now - lastSave.current > AUTOSAVE_INTERVAL_MS) {
        lastSave.current = now
        useGameStore.getState().saveNow()
      }
      frame = requestAnimationFrame(step)
    }

    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [active])

  // Pause when the tab is hidden so returning players are not punished.
  useEffect(() => {
    if (!active) return
    const onVisibility = () => {
      const store = useGameStore.getState()
      if (document.hidden) {
        if (store.settings.pauseOnBlur && store.speed !== 0) {
          store.setSpeed(0)
          store.saveNow()
        }
      } else {
        lastFrame.current = performance.now()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [active])

  // Save on the way out — covers installed-PWA task switching.
  useEffect(() => {
    const onHide = () => useGameStore.getState().saveNow()
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])
}

/** Keyboard shortcuts: space to pause, 1-3 for speed, Esc to cancel build. */
export function useHotkeys(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const store = useGameStore.getState()
      switch (e.key) {
        case ' ':
          e.preventDefault()
          store.togglePlay()
          break
        case '1':
          store.setSpeed(1)
          break
        case '2':
          store.setSpeed(2)
          break
        case '3':
          store.setSpeed(3)
          break
        case 'Escape':
          if (store.buildMode) store.setBuildMode(null)
          else store.clearSelection()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}
