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
import { workerMultiplier } from '../game/engine/traits'
import { useGameStore, useRun } from '../game/store'
import type { RunState, Villager } from '../game/types'
import { formatMultiplier } from './Inspector'
import { useConfirm } from './useConfirm'

/** Where the player diagnoses "why is resolve dropping?". */
export function VillagerPanel() {
  const run = useRun()
  const recallAll = useGameStore((s) => s.recallAll)
  const confirmRecall = useConfirm('recall-all', recallAll)
  if (!run) return null

  const mods = computeModifiers(run)
  const breakdowns = resolveBreakdowns(run, mods)
  const counts = speciesCounts(run)
  const coverage = serviceCoverage(run)
  const pop = population(run)
  const villagers = villagerList(run)
  const busy = villagers.filter((v) => v.assignment).length

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
                      <b className="need-state" aria-hidden>
                        {met ? '✓' : ratio > 0 ? '◐' : '✕'}
                      </b>
                      {NEED_LABELS[need].icon} {NEED_LABELS[need].name}
                      <span className="sr-only">
                        {met ? ' met' : ratio > 0 ? ' partly met' : ' unmet'}
                      </span>
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
          <button
            type="button"
            className={confirmRecall.armed ? 'danger is-armed' : ''}
            onClick={confirmRecall.trigger}
            disabled={busy === 0 && !confirmRecall.armed}
            title="Send every worker and clearer back to idle"
          >
            {confirmRecall.armed ? `Recall all ${busy}? Click again` : 'Recall all'}
          </button>
          <span className="sr-only" aria-live="polite">
            {confirmRecall.armed
              ? `Press Recall all again to send ${busy} villagers back to idle.`
              : ''}
          </span>
        </div>
        <div className="villager-list">
          {villagers.map((v) => (
            <VillagerRow key={v.id} run={run} villager={v} />
          ))}
        </div>
      </section>
    </div>
  )
}

/**
 * One villager: what they are doing (click to find it on the map) and a
 * picker to send them somewhere else — buildings with an open slot, ranked by
 * how fast this villager would work there.
 */
function VillagerRow({ run, villager: v }: { run: RunState; villager: Villager }) {
  const hire = useGameStore((s) => s.hire)
  const release = useGameStore((s) => s.release)
  const assignment = v.assignment
  let label = 'Idle · building & hauling'
  let goTo: (() => void) | null = null
  if (assignment?.startsWith('clearing:')) {
    const glade = run.glades[assignment.slice('clearing:'.length)]
    label = `⛏ Clearing ${glade?.name ?? '—'}`
    if (glade) {
      goTo = () => {
        const store = useGameStore.getState()
        store.selectGlade(glade.id)
        store.focusCamera(glade.center)
      }
    }
  } else if (assignment) {
    const building = run.buildings[assignment]
    const def = building ? BUILDINGS[building.defId] : undefined
    label = def ? `${def.icon} ${def.name}` : 'Working'
    if (building) {
      goTo = () => {
        const store = useGameStore.getState()
        store.selectBuilding(building.id)
        store.focusCamera(building.pos)
      }
    }
  }
  const trait = v.trait ? VILLAGER_TRAITS[v.trait] : undefined
  const openings = openSlotsFor(run, v)

  const onAssign = (value: string) => {
    if (value === (assignment ?? '')) return
    if (assignment) release(v.id)
    if (value) hire(value, v.id)
  }

  const body = (
    <>
      <span aria-hidden>{SPECIES[v.species].icon}</span>
      <strong>
        {v.name}
        {trait && (
          <em className="villager-trait">
            {' '}
            {trait.icon} {trait.name}
          </em>
        )}
      </strong>
      <small>
        {assignment ? '' : '💤 '}
        {label}
      </small>
    </>
  )

  return (
    <div
      className={`villager ${assignment ? '' : 'is-idle'}`}
      title={trait ? `${trait.name}: ${trait.description}` : undefined}
    >
      {goTo ? (
        <button
          type="button"
          className="villager-main"
          onClick={goTo}
          aria-label={`${v.name}: ${label}. Show on map`}
        >
          {body}
        </button>
      ) : (
        <div className="villager-main">{body}</div>
      )}
      <select
        className="villager-assign"
        aria-label={`Assign ${v.name}`}
        value={assignment ?? ''}
        onChange={(e) => onAssign(e.target.value)}
      >
        <option value="">{assignment ? 'Make idle' : 'Idle'}</option>
        {assignment && <option value={assignment}>{label}</option>}
        {openings.length > 0 && (
          <optgroup label="Open slots · fastest first">
            {openings.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label} · {formatMultiplier(o.mult)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  )
}

/** Built workplaces with a free slot, best fit for this villager first. */
function openSlotsFor(run: RunState, v: Villager) {
  const season = run.season.season
  return Object.values(run.buildings)
    .filter((b) => b.id !== v.assignment)
    .flatMap((b) => {
      const def = BUILDINGS[b.defId]
      if (!def || !b.built || def.workerSlots <= 0) return []
      if (b.workers.length >= def.workerSlots) return []
      return [
        {
          id: b.id,
          mult: workerMultiplier(v, def.tags, season),
          label: `${def.icon} ${def.name} (${b.workers.length}/${def.workerSlots}) · ${
            run.glades[b.gladeId]?.name ?? ''
          }`,
        },
      ]
    })
    .sort((a, b) => b.mult - a.mult || a.label.localeCompare(b.label))
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
