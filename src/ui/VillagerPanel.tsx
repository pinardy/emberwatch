import { BUILDINGS } from '../game/content/buildings'
import { displayName, workerSlotsOf } from '../game/engine/upgrades'
import { NEED_LABELS, SPECIES, VILLAGER_TRAITS } from '../game/content/species'
import { computeModifiers } from '../game/engine/modifiers'
import {
  SERVICE_COVERAGE_RATIO,
  population,
  serviceCoverage,
  speciesCounts,
  villagerList,
} from '../game/engine/queries'
import { resolveBreakdowns, type ResolveBreakdown } from '../game/engine/society'
import {
  REFINED_FROM_POPULATION,
  REFINED_FROM_YEAR,
  type RefinedStatus,
} from '../game/engine/refinedNeeds'
import { workerMultiplier } from '../game/engine/traits'
import { useFrameDerived } from '../game/frameDerived'
import { useGameStore, useHudRun } from '../game/store'
import type { RunState, Villager } from '../game/types'
import { formatMultiplier } from './Inspector'
import { againWord, useConfirm } from './useConfirm'
import { Icon } from './Icon'
import { IconText } from './IconText'
import { signed } from './threatText'
import { NEED_ART } from '../game/content/art'
import { VILLAGER_TRAIT_ART } from '../game/content/artFamilies'
import './needs.css'

/** Where the player diagnoses "why is resolve dropping?". */
export function VillagerPanel() {
  const run = useHudRun()
  const recallAll = useGameStore((s) => s.recallAll)
  const confirmRecall = useConfirm('recall-all', recallAll)
  // Shared with the top bar: computed once per sim step.
  const frame = useFrameDerived()
  if (!run) return null

  const mods = frame?.mods ?? computeModifiers(run)
  const breakdowns = frame?.topBar.breakdowns ?? resolveBreakdowns(run, mods)
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
                <span className="species-icon">
                  <Icon of={def} />
                </span>
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
                      <Icon id={NEED_ART[need]} /> {NEED_LABELS[need].name}
                      <span className="sr-only">
                        {met ? ' met' : ratio > 0 ? ' partly met' : ' unmet'}
                      </span>
                      <em>
                        {cov.capacity}/{required}
                      </em>
                    </span>
                  )
                })}
                {b.refinedStatus && !refinedHeld(b.refinedStatus) && (
                  <RefinedChip status={b.refinedStatus} bonus={b.refined} />
                )}
              </div>
              {b.refinedStatus && refinedHeld(b.refinedStatus) && (
                // Wanted, but it counts only once the base needs above are
                // all met: set apart and dimmed so it does not read as the
                // next thing to build.
                <div className="refined-held">
                  <small aria-hidden>Once base needs are met:</small>
                  <RefinedChip status={b.refinedStatus} bonus={b.refined} />
                </div>
              )}

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
                  <Term
                    label={`Expectations (Year ${run.season.year}, ${pop} villagers)`}
                    value={b.expectations}
                  />
                  <Term
                    label={`Refined need: ${b.refinedStatus?.def.name ?? ''}`}
                    value={b.refined}
                  />
                  <Term label="Cornerstones" value={b.cornerstone} />
                  <Term label="Cold homes in the Storm" value={b.chill} />
                  <Term label="Penalties" value={b.penalties - b.chill} />
                </ul>
                <RefinedLine b={b} />
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
            {confirmRecall.armed ? `Recall all ${busy}? ${againWord()}` : 'Recall all'}
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
      <span aria-hidden>
        <Icon of={SPECIES[v.species]} />
      </span>
      <strong>
        {v.name}
        {trait && (
          <em className="villager-trait">
            {' '}
            <Icon id={VILLAGER_TRAIT_ART[trait.id]} emoji={trait.icon} /> {trait.name}
          </em>
        )}
      </strong>
      <small>
        {assignment ? '' : '💤 '}
        <IconText text={label} />
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
      const slots = workerSlotsOf(b)
      if (!def || !b.built || slots <= 0) return []
      if (b.workers.length >= slots) return []
      return [
        {
          id: b.id,
          mult: workerMultiplier(v, def.tags, season),
          label: `${def.icon} ${displayName(b)} (${b.workers.length}/${slots}) · ${
            run.glades[b.gladeId]?.name ?? ''
          }`,
        },
      ]
    })
    .sort((a, b) => b.mult - a.mult || a.label.localeCompare(b.label))
}

/** "from Year 3 or 20 villagers": when refined needs wake. */
const REFINED_WHEN = `from Year ${REFINED_FROM_YEAR} or ${REFINED_FROM_POPULATION} villagers`

type RefinedState = 'dormant' | 'held' | 'waiting' | 'met' | 'partial' | 'unmet'

function refinedState(status: RefinedStatus): RefinedState {
  if (!status.unlocked) return 'dormant'
  // Wanted, but it pays only once every base need of the species is met:
  // on hand already ('waiting') or not ('held').
  if (!status.basicsMet) return status.ratio > 0 ? 'waiting' : 'held'
  return status.met ? 'met' : status.ratio > 0 ? 'partial' : 'unmet'
}

/** Wanted, but on hold until the species' base needs are all met. */
function refinedHeld(status: RefinedStatus): boolean {
  const state = refinedState(status)
  return state === 'held' || state === 'waiting'
}

const REFINED_MARK: Record<RefinedState, string> = {
  dormant: '·',
  held: '✗',
  waiting: '◐',
  met: '✓',
  partial: '◐',
  unmet: '✗',
}

const REFINED_SR: Record<RefinedState, string> = {
  dormant: `, not wanted yet (${REFINED_WHEN})`,
  held: ' unmet, and it counts only once every base need is met',
  waiting: ', on hand but waiting for every base need to be met',
  met: ' met',
  partial: ' partly met',
  unmet: ' unmet',
}

/** The chip's state class: held and waiting chips are dimmed as well. */
const REFINED_CLASS: Record<RefinedState, string> = {
  dormant: 'is-dormant',
  held: 'is-unmet is-held',
  waiting: 'is-partial is-held',
  met: 'is-met',
  partial: 'is-partial',
  unmet: 'is-unmet',
}

/**
 * A species' refined need, beside the base need it refines: met, partly
 * met, missing (never a penalty) or not wanted yet.
 */
function RefinedChip({ status, bonus }: { status: RefinedStatus; bonus: number }) {
  const state = refinedState(status)
  const worth =
    state === 'dormant'
      ? `Wanted ${REFINED_WHEN}.`
      : state === 'waiting' || state === 'held'
        ? 'It pays once every base need of this species is met. Missing it costs nothing.'
        : `Covering ${status.capacity} of ${status.required} villagers: ${signed(bonus, (v) => v.toFixed(1))} resolve. Missing it costs nothing.`
  return (
    <span
      className={`need need-refined ${REFINED_CLASS[state]}`}
      title={`Refined ${NEED_LABELS[status.def.need].name}: ${status.def.hint} ${worth}`}
    >
      <b className="need-state" aria-hidden>
        {REFINED_MARK[state]}
      </b>
      <span aria-hidden>{status.def.icon}</span> refined: {status.def.name}
      <span className="sr-only">{REFINED_SR[state]}</span>
      {state !== 'dormant' && (
        <em>
          {status.capacity}/{status.required}
        </em>
      )}
    </span>
  )
}

/** "Luxury ✓ · refined: spiced ale ✗", and how to meet it. */
function RefinedLine({ b }: { b: ResolveBreakdown }) {
  const status = b.refinedStatus
  if (!status) return null
  const base = NEED_LABELS[status.def.need].name
  const baseMark = b.needDetail[status.def.need] ? '✓' : (b.needRatio[status.def.need] ?? 0) > 0 ? '◐' : '✗'
  const state = refinedState(status)
  return (
    <p className="refined-line">
      <strong>
        {base} {baseMark} · refined: {status.def.name}{' '}
        {state === 'dormant'
          ? '(not yet wanted)'
          : state === 'waiting' || state === 'held'
            ? `${REFINED_MARK[state]} (waits on the base needs)`
            : REFINED_MARK[state]}
      </strong>
      <small>
        {status.def.hint}{' '}
        {state === 'dormant'
          ? `Wanted ${REFINED_WHEN}.`
          : 'Once every base need is met, it adds resolve and eases rising expectations; missing it costs nothing.'}
      </small>
    </p>
  )
}

function Term({ label, value }: { label: string; value: number }) {
  if (Math.abs(value) < 0.05) return null
  return (
    <li>
      <span>{label}</span>
      <strong className={value > 0 ? 'is-good' : 'is-bad'}>
        {signed(value, (v) => v.toFixed(1))}
      </strong>
    </li>
  )
}

/** Maps a resolve value onto a 0-100% bar with `max` as the top of the scale. */
function clampPct(value: number, max: number): number {
  return Math.max(0, Math.min(100, (value / max) * 100))
}
