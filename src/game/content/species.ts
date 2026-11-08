import type { SpeciesDef, SpeciesId, VillagerTraitId } from '../types'
import { SPECIES_ART } from './art'

const defs: SpeciesDef[] = [
  {
    id: 'human',
    name: 'Humans',
    icon: '🧑‍🌾',
    color: '#e0b877',
    baseResolve: 10,
    resolveTarget: 20,
    needs: ['religion', 'luxury'],
    workBonus: { farming: 0.3, gathering: 0.15 },
    trait: {
      name: 'Steadfast',
      description: 'Slow to give up: despair builds half as fast.',
      effects: [{ kind: 'slowDespair', percent: 50 }],
    },
    blurb: 'Steady farmhands. They want a shrine to pray at and something nice to drink.',
    refined: {
      need: 'luxury',
      name: 'spiced ale',
      icon: '🍹',
      good: 'spicedAle',
      hint: 'A Tavern with spiced ale in stock, brewed from ale and herbs at a Brewery raised to a Copper Still.',
    },
  },
  {
    id: 'beaver',
    name: 'Beavers',
    icon: '🦫',
    color: '#a98263',
    baseResolve: 10,
    resolveTarget: 20,
    needs: ['luxury', 'education'],
    workBonus: { woodworking: 0.4, masonry: 0.15 },
    trait: {
      name: 'Master Builders',
      description: 'Idle beavers raise buildings 40% faster.',
      effects: [{ kind: 'buildRate', percent: 40 }],
    },
    blurb: 'Master carpenters, and insufferably particular about their comforts.',
    refined: {
      need: 'education',
      name: 'blueprint folios',
      icon: '📘',
      good: 'folio',
      hint: "A Guild House with blueprint folios in stock, bound from scrolls and planks at a Scribe's Office.",
    },
  },
  {
    id: 'lizard',
    name: 'Lizards',
    icon: '🦎',
    color: '#7fae72',
    baseResolve: 10,
    resolveTarget: 19,
    needs: ['brawling', 'treatment'],
    workBonus: { hunting: 0.4, smithing: 0.2 },
    trait: {
      name: 'Blood of Embers',
      description:
        'A cold hearth does not trouble them at all, and they spar among themselves: Brawling counts as three-quarters met even without an Arena.',
      effects: [
        { kind: 'ignoreColdHearth' },
        /*
         * Brawling is the only need no other species shares, and its chain is
         * the second deepest (fiber to fabric at a weaver, then fabric and
         * planks into training gear, then an Arena). Never shared, it is
         * always the need the draft reaches last: across every lizard trio it
         * averaged ~1-20% coverage, and lizard trios trailed the rest by ~8
         * points; beaver/lizard/fox, where the fox's Rest is unshared too,
         * sat at 63% against 72-92%. Like the harpies' Education, the floor
         * matters where the venue never comes and little once it stands.
         */
        { kind: 'needFloor', need: 'brawling', ratio: 0.75 },
      ],
    },
    blurb: 'Hunters and smiths. Give them something to punch and someone to patch them up.',
    refined: {
      need: 'brawling',
      name: 'a feast after the bout',
      icon: '🥩',
      good: 'jerky',
      hint: 'A Clan Arena with jerky in stock, smoked at a Smokehouse.',
    },
  },
  {
    id: 'harpy',
    name: 'Harpies',
    icon: '🦅',
    color: '#8fa9c9',
    baseResolve: 10,
    resolveTarget: 20,
    needs: ['education', 'rest'],
    workBonus: { scholar: 0.4, gathering: 0.2 },
    trait: {
      name: 'Winged Scholars',
      description:
        'Survey glades from above, clearing them 50% faster, and teach one another: Education counts as three-quarters met even without a Guild House.',
      effects: [
        { kind: 'clearRate', percent: 50 },
        /*
         * Education is the deepest chain in the game (a Guild House priced in
         * bricks, a Scribes' Office priced in fabric, scrolls from fiber and
         * resin). Where beavers share it, it is drafted early; in a trio
         * without them it is the need the draft reaches last, and harpies sat
         * half-served for the whole run. The floor is worth little once a
         * Guild House covers them, so it mostly closes that gap: in the
         * balance harness it lifts human/fox/harpy by ~12 points and
         * beaver/lizard/harpy by ~1. Half (0.5) closed under half the gap.
         */
        { kind: 'needFloor', need: 'education', ratio: 0.75 },
      ],
    },
    blurb: 'Scholars of the old world. Prone to complaining, excellent at reading.',
    refined: {
      need: 'rest',
      name: 'scented baths',
      icon: '🪔',
      good: 'incense',
      hint: 'A Bath House with incense in stock to burn, rolled at an Apothecary Workshop.',
    },
  },
  {
    id: 'fox',
    name: 'Foxes',
    icon: '🦊',
    color: '#d38a5c',
    baseResolve: 10,
    resolveTarget: 19,
    needs: ['rest', 'treatment'],
    workBonus: { cooking: 0.3, gathering: 0.25 },
    trait: {
      name: 'Light Eaters',
      description: 'Forage on the side: they eat 35% less from the stores.',
      effects: [{ kind: 'mealSize', percent: -35 }],
    },
    blurb: 'Foragers and cooks who would rather be napping.',
    refined: {
      need: 'rest',
      name: 'porridge suppers',
      icon: '🥣',
      good: 'porridge',
      hint: 'A Bath House with porridge in stock, cooked from roots and grain at a Cookhouse.',
    },
  },
]

for (const d of defs) d.art ??= SPECIES_ART[d.id]

export const SPECIES: Record<SpeciesId, SpeciesDef> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
) as Record<SpeciesId, SpeciesDef>

export const SPECIES_LIST = defs

/** One villager of a species: "Harpy", "Fox", "Beaver". */
export function speciesSingular(sp: SpeciesId): string {
  const name = SPECIES[sp]?.name ?? 'Villagers'
  if (name.endsWith('ies')) return `${name.slice(0, -3)}y`
  if (name.endsWith('xes')) return name.slice(0, -2)
  return name.slice(0, -1)
}

export const STARTING_SPECIES: SpeciesId[] = ['human', 'beaver', 'lizard']

/** Player-facing names for the building tags species work bonuses apply to. */
export const WORK_TAG_LABELS: Record<string, string> = {
  gathering: 'Gathering camps',
  farming: 'Farming',
  woodworking: 'Woodworking',
  masonry: 'Masonry',
  smithing: 'Smithing',
  crafting: 'Crafting',
  alchemy: 'Alchemy',
  cooking: 'Cooking',
  brewing: 'Brewing',
  scholar: 'Scholarship',
  hunting: 'Hunting',
}

export const NEED_LABELS: Record<string, { name: string; icon: string }> = {
  rest: { name: 'Rest', icon: '🛌' },
  luxury: { name: 'Luxury', icon: '🍺' },
  religion: { name: 'Religion', icon: '🕯️' },
  education: { name: 'Education', icon: '📜' },
  brawling: { name: 'Brawling', icon: '🥊' },
  treatment: { name: 'Treatment', icon: '🍵' },
}

/**
 * Personal quirks rolled when a villager arrives. Effects are read in the
 * engine wherever the number they bend is computed.
 */
export interface VillagerTraitDef {
  id: VillagerTraitId
  name: string
  icon: string
  description: string
  /** Multiplier on assigned work speed. */
  work?: number
  /** Multiplier on assigned work speed during the Storm only. */
  stormWork?: number
  /** Multiplier on food eaten. */
  meals?: number
  /** Multiplier on build contribution while idle. */
  build?: number
  /** Multiplier on glade-clearing contribution. */
  clear?: number
  /** Extra work multiplier at gathering camps. */
  gatherWork?: number
}

const traitDefs: VillagerTraitDef[] = [
  { id: 'diligent', name: 'Diligent', icon: '💪', description: 'Works 15% faster.', work: 1.15 },
  { id: 'sluggish', name: 'Sluggish', icon: '🥱', description: 'Works 12% slower.', work: 0.88 },
  { id: 'glutton', name: 'Glutton', icon: '🍖', description: 'Eats 30% more.', meals: 1.3 },
  { id: 'frugal', name: 'Frugal', icon: '🥄', description: 'Eats 20% less.', meals: 0.8 },
  { id: 'strongback', name: 'Strong Back', icon: '🧱', description: 'Builds 40% faster while idle.', build: 1.4 },
  { id: 'pathfinder', name: 'Pathfinder', icon: '🧭', description: 'Clears glades 40% faster.', clear: 1.4 },
  { id: 'forager', name: 'Forager', icon: '🍄', description: '20% faster at gathering camps.', gatherWork: 1.2 },
  { id: 'stormborn', name: 'Stormborn', icon: '⛈️', description: 'Works 25% faster during the Storm.', stormWork: 1.25 },
]

export const VILLAGER_TRAITS: Record<VillagerTraitId, VillagerTraitDef> = Object.fromEntries(
  traitDefs.map((d) => [d.id, d]),
) as Record<VillagerTraitId, VillagerTraitDef>

export const VILLAGER_TRAIT_LIST = traitDefs

const FIRST_NAMES = [
  'Bram', 'Oda', 'Silt', 'Nessa', 'Kobb', 'Vell', 'Fenn', 'Ruk', 'Isla', 'Tamm',
  'Grell', 'Ivy', 'Dorn', 'Sable', 'Quill', 'Mott', 'Ash', 'Wren', 'Corin', 'Pell',
  'Hazel', 'Torv', 'Juno', 'Skarn', 'Lune', 'Bracken', 'Vesper', 'Halla', 'Nim', 'Osk',
]

export function villagerName(index: number): string {
  const first = FIRST_NAMES[index % FIRST_NAMES.length]
  const suffix = Math.floor(index / FIRST_NAMES.length)
  return suffix > 0 ? `${first} ${'I'.repeat(suffix + 1)}` : first
}
