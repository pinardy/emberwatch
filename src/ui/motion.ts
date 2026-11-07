import { useSyncExternalStore } from 'react'

/**
 * Honour the OS-level reduced-motion preference — live: turning it on or off
 * while the game runs takes effect at once. The cosmetic layers (rain,
 * pulses, pops, smoke, camera glides) read `REDUCED_MOTION` each frame or
 * when they start, and fall back to their static forms; components that
 * decide in render subscribe with `useReducedMotion`.
 */
const query =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null

/** True while the player asks for reduced motion (a live binding). */
export let REDUCED_MOTION: boolean = query?.matches ?? false

const listeners = new Set<() => void>()

const onChange = (e: { matches: boolean }) => {
  REDUCED_MOTION = e.matches
  for (const listener of listeners) listener()
}
if (query) {
  if (typeof query.addEventListener === 'function') query.addEventListener('change', onChange)
  else if (typeof query.addListener === 'function') query.addListener(onChange)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const read = () => REDUCED_MOTION

/** The reduced-motion preference, re-rendering when it changes. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, read, read)
}
