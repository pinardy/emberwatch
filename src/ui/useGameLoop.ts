import { useEffect, useRef, type RefObject } from 'react'
import { SPEED_OPTIONS, type GameSpeed } from '../game/engine/balance'
import { MAX_FRAME_REAL_SECONDS, useGameStore, type SidePanel } from '../game/store'

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
      const dt = Math.min((now - lastFrame.current) / 1000, MAX_FRAME_REAL_SECONDS)
      lastFrame.current = now
      // The frame time throttles the HUD clock (see `hudVersion`).
      useGameStore.getState().advance(dt, now)

      if (now - lastSave.current > AUTOSAVE_INTERVAL_MS) {
        lastSave.current = now
        // In idle time, not inside this frame; tab hide and pagehide below
        // still save synchronously.
        useGameStore.getState().saveSoon()
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

/**
 * Things Esc can close besides build mode and the selection. `high` layers
 * (the controls help) close before build mode is cancelled; `low` layers (the
 * tip coach) only once there is nothing else to cancel. The newest layer of a
 * priority closes first.
 */
type EscapeLayer = { priority: 'high' | 'low'; close: () => void }
const escapeLayers: EscapeLayer[] = []

function closeTopLayer(priority: EscapeLayer['priority']): boolean {
  for (let i = escapeLayers.length - 1; i >= 0; i--) {
    if (escapeLayers[i].priority === priority) {
      escapeLayers[i].close()
      return true
    }
  }
  return false
}

/** Registers something Esc should close while `open` is true. */
export function useEscapeLayer(
  open: boolean,
  close: () => void,
  priority: EscapeLayer['priority'] = 'high',
): void {
  const latest = useRef(close)
  latest.current = close
  useEffect(() => {
    if (!open) return
    const layer: EscapeLayer = { priority, close: () => latest.current() }
    escapeLayers.push(layer)
    return () => {
      const index = escapeLayers.indexOf(layer)
      if (index >= 0) escapeLayers.splice(index, 1)
    }
  }, [open, priority])
}

/**
 * Closes a popover on Esc or on a tap anywhere outside `host`, the element
 * that holds both the popover and the button that opens it.
 */
export function useDismiss(
  open: boolean,
  host: RefObject<HTMLElement | null>,
  close: () => void,
): void {
  useEscapeLayer(open, close)
  const latest = useRef(close)
  latest.current = close
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (host.current && !host.current.contains(e.target as Node)) latest.current()
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open, host])
}

/** Side-panel shortcuts, by physical key so they survive non-QWERTY layouts. */
export const PANEL_KEYS: Record<string, Exclude<SidePanel, null>> = {
  KeyB: 'build',
  KeyP: 'villagers',
  KeyO: 'orders',
  KeyT: 'trade',
  KeyL: 'log',
}

/** The letter shown in tooltips and help for each panel. */
export const PANEL_KEY_LABEL: Record<Exclude<SidePanel, null>, string> = {
  build: 'B',
  villagers: 'P',
  orders: 'O',
  trade: 'T',
  log: 'L',
}

function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable
}

/**
 * Keyboard shortcuts: Space pauses, 1–5 set speed, B/P/O/T/L open panels, Esc
 * closes the topmost thing (help, placement, selection, then tips).
 *
 * Everything is ignored while a blocking dialog is up — the draft and glade
 * events must be answered, and their buttons need Space and Enter themselves.
 */
export function useHotkeys(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (isTextEntry(e.target)) return
      const store = useGameStore.getState()
      const run = store.run
      if (!run || run.phase !== 'playing' || run.pendingChoices.length > 0) return

      if (e.key === 'Escape') {
        if (closeTopLayer('high')) return
        if (store.buildMode) store.cancelBuildStep()
        else if (store.selectedBuilding || store.selectedDeposit || store.selectedGlade) {
          store.clearSelection()
        } else closeTopLayer('low')
        return
      }

      // Leave browser and OS shortcuts (Ctrl+1 switches tabs, Cmd+L...) alone.
      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (e.key === ' ') {
        e.preventDefault()
        // Holding Space would otherwise flicker between paused and running.
        if (!e.repeat) store.togglePlay()
        return
      }
      const speed = Number(e.key)
      if (/^[1-9]$/.test(e.key) && (SPEED_OPTIONS as readonly number[]).includes(speed)) {
        store.setSpeed(speed as GameSpeed)
        return
      }
      const panel = PANEL_KEYS[e.code]
      if (panel && !e.repeat) {
        store.setPanel(store.panel === panel ? null : panel)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}
