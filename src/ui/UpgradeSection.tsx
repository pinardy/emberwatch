import { BUILDINGS } from '../game/content/buildings'
import { RESOURCES } from '../game/content/resources'
import { canUpgradeBuilding, rushCost } from '../game/engine/actions'
import { canAfford, idleVillagers } from '../game/engine/queries'
import {
  describeUpgrade,
  isUpgrading,
  maxTier,
  nextUpgrade,
  tierOf,
} from '../game/engine/upgrades'
import { useGameStore } from '../game/store'
import type { BuildingInstance, RunState } from '../game/types'
import { Cost } from './BuildPanel'
import { tierMark } from './mapShared'

/**
 * The Inspector's upgrade block: what the next tier is, what it costs (and
 * whether you can pay, in words), what it changes — or, while builders are
 * at it, how far along it is and what rushing it would cost.
 */
export function UpgradeSection({ run, building }: { run: RunState; building: BuildingInstance }) {
  const upgrade = useGameStore((s) => s.upgrade)
  const rush = useGameStore((s) => s.rush)
  const def = BUILDINGS[building.defId]
  const max = maxTier(building.defId)
  if (!def || max === 0 || !building.built) return null

  const tier = tierOf(building)
  const next = nextUpgrade(building)

  if (isUpgrading(building) && next) {
    const progress = building.upgradeProgress ?? 0
    const idle = idleVillagers(run).length
    const cost = rushCost(run, building.id)
    const amber = Math.floor(run.stock.amber ?? 0)
    return (
      <section className="inspector-section upgrade-section" aria-label="Upgrade">
        <h4>Upgrade</h4>
        <p className="muted" role="status">
          ⬆ Upgrading to <strong>{next.name}</strong> — {Math.floor(progress)}/{next.buildSeconds}{' '}
          work.{' '}
          {idle > 0
            ? `${idle} idle villager${idle === 1 ? ' is' : 's are'} building it.`
            : 'No idle villagers are free to build it.'}{' '}
          It keeps working at its current tier meanwhile.
        </p>
        <div
          className="bar"
          role="progressbar"
          aria-label="Upgrade progress"
          aria-valuemin={0}
          aria-valuemax={next.buildSeconds}
          aria-valuenow={Math.floor(progress)}
        >
          <div
            className="bar-fill"
            style={{ width: `${Math.min(100, (progress / next.buildSeconds) * 100)}%` }}
          />
        </div>
        <button
          type="button"
          className="wide-button"
          disabled={amber < cost}
          onClick={() => rush(building.id)}
        >
          ⚡ Rush upgrade for {cost} {RESOURCES.amber.icon}
          {amber < cost ? ` (${cost - amber} amber short)` : ''}
        </button>
      </section>
    )
  }

  if (!next) {
    return (
      <section className="inspector-section upgrade-section" aria-label="Upgrade">
        <h4>Upgrade</h4>
        <p className="muted">
          <span className="tier-stars">{tierMark(building)}</span> Fully upgraded — tier {tier} of{' '}
          {max}.
        </p>
      </section>
    )
  }

  const affordable = canAfford(run.stock, next.cost)
  const error = canUpgradeBuilding(run, building.id)
  return (
    <section className="inspector-section upgrade-section" aria-label="Upgrade">
      <h4>
        Upgrade · tier {tier + 1} of {max}
      </h4>
      <p>
        Next: <strong>{next.name}</strong>
      </p>
      <p className="upgrade-cost">
        <Cost cost={next.cost} stock={run.stock} />
      </p>
      <p className={`upgrade-afford ${affordable ? 'is-good' : 'is-bad'}`}>
        {affordable ? '✓ You can afford it.' : '✕ Not enough materials yet.'}
      </p>
      <ul className="upgrade-effects">
        {describeUpgrade(def, next).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <button
        type="button"
        className="wide-button"
        disabled={error !== null}
        title={error ?? `Builders raise it to ${next.name}; it keeps working meanwhile.`}
        onClick={() => upgrade(building.id)}
      >
        ⬆ Upgrade to {next.name}
      </button>
    </section>
  )
}
