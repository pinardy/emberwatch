import { SEASON_INFO } from '../game/engine/balance'
import { MAX_HOSTILITY } from '../game/engine/tick'
import { computeModifiers } from '../game/engine/modifiers'
import { idleVillagers, population, totalHousing } from '../game/engine/queries'
import { resolveBreakdowns } from '../game/engine/society'
import { SPECIES } from '../game/content/species'
import { useGameStore, useRun } from '../game/store'
import { SPEED_OPTIONS } from '../game/engine/balance'

export function TopBar() {
  const run = useRun()
  const speed = useGameStore((s) => s.speed)
  const setSpeed = useGameStore((s) => s.setSpeed)
  const goToScreen = useGameStore((s) => s.goToScreen)
  if (!run) return null

  const info = SEASON_INFO[run.season.season]
  const seasonPct = run.season.elapsed / run.season.length
  const pop = population(run)
  const housing = totalHousing(run)
  const idle = idleVillagers(run).length
  const mods = computeModifiers(run)
  const breakdowns = resolveBreakdowns(run, mods)

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="icon-btn"
          onClick={() => goToScreen('menu')}
          title="Menu"
        >
          ☰
        </button>

        <div className={`season season-${run.season.season}`}>
          <div className="season-ring" style={{ ['--pct' as string]: seasonPct }}>
            <span>{info.icon}</span>
          </div>
          <div className="season-text">
            <strong>{info.name}</strong>
            <small>
              Year {run.season.year} · {Math.ceil(run.season.length - run.season.elapsed)}s
            </small>
          </div>
        </div>

        <div className="speed-group" role="group" aria-label="Game speed">
          {SPEED_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={speed === option ? 'is-active' : ''}
              onClick={() => setSpeed(option)}
              title={option === 0 ? 'Pause (space)' : `${option}× speed`}
            >
              {option === 0 ? '⏸' : `${option}×`}
            </button>
          ))}
        </div>
      </div>

      <div className="topbar-meters">
        <Meter
          label="Reputation"
          icon="👑"
          value={run.reputation}
          max={run.maxReputation}
          fraction={run.reputationProgress}
          tone="good"
          hint="Win at maximum reputation. Earned from high resolve and completed orders."
        />
        <Meter
          label="Impatience"
          icon="⏳"
          value={run.impatience}
          max={run.maxImpatience}
          fraction={run.impatienceProgress}
          tone="bad"
          hint="You lose if this fills. Grows over time, and faster when villagers leave."
        />
        <Meter
          label="Hostility"
          icon="🌩️"
          value={Math.round(run.hostility)}
          max={MAX_HOSTILITY}
          fraction={0}
          tone="warn"
          hint="Lowers resolve for everyone. Rises with time, population and cleared glades."
        />
      </div>

      <div className="topbar-right">
        <div className="stat" title="Population and housing">
          <span>🧑‍🤝‍🧑</span>
          <strong className={pop > housing ? 'is-bad' : ''}>
            {pop}/{housing}
          </strong>
        </div>
        <div className="stat" title="Idle villagers — they also act as builders">
          <span>💤</span>
          <strong className={idle > 0 ? 'is-warn' : ''}>{idle}</strong>
        </div>
        <div className="resolve-chips">
          {breakdowns.map((b) => (
            <div
              key={b.species}
              className="resolve-chip"
              title={`${SPECIES[b.species].name}: resolve ${b.current.toFixed(
                1,
              )} (target ${b.target.toFixed(1)}, reputation above ${b.threshold})`}
            >
              <span>{SPECIES[b.species].icon}</span>
              <strong
                className={
                  b.current < 0 ? 'is-bad' : b.current >= b.threshold ? 'is-good' : ''
                }
              >
                {Math.round(b.current)}
              </strong>
            </div>
          ))}
        </div>
      </div>
    </header>
  )
}

interface MeterProps {
  label: string
  icon: string
  value: number
  max: number
  fraction: number
  tone: 'good' | 'bad' | 'warn'
  hint: string
}

function Meter({ label, icon, value, max, fraction, tone, hint }: MeterProps) {
  const pct = ((value + Math.min(1, fraction)) / max) * 100
  return (
    <div className={`meter meter-${tone}`} title={hint}>
      <div className="meter-head">
        <span>{icon}</span>
        <span className="meter-label">{label}</span>
        <strong>
          {value}
          <small>/{max}</small>
        </strong>
      </div>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  )
}
