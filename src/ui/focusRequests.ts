import { useEffect, useRef, type RefObject } from 'react'

/**
 * One-shot focus hand-offs between parts of the HUD that do not know about
 * each other: a keyboard list picks a building or glade and asks for the
 * Inspector to take focus once it has rendered.
 */

let inspectorWanted = false

/** Asks the Inspector to take focus the next time it renders a selection. */
export function requestInspectorFocus(): void {
  inspectorWanted = true
}

/**
 * On a change of screen, focus moves to the new screen's title (its h1), so
 * keyboard and screen-reader users start at the top of what they just opened
 * rather than on a button that no longer exists. Screens load lazily, so this
 * waits a few frames for the title; anything that has already taken focus in
 * the new screen (a dialog, the founding panel) keeps it.
 */
export function useScreenFocus(screen: string): void {
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    let frames = 0
    let handle = 0
    const tryFocus = () => {
      const active = document.activeElement
      const settled = active && active !== document.body && active.isConnected
      if (settled && active.closest('.screen, .game')) return
      const title = document.querySelector<HTMLElement>('.screen h1, .game h1')
      if (title) {
        if (!title.hasAttribute('tabindex')) title.tabIndex = -1
        title.focus({ preventScroll: true })
        return
      }
      if (frames++ < 60 && typeof requestAnimationFrame === 'function') {
        handle = requestAnimationFrame(tryFocus)
      }
    }
    tryFocus()
    return () => {
      if (handle) cancelAnimationFrame(handle)
    }
  }, [screen])
}

/** Focuses `ref` (once) if a list asked for the Inspector's focus. */
export function useInspectorFocus(ref: RefObject<HTMLElement | null>, selectionKey: string): void {
  useEffect(() => {
    if (!inspectorWanted) return
    inspectorWanted = false
    ref.current?.focus({ preventScroll: true })
  }, [ref, selectionKey])
}
