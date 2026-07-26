import type { MetaState, RunState, SpeciesId } from '../types'

/**
 * Between-run progression. Deliberately small: a handful of permanent unlocks
 * that widen the option space rather than raise raw power.
 */
export interface MetaUpgradeDef {
  id: string
  name: string
  icon: string
  cost: number
  description: string
  /** Species this upgrade adds to the draw pool. */
  unlocksSpecies?: SpeciesId
}

const defs: MetaUpgradeDef[] = [
  {
    id: 'deeperStores',
    name: 'Deeper Stores',
    icon: '🪵',
    cost: 3,
    description: 'Every settlement starts with 20 extra wood.',
  },
  {
    id: 'travelRations',
    name: 'Travel Rations',
    icon: '🍪',
    cost: 4,
    description: 'Start each run with 15 biscuits — enough to survive a slow opening.',
  },
  {
    id: 'unlockHarpy',
    name: 'Harpy Charter',
    icon: '🦅',
    cost: 5,
    description: 'Harpies may be drawn as settlers. Excellent scholars and foragers.',
    unlocksSpecies: 'harpy',
  },
  {
    id: 'unlockFox',
    name: 'Fox Charter',
    icon: '🦊',
    cost: 5,
    description: 'Foxes may be drawn as settlers. Fine cooks, keen foragers.',
    unlocksSpecies: 'fox',
  },
  {
    id: 'citadelBlessing',
    name: "Citadel's Blessing",
    icon: '🕯️',
    cost: 8,
    description: 'Begin every run with the Campfire Tales cornerstone (+2 resolve to all).',
  },
]

export const META_UPGRADES: Record<string, MetaUpgradeDef> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
)

export const META_UPGRADE_LIST = defs

export const META_VERSION = 1

export function defaultMeta(): MetaState {
  return {
    version: META_VERSION,
    citadelSupplies: 0,
    runsWon: 0,
    runsLost: 0,
    unlockedSpecies: [],
    upgrades: [],
    history: [],
  }
}

/** Supplies awarded when a run ends. Losing still pays something out. */
export function supplyReward(run: RunState): number {
  const base = run.phase === 'won' ? 6 : 1
  return base + Math.floor(run.reputation / 3) + run.stats.gladesCleared
}
