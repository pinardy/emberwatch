import { BUILDINGS } from '../game/content/buildings'
import { GLADE_EVENTS } from '../game/content/gladeEvents'
import { RESOURCES } from '../game/content/resources'
import { NEED_LABELS, SPECIES } from '../game/content/species'
import { isReachable, rushCost } from '../game/engine/actions'
import { DEPOSIT_INFO } from '../game/engine/mapgen'
import { computeModifiers } from '../game/engine/modifiers'
import { availableRecipes, idleVillagers } from '../game/engine/queries'
import {
  adjacencyMultiplier,
  seasonMultiplier,
  workRate,
} from '../game/engine/production'
import { useGameStore, useRun } from '../game/store'
import type { BuildingInstance, Recipe, RunState } from '../game/types'

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
        <BuildingInspector run={run} building={building} />
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
  const hire = useGameStore((s) => s.hire)
  const fire = useGameStore((s) => s.fire)
  const chooseRecipe = useGameStore((s) => s.chooseRecipe)
  const pauseBuilding = useGameStore((s) => s.pauseBuilding)
  const demolish = useGameStore((s) => s.demolish)
  if (!def) return null

  const mods = computeModifiers(run)
  const recipes = availableRecipes(building)
  const active = def.recipes.find((r) => r.id === building.activeRecipeId)
  const rate =
    workRate(run, building, mods) *
    seasonMultiplier(building.defId, run.season.season, mods)
  const idle = idleVillagers(run).length
  const adjacent = adjacencyMultiplier(run, building) > 1

  return (
    <div className="inspector-body">
      <header className="inspector-head">
        <span className="inspector-icon">{def.icon}</span>
        <div>
          <strong>{def.name}</strong>
          <small>
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
          {def.workerSlots > 0 && (
            <section className="inspector-section">
              <div className="row-between">
                <h4>
                  Workers {building.workers.length}/{def.workerSlots}
                </h4>
                <div className="btn-row">
                  <button
                    type="button"
                    onClick={() => fire(building.id)}
                    disabled={building.workers.length === 0}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => hire(building.id)}
                    disabled={building.workers.length >= def.workerSlots || idle === 0}
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="worker-chips">
                {building.workers.map((id) => {
                  const villager = run.villagers[id]
                  if (!villager) return null
                  const bonus = bonusPercent(villager.species, def.tags)
                  return (
                    <button
                      key={id}
                      type="button"
                      className="worker-chip"
                      title={`Remove ${villager.name}`}
                      onClick={() => fire(building.id, id)}
                    >
                      {SPECIES[villager.species].icon} {villager.name}
                      {bonus > 0 && <em>+{bonus}%</em>}
                    </button>
                  )
                })}
                {building.workers.length === 0 && (
                  <span className="muted">Nobody is working here.</span>
                )}
              </div>
            </section>
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
                  <small className="muted">
                    {rate <= 0
                      ? seasonMultiplier(building.defId, run.season.season, mods) === 0
                        ? 'Idle — this building produces nothing during the Storm.'
                        : 'Idle — assign a worker.'
                      : `${rate.toFixed(2)} work/s → one batch every ${(
                          active.seconds / rate
                        ).toFixed(1)}s`}
                  </small>
                </>
              )}
            </section>
          )}

          {def.service && (
            <section className="inspector-section">
              <h4>Service</h4>
              <p className="muted">
                {NEED_LABELS[def.service.need].icon} Satisfies{' '}
                {NEED_LABELS[def.service.need].name} for up to {def.service.capacity}{' '}
                villagers. Needs a worker and a steady supply of{' '}
                {Object.keys(def.recipes[0]?.inputs ?? {})
                  .map((id) => RESOURCES[id as keyof typeof RESOURCES]?.name)
                  .join(', ')}
                .
              </p>
            </section>
          )}

          {def.adjacency && (
            <section className="inspector-section">
              <h4>Adjacency</h4>
              <p className="muted">
                {adjacent ? '✅' : '▫'} +{def.adjacency.percent}% work speed next to a{' '}
                {BUILDINGS[def.adjacency.nearId]?.name}
                {adjacent ? ' — active.' : ' — not adjacent.'}
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
            className="danger"
            onClick={() => {
              demolish(building.id)
              useGameStore.getState().clearSelection()
            }}
          >
            Demolish
          </button>
        )}
      </footer>
    </div>
  )
}

function bonusPercent(species: keyof typeof SPECIES, tags: string[]): number {
  const bonuses = SPECIES[species].workBonus as Record<string, number | undefined>
  let sum = 0
  for (const tag of tags) sum += bonuses[tag] ?? 0
  return Math.round(sum * 100)
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
          <span className="inspector-icon">
            {glade.kind === 'small' ? '🌿' : glade.kind === 'dangerous' ? '⚠️' : '☠️'}
          </span>
          <div>
            <strong>{glade.name}</strong>
            <small>
              {glade.kind === 'small'
                ? 'Small glade'
                : glade.kind === 'dangerous'
                  ? 'Dangerous glade'
                  : 'Forbidden glade'}
            </small>
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
