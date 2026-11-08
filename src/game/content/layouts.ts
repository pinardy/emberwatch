import type { BiomeDef, BiomeId, LayoutDef, LayoutId } from '../types'

/**
 * Map layouts and biomes: the shape of the ground a run is founded on.
 *
 * Every run draws one layout and one biome from its seed, in a stream of their
 * own (`engine/terrainPlan.ts`), weighted by these odds and by any land that
 * leans one way (Fertile Floodplain favours the river, Ancient Ruins the
 * ruins field). The two combine freely: a biome claims a region of whatever
 * layout was drawn — a wedge of the rings or the ruins, the river's far bank,
 * one flank below the ridge.
 *
 * Everything here is data read by `engine/worldgen.ts` (where glades go,
 * which borders carry a barrier, which event pool a glade draws from) and by
 * the screens that describe the ground. The default — rings in the old
 * woodland — generates exactly the map a seed always had.
 */

const layoutDefs: LayoutDef[] = [
  {
    id: 'rings',
    name: 'The Ringed Glades',
    icon: '◎',
    blurb: 'Glades ring the hearth in two circles, with neighbours on every side.',
    detail:
      'Two rings of glades around the hearth: easy neighbours close in, richer and more dangerous ones further out. Expand any way you like.',
    weight: 5,
    seeding: { kind: 'rings' },
    biomeRegion: 'wedge',
  },
  {
    id: 'river',
    name: 'The River Vale',
    icon: '🌊',
    blurb: 'A river splits the map. Its far bank is reached only at two fords, and roads cross only there.',
    detail:
      'A river runs along the glade borders and cuts the map in two. Glades across it are reached only from a glade on the other side of a ford, and no road or building crosses the water anywhere else. Clear toward a ford to open the far bank.',
    weight: 1.7,
    seeding: { kind: 'rings' },
    biomeRegion: 'farSide',
    split: { kind: 'line', far: 5 },
    barrier: 'river',
    crossings: { count: 2, fromHearth: false },
    bankWeights: { fertile: 2, marsh: 1.5 },
  },
  {
    id: 'ridge',
    name: 'The Long Ridge',
    icon: '⛰️',
    blurb: 'The hearth stands at the end of a high ridge. Push along the spine to find the passes down.',
    detail:
      'The hearth sits at one end of a rocky ridge with cliffs on both sides. One switchback leads down near the hearth; the other passes wait further along the spine, so expansion has a direction — along the ridge first, then down and around.',
    weight: 1.6,
    seeding: { kind: 'spine', steps: [5.4, 9, 12.4], corridor: 3, terrain: 'rock', terrainWeight: 1.5, lowland: [5, 7] },
    biomeRegion: 'flank',
    split: { kind: 'spine' },
    barrier: 'cliff',
    crossings: { count: 4, fromHearth: true },
  },
  {
    id: 'ruins',
    name: 'The Fallen Holdfast',
    icon: '🏛️',
    blurb: "Glades scattered through an old kingdom's ruins: salvage stone and bricks, and mind what the ruins keep.",
    detail:
      'More, smaller glades scattered without rings among the ruins of an old holdfast. Half of them hold tumbled stonework — a Stonecutters\' Camp salvages stone and old bricks from it until it is picked clean — and dangerous glades open on the ruins\' own events first.',
    weight: 1.7,
    seeding: { kind: 'scatter', count: 16, minGap: 3.3, hearthGap: 4.6 },
    biomeRegion: 'wedge',
    eventPool: 'ruins',
    extraDeposit: { kind: 'ruins', chance: 0.5 },
  },
]

const biomeDefs: BiomeDef[] = [
  {
    id: 'woodland',
    name: 'The Old Forest',
    icon: '🌲',
    blurb: 'Forest, fen, rock and loam, as the Queen\'s surveyors always find it.',
    detail: 'The forest as every settlement knows it.',
    weight: 7,
  },
  {
    id: 'cinderwood',
    name: 'The Cinderwood',
    icon: '🔥',
    blurb:
      'An old burn scar claims part of the map: ash that stays warm in the Storm, charred deadfall, fireweed, and the fire\'s own ghosts.',
    detail:
      'Where a settlement once let its hearth die, the fire that followed burned a swathe of the forest to the ground. Its glades are cinder flats: homes there stay warm through every Storm, but farms barely grow and every workplace slows in the Storm rain. Charred deadfall gives quick wood to a Woodcutters\' Camp until it runs out, and fireweed gives an Herbalists\' Camp herbs and fibre at once. Little lives there to cut back, so its glades clear faster.',
    weight: 3,
    terrain: 'cinder',
    themes: [
      { deposits: ['deadfall', 'fireweed', 'vegetation', 'deadfall'] },
      { deposits: ['fireweed', 'game', 'deadfall', 'stoneVein'] },
      { deposits: ['deadfall', 'fireweed', 'clayPatch', 'vegetation'] },
      { deposits: ['fireweed', 'fireweed', 'vegetation', 'orePatch'] },
    ],
    eventPool: 'cinderwood',
    clearWorkScale: 0.8,
    share: 0.34,
  },
]

export const LAYOUTS: Record<LayoutId, LayoutDef> = Object.fromEntries(
  layoutDefs.map((d) => [d.id, d]),
) as Record<LayoutId, LayoutDef>

export const LAYOUT_LIST = layoutDefs

export const BIOMES: Record<BiomeId, BiomeDef> = Object.fromEntries(
  biomeDefs.map((d) => [d.id, d]),
) as Record<BiomeId, BiomeDef>

export const BIOME_LIST = biomeDefs

/** The layout and biome of every run before either existed. */
export const DEFAULT_LAYOUT: LayoutId = 'rings'
export const DEFAULT_BIOME: BiomeId = 'woodland'
