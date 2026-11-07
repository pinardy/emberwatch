import { useMemo } from 'react'
import { latestSlot, listSlots } from '../game/saveSlots'
import { useGameStore } from '../game/store'
import { ACHIEVEMENT_LIST, achievementCount } from '../game/content/achievements'
import { DailyMenuEntry } from './DailyScreen'
import { SlotOneLiner } from './SaveSlots'
import { AutoPauseFields, PauseOnBlurField, PerfField, SoundFields } from './SettingsFields'
import { HowToPlay } from './HowToPlay'
import { Icon } from './Icon'

export function MenuScreen() {
  const goToScreen = useGameStore((s) => s.goToScreen)
  const resumeSaved = useGameStore((s) => s.resumeSaved)
  const meta = useGameStore((s) => s.meta)
  const run = useGameStore((s) => s.run)
  const version = useGameStore((s) => s.version)
  const settings = useGameStore((s) => s.settings)
  const updateSettings = useGameStore((s) => s.updateSettings)

  // The most recently played slot, for "Continue".
  const latest = useMemo(() => {
    const id = latestSlot()
    return id ? (listSlots().find((s) => s.id === id) ?? null) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, version])

  return (
    <div className="screen menu-screen">
      <div className="menu-card">
        <h1 className="brand">
          Ember<span>watch</span>
        </h1>
        <p className="tagline">
          A roguelite city builder. Raise a settlement in the rain-soaked forest, keep the
          three species you bring from walking out on you, and earn the Queen's favour
          before her patience runs out.
        </p>

        <div className="menu-actions">
          {run && (
            <button type="button" className="primary" onClick={() => goToScreen('game')}>
              ▶ Back to the settlement
            </button>
          )}
          {!run && latest?.meta && (
            <button type="button" className="primary" onClick={() => resumeSaved(latest.id)}>
              ▶ Continue
              <small className="menu-sub">
                {latest.label} · <SlotOneLiner meta={latest.meta} />
              </small>
            </button>
          )}
          <button
            type="button"
            className={run ? '' : 'primary'}
            onClick={() => goToScreen('setup')}
          >
            <Icon id="small" emoji="🌱" /> New settlement
          </button>
          <button type="button" onClick={() => goToScreen('saves')}>
            <Icon id="folder" emoji="📂" /> Saved settlements
          </button>
          <button type="button" onClick={() => goToScreen('citadel')}>
            <Icon id="guildHouse" emoji="🏛️" /> The Citadel ({meta.citadelSupplies} supplies)
          </button>
          <DailyMenuEntry />
          <button type="button" onClick={() => goToScreen('achievements')}>
            <Icon id="medal" emoji="🏅" /> Achievements ({achievementCount(meta.achievements)}/{ACHIEVEMENT_LIST.length})
          </button>
        </div>

        <HowToPlay />

        <details className="how-to settings-block">
          <summary>Settings</summary>
          <SoundFields />
          <PauseOnBlurField />
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
          <PerfField />
          <AutoPauseFields />
        </details>

        <p className="menu-foot muted">
          {meta.title && <span className="menu-title">Viceroy {meta.title} · </span>}
          {meta.runsWon} won · {meta.runsLost} lost
        </p>
      </div>
    </div>
  )
}
