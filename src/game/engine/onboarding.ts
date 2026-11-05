import { BUILDINGS } from '../content/buildings'
import { EDIBLE } from '../content/resources'
import type { BuildingInstance, ResourceId, RunState } from '../types'
import { isReachable } from './actions'

/**
 * The "First steps" checklist: the handful of moves that keep a new
 * settlement fed, warm and housed through its first Storm. Every step ticks
 * itself off from the run state, so the checklist can never disagree with
 * what is on the map. Pure and read-only — the UI decides what to show.
 */
export type FirstStepId = 'foodCamp' | 'woodCamp' | 'staffCamps' | 'shelter' | 'glade'

export interface FirstStep {
  id: FirstStepId
  label: string
  /** A few words on why it matters. */
  why: string
  done: boolean
  /** Optional steps never hold the checklist open. */
  optional: boolean
}

/** A gathering camp whose recipes yield something villagers can eat. */
export function isFoodCamp(defId: string): boolean {
  const def = BUILDINGS[defId]
  if (!def || def.category !== 'gathering') return false
  return def.recipes.some((r) =>
    Object.keys(r.outputs).some((id) => EDIBLE.includes(id as ResourceId)),
  )
}

export function isWoodCamp(defId: string): boolean {
  return defId === 'woodcuttersCamp'
}

function placed(s: RunState, test: (b: BuildingInstance) => boolean): BuildingInstance[] {
  return Object.values(s.buildings).filter(test)
}

/** The first steps, in the order a new player should take them. */
export function firstSteps(s: RunState): FirstStep[] {
  const foodCamps = placed(s, (b) => isFoodCamp(b.defId))
  const woodCamps = placed(s, (b) => isWoodCamp(b.defId))
  const staffed = (camps: BuildingInstance[]) => camps.some((b) => b.workers.length > 0)
  const housing = placed(s, (b) => BUILDINGS[b.defId]?.category === 'housing')
  const clearing =
    s.stats.gladesCleared > 0 || Object.values(s.glades).some((g) => !g.cleared && g.clearers > 0)

  return [
    {
      id: 'foodCamp',
      label: "Build a Foragers' Camp",
      why: 'Your starting food lasts only a few minutes.',
      done: foodCamps.length > 0,
      optional: false,
    },
    {
      id: 'woodCamp',
      label: "Build a Woodcutters' Camp",
      why: 'Wood builds everything and keeps the hearth lit in the Storm.',
      done: woodCamps.length > 0,
      optional: false,
    },
    {
      id: 'staffCamps',
      label: 'Assign workers to both camps',
      why: 'A camp with nobody in it produces nothing.',
      done: staffed(foodCamps) && staffed(woodCamps),
      optional: false,
    },
    {
      id: 'shelter',
      label: 'Build a Shelter',
      why: 'Unhoused villagers lose resolve and soon leave.',
      done: housing.length > 0,
      optional: false,
    },
    {
      id: 'glade',
      label: 'Send a crew to clear a glade',
      why: 'New land holds loot, deposits and room to grow.',
      done: clearing,
      optional: true,
    },
  ]
}

/** True once every required step is done. */
export function firstStepsComplete(s: RunState): boolean {
  return firstSteps(s).every((step) => step.done || step.optional)
}

/**
 * Where clicking a step should take the player: the building to place, the
 * camp to staff, or the glade to clear. `null` when there is nothing to point
 * at (e.g. no camp built yet to staff).
 */
export type FirstStepTarget =
  | { kind: 'build'; defId: string }
  | { kind: 'building'; buildingId: string }
  | { kind: 'glade'; gladeId: string }

export function firstStepTarget(s: RunState, id: FirstStepId): FirstStepTarget | null {
  switch (id) {
    case 'foodCamp':
      return { kind: 'build', defId: 'foragersCamp' }
    case 'woodCamp':
      return { kind: 'build', defId: 'woodcuttersCamp' }
    case 'shelter':
      return { kind: 'build', defId: 'shelter' }
    case 'staffCamps': {
      // A camp from a kind nobody works yet; finished camps before sites.
      const unstaffed = [
        placed(s, (b) => isFoodCamp(b.defId)),
        placed(s, (b) => isWoodCamp(b.defId)),
      ].filter((camps) => !camps.some((b) => b.workers.length > 0))
      const candidates = unstaffed.flat().sort((a, b) => Number(b.built) - Number(a.built))
      return candidates[0] ? { kind: 'building', buildingId: candidates[0].id } : null
    }
    case 'glade': {
      const glade = Object.values(s.glades)
        .filter((g) => !g.cleared && isReachable(s, g.id))
        .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.clearWork - b.clearWork)[0]
      return glade ? { kind: 'glade', gladeId: glade.id } : null
    }
  }
}

/** Safe glades first: a new player's first crew should not open a forbidden one. */
function kindRank(kind: string): number {
  return kind === 'small' ? 0 : kind === 'dangerous' ? 1 : 2
}
