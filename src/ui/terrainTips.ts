import { isFounding } from '../game/engine/founding'
import { layoutOf } from '../game/engine/terrainPlan'
import { terrainWarmsHomes } from '../game/engine/queries'
import type { RunState } from '../game/types'
import type { Tip } from './tips'

/**
 * The coach's tips for the map's layouts and biomes (`content/layouts.ts`),
 * kept apart from the main list in `tips.ts`, which spreads them in early.
 * Each fires once, the first time its ground matters.
 *
 * The ground shapes the whole run, so these are urgent: they may interrupt
 * the First steps checklist rather than queue behind it (and behind every
 * other tip) until the first Storm has passed. The layout's tip waits a few
 * seconds into the clock, so the checklist greets the player first.
 */

/** Seconds of play before a layout or biome tip may interrupt the checklist. */
export const TERRAIN_TIP_DELAY = 15

const founded = (run: RunState) => !isFounding(run) && run.clock >= TERRAIN_TIP_DELAY

/** A glade of warm ground (the Cinderwood) is in view. */
const warmGroundSeen = (run: RunState) =>
  Object.values(run.glades).some((g) => g.discovered && terrainWarmsHomes(g.terrain))

export const TERRAIN_TIPS: Tip[] = [
  {
    id: 'river-vale',
    title: 'A river splits this map',
    text: 'Glades across the water are reached only by a ford, the gravel crossings on the map, and roads cross only there. Clear toward a ford to open the far bank.',
    when: (run) => founded(run) && layoutOf(run.world).id === 'river',
    urgent: true,
  },
  {
    id: 'long-ridge',
    title: 'Your hearth stands on a ridge',
    text: 'Cliffs fall away on both sides. One switchback leads down near the hearth; the other passes wait further along the spine. Push along the ridge to open the lowland.',
    when: (run) => founded(run) && layoutOf(run.world).id === 'ridge',
    urgent: true,
  },
  {
    id: 'ruins-field',
    title: 'Ruins of an old holdfast',
    text: "Tumbled stonework stands in many glades here. Once one is cleared, a Stonecutters' Camp beside it salvages stone and old bricks until it is picked clean. The ruins' glades keep secrets of their own.",
    // On the layout, not on the first ruin cleared: the player should know to
    // look for it before choosing which glades to clear.
    when: (run) => founded(run) && layoutOf(run.world).id === 'ruins',
    urgent: true,
  },
  {
    id: 'cinderwood',
    title: 'The Cinderwood: warm ash',
    text: 'Homes raised on the cinder flats stay warm through every Storm, beyond any fire. But farms barely grow there, and every workplace slows in the Storm rain: house people on the ash, work elsewhere.',
    when: (run) => founded(run) && warmGroundSeen(run),
    urgent: true,
  },
]
