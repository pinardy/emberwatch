import {
  ACHIEVEMENT_LIST,
  ACHIEVEMENT_TIERS,
  achievementProgress,
  earnedTitles,
  type AchievementDef,
} from '../game/content/achievements'
import { useGameStore } from '../game/store'
import type { AchievementState } from '../game/types'
import './replay.css'
import { achievementArt } from '../game/content/art'
import { Icon } from './Icon'
import { IconText } from './IconText'

function rewardText(def: AchievementDef): string | null {
  const parts: string[] = []
  if (def.reward?.supplies) parts.push(`📦 +${def.reward.supplies} supplies`)
  if (def.reward?.title) parts.push(`🎗️ Title: “${def.reward.title}”`)
  return parts.length > 0 ? parts.join(' · ') : null
}

function earnedOn(at: number): string {
  // Achievements credited from an older save have no date.
  return at > 0 ? `Earned ${new Date(at).toISOString().slice(0, 10)}` : 'Earned'
}

export function AchievementCard({ def, state }: { def: AchievementDef; state: AchievementState }) {
  const at = state.unlocked[def.id]
  const earned = at !== undefined
  const progress = achievementProgress(state, def)
  const reward = rewardText(def)
  return (
    <li className={`achievement-card ${earned ? 'is-earned' : 'is-locked'}`}>
      <span className="achievement-icon" aria-hidden>
        <Icon id={achievementArt(def)} emoji={def.icon} />
      </span>
      <div className="achievement-body">
        <strong>{def.name}</strong>
        <small>{def.description}</small>
        {progress && !earned && (
          <div
            className="achievement-progress"
            role="progressbar"
            aria-label={`${def.name} progress`}
            aria-valuemin={0}
            aria-valuemax={progress[1]}
            aria-valuenow={progress[0]}
          >
            <div className="bar">
              <div
                className="bar-fill"
                style={{ width: `${(progress[0] / progress[1]) * 100}%` }}
              />
            </div>
            <small>
              {progress[0]}/{progress[1]} {def.progress?.unit}
            </small>
          </div>
        )}
        {reward && (
          <small className="achievement-reward">
            <IconText text={reward} anywhere />
          </small>
        )}
      </div>
      <em className="achievement-status">
        {earned ? `✓ ${earnedOn(at)}` : <Icon id="lock" emoji="🔒" label="Locked" />}
      </em>
    </li>
  )
}

/** Every achievement by tier, with progress for the multi-run ones and the title picker. */
export function AchievementsScreen() {
  const meta = useGameStore((s) => s.meta)
  const goToScreen = useGameStore((s) => s.goToScreen)
  const setTitle = useGameStore((s) => s.setTitle)
  const state = meta.achievements
  const earned = ACHIEVEMENT_LIST.filter((d) => state.unlocked[d.id] !== undefined).length
  const titles = earnedTitles(state)

  return (
    <div className="screen achievements-screen">
      <div className="menu-card wide">
        <header className="row-between">
          <h2>
            <Icon id="medal" emoji="🏅" /> Achievements
          </h2>
          <span className="chip big">
            {earned}/{ACHIEVEMENT_LIST.length} earned
          </span>
        </header>
        <p className="muted">
          Judged when a run is banked, won or lost. A few send supplies to the Citadel or grant a
          title to wear; the rest are for the ledger.
        </p>

        <label className="title-picker">
          <span>Title worn on the menu</span>
          <select
            value={meta.title ?? ''}
            onChange={(e) => setTitle(e.target.value === '' ? null : e.target.value)}
            disabled={titles.length === 0}
          >
            <option value="">{titles.length === 0 ? 'None earned yet' : 'None'}</option>
            {titles.map((t) => (
              <option key={t} value={t}>
                Viceroy {t}
              </option>
            ))}
          </select>
        </label>

        {ACHIEVEMENT_TIERS.map((tier) => {
          const list = ACHIEVEMENT_LIST.filter((d) => d.tier === tier.id)
          const got = list.filter((d) => state.unlocked[d.id] !== undefined).length
          return (
            <section key={tier.id} className="setup-section" aria-label={tier.name}>
              <h3>
                {tier.name}{' '}
                <small className="muted">
                  {got}/{list.length}
                </small>
              </h3>
              <p className="muted">{tier.blurb}</p>
              <ul className="achievement-grid">
                {list.map((def) => (
                  <AchievementCard key={def.id} def={def} state={state} />
                ))}
              </ul>
            </section>
          )
        })}

        <footer className="modal-foot">
          <button type="button" onClick={() => goToScreen('menu')}>
            Back to menu
          </button>
          <button type="button" onClick={() => goToScreen('citadel')}>
            <Icon id="guildHouse" emoji="🏛️" /> The Citadel
          </button>
        </footer>
      </div>
    </div>
  )
}
