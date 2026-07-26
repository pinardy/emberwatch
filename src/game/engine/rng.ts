/**
 * Counter-based deterministic RNG.
 *
 * We never keep RNG state outside `RunState` — a value is a pure function of
 * `(seed, cursor)`, and the cursor lives in the run. That means a save file
 * resumes to the exact same future, which matters for a roguelite where seeds
 * are shareable.
 */

/** splitmix32 — fast, well-distributed, no dependencies. */
export function hashInt(seed: number, cursor: number): number {
  let z = (seed + cursor * 0x9e3779b9) | 0
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad)
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97)
  z = z ^ (z >>> 15)
  return z >>> 0
}

export interface Rng {
  /** [0, 1) */
  next(): number
  /** Integer in [0, max). */
  int(max: number): number
  /** Integer in [min, max] inclusive. */
  range(min: number, max: number): number
  pick<T>(items: readonly T[]): T
  /** `count` distinct items (or fewer if the pool is small). */
  sample<T>(items: readonly T[], count: number): T[]
  weighted<T>(items: readonly T[], weight: (item: T) => number): T
  chance(p: number): boolean
  shuffle<T>(items: readonly T[]): T[]
  /** Current cursor, so callers can write it back into the run state. */
  cursor(): number
}

/** Wraps a seed + starting cursor. `onAdvance` receives the new cursor. */
export function makeRng(seed: number, startCursor: number): Rng {
  let cursor = startCursor

  const next = () => hashInt(seed, cursor++) / 0x100000000

  const rng: Rng = {
    next,
    int: (max) => (max <= 0 ? 0 : Math.floor(next() * max)),
    range: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    sample(items, count) {
      const pool = rng.shuffle(items)
      return pool.slice(0, Math.min(count, pool.length))
    },
    weighted(items, weight) {
      const total = items.reduce((acc, i) => acc + Math.max(0, weight(i)), 0)
      if (total <= 0) return items[0]
      let roll = next() * total
      for (const item of items) {
        roll -= Math.max(0, weight(item))
        if (roll <= 0) return item
      }
      return items[items.length - 1]
    },
    chance: (p) => next() < p,
    shuffle(items) {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const a = out[i]
        const b = out[j]
        out[i] = b
        out[j] = a
      }
      return out
    },
    cursor: () => cursor,
  }

  return rng
}

/** Convenience for a throwaway seed (new run, meta screens). */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0
}

/** Turns a human-typed seed string into a usable 32-bit seed. */
export function parseSeed(input: string): number {
  const trimmed = input.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) >>> 0
  let h = 2166136261
  for (let i = 0; i < trimmed.length; i++) {
    h ^= trimmed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
