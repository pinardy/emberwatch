import { useEffect, type RefObject } from 'react'

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

/** Focuses `ref` (once) if a list asked for the Inspector's focus. */
export function useInspectorFocus(ref: RefObject<HTMLElement | null>, selectionKey: string): void {
  useEffect(() => {
    if (!inspectorWanted) return
    inspectorWanted = false
    ref.current?.focus({ preventScroll: true })
  }, [ref, selectionKey])
}
