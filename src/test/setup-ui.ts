import { configure } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest'
import { resetLoopStateForTests } from '../game/store'
import { preloadScreens } from '../ui/lazyScreens'

/*
 * In the app, lazily loaded screens are fetched in idle time right after the
 * menu appears, and once loaded they render without suspending. Doing the
 * same here lets UI tests click from screen to screen synchronously, as a
 * player who waited a moment would. The cold path, where a screen suspends
 * and shows its fallback first, is covered by LazyScreens.test.tsx.
 */
beforeAll(async () => {
  await preloadScreens()
})

/*
 * `findBy*` and `waitFor` give up after 1 s by default; on a loaded machine a
 * screen that mounts the whole game can take longer than that to settle.
 */
configure({ asyncUtilTimeout: 5000 })

/*
 * A run set out with the seed left blank draws its seed from Math.random, so
 * a UI flow through the setup screen would play a different map every time
 * and a map-dependent step could fail one run in many. Each test gets its own
 * seeded sequence instead (from its name, so it does not depend on the order
 * tests run in); calls within a test still differ from one another.
 */
const realRandom = Math.random

function seededRandom(seed: number): () => number {
  // mulberry32
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashName(name: string): number {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

beforeEach(() => {
  Math.random = seededRandom(hashName(expect.getState().currentTestName ?? ''))
})

afterEach(() => {
  // The store's frame carry, auto-pause snapshot, HUD throttle and any idle
  // save still waiting belong to the test that made them.
  resetLoopStateForTests()
})

afterAll(() => {
  Math.random = realRandom
})
