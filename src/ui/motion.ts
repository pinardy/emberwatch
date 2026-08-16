/**
 * Honour the OS-level reduced-motion preference. Checked once at load — the
 * cosmetic layers (rain, pulses, pops, smoke, camera glides) read this flag
 * and fall back to their static forms.
 */
export const REDUCED_MOTION: boolean =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
