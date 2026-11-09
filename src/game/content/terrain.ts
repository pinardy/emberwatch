import type { TerrainDef, TerrainId } from '../types'
import { TERRAIN_ART } from './art'

/**
 * What each kind of ground does to the buildings standing on it. A building
 * takes the terrain of the glade it was placed in, so the same farm is worth
 * more on fertile ground than on a crag — and where a glade's border runs is
 * suddenly worth knowing.
 *
 * Effects are declarative and read by `engine/production.ts`; the placement
 * ghost and the Inspector render the same list.
 */
export const TERRAIN: Record<TerrainId, TerrainDef> = {
  clearing: {
    id: 'clearing',
    name: 'Clearing',
    icon: '🌱',
    blurb: 'Open, honest ground. No bonus and no penalty.',
    effects: [],
  },
  fertile: {
    id: 'fertile',
    name: 'Fertile ground',
    icon: '🌾',
    blurb: 'Dark loam. Farms flourish here.',
    effects: [{ kind: 'workSpeed', tag: 'farming', percent: 25 }],
  },
  rock: {
    id: 'rock',
    name: 'Rocky ground',
    icon: '🪨',
    blurb: 'Stone close under the soil: masons and miners thrive, ploughs break.',
    effects: [
      { kind: 'workSpeed', tag: 'masonry', percent: 20 },
      { kind: 'yield', resource: 'copperOre', percent: 15 },
      { kind: 'workSpeed', tag: 'farming', percent: -20 },
    ],
  },
  marsh: {
    id: 'marsh',
    name: 'Marsh',
    icon: '🪷',
    blurb: 'Foundations sink and work drags, but the clay is rich.',
    effects: [
      { kind: 'buildSpeed', percent: -20 },
      { kind: 'yield', resource: 'clay', percent: 25 },
    ],
  },
  forest: {
    id: 'forest',
    name: 'Forest',
    icon: '🌲',
    blurb: 'Close timber and thick undergrowth. Gatherers work faster.',
    effects: [{ kind: 'workSpeed', tag: 'gathering', percent: 15 }],
  },
  // The Cinderwood's ground (see `content/layouts.ts`): its quirk is the
  // warmth still sleeping in the ash — a place for homes, not workshops.
  cinder: {
    id: 'cinder',
    name: 'Cinder flats',
    icon: '🔥',
    blurb:
      'Ash over old embers. Homes here stay warm through every Storm, but nothing planted takes, and Storm rain turns the ash to slurry around every workplace.',
    effects: [
      { kind: 'warmHomes' },
      { kind: 'workSpeed', tag: 'farming', percent: -40 },
      { kind: 'seasonWork', season: 'storm', percent: -10 },
    ],
  },
}

for (const def of Object.values(TERRAIN)) def.art ??= TERRAIN_ART[def.id]
