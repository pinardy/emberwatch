import { useEffect } from 'react'
import { useGameStore } from './game/store'
import { CitadelScreen } from './ui/CitadelScreen'
import { GameScreen } from './ui/GameScreen'
import { MenuScreen } from './ui/MenuScreen'
import { SavesScreen } from './ui/SavesScreen'
import { SetupScreen } from './ui/SetupScreen'
import { UpdatePrompt } from './ui/UpdatePrompt'

export default function App() {
  const screen = useGameStore((s) => s.screen)
  const boot = useGameStore((s) => s.boot)

  useEffect(() => {
    boot()
  }, [boot])

  return (
    <>
      {screen === 'menu' && <MenuScreen />}
      {screen === 'setup' && <SetupScreen />}
      {screen === 'citadel' && <CitadelScreen />}
      {screen === 'saves' && <SavesScreen />}
      {screen === 'game' && <GameScreen />}
      <UpdatePrompt />
    </>
  )
}
