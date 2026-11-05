import { beforeAll } from 'vitest'
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
