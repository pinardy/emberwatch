import type { ConditionOutcome, ResourceId } from '../types'
import { LONG_NIGHT_BRAZIERS, LONG_NIGHT_REACH_PERCENT } from '../engine/balance'

/**
 * Storm blights: how the forest's hostility reaches the settlement.
 *
 * At each Clearance the forest's mood picks one blight from those its
 * hostility has unlocked and announces it — what will happen when the Storm
 * breaks, and the goods that blunt it. The forecast is a lingering condition
 * (it shows beside the threats with a countdown to the Storm): make that many
 * goods before then — a Clearance's worth of work for the right producers —
 * and the blight is turned aside; let the Storm arrive first and `strike`
 * lands. The amount grows each year (see `engine/blights.ts`). Data only.
 */
export interface StormBlightDef {
  id: string
  /** The forecast's name on the conditions bar, e.g. "Rising Waters". */
  name: string
  icon: string
  /** Drawn only once hostility has reached this. */
  minHostility: number
  /** Relative odds among the blights hostility has unlocked. */
  weight: number
  /** What will happen, said at Clearance. */
  warning: string
  /**
   * The goods that blunt it: this many made during the Clearance after the
   * forecast (Year 2; more each later year).
   */
  prep: { resource: ResourceId; amount: number }
  /** What lands if the Storm breaks first. */
  strike: ConditionOutcome
}

const defs: StormBlightDef[] = [
  {
    id: 'leakingRoofs',
    name: 'Gathering Clouds',
    icon: '💧',
    minHostility: 12,
    weight: 3,
    warning: 'The rain will find every gap in the roofs: every species −8 resolve through the Storm.',
    prep: { resource: 'plank', amount: 20 },
    strike: {
      condition: {
        name: 'Leaking Roofs',
        icon: '💧',
        description: 'Rain pours through the roofs: every species −8 resolve until the Storm passes, or until 12 planks patch them.',
        resolveBy: { kind: 'stock', resource: 'plank', amount: 12 },
        consume: true,
        whileActive: [{ kind: 'resolveFlat', species: 'all', amount: -8 }],
        passesWithStorm: true,
      },
    },
  },
  {
    id: 'dampStores',
    name: 'Creeping Damp',
    icon: '🐀',
    minHostility: 12,
    weight: 3,
    warning: 'Damp and vermin will reach the stores: 40% of every raw food stack rots when the Storm breaks.',
    prep: { resource: 'clay', amount: 15 },
    strike: { spoil: { category: 'rawFood', share: 0.4 } },
  },
  {
    id: 'risingWaters',
    name: 'Rising Waters',
    icon: '🌊',
    minHostility: 24,
    weight: 3,
    warning: 'The streams will burst into the workshops: every workplace 40% slower through the Storm.',
    prep: { resource: 'brick', amount: 14 },
    strike: {
      condition: {
        name: 'Flooded Workshops',
        icon: '🌊',
        description: 'Water stands in every workshop: all work 40% slower until the Storm passes, or until 16 planks raise the floors.',
        resolveBy: { kind: 'stock', resource: 'plank', amount: 16 },
        consume: true,
        whileActive: [{ kind: 'productionSpeed', tag: 'all', percent: -40 }],
        passesWithStorm: true,
      },
    },
  },
  {
    id: 'stormFever',
    name: 'Fever Winds',
    icon: '🤒',
    minHostility: 24,
    weight: 3,
    warning: 'A fever rides the Storm: it takes a villager, and every species is −4 resolve until it passes.',
    prep: { resource: 'herb', amount: 60 },
    strike: {
      villagerLoss: 1,
      condition: {
        name: 'Storm Fever',
        icon: '🤒',
        description: 'The sick lie by the fire: every species −4 resolve until the Storm passes, or until 10 herbs are brewed for them.',
        resolveBy: { kind: 'stock', resource: 'herb', amount: 10 },
        consume: true,
        whileActive: [{ kind: 'resolveFlat', species: 'all', amount: -4 }],
        passesWithStorm: true,
      },
    },
  },
  {
    id: 'somethingStirs',
    name: 'Something Stirs',
    icon: '🐺',
    minHostility: 32,
    weight: 3,
    warning: 'A beast follows the Storm in and raids the larder until it is paid off — and grows bolder each time.',
    prep: { resource: 'stone', amount: 45 },
    strike: {
      threat: {
        name: 'The Storm Stalker',
        icon: '🐺',
        description: 'It came in with the Storm and it is not leaving hungry.',
        interval: 60,
        appease: { plank: 15 },
        strike: { stockLoss: { berry: 8, root: 8, meat: 8 }, hostility: 2 },
      },
    },
  },
  {
    id: 'longNight',
    name: 'The Long Night',
    icon: '🌑',
    minHostility: 18,
    weight: 3,
    warning:
      "The longest night of the year falls with the Storm: the hearth's warm ring will pull in to half its reach, not 70%, and homes beyond every fire will freeze.",
    prep: { resource: 'wood', amount: 70 },
    strike: {
      condition: {
        name: 'The Long Night',
        icon: '🌑',
        description: `The dark presses on the hearth: its warm ring pulls in to half its reach until the Storm passes, or until ${LONG_NIGHT_BRAZIERS} more braziers are lit against it.`,
        resolveBy: { kind: 'buildingId', buildingId: 'brazier', amount: LONG_NIGHT_BRAZIERS },
        whileActive: [{ kind: 'hearthReach', percent: LONG_NIGHT_REACH_PERCENT }],
        passesWithStorm: true,
      },
    },
  },
  {
    id: 'blackFrost',
    name: 'Black Frost',
    icon: '❄️',
    minHostility: 40,
    weight: 3,
    warning: 'A killing frost rides the Storm: it takes two villagers, and the hearth burns 50% more wood until it passes.',
    prep: { resource: 'plank', amount: 50 },
    strike: {
      villagerLoss: 2,
      condition: {
        name: 'Killing Frost',
        icon: '❄️',
        description: 'The frost bites: the hearth burns 50% more wood until the Storm passes, or until 40 more wood is cut to stoke it.',
        resolveBy: { kind: 'produced', resource: 'wood', amount: 40 },
        whileActive: [{ kind: 'hearthFuel', percent: 50 }],
        passesWithStorm: true,
      },
    },
  },
]

export const STORM_BLIGHTS: Record<string, StormBlightDef> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
)

export const STORM_BLIGHT_LIST = defs
