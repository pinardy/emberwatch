import { BUILDINGS } from '../game/content/buildings'
import { GLADE_EVENTS } from '../game/content/gladeEvents'
import { RESOURCES } from '../game/content/resources'
import { useEffect, useRef, useState } from 'react'
import { NEED_LABELS, SPECIES, VILLAGER_TRAITS } from '../game/content/species'
import {
  demolishRefund,
  demolishRefundPercent,
  isReachable,
  rushCost,
} from '../game/engine/actions'
import { DEPOSIT_INFO } from '../game/engine/mapgen'
import { computeModifiers } from '../game/engine/modifiers'
import { availableRecipes, idleVillagers } from '../game/engine/queries'
import {
  adjacencyStatus,
  describeBonus,
  partnerIcon,
  serviceCapacity,
} from '../game/engine/adjacency'
import { terrainHint } from '../game/engine/placement'
import { homesWithin, isWarmAt } from '../game/engine/queries'
import { TERRAIN } from '../game/content/terrain'
import { terrainOf } from '../game/engine/production'
import { workerMultiplier } from '../game/engine/traits'
import { useGameStore, useRun } from '../game/store'
import { BuildingStatusLine } from './BuildingStatusLine'
import { GLADE_KIND_STYLE, tierMark } from './mapShared'
import type {
  BuildingDef,
  BuildingInstance,
  Recipe,
  ResourceBag,
  RunState,
  Villager,
} from '../game/types'
import { useConfirm } from './useConfirm'
import { UpgradeSection } from './UpgradeSection'
import {
  displayName,
  isInsulated,
  warmthRadiusOf,
  workerSlotsOf,
} from '../game/engine/upgrades'

/**
 * Context panel for whatever the player last tapped: a building, a deposit,
 * or an uncleared glade.
 */
export function Inspector() {
  const run = useRun()
  const selectedBuilding = useGameStore((s) => s.selectedBuilding)
  const selectedDeposit = useGameStore((s) => s.selectedDeposit)
  const selectedGlade = useGameStore((s) => s.selectedGlade)
  if (!run) return null

  if (selectedGlade) return <GladeInspector run={run} gladeId={selectedGlade} />

  if (selectedBuilding) {
    const building = run.buildings[selectedBuilding]
    if (!building) return null
    return (
      <div className="inspector">
        <BuildingInspector key={building.id} run={run} building={building} />
      </div>
    )
  }

  if (selectedDeposit) {
    const deposit = run.deposits[selectedDeposit]
    if (!deposit) return null
    return (
      <div className="inspector">
        <div className="inspector-body">
          <header className="inspector-head">
            <span className="inspector-icon">{DEPOSIT_INFO[deposit.kind].icon}</span>
            <div>
              <strong>{DEPOSIT_INFO[deposit.kind].name}</strong>
              <small>{run.glades[deposit.gladeId]?.name}</small>
            </div>
            <CloseButton />
          </header>
          <p className="muted">
            {deposit.amount === null
              ? 'Renewable — this deposit never runs out.'
              : `${deposit.amount} harvests remaining.`}{' '}
            Place a camp within reach to work it.
          </p>
        </div>
      </div>
    )
  }

  return null
}

function CloseButton() {
  const clearSelection = useGameStore((s) => s.clearSelection)
  return (
    <button
      type="button"
      className="icon-btn inspector-close"
      aria-label="Close"
      onClick={clearSelection}
    >
      ✕
    </button>
  )
}

function BuildingInspector({ run, building }: { run: RunState; building: BuildingInstance }) {
  const def = BUILDINGS[building.defId]
  const chooseRecipe = useGameStore((s) => s.chooseRecipe)
  const pauseBuilding = useGameStore((s) => s.pauseBuilding)
  const demolish = useGameStore((s) => s.demolish)
  // Keyed on `built` too: a site that finishes while armed disarms, so the
  // second click never removes something the button no longer describes.
  const confirmDemolish = useConfirm(`demolish:${building.id}:${building.built}`, () => {
    demolish(building.id)
    useGameStore.getState().clearSelection()
  })
  if (!def) return null

  const mods = computeModifiers(run)
  const recipes = availableRecipes(building)
  const active = recipes.find((r) => r.id === building.activeRecipeId)
  const idle = idleVillagers(run).length
  const adjacency = adjacencyStatus(run, building)
  const terrain = terrainOf(run, building)
  const ground = terrainHint(building.defId, terrain)
  // Unbuilt sites are cancelled, not demolished: the refund slides from all of
  // the materials (untouched) towards half (finished).
  const removeLabel = building.built ? 'Demolish' : 'Cancel construction'
  // Share of everything spent on it (base cost and any upgrade tiers).
  const refundShare = Math.round(demolishRefundPercent(building) * 100)

  return (
    <div className="inspector-body">
      <header className="inspector-head">
        <span className="inspector-icon">{def.icon}</span>
        <div>
          <strong>{displayName(building)}</strong>
          <small>
            {tierMark(building) && (
              <span className="tier-stars" aria-label={`Tier ${building.tier}`}>
                {tierMark(building)}{' '}
              </span>
            )}
            {run.glades[building.gladeId]?.name}
            {building.paused ? ' · paused' : ''}
          </small>
        </div>
        <CloseButton />
      </header>

      {!building.built ? (
        <>
          <p className="muted">
            Under construction — {Math.floor(building.buildProgress)}/{def.buildSeconds}{' '}
            work. {idle > 0 ? `${idle} idle villagers are building it.` : 'No idle villagers are available to build it.'}
          </p>
          <div className="bar">
            <div
              className="bar-fill"
              style={{ width: `${(building.buildProgress / def.buildSeconds) * 100}%` }}
            />
          </div>
          <button
            type="button"
            className="wide-button"
            disabled={(run.stock.amber ?? 0) < rushCost(run, building.id)}
            onClick={() => useGameStore.getState().rush(building.id)}
          >
            ⚡ Rush for {rushCost(run, building.id)} {RESOURCES.amber.icon}
          </button>
        </>
      ) : (
        <>
          {workerSlotsOf(building) > 0 && (
            <WorkerSection run={run} building={building} def={def} />
          )}

          {recipes.length > 0 && (
            <section className="inspector-section">
              <h4>Producing</h4>
              <div className="recipe-list">
                {recipes.map((recipe) => (
                  <button
                    key={recipe.id}
                    type="button"
                    className={`recipe ${building.activeRecipeId === recipe.id ? 'is-active' : ''}`}
                    onClick={() => chooseRecipe(building.id, recipe.id)}
                  >
                    <RecipeLabel recipe={recipe} />
                    <small>{recipe.seconds}s work</small>
                  </button>
                ))}
              </div>
              {active && (
                <>
                  <div className="bar">
                    <div
                      className="bar-fill"
                      style={{
                        width: `${Math.min(100, (building.recipeProgress / active.seconds) * 100)}%`,
                      }}
                    />
                  </div>
                </>
              )}
              <BuildingStatusLine run={run} building={building} mods={mods} />
            </section>
          )}
          {recipes.length === 0 && def.recipes.length > 0 && (
            <section className="inspector-section">
              <BuildingStatusLine run={run} building={building} mods={mods} />
            </section>
          )}

          {def.service && (
            <section className="inspector-section">
              <h4>Service</h4>
              <p className="muted">
                {NEED_LABELS[def.service.need].icon} Satisfies{' '}
                {NEED_LABELS[def.service.need].name} for up to{' '}
                {serviceCapacity(run, building)} villagers
                {serviceCapacity(run, building) > def.service.capacity
                  ? ` (base ${def.service.capacity}, raised by its neighbours)`
                  : ''}
                . Needs a worker and a steady supply of{' '}
                {Object.keys(def.recipes[0]?.inputs ?? {})
                  .map((id) => RESOURCES[id as keyof typeof RESOURCES]?.name)
                  .join(', ')}
                .
              </p>
            </section>
          )}

          {adjacency.length > 0 && (
            <section className="inspector-section">
              <h4>Adjacency</h4>
              {adjacency.map((status, i) => (
                <p key={i} className="muted">
                  {status.percent > 0 ? '✅' : '▫'} {partnerIcon(status.bonus)}{' '}
                  {describeBonus(status.bonus)}
                  {status.percent > 0 ? ` — active, +${status.percent}%.` : ' — not adjacent.'}
                </p>
              ))}
            </section>
          )}

          {def.warmth && (
            <section className="inspector-section">
              <h4>Warmth</h4>
              <p className="muted">
                {building.unlit ? '❄ Cold — no wood to burn.' : '🔥 Lit.'} Keeps{' '}
                {homesWithin(run, building.pos, warmthRadiusOf(building)).length} home
                {homesWithin(run, building.pos, warmthRadiusOf(building)).length === 1 ? '' : 's'} within{' '}
                {warmthRadiusOf(building)} warm during the Storm, burning{' '}
                {def.warmth.fuelPerSecond.toFixed(3)} wood/s while it rages.
              </p>
            </section>
          )}

          {def.category === 'housing' && (
            <section className="inspector-section">
              <h4>Warmth</h4>
              <p className="muted">
                {isInsulated(building)
                  ? '🔥 Warm — insulated by its upgrade, it needs no fire nearby.'
                  : isWarmAt(run, building.pos)
                    ? '🔥 Warm — inside the reach of the hearth or a lit brazier.'
                    : '❄ Cold in the Storm — beyond every fire. A brazier nearby would warm it.'}
              </p>
            </section>
          )}

          {terrain && def.category !== 'hearth' && (
            <section className="inspector-section">
              <h4>Ground</h4>
              <p className="muted">
                {ground ?? `${TERRAIN[terrain].icon} ${TERRAIN[terrain].name}: no effect on this building.`}
              </p>
            </section>
          )}

          {def.gatherRadius && (
            <section className="inspector-section">
              <h4>Deposits in range</h4>
              <div className="chip-row">
                {Object.entries(building.depositsInRange).map(([id, tiles]) => (
                  <span key={id} className="chip">
                    {DEPOSIT_INFO[id as keyof typeof DEPOSIT_INFO].icon} ×{tiles?.length ?? 0}
                  </span>
                ))}
                {Object.keys(building.depositsInRange).length === 0 && (
                  <span className="muted">None — this camp cannot work.</span>
                )}
              </div>
            </section>
          )}
          <UpgradeSection run={run} building={building} />
        </>
      )}

      <footer className="inspector-foot">
        {building.built && def.recipes.length > 0 && (
          <button type="button" onClick={() => pauseBuilding(building.id)}>
            {building.paused ? '▶ Resume' : '⏸ Pause'}
          </button>
        )}
        {def.category !== 'hearth' && (
          <button
            type="button"
            className={`danger ${confirmDemolish.armed ? 'is-armed' : ''}`}
            onClick={confirmDemolish.trigger}
            title={
              confirmDemolish.armed
                ? building.built
                  ? 'Click again to tear it down'
                  : 'Click again to cancel construction'
                : building.built
                  ? 'Tear this building down for half its materials back'
                  : refundShare >= 100
                    ? 'Nobody has worked on this site yet: cancel it for all of its materials back'
                    : `Cancel this site for ${refundShare}% of its materials back`
            }
          >
            {confirmDemolish.armed ? (
              <>
                Confirm? Refund <BagLabel bag={demolishRefund(building)} />
                <small className="refund-share"> ({refundShare}%)</small>
              </>
            ) : (
              removeLabel
            )}
          </button>
        )}
        <span className="sr-only" aria-live="polite">
          {confirmDemolish.armed
            ? building.built
              ? `Press Demolish again within a few seconds to tear down the ${def.name} for ${refundShare}% of its materials.`
              : `Press Cancel construction again within a few seconds to remove the ${def.name} site for ${refundShare}% of its materials.`
            : ''}
        </span>
      </footer>
    </div>
  )
}

/** "+40%", "−12%" or "±0%" for a worker multiplier like 1.4. */
export function formatMultiplier(multiplier: number): string {
  const pct = Math.round((multiplier - 1) * 100)
  if (pct === 0) return '±0%'
  return pct > 0 ? `+${pct}%` : `−${-pct}%`
}

/** Why a villager is faster or slower at a building, for tooltips. */
export function multiplierReason(v: Villager, def: BuildingDef): string {
  const parts: string[] = []
  const bonuses = SPECIES[v.species].workBonus as Record<string, number | undefined>
  const speciesBonus = def.tags.reduce((sum, tag) => sum + (bonuses[tag] ?? 0), 0)
  if (speciesBonus !== 0) {
    parts.push(`${SPECIES[v.species].name} ${formatMultiplier(1 + speciesBonus)}`)
  }
  if (v.trait) {
    const trait = VILLAGER_TRAITS[v.trait]
    parts.push(`${trait.name}: ${trait.description}`)
  }
  return parts.length > 0 ? parts.join(' · ') : 'An average worker here'
}

function BagLabel({ bag }: { bag: ResourceBag }) {
  const entries = Object.entries(bag)
  if (entries.length === 0) return <span>nothing</span>
  return (
    <span className="bag-label">
      {entries.map(([id, amount]) => (
        <span key={id} title={RESOURCES[id as keyof typeof RESOURCES]?.name}>
          {RESOURCES[id as keyof typeof RESOURCES]?.icon}
          {amount}
        </span>
      ))}
    </span>
  )
}

function MultiplierTag({ mult }: { mult: number }) {
  return (
    <em className={`mult ${mult > 1 ? 'is-good' : mult < 1 ? 'is-bad' : 'muted'}`}>
      {formatMultiplier(mult)}
    </em>
  )
}

/**
 * Who works here, slot by slot. Each filled slot can be swapped or emptied;
 * an empty slot opens a picker of idle villagers ranked by how fast they would
 * work this building (species bonus × personal quirk).
 */
function WorkerSection({
  run,
  building,
  def,
}: {
  run: RunState
  building: BuildingInstance
  def: BuildingDef
}) {
  const hire = useGameStore((s) => s.hire)
  const fire = useGameStore((s) => s.fire)
  /** `undefined`: picker closed · `null`: filling an empty slot · id: swapping that worker. */
  const [picking, setPicking] = useState<string | null | undefined>(undefined)
  const pickerRef = useRef<HTMLDivElement>(null)
  const pickerOpen = picking !== undefined

  // On a short inspector (phones) the picker opens below the fold.
  useEffect(() => {
    if (pickerOpen) pickerRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [pickerOpen, picking])

  const season = run.season.season
  const candidates = idleVillagers(run)
    .map((v) => ({ v, mult: workerMultiplier(v, def.tags, season) }))
    .sort((a, b) => b.mult - a.mult || a.v.name.localeCompare(b.v.name))
  const best = candidates[0]
  const slotCount = workerSlotsOf(building)
  const full = building.workers.length >= slotCount
  const slots = Array.from({ length: slotCount }, (_, i) => building.workers[i] ?? null)
  const replacing = picking ? run.villagers[picking] : undefined

  const choose = (villagerId: string) => {
    if (picking) fire(building.id, picking)
    hire(building.id, villagerId)
    setPicking(undefined)
  }

  return (
    <section className="inspector-section" aria-label="Workers">
      <div className="row-between">
        <h4>
          Workers {building.workers.length}/{slotCount}
        </h4>
        <button
          type="button"
          className="hire-best"
          onClick={() => best && hire(building.id, best.v.id)}
          disabled={full || !best}
          title={
            full
              ? 'Every slot is filled'
              : best
                ? `Hire ${best.v.name}, the fastest idle villager here (${formatMultiplier(best.mult)})`
                : 'No idle villagers'
          }
        >
          + Best available
        </button>
      </div>
      <ul className="worker-slots">
        {slots.map((id, index) => {
          const villager = id ? run.villagers[id] : undefined
          if (!villager) {
            return (
              <li key={`empty-${index}`} className="worker-slot is-empty">
                <button
                  type="button"
                  className="slot-pick"
                  aria-expanded={picking === null}
                  onClick={() => setPicking(picking === null ? undefined : null)}
                >
                  <span aria-hidden>＋</span> Choose a worker…
                </button>
              </li>
            )
          }
          const trait = villager.trait ? VILLAGER_TRAITS[villager.trait] : undefined
          return (
            <li key={villager.id} className="worker-slot">
              <span className="worker-who" title={multiplierReason(villager, def)}>
                <span aria-hidden>{SPECIES[villager.species].icon}</span>
                <strong>{villager.name}</strong>
                {trait && (
                  <span className="worker-trait" title={`${trait.name}: ${trait.description}`}>
                    {trait.icon}
                    <span className="sr-only"> {trait.name}</span>
                  </span>
                )}
                <MultiplierTag mult={workerMultiplier(villager, def.tags, season)} />
              </span>
              <button
                type="button"
                aria-label={`Swap ${villager.name}`}
                title="Swap for an idle villager"
                aria-expanded={picking === villager.id}
                onClick={() => setPicking(picking === villager.id ? undefined : villager.id)}
              >
                Swap
              </button>
              <button
                type="button"
                aria-label={`Remove ${villager.name}`}
                title={`Send ${villager.name} back to idle`}
                onClick={() => {
                  if (picking === villager.id) setPicking(undefined)
                  fire(building.id, villager.id)
                }}
              >
                ✕
              </button>
            </li>
          )
        })}
      </ul>

      {picking !== undefined && (
        <div
          ref={pickerRef}
          className="worker-picker"
          role="group"
          aria-label="Choose a worker"
        >
          <div className="row-between">
            <small className="muted">
              {replacing
                ? `Replace ${replacing.name} with… (fastest first)`
                : 'Idle villagers, fastest here first'}
            </small>
            <button type="button" className="link-button" onClick={() => setPicking(undefined)}>
              Cancel
            </button>
          </div>
          {candidates.length === 0 ? (
            <p className="muted">
              Nobody is idle. Free someone up from the People tab or another building.
            </p>
          ) : (
            <ul className="picker-list">
              {candidates.map(({ v, mult }, rank) => {
                const trait = v.trait ? VILLAGER_TRAITS[v.trait] : undefined
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      className="picker-option"
                      title={multiplierReason(v, def)}
                      onClick={() => choose(v.id)}
                    >
                      <span aria-hidden>{SPECIES[v.species].icon}</span>
                      <strong>{v.name}</strong>
                      <small>{trait ? `${trait.icon} ${trait.name}` : SPECIES[v.species].name}</small>
                      <MultiplierTag mult={mult} />
                      {rank === 0 && candidates.length > 1 && <span className="best-tag">★ best</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

export function RecipeLabel({ recipe }: { recipe: Recipe }) {
  const inputs = Object.entries(recipe.inputs)
  const outputs = Object.entries(recipe.outputs)
  return (
    <span className="recipe-label">
      {inputs.length > 0 ? (
        inputs.map(([id, amount]) => (
          <span key={id}>
            {RESOURCES[id as keyof typeof RESOURCES]?.icon}
            {amount}
          </span>
        ))
      ) : (
        <span>{recipe.requiresDeposit ? DEPOSIT_INFO[recipe.requiresDeposit].icon : '—'}</span>
      )}
      <em>→</em>
      {outputs.length > 0 ? (
        outputs.map(([id, amount]) => (
          <span key={id}>
            {RESOURCES[id as keyof typeof RESOURCES]?.icon}
            {amount}
          </span>
        ))
      ) : (
        <span>🛎</span>
      )}
    </span>
  )
}

function GladeInspector({ run, gladeId }: { run: RunState; gladeId: string }) {
  const glade = run.glades[gladeId]
  const add = useGameStore((s) => s.clearGladeAdd)
  const remove = useGameStore((s) => s.clearGladeRemove)
  if (!glade) return null

  const reachable = isReachable(run, gladeId)
  const idle = idleVillagers(run).length
  const pct = glade.clearWork > 0 ? (glade.clearProgress / glade.clearWork) * 100 : 100
  const secondsLeft =
    glade.clearers > 0
      ? Math.ceil((glade.clearWork - glade.clearProgress) / glade.clearers)
      : null
  const event = glade.eventId ? GLADE_EVENTS[glade.eventId] : undefined

  return (
    <div className="inspector">
      <div className="inspector-body">
        <header className="inspector-head">
          <span className="inspector-icon">{GLADE_KIND_STYLE[glade.kind].icon}</span>
          <div>
            <strong>{glade.name}</strong>
            <small>{GLADE_KIND_STYLE[glade.kind].title}</small>
          </div>
          <CloseButton />
        </header>

        {glade.cleared ? (
          <p className="muted">Cleared. You can build here.</p>
        ) : !reachable ? (
          <p className="muted">
            Too far. Clear a glade that borders this one before your crews can reach it.
          </p>
        ) : (
          <>
            <section className="inspector-section">
              <div className="row-between">
                <h4>Clearing crew {glade.clearers}</h4>
                <div className="btn-row">
                  <button
                    type="button"
                    onClick={() => remove(gladeId)}
                    disabled={glade.clearers === 0}
                  >
                    −
                  </button>
                  <button type="button" onClick={() => add(gladeId)} disabled={idle === 0}>
                    +
                  </button>
                </div>
              </div>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <small className="muted">
                {Math.floor(glade.clearProgress)}/{glade.clearWork} work
                {secondsLeft !== null ? ` · about ${secondsLeft}s remaining` : ' · idle'}
              </small>
            </section>

            <section className="inspector-section">
              <h4>Expected haul</h4>
              <div className="chip-row">
                {Object.entries(glade.reward).map(([id, amount]) => (
                  <span key={id} className="chip">
                    {RESOURCES[id as keyof typeof RESOURCES]?.icon} {amount}
                  </span>
                ))}
              </div>
              {event && (
                <p className="muted warn-text">
                  ⚠ Something is waiting here. Clearing it will force a decision.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

