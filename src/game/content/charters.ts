import type { CharterDef } from '../types'

/**
 * The Queen's charter, granted once at a mid-run reputation milestone. The
 * offer draws one charter from each family, so the decision is between a
 * run-shaping perk, breathing room with the Queen, and a guaranteed blueprint.
 */
const defs: CharterDef[] = [
  // ---- run-shaping perks ----------------------------------------------------
  {
    id: 'hearthguardCharter',
    name: 'Charter of the Hearthguard',
    icon: '🛡️',
    family: 'perk',
    description: '+4 resolve for every species, and hostility grows 15% slower.',
    effects: [
      { kind: 'resolveFlat', species: 'all', amount: 4 },
      { kind: 'hostilityRate', percent: -15 },
    ],
  },
  {
    id: 'wildwardenCharter',
    name: 'Charter of the Wildwardens',
    icon: '🌲',
    family: 'perk',
    description: 'Glades clear 30% faster, yield 25% more loot, and anger the forest half as much.',
    effects: [
      { kind: 'clearSpeed', percent: 30 },
      { kind: 'gladeLoot', percent: 25 },
      { kind: 'gladeHostility', percent: -50 },
    ],
  },
  {
    id: 'guildCharter',
    name: 'Charter of the Guilds',
    icon: '⚙️',
    family: 'perk',
    description: 'Every workshop and camp works 15% faster, and builders 20% faster.',
    effects: [
      { kind: 'productionSpeed', tag: 'all', percent: 15 },
      { kind: 'buildSpeed', percent: 20 },
    ],
  },
  {
    id: 'heraldsCharter',
    name: "Herald's Charter",
    icon: '📯',
    family: 'perk',
    description: 'Reputation from contented villagers flows 20% faster.',
    effects: [{ kind: 'reputationRate', percent: 20 }],
  },
  // ---- patience ------------------------------------------------------------
  {
    id: 'royalIndulgence',
    name: 'Royal Indulgence',
    icon: '👑',
    family: 'patience',
    description: "The Queen's patience ceiling rises by 4.",
    maxImpatience: 4,
  },
  {
    id: 'patientCrown',
    name: 'The Patient Crown',
    icon: '⏳',
    family: 'patience',
    description: 'Forgives 3 impatience now, and her patience frays 20% slower.',
    impatienceRelief: 3,
    effects: [{ kind: 'impatienceRate', percent: -20 }],
  },
  // ---- blueprints ----------------------------------------------------------
  {
    id: 'architectsWarrant',
    name: "Royal Architect's Warrant",
    icon: '📐',
    family: 'blueprint',
    description: 'Unlocks a blueprint your settlement needs, with its building materials delivered.',
    grantsBlueprint: true,
  },
]

export const CHARTERS: Record<string, CharterDef> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
)

export const CHARTER_LIST = defs
