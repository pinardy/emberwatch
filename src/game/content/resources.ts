import type { ResourceBag, ResourceDef, ResourceId } from '../types'
import { RESOURCE_ART } from './art'

const defs: ResourceDef[] = [
  // ---- materials -----------------------------------------------------------
  { id: 'wood', name: 'Wood', category: 'material', icon: '🪵', value: 2 },
  { id: 'plank', name: 'Planks', category: 'material', icon: '🟫', value: 6 },
  { id: 'stone', name: 'Stone', category: 'material', icon: '🪨', value: 3 },
  { id: 'brick', name: 'Bricks', category: 'material', icon: '🧱', value: 8 },
  { id: 'clay', name: 'Clay', category: 'material', icon: '🟤', value: 3 },
  { id: 'copperOre', name: 'Copper Ore', category: 'material', icon: '🟠', value: 4 },
  { id: 'copperBar', name: 'Copper Bars', category: 'material', icon: '🟧', value: 10 },
  { id: 'plantFiber', name: 'Plant Fibre', category: 'material', icon: '🌾', value: 2 },
  { id: 'fabric', name: 'Fabric', category: 'material', icon: '🧵', value: 7 },
  { id: 'resin', name: 'Resin', category: 'material', icon: '🟡', value: 4 },
  { id: 'part', name: 'Parts', category: 'material', icon: '⚙️', value: 12 },
  { id: 'tool', name: 'Tools', category: 'material', icon: '🔧', value: 14 },

  // ---- raw food ------------------------------------------------------------
  { id: 'berry', name: 'Berries', category: 'rawFood', icon: '🫐', value: 2 },
  { id: 'root', name: 'Roots', category: 'rawFood', icon: '🥕', value: 2 },
  { id: 'meat', name: 'Meat', category: 'rawFood', icon: '🍖', value: 3 },
  { id: 'grain', name: 'Grain', category: 'rawFood', icon: '🌿', value: 3 },
  { id: 'vegetable', name: 'Vegetables', category: 'rawFood', icon: '🥬', value: 3 },
  { id: 'mushroom', name: 'Mushrooms', category: 'rawFood', icon: '🍄', value: 2 },
  { id: 'insect', name: 'Insects', category: 'rawFood', icon: '🦗', value: 2 },
  { id: 'egg', name: 'Eggs', category: 'rawFood', icon: '🥚', value: 3 },
  { id: 'herb', name: 'Herbs', category: 'rawFood', icon: '🌱', value: 3 },

  // ---- cooked food ---------------------------------------------------------
  { id: 'biscuit', name: 'Biscuits', category: 'food', icon: '🍪', value: 8 },
  { id: 'skewer', name: 'Skewers', category: 'food', icon: '🍢', value: 8 },
  { id: 'jerky', name: 'Jerky', category: 'food', icon: '🥩', value: 8 },
  { id: 'porridge', name: 'Porridge', category: 'food', icon: '🥣', value: 8 },
  { id: 'pickles', name: 'Pickled Goods', category: 'food', icon: '🫙', value: 8 },

  // ---- service goods -------------------------------------------------------
  { id: 'ale', name: 'Ale', category: 'serviceGood', icon: '🍺', value: 10 },
  { id: 'incense', name: 'Incense', category: 'serviceGood', icon: '🕯️', value: 10 },
  { id: 'scroll', name: 'Scrolls', category: 'serviceGood', icon: '📜', value: 11 },
  { id: 'tea', name: 'Tea', category: 'serviceGood', icon: '🍵', value: 10 },
  { id: 'trainingGear', name: 'Training Gear', category: 'serviceGood', icon: '🥊', value: 11 },
  // The humans' refined Luxury (see `species.ts`), brewed at a Copper Still.
  { id: 'spicedAle', name: 'Spiced Ale', category: 'serviceGood', icon: '🍹', value: 13 },
  // The beavers' refined Education, bound at a Scribe's Office.
  { id: 'folio', name: 'Blueprint Folios', category: 'serviceGood', icon: '📘', value: 13 },

  // ---- currency ------------------------------------------------------------
  { id: 'amber', name: 'Amber', category: 'currency', icon: '🟨', value: 1 },
]

for (const d of defs) d.art ??= RESOURCE_ART[d.id]

export const RESOURCES: Record<ResourceId, ResourceDef> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
) as Record<ResourceId, ResourceDef>

export const RESOURCE_LIST = defs

/** Anything villagers will eat. Variety across these grants bonus resolve. */
export const EDIBLE: ResourceId[] = defs
  .filter((d) => d.category === 'rawFood' || d.category === 'food')
  .map((d) => d.id)

/** Cooked food counts double when eaten and feeds the "complex food" need. */
export const COMPLEX_FOOD: ResourceId[] = defs
  .filter((d) => d.category === 'food')
  .map((d) => d.id)

/** Everything in `bag` whose resource belongs to `category`. */
export function categoryTotal(bag: ResourceBag, category: string): number {
  let sum = 0
  for (const [id, amount] of Object.entries(bag)) {
    if (RESOURCES[id as ResourceId]?.category === category) sum += amount ?? 0
  }
  return sum
}

export function resourceName(id: ResourceId): string {
  return RESOURCES[id]?.name ?? id
}
