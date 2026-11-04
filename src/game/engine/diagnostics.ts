import { BUILDINGS } from '../content/buildings'
import { NEED_LABELS, SPECIES } from '../content/species'
import { RESOURCES } from '../content/resources'
import type { ResourceId, RunState, SpeciesId } from '../types'
import { HEARTH_FUEL_PER_SECOND } from './balance'
import { computeModifiers } from './modifiers'
import {
  canAfford,
  idleVillagers,
  population,
  secondsUntilDeparture,
  totalHousing,
} from './queries'
import { stormFuelPerSecond } from './society'

/**
 * Things that are quietly going wrong.
 *
 * Every entry here is a failure mode the balance harness actually hit — an
 * unsupplied tavern, construction with nobody to build it, a settlement that
 * grew past its housing. They are invisible in the raw numbers, so the game
 * says them out loud rather than letting a run rot for five minutes.
 */
export interface Warning {
  id: string
  text: string
  severity: 'danger' | 'caution'
}

export function collectWarnings(s: RunState): Warning[] {
  const out: Warning[] = []
  if (s.phase !== 'playing') return out

  if (s.starving) {
    out.push({
      id: 'starving',
      severity: 'danger',
      text: '🍽️ Villagers are going hungry — resolve is collapsing.',
    })
  }

  const braziers = Object.values(s.buildings).filter(
    (b) => b.built && BUILDINGS[b.defId]?.warmth,
  )
  const unlit = braziers.filter((b) => b.unlit).length
  if (s.coldHearth) {
    out.push({
      id: 'cold',
      severity: 'danger',
      text:
        braziers.length > 0
          ? '🔥 The hearth and its braziers have gone out. They need wood.'
          : '🔥 The hearth has gone out. It needs wood.',
    })
  } else if (unlit > 0) {
    out.push({
      id: 'cold-braziers',
      severity: 'danger',
      text: `🏮 ${unlit} brazier${unlit > 1 ? 's have' : ' has'} gone cold — the homes around ${unlit > 1 ? 'them' : 'it'} are freezing. Bring wood.`,
    })
  } else if (s.season.season === 'storm') {
    // Will the woodpile last the rest of the Storm at the current burn?
    const mods = computeModifiers(s)
    const burn = stormFuelPerSecond(s, HEARTH_FUEL_PER_SECOND, mods.hearthFuel)
    const remaining = Math.max(0, s.season.length - s.season.elapsed)
    const wood = s.stock.wood ?? 0
    if (burn > 0 && wood < burn * remaining) {
      const lasts = Math.floor(wood / burn)
      const fires = braziers.length > 0 ? `the hearth and ${braziers.length} brazier${braziers.length > 1 ? 's' : ''}` : 'the hearth'
      out.push({
        id: 'fuel',
        severity: 'caution',
        text: `🪵 Wood for ${lasts}s of fire, ${Math.ceil(remaining)}s of Storm left — ${fires} burn ${burn.toFixed(2)}/s.`,
      })
    }
  }

  // A species in despair is on a visible countdown, not a silent one.
  for (const [sp, seconds] of Object.entries(secondsUntilDeparture(s))) {
    out.push({
      id: `leaving-${sp}`,
      severity: 'danger',
      text: `🚪 ${SPECIES[sp as SpeciesId].name} will start leaving in ${Math.ceil(seconds ?? 0)}s.`,
    })
  }

  const pop = population(s)
  const housing = totalHousing(s)
  if (pop > housing) {
    out.push({
      id: 'unhoused',
      severity: 'caution',
      text: `🛏 ${pop - housing} villagers have no bed. Build housing.`,
    })
  }

  // Construction only advances while somebody is idle.
  const sites = Object.values(s.buildings).filter((b) => !b.built).length
  if (sites > 0 && idleVillagers(s).length === 0) {
    out.push({
      id: 'no-builders',
      severity: 'caution',
      text: `🔨 ${sites} building${sites > 1 ? 's' : ''} stalled — idle villagers are your builders.`,
    })
  }

  // A service with no goods to hand out contributes nothing at all.
  const unsupplied = new Map<string, ResourceId[]>()
  const unstaffed = new Set<string>()
  for (const b of Object.values(s.buildings)) {
    const def = BUILDINGS[b.defId]
    if (!def?.service || !b.built || b.paused) continue
    if (b.workers.length === 0) {
      unstaffed.add(def.service.need)
      continue
    }
    const recipe = def.recipes[0]
    if (recipe && !canAfford(s.stock, recipe.inputs)) {
      const missing = (Object.keys(recipe.inputs) as ResourceId[]).filter(
        (id) => (s.stock[id] ?? 0) <= 0,
      )
      unsupplied.set(def.service.need, missing)
    }
  }

  for (const [need, missing] of unsupplied) {
    const goods = missing.map((id) => RESOURCES[id]?.name ?? id).join(', ')
    out.push({
      id: `unsupplied-${need}`,
      severity: 'caution',
      text: `${NEED_LABELS[need]?.icon ?? '🛎'} Your ${NEED_LABELS[need]?.name ?? need} service has no ${goods}.`,
    })
  }

  for (const need of unstaffed) {
    if (unsupplied.has(need)) continue
    out.push({
      id: `unstaffed-${need}`,
      severity: 'caution',
      text: `${NEED_LABELS[need]?.icon ?? '🛎'} Your ${NEED_LABELS[need]?.name ?? need} service has no worker.`,
    })
  }

  if (s.impatience >= s.maxImpatience - 3) {
    out.push({
      id: 'impatience',
      severity: 'danger',
      text: "⏳ The Queen is nearly out of patience.",
    })
  }

  return out
}
