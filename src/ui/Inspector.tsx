import { DEPOSIT_ART, GLADE_ART, NEED_ART } from '../game/content/art'
import { VILLAGER_TRAIT_ART } from '../game/content/artFamilies'
import { BUILDINGS } from '../game/content/buildings'
import { GLADE_EVENTS } from '../game/content/gladeEvents'
import { RESOURCES } from '../game/content/resources'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NEED_LABELS, SPECIES, VILLAGER_TRAITS } from '../game/content/species'
import {
  demolishRefund,
  demolishRefundPercent,
  isReachable,
  rushCost,
} from '../game/engine/actions'
import {
  HOSTILITY_PER_GLADE_CLEARED,
  HOSTILITY_RATE_PER_CLEARED_GLADE,
  SPARED_GLADE_RECLAIM_HOSTILITY,
} from '../game/engine/balance'
import { sparedGladeCalmOf } from '../game/engine/hostility'
import { DEPOSIT_INFO } from '../game/engine/mapgen'
import { GladeGround, barrierReachHint } from './GladeGround'
import { computeModifiers } from '../game/engine/modifiers'
import { availableRecipes, idleVillagers } from '../game/engine/queries'
import {
  adjacencyStatus,
  describeBonus,
  serviceCapacity,
} from '../game/engine/adjacency'
import { terrainHint } from '../game/engine/placement'
import { homesWithin, isWarmAt } from '../game/engine/queries'
import { TERRAIN } from '../game/content/terrain'
import { terrainOf } from '../game/engine/production'
import { benefitsFromRoad, describeRoadLink, roadLinkOf } from '../game/engine/roads'
import { workerMultiplier } from '../game/engine/traits'
import { useGameStore, useHudRun } from '../game/store'
import { Bar } from './Bar'
import { BagIcons } from './BagIcons'
import { BuildingStatusLine } from './BuildingStatusLine'
import { Icon } from './Icon'
import { PartnerIcon } from './PartnerIcon'
import { GLADE_KIND_STYLE, tierMark } from './mapShared'
import type {
  BuildingDef,
  BuildingInstance,
  DepositId,
  Recipe,
  Glade,
  ResourceBag,
  RunState,
  Villager,
} from '../game/types'
import { ScoutReport } from './ScoutReport'
import { DumpStock } from './DumpStock'
import { ArchitectSection } from './ArchitectSection'
import { describeStakes, gladeStakes } from '../game/engine/glades'
import { againWord, useConfirm } from './useConfirm'
import { UpgradeSection } from './UpgradeSection'
import {
  displayName,
  isInsulated,
  warmthRadiusOf,
  workerSlotsOf,
} from '../game/engine/upgrades'
import { IconText } from './IconText'
import { useInspectorFocus } from './focusRequests'
import { GladeStakeChips } from './GladeStakeChips'

/**
 * Context panel for whatever the player last tapped: a building, a deposit,
 * or an uncleared glade.
 */
export function Inspector() {
  const run = useHudRun()
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
          <InspectorHead icon={<Icon id={DEPOSIT_ART[deposit.kind]} />} name={DEPOSIT_INFO[deposit.kind].name}>
            {run.glades[deposit.gladeId]?.name}
          </InspectorHead>
          <p className="muted">
            {deposit.amount === null
              ? 'Renewable — this deposit never runs out.'
              : `${deposit.amount} harvests remaining.`}{' '}
            Place a camp within reach to work it.
          </p>
          {DEPOSIT_INFO[deposit.kind].note && <p className="muted deposit-note">{DEPOSIT_INFO[deposit.kind].note}</p>}
        </div>
      </div>
    )
  }

  return null
}

/** The inspector's title row: icon, name, a line under it, and Close. */
function InspectorHead({ icon, name, children }: { icon: ReactNode; name: ReactNode; children: ReactNode }) {
  const clearSelection = useGameStore((s) => s.clearSelection)
  // Picked from a keyboard list: focus lands on the name, so the Inspector reads next.
  const title = useRef<HTMLHeadingElement>(null)
  useInspectorFocus(title, typeof name === 'string' ? name : '')
  return (
    <header className="inspector-head">
      <span className="inspector-icon" aria-hidden>{icon}</span>
      <div>
        <h2 className="inspector-title" ref={title} tabIndex={-1}>
          {name}
        </h2>
        <small>{children}</small>
      </div>
      <button
        type="button"
        className="icon-btn inspector-close"
        aria-label="Close"
        onClick={clearSelection}
      >
        ✕
      </button>
    </header>
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
      <InspectorHead icon={<Icon of={def} />} name={displayName(building)}>
        {tierMark(building) && (
          <span className="tier-stars" role="img" aria-label={`Tier ${building.tier}`}>
            {tierMark(building)}{' '}
          </span>
        )}
        {run.glades[building.gladeId]?.name}
        {building.paused ? ' · paused' : ''}
      </InspectorHead>

      {!building.built ? (
        <>
          <p className="muted">
            Under construction — {Math.floor(building.buildProgress)}/{def.buildSeconds}{' '}
            work. {idle > 0 ? `${idle} idle villagers are building it.` : 'No idle villagers are available to build it.'}
          </p>
          <Bar value={building.buildProgress / def.buildSeconds} />
          <button
            type="button"
            className="wide-button"
            disabled={(run.stock.amber ?? 0) < rushCost(run, building.id)}
            onClick={() => useGameStore.getState().rush(building.id)}
          >
            <Icon id="lightning" emoji="⚡" /> Rush for {rushCost(run, building.id)} <Icon of={RESOURCES.amber} label="amber" />
          </button>
        </>
      ) : (
        <>
          {workerSlotsOf(building) > 0 && (
            <WorkerSection run={run} building={building} def={def} />
          )}

          {recipes.length > 0 && (
            <section className="inspector-section">
              <h3>Producing</h3>
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
              {active && <Bar value={building.recipeProgress / active.seconds} />}
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
              <h3>Service</h3>
              <p className="muted">
                <Icon id={NEED_ART[def.service.need]} /> Satisfies{' '}
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
              <h3>Adjacency</h3>
              {adjacency.map((status, i) => (
                <p key={i} className="muted">
                  {status.percent > 0 ? '✅' : '▫'} <PartnerIcon bonus={status.bonus} />{' '}
                  {describeBonus(status.bonus)}
                  {status.percent > 0 ? ` — active, +${status.percent}%.` : ' — not adjacent.'}
                </p>
              ))}
            </section>
          )}

          {def.warmth && (
            <section className="inspector-section">
              <h3>Warmth</h3>
              <p className="muted">
                <IconText text={building.unlit ? '❄ Cold — no wood to burn.' : '🔥 Lit.'} /> Keeps{' '}
                {homesWithin(run, building.pos, warmthRadiusOf(building)).length} home
                {homesWithin(run, building.pos, warmthRadiusOf(building)).length === 1 ? '' : 's'} within{' '}
                {warmthRadiusOf(building)} warm during the Storm, burning{' '}
                {def.warmth.fuelPerSecond.toFixed(3)} wood/s while it rages.
              </p>
            </section>
          )}

          {def.category === 'housing' && (
            <section className="inspector-section">
              <h3>Warmth</h3>
              <p className="muted">
                <IconText
                  text={
                    isInsulated(building)
                      ? '🔥 Warm — insulated by its upgrade, it needs no fire nearby.'
                      : isWarmAt(run, building.pos)
                        ? '🔥 Warm — inside the reach of the hearth or a lit brazier.'
                        : '❄ Cold in the Storm — beyond every fire. A brazier nearby would warm it.'
                  }
                />
              </p>
            </section>
          )}

          {benefitsFromRoad(def) && (
            <section className="inspector-section">
              <h3>Road</h3>
              <p className="muted">
                <IconText text={describeRoadLink(roadLinkOf(run, building)) ?? ''} />
              </p>
            </section>
          )}

          {terrain && def.category !== 'hearth' && (
            <section className="inspector-section">
              <h3>Ground</h3>
              <p className="muted">
                <Icon of={TERRAIN[terrain]} />{' '}
                {ground
                  ? ground.slice(TERRAIN[terrain].icon.length + 1)
                  : `${TERRAIN[terrain].name}: no effect on this building.`}
              </p>
            </section>
          )}

          {def.gatherRadius && (
            <section className="inspector-section">
              <h3>Deposits in range</h3>
              <div className="chip-row">
                {Object.entries(building.depositsInRange).map(([id, tiles]) => (
                  <span key={id} className="chip">
                    <Icon
                      id={DEPOSIT_ART[id as DepositId]}
                      label={DEPOSIT_INFO[id as DepositId].name}
                    />{' '}
                    ×{tiles?.length ?? 0}
                  </span>
                ))}
                {Object.keys(building.depositsInRange).length === 0 && (
                  <span className="muted">None — this camp cannot work.</span>
                )}
              </div>
            </section>
          )}
          <UpgradeSection run={run} building={building} />
          {def.category === 'hearth' && <ArchitectSection run={run} />}
          {(def.category === 'hearth' || def.storage) && <DumpStock run={run} />}
        </>
      )}

      <footer className="inspector-foot">
        {building.built && def.recipes.length > 0 && (
          <button type="button" onClick={() => pauseBuilding(building.id)}>
            {building.paused ? (
                  '▶ Resume'
                ) : (
                  <>
                    <Icon id="pause" emoji="⏸" /> Pause
                  </>
                )}
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
                  ? `${againWord()} to tear it down`
                  : `${againWord()} to cancel construction`
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
  if (Object.keys(bag).length === 0) return <span>nothing</span>
  return (
    <span className="bag-label">
      <BagIcons bag={bag} title />
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
        <h3>
          Workers {building.workers.length}/{slotCount}
        </h3>
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
                <span aria-hidden>
                  <Icon of={SPECIES[villager.species]} />
                </span>
                <strong>{villager.name}</strong>
                {trait && (
                  <span className="worker-trait" title={`${trait.name}: ${trait.description}`}>
                    <Icon id={VILLAGER_TRAIT_ART[trait.id]} emoji={trait.icon} />
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
                      <span aria-hidden>
                        <Icon of={SPECIES[v.species]} />
                      </span>
                      <strong>{v.name}</strong>
                      <small>
                        {trait ? (
                          <>
                            <Icon id={VILLAGER_TRAIT_ART[trait.id]} emoji={trait.icon} /> {trait.name}
                          </>
                        ) : (
                          SPECIES[v.species].name
                        )}
                      </small>
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
  return (
    <span className="recipe-label">
      {Object.keys(recipe.inputs).length > 0 ? (
        <BagIcons bag={recipe.inputs} />
      ) : (
        <span>{recipe.requiresDeposit ? <Icon id={DEPOSIT_ART[recipe.requiresDeposit]} /> : '—'}</span>
      )}
      <em>→</em>
      {Object.keys(recipe.outputs).length > 0 ? (
        <BagIcons bag={recipe.outputs} />
      ) : (
        <span>
          <Icon id="bell" emoji="🛎" />
        </span>
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
  const cleared = glade.clearWork > 0 ? glade.clearProgress / glade.clearWork : 1
  const secondsLeft =
    glade.clearers > 0
      ? Math.ceil((glade.clearWork - glade.clearProgress) / glade.clearers)
      : null
  const event = glade.eventId ? GLADE_EVENTS[glade.eventId] : undefined
  const stakes = gladeStakes(run, gladeId)

  return (
    <div className="inspector">
      <div className="inspector-body">
        <InspectorHead icon={<Icon id={GLADE_ART[glade.kind]} />} name={glade.name}>
          {GLADE_KIND_STYLE[glade.kind].title}
        </InspectorHead>

        {glade.cleared ? (
          <p className="muted">Cleared. You can build here.</p>
        ) : !reachable ? (
          <p className="muted">
            Too far. Clear a glade that borders this one before your crews can reach it.
            {barrierReachHint(run) ? ` ${barrierReachHint(run)}` : ''}
          </p>
        ) : glade.spared ? (
          <SparedGlade run={run} glade={glade} />
        ) : (
          <>
            <section className="inspector-section">
              <div className="row-between">
                <h3>Clearing crew {glade.clearers}</h3>
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
              <Bar value={cleared} />
              <small className="muted">
                {Math.floor(glade.clearProgress)}/{glade.clearWork} work
                {secondsLeft !== null ? ` · about ${secondsLeft}s remaining` : ' · idle'}
              </small>
            </section>

            <section className="inspector-section">
              <h3>Expected haul</h3>
              <div className="chip-row">
                <BagIcons bag={glade.reward} className="chip" />
              </div>
              {event && (
                <p className="muted warn-text">
                  <Icon id="dangerous" emoji="⚠" /> Something is waiting here. Clearing it will force a decision
                  {stakes.length > 0 ? ` — it could cost or bring ${describeStakes(stakes)}.` : '.'}
                </p>
              )}
              {event && <GladeStakeChips stakes={stakes} />}
              <ScoutReport run={run} gladeId={gladeId} />
            </section>

            <LeaveToForest run={run} glade={glade} />
          </>
        )}
        <GladeGround glade={glade} />
      </div>
    </div>
  )
}

/** Hostility per minute a spared glade of this kind calms, for display. */
function calmPerMinute(glade: Glade): string {
  return (sparedGladeCalmOf(glade.kind) * 60).toFixed(2)
}

/**
 * The other choice on a border glade: leave it wild. Clearing pays loot,
 * ground and reclaimed-land reputation but angers the forest for good;
 * sparing gives all of that up and calms it while the glade stands.
 */
function LeaveToForest({ run, glade }: { run: RunState; glade: Glade }) {
  const spare = useGameStore((s) => s.spareGlade)
  const mods = computeModifiers(run)
  const jump = HOSTILITY_PER_GLADE_CLEARED * mods.gladeHostility
  return (
    <section className="inspector-section glade-truce">
      <h3>Or leave it to the forest</h3>
      <p className="muted">
        Clearing it adds {jump.toFixed(1)} hostility now and makes the forest grow{' '}
        {Math.round(HOSTILITY_RATE_PER_CLEARED_GLADE * 100)}% faster for the rest of the run. Left
        wild, it calms hostility by {calmPerMinute(glade)} a minute for as long as it stands — but
        its haul, its ground and whatever waits there stay in the woods.
      </p>
      <button
        type="button"
        onClick={() => spare(glade.id)}
        title={glade.clearers > 0 ? 'The clearing crew comes home.' : undefined}
      >
        <Icon id="trees" emoji="🌲" /> Leave to the forest
      </button>
    </section>
  )
}

/** A glade already spared: what it is doing, and the costly way back. */
function SparedGlade({ run, glade }: { run: RunState; glade: Glade }) {
  const reclaim = useGameStore((s) => s.reclaimGlade)
  const confirm = useConfirm(`reclaim-${glade.id}`, () => reclaim(glade.id))
  return (
    <section className="inspector-section glade-truce is-spared">
      <h3>
        <Icon id="trees" emoji="🌲" /> Left to the forest
      </h3>
      <p className="muted">
        It stays wild and calms hostility by {calmPerMinute(glade)} a minute while it stands
        (hostility now {Math.floor(run.hostility)}). Crews cannot clear it until the truce is
        broken.
      </p>
      <button
        type="button"
        className={confirm.armed ? 'danger is-armed' : ''}
        onClick={confirm.trigger}
        title={`Breaking the truce costs ${SPARED_GLADE_RECLAIM_HOSTILITY} hostility`}
      >
        {confirm.armed
          ? `Break the truce for +${SPARED_GLADE_RECLAIM_HOSTILITY} hostility? ${againWord()}`
          : `Break the truce (+${SPARED_GLADE_RECLAIM_HOSTILITY} hostility)`}
      </button>
    </section>
  )
}

