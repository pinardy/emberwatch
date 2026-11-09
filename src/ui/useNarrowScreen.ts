import { useSyncExternalStore } from 'react'

/**
 * Phones and small tablets: the width at which the side panel turns into a
 * bottom sheet (styles.css, `@media (max-width: 860px)`). Components that lay
 * out differently there (the HUD strip, coach tips in the sheet, the First
 * steps chip) read this hook rather than hiding things with CSS alone, so the
 * desktop DOM stays exactly as it was.
 *
 * jsdom has no media queries, so tests choose the layout with
 * `setNarrowScreenForTests` instead.
 */
export const NARROW_QUERY = '(max-width: 860px)'

const query =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(NARROW_QUERY)
    : null

let override: boolean | null = null
const listeners = new Set<() => void>()

const notify = () => {
  for (const listener of listeners) listener()
}

if (query) {
  if (typeof query.addEventListener === 'function') query.addEventListener('change', notify)
  else if (typeof query.addListener === 'function') query.addListener(notify)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** True on a narrow screen, now (outside React). */
export function isNarrowScreen(): boolean {
  return override ?? query?.matches ?? false
}

/** True on a narrow screen, re-rendering when the width crosses the line. */
export function useNarrowScreen(): boolean {
  return useSyncExternalStore(subscribe, isNarrowScreen, isNarrowScreen)
}

/** Tests: force the narrow (true) or wide (false) layout; null follows the media query. */
export function setNarrowScreenForTests(value: boolean | null): void {
  override = value
  notify()
}
