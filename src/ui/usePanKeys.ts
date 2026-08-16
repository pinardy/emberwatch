import { useEffect, useRef } from 'react'

/**
 * Tracks held WASD / arrow keys for camera panning. Returns a ref to the set
 * of active pan directions; the consumer decides how to move its camera
 * (per-frame in the 3D view, per-event nudges in the 2D fallback).
 *
 * Uses `e.code` so W/A/S/D stay in place on non-QWERTY layouts.
 */

export type PanDirection = 'up' | 'down' | 'left' | 'right'

const CODE_TO_DIRECTION: Record<string, PanDirection> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
}

export function panDirectionOf(e: KeyboardEvent): PanDirection | null {
  const target = e.target as HTMLElement | null
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return null
  // Leave browser/OS shortcuts (Ctrl+A, Alt+arrows...) alone.
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  return CODE_TO_DIRECTION[e.code] ?? null
}

/** Held pan keys, kept in a ref so reading them never re-renders anything. */
export function usePanKeys(): React.MutableRefObject<Set<PanDirection>> {
  const held = useRef(new Set<PanDirection>())

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const direction = panDirectionOf(e)
      if (!direction) return
      held.current.add(direction)
      // Arrows would otherwise scroll the page behind the map.
      if (e.code.startsWith('Arrow')) e.preventDefault()
    }
    const onUp = (e: KeyboardEvent) => {
      const direction = CODE_TO_DIRECTION[e.code]
      if (direction) held.current.delete(direction)
    }
    // Alt-tabbing away with a key held would leave the camera drifting.
    const onBlur = () => held.current.clear()

    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  return held
}
