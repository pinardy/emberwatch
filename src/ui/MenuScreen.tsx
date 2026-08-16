import { useEffect, useState } from 'react'
import { loadRun } from '../game/persistence'
import { useGameStore } from '../game/store'

export function MenuScreen() {
  const goToScreen = useGameStore((s) => s.goToScreen)
  const resumeSaved = useGameStore((s) => s.resumeSaved)
  const meta = useGameStore((s) => s.meta)
  const run = useGameStore((s) => s.run)
  const settings = useGameStore((s) => s.settings)
  const updateSettings = useGameStore((s) => s.updateSettings)
  const [hasSave, setHasSave] = useState(false)

  useEffect(() => {
    setHasSave(loadRun() !== null)
  }, [run])

  return (
    <div className="screen menu-screen">
      <div className="menu-card">
        <h1 className="brand">
          Ember<span>watch</span>
        </h1>
        <p className="tagline">
          A roguelite city builder. Raise a settlement in the rain-soaked forest, keep five
          species from walking out on you, and earn the Queen's favour before her patience
          runs out.
        </p>

        <div className="menu-actions">
          {run && (
            <button type="button" className="primary" onClick={() => goToScreen('game')}>
              ▶ Back to the settlement
            </button>
          )}
          {!run && hasSave && (
            <button type="button" className="primary" onClick={resumeSaved}>
              ▶ Continue saved settlement
            </button>
          )}
          <button
            type="button"
            className={run ? '' : 'primary'}
            onClick={() => goToScreen('setup')}
          >
            🌱 New settlement
          </button>
          <button type="button" onClick={() => goToScreen('citadel')}>
            🏛️ The Citadel ({meta.citadelSupplies} supplies)
          </button>
        </div>

        <details className="how-to">
          <summary>How to play</summary>
          <ol>
            <li>
              <strong>Clear glades.</strong> Tap a fogged glade next to your territory and
              add villagers to the clearing crew. Glades yield resources — and dangerous
              ones force a decision.
            </li>
            <li>
              <strong>Feed everyone.</strong> Gathering camps must sit within range of a
              deposit. Cooked food feeds twice as far, and food <em>variety</em> raises
              resolve.
            </li>
            <li>
              <strong>Meet their needs.</strong> Each species wants two services. A service
              must be staffed <em>and</em> supplied to count, and must cover 75% of your
              population.
            </li>
            <li>
              <strong>Watch the three bars.</strong> Reputation wins the run, Impatience
              loses it, and Hostility drags resolve down for everybody.
            </li>
            <li>
              <strong>Survive the Storm.</strong> Farms stop, gathering halves, and the
              hearth burns wood. Stockpile before it hits.
            </li>
          </ol>
          <p className="muted">
            Space pauses · 1/2/3 set speed · WASD/arrows pan · Q/E rotate · H homes ·
            right-click or Esc cancels placement. Progress saves automatically and the
            game works offline once loaded.
          </p>
        </details>

        <details className="how-to settings-block">
          <summary>Settings</summary>
          <label>
            <input
              type="checkbox"
              checked={settings.sound}
              onChange={(e) => updateSettings({ sound: e.target.checked })}
            />
            Sound & rain ambience
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.pauseOnBlur}
              onChange={(e) => updateSettings({ pauseOnBlur: e.target.checked })}
            />
            Pause when the window loses focus
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.renderer === '3d'}
              onChange={(e) => updateSettings({ renderer: e.target.checked ? '3d' : '2d' })}
            />
            3D map (2D vector map otherwise)
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.shadows}
              onChange={(e) => updateSettings({ shadows: e.target.checked })}
            />
            Shadows — turn off on slower devices
          </label>
        </details>

        <p className="menu-foot muted">
          {meta.runsWon} won · {meta.runsLost} lost
        </p>
      </div>
    </div>
  )
}
