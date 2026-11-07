import { useEffect } from 'react'
import { useGameStore } from './game/store'
import { DailyScreen } from './ui/DailyScreen'
import {
  AchievementsScreen,
  CitadelScreen,
  GameScreen,
  SavesScreen,
  SetupScreen,
  preloadScreensWhenIdle,
} from './ui/lazyScreens'
import { MenuScreen } from './ui/MenuScreen'
import { RecoveryOverlay } from './ui/RecoveryOverlay'
import { UpdatePrompt } from './ui/UpdatePrompt'

export default function App() {
  const screen = useGameStore((s) => s.screen)
  const boot = useGameStore((s) => s.boot)

  useEffect(() => {
    boot()
  }, [boot])

  // Only the menu ships in the startup chunk; fetch the rest once it is up.
  useEffect(() => preloadScreensWhenIdle(), [])

  return (
    <>
      {screen === 'menu' && <MenuScreen />}
      {screen === 'setup' && <SetupScreen />}
      {screen === 'citadel' && <CitadelScreen />}
      {screen === 'saves' && <SavesScreen />}
      {screen === 'game' && <GameScreen />}
      {screen === 'achievements' && <AchievementsScreen />}
      {screen === 'daily' && <DailyScreen />}
      {/* After a game-loop crash; render errors show it from the boundary. */}
      <RecoveryOverlay />
      <UpdatePrompt />
    </>
  )
}
