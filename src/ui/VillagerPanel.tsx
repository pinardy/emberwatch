import { BUILDINGS } from '../game/content/buildings'
import { NEED_LABELS, SPECIES, VILLAGER_TRAITS } from '../game/content/species'
import { computeModifiers } from '../game/engine/modifiers'
import {
  SERVICE_COVERAGE_RATIO,
  population,
  serviceCoverage,
  speciesCounts,
  villagerList,
} from '../game/engine/queries'
import { resolveBreakdowns } from '../game/engine/society'
import { useGameStore, useRun } from '../game/store'

/** Where the player diagnoses "why is resolve dropping?". */
export function VillagerPanel() {
  const run = useRun()
  const recallAll = useGameStore((s) => s.recallAll)
  const selectBuilding = useGameStore((s) => s.selectBuilding)
  if (!run) return null

  const mods = computeModifiers(run)
  const breakdowns = resolveBreakdowns(run, mods)
  const counts = speciesCounts(run)
  const coverage = serviceCoverage(run)
  const pop = population(run)
  const villagers = villagerList(run)

  return (
    <div className="panel-body">
      <section className="build-group">
        <h3>Resolve</h3>
        {breakdowns.map((b) => {
          const count = counts[b.species]
          const def = SPECIES[b.species]
          return (
            <div className="species-card" key={b.species}>
              <div className="species-head">
                <span className="species-icon">{def.icon}</span>
                <div>
                  <strong>
                    {def.name} <small>×{count}</small>
                  </strong>
                  <small>{def.blurb}</small>
                  <small className="species-trait" title={def.trait.description}>
                    ✨ {def.trait.name} — {def.trait.description}
                  </small>
                </div>
                <div
                  className={`species-resolve ${
                    b.current < 0 ? 'is-bad' : b.current >= b.threshold ? 'is-good' : ''
                  }`}
                  title={`Reputation is earned above ${b.threshold}`}
                >
                  {Math.round(b.current)}
                  <small>→{Math.round(b.target)}</small>
                </div>
              </div>

              <div className="resolve-track">
                <div
                  className="resolve-threshold"
                  style={{ left: `${clampPct(b.threshold, 50)}%` }}
                  title={`Reputation threshold: ${b.threshold}`}
                />
                <div
                  className={`resolve-fill ${b.current >= b.threshold ? 'is-good' : ''}`}
                  style={{ width: `${clampPct(b.current, 50)}%` }}
                />
              </div>

              <div className="need-row">
                {def.needs.map((need) => {
                  const met = b.needDetail[need]
                  const ratio = b.needRatio[need] ?? 0
                  const cov = coverage[need]
                  const required = Math.ceil(pop * SERVICE_COVERAGE_RATIO)
                  return (
                    <span
                      key={need}
                      className={`need ${met ? 'is-met' : ratio > 0 ? 'is-partial' : 'is-unmet'}`}
                      title={`${NEED_LABELS[need].name}: covering ${cov.capacity} of ${required} villagers — worth ${Math.round(
                        ratio * 100,
                      )}% of its resolve bonus`}
                    >
                      {NEED_LABELS[need].icon} {NEED_LABELS[need].name}
                      <em>
                        {cov.capacity}/{required}
                      </em>
                    </span>
                  )
                })}
              </div>

              <details className="breakdown">
                <summary>Why {Math.round(b.target)}?</summary>
                <ul>
                  <li>
                    <span>Base</span>
                    <strong>{b.base.toFixed(1)}</strong>
                  </li>
                  <Term label="Services met" value={b.needs} />
                  <Term label="Everyone housed" value={b.housing} />
                  <Term label="Comfortable homes" value={b.comfort} />
                  <Term label="Food variety" value={b.variety} />
                  <Term label="Hostility" value={b.hostility} />
                  <Term label="Cornerstones" value={b.cornerstone} />
                  <Term label="Penalties" value={b.penalties} />
                </ul>
              </details>
            </div>
          )
        })}
      </section>

      <section className="build-group">
        <div className="row-between">
          <h3>Villagers ({villagers.length})</h3>
          <button type="button" onClick={recallAll}>
            Recall all
          </button>
        </div>
        <div className="villager-list">
          {villagers.map((v) => {
            const assignment = v.assignment
            let label = 'Idle · building & hauling'
            let buildingId: string | null = null
            if (assignment?.startsWith('clearing:')) {
              const glade = run.glades[assignment.slice('clearing:'.length)]
              label = `Clearing ${glade?.name ?? '—'}`
            } else if (assignment) {
              const building = run.buildings[assignment]
              const def = building ? BUILDINGS[building.defId] : undefined
              label = def ? `${def.icon} ${def.name}` : 'Working'
              buildingId = building?.id ?? null
            }
            const trait = v.trait ? VILLAGER_TRAITS[v.trait] : undefined
            return (
              <button
                type="button"
                className={`villager ${assignment ? '' : 'is-idle'}`}
                key={v.id}
                onClick={() => buildingId && selectBuilding(buildingId)}
                title={trait ? `${trait.name}: ${trait.description}` : undefined}
              >
                <span>{SPECIES[v.species].icon}</span>
                <strong>
                  {v.name}
                  {trait && <em className="villager-trait"> {trait.icon} {trait.name}</em>}
                </strong>
                <small>{label}</small>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function Term({ label, value }: { label: string; value: number }) {
  if (Math.abs(value) < 0.05) return null
  return (
    <li>
      <span>{label}</span>
      <strong className={value > 0 ? 'is-good' : 'is-bad'}>
        {value > 0 ? '+' : ''}
        {value.toFixed(1)}
      </strong>
    </li>
  )
}

/** Maps a resolve value onto a 0-100% bar with `max` as the top of the scale. */
function clampPct(value: number, max: number): number {
  return Math.max(0, Math.min(100, (value / max) * 100))
}
