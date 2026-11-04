import { BUILDINGS, CATEGORY_LABELS } from '../game/content/buildings'
import { RESOURCES } from '../game/content/resources'
import { NEED_LABELS } from '../game/content/species'
import { describeBonus, partnerIcon } from '../game/engine/adjacency'
import { canAfford } from '../game/engine/queries'
import { useGameStore, useRun } from '../game/store'
import type { BuildingCategory, ResourceBag } from '../game/types'

const ORDER: BuildingCategory[] = [
  'housing',
  'gathering',
  'production',
  'service',
  'logistics',
]

export function BuildPanel() {
  const run = useRun()
  const buildMode = useGameStore((s) => s.buildMode)
  const setBuildMode = useGameStore((s) => s.setBuildMode)
  if (!run) return null

  const unlocked = run.unlockedBuildings
    .map((id) => BUILDINGS[id])
    .filter((d) => d && d.category !== 'hearth')

  return (
    <div className="panel-body">
      <p className="panel-hint">
        Idle villagers build automatically — the more you leave unassigned, the faster
        construction goes.
      </p>
      {ORDER.map((category) => {
        const items = unlocked.filter((d) => d.category === category)
        if (items.length === 0) return null
        return (
          <section key={category} className="build-group">
            <h3>{CATEGORY_LABELS[category]}</h3>
            <div className="build-list">
              {items.map((def) => {
                const affordable = canAfford(run.stock, def.cost)
                const active = buildMode === def.id
                return (
                  <button
                    key={def.id}
                    type="button"
                    className={`build-card ${active ? 'is-active' : ''} ${
                      affordable ? '' : 'is-poor'
                    }`}
                    onClick={() => setBuildMode(active ? null : def.id)}
                  >
                    <span className="build-icon">{def.icon}</span>
                    <span className="build-main">
                      <strong>{def.name}</strong>
                      <span className="build-cost">
                        <Cost cost={def.cost} stock={run.stock} />
                      </span>
                      <small>{def.description}</small>
                      <span className="build-tags">
                        {def.workerSlots > 0 && <em>👷 {def.workerSlots}</em>}
                        {def.housing ? <em>🛏 {def.housing}</em> : null}
                        {def.storage ? <em>📦 {def.storage}</em> : null}
                        {def.gatherRadius ? <em>◎ {def.gatherRadius}</em> : null}
                        {(def.adjacency ?? []).map((bonus, i) => (
                          <em key={`adj-${i}`} title={describeBonus(bonus)}>
                            🔗 {partnerIcon(bonus)} +{bonus.percent}%
                            {bonus.effect === 'capacity' ? ' cap' : ''}
                          </em>
                        ))}
                        {def.warmth ? (
                          <em title={`Keeps homes within ${def.warmth.radius} warm during the Storm`}>
                            🔥 ◎ {def.warmth.radius}
                          </em>
                        ) : null}
                        {def.service ? (
                          <em>
                            {NEED_LABELS[def.service.need].icon}{' '}
                            {NEED_LABELS[def.service.need].name} {def.service.capacity}
                          </em>
                        ) : null}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function Cost({ cost, stock }: { cost: ResourceBag; stock: ResourceBag }) {
  const entries = Object.entries(cost) as [keyof typeof RESOURCES, number][]
  if (entries.length === 0) return <em className="muted">free</em>
  return (
    <>
      {entries.map(([id, amount]) => {
        const have = stock[id] ?? 0
        return (
          <span key={id} className={have >= amount ? '' : 'is-bad'}>
            {RESOURCES[id]?.icon} {amount}
          </span>
        )
      })}
    </>
  )
}
