import type { GladeEventDef } from '../types'

/**
 * Glade events fire the moment a dangerous or forbidden glade finishes
 * clearing. Options are resolved by `engine/events.ts`; anything the player
 * cannot afford is shown but disabled.
 */
const defs: GladeEventDef[] = [
  // ---- dangerous glades ----------------------------------------------------
  {
    id: 'rainDrenchedCache',
    name: 'Rain-Drenched Cache',
    icon: '🎁',
    kind: 'dangerous',
    description:
      'A trader’s cart, half-swallowed by mud. The crates are sound, but prying them open will take tools — or a lot of patience.',
    options: [
      {
        label: 'Force the crates',
        description: 'Spend 2 tools for the full haul.',
        requires: { tool: 2 },
        cost: { tool: 2 },
        gain: { plank: 20, fabric: 10, amber: 30 },
      },
      {
        label: 'Salvage by hand',
        description: 'Take what comes loose.',
        gain: { plank: 8, wood: 10 },
      },
      {
        label: 'Leave it to the forest',
        description: 'The woods appreciate restraint.',
        hostility: -8,
      },
    ],
  },
  {
    id: 'drownedShrine',
    name: 'Drowned Shrine',
    icon: '⛩️',
    kind: 'dangerous',
    description:
      'An old shrine to a name nobody remembers, still burning somehow. Your villagers have already started leaving offerings.',
    options: [
      {
        label: 'Make an offering',
        description: 'Give 10 food. The settlement takes heart.',
        requires: { berry: 10 },
        cost: { berry: 10 },
        reputation: 1,
      },
      {
        label: 'Strip it for materials',
        description: 'Good stone, angry forest.',
        gain: { stone: 24, incense: 6 },
        hostility: 10,
      },
      { label: 'Board it up', description: 'Nothing gained, nothing lost.' },
    ],
  },
  {
    id: 'blightTouchedGrove',
    name: 'Blight-Touched Grove',
    icon: '🌫️',
    kind: 'dangerous',
    description:
      'The trees here weep something black. It is spreading, slowly, toward the hearth.',
    options: [
      {
        label: 'Burn it out',
        description: 'Spend 15 wood to cleanse the grove.',
        requires: { wood: 15 },
        cost: { wood: 15 },
        hostility: -12,
      },
      {
        label: 'Harvest the blight-resin',
        description: 'Valuable. Also a very bad idea.',
        gain: { resin: 14, amber: 20 },
        hostility: 14,
      },
      {
        label: 'Wall it off and move on',
        description: 'The Queen dislikes half-measures.',
        impatience: 1,
      },
    ],
  },
  {
    id: 'stragglersCamp',
    name: "Stragglers' Camp",
    icon: '🏕️',
    kind: 'dangerous',
    description:
      'Survivors from a settlement that did not make it. They are hungry, exhausted, and willing to work.',
    options: [
      {
        label: 'Feed and welcome them',
        description: 'Spend 12 food; three villagers join you.',
        requires: { berry: 12 },
        cost: { berry: 12 },
        gain: { amber: 5 },
        reputation: 1,
      },
      {
        label: 'Trade for their supplies',
        description: 'Buy them out and send them on.',
        cost: { amber: 25 },
        requires: { amber: 25 },
        gain: { plank: 12, fabric: 6, tool: 2 },
      },
      {
        label: 'Turn them away',
        description: 'Word gets back to the Citadel.',
        impatience: 2,
      },
    ],
  },
  {
    id: 'humsOfTheDeep',
    name: 'Hums of the Deep',
    icon: '🎶',
    kind: 'dangerous',
    description:
      'Something under the roots is singing. Two of your villagers have not blinked in a while.',
    options: [
      {
        label: 'Silence it with iron',
        description: 'Spend 3 tools. The humming stops.',
        requires: { tool: 3 },
        cost: { tool: 3 },
        hostility: -10,
      },
      {
        label: 'Listen closely',
        description: 'You learn something. It costs you someone.',
        gain: { scroll: 8, amber: 25 },
        villagerLoss: 1,
      },
      {
        label: 'Retreat from the glade',
        description: 'Hostility climbs.',
        hostility: 8,
      },
    ],
  },

  // ---- forbidden glades ---------------------------------------------------
  {
    id: 'ancientVault',
    name: 'Ancient Vault',
    icon: '🗝️',
    kind: 'forbidden',
    description:
      'A sealed vault from before the Storms. The mechanism is intact — and so is whatever is inside.',
    options: [
      {
        label: 'Pick the lock',
        description: 'Spend 4 parts. The vault opens cleanly.',
        requires: { part: 4 },
        cost: { part: 4 },
        gain: { tool: 8, copperBar: 12, amber: 60 },
        reputation: 2,
      },
      {
        label: 'Break it open',
        description: 'Loud, messy, and the forest notices.',
        gain: { copperBar: 8, amber: 30 },
        hostility: 18,
      },
      {
        label: 'Report it and reseal it',
        description: 'The Queen prefers her secrets kept.',
        reputation: 1,
        impatience: 1,
      },
    ],
  },
  {
    id: 'stormBeast',
    name: 'Storm Beast',
    icon: '🐺',
    kind: 'forbidden',
    description:
      'It has been watching the settlement for two seasons. Tonight it came closer.',
    options: [
      {
        label: 'Arm the hunters',
        description: 'Spend 4 training gear and 10 meat to drive it off.',
        requires: { trainingGear: 4, meat: 10 },
        cost: { trainingGear: 4, meat: 10 },
        hostility: -20,
        reputation: 2,
      },
      {
        label: 'Feed it',
        description: 'Buys peace with 30 food. It will be back.',
        requires: { skewer: 10, meat: 20 },
        cost: { skewer: 10, meat: 20 },
        hostility: -8,
      },
      {
        label: 'Bar the doors and pray',
        description: 'It takes two villagers and leaves.',
        villagerLoss: 2,
        hostility: 6,
      },
    ],
  },
  {
    id: 'sunkenLibrary',
    name: 'Sunken Library',
    icon: '📚',
    kind: 'forbidden',
    description:
      'Shelves upon shelves, mostly ruined. The dry pages are worth more than amber to the right buyer.',
    options: [
      {
        label: 'Catalogue it properly',
        description: 'Spend 6 scrolls of your own to preserve the collection.',
        requires: { scroll: 6 },
        cost: { scroll: 6 },
        gain: { scroll: 20, amber: 50 },
        reputation: 2,
      },
      {
        label: 'Take what is dry',
        description: 'Quick, and only a little wasteful.',
        gain: { scroll: 10, fabric: 8 },
      },
      {
        label: 'Burn it for warmth',
        description: 'Nobody in the settlement will forget this.',
        gain: { wood: 30 },
        hostility: 12,
        impatience: 2,
      },
    ],
  },
]

export const GLADE_EVENTS: Record<string, GladeEventDef> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
)

export const GLADE_EVENT_LIST = defs

export function eventsOfKind(kind: 'dangerous' | 'forbidden'): GladeEventDef[] {
  return defs.filter((d) => d.kind === kind)
}
