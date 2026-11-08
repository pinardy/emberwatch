import type { GladeEventDef } from '../types'

/**
 * Glade events fire the moment a dangerous or forbidden glade finishes
 * clearing. Options are resolved by `engine/glades.ts`; anything the player
 * cannot afford is shown but disabled.
 *
 * Design invariants the engine and the balance bot rely on:
 *  - The last option of every event never has a `requires` or `foodCost`, so
 *    an event can always be resolved.
 *  - "Food" prices use `foodCost`, which accepts any edible stock, never a
 *    specific resource such as `berry`.
 *  - `threat` options are the greedy path: better loot now, a menace that
 *    strikes on a timer until it is appeased.
 *  - `ongoing` options trade an immediate cost for a run-long effect.
 *  - `condition` options take a gain now and leave a lingering aftermath that
 *    lifts only when a build-loop goal is met (sometimes against a deadline).
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
        foodCost: 10,
        reputation: 1,
      },
      {
        label: 'Strip it for materials',
        description: 'Good stone, angry forest.',
        gain: { stone: 24, incense: 6 },
        hostility: 10,
      },
      {
        label: 'Bargain with the spirit',
        description: 'It lets you take the offering bowl, if you promise incense in return.',
        gain: { amber: 30, stone: 10 },
        condition: {
          name: "The Spirit's Tribute",
          icon: '🕯️',
          description: 'Deliver 10 incense within 3 minutes, or hostility +15.',
          resolveBy: { kind: 'stock', resource: 'incense', amount: 10 },
          consume: true,
          deadline: 180,
          onResolve: { hostility: -5 },
          onFail: { hostility: 15 },
        },
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
        label: 'Let it run its course',
        description: 'Take the dead wood. The blight follows you home, until villagers have somewhere to gather.',
        gain: { wood: 18, resin: 6 },
        condition: {
          name: 'Spreading Blight',
          icon: '🌫️',
          description: '−3 resolve for every species until a new service building stands.',
          resolveBy: { kind: 'buildingsOfCategory', category: 'service', amount: 1 },
          whileActive: [{ kind: 'resolveFlat', species: 'all', amount: -3 }],
        },
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
        foodCost: 12,
        gain: { amber: 5 },
        reputation: 1,
        villagerGain: 3,
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
  {
    id: 'howlingDen',
    name: 'Howling Den',
    icon: '🐺',
    kind: 'dangerous',
    description:
      'A den of storm-wolves, lean and patient. They have smelled the larders, and they are not afraid of you.',
    options: [
      {
        label: 'Cull the pack now',
        description: 'Spend 8 meat and 2 training gear to end it before it starts.',
        requires: { meat: 8, trainingGear: 2 },
        cost: { meat: 8, trainingGear: 2 },
        hostility: -6,
        reputation: 1,
      },
      {
        label: 'Loot the bone-pile',
        description: 'Rich pickings — and the pack follows you home.',
        gain: { meat: 12, amber: 25, resin: 6 },
        threat: {
          name: 'The Wolf Pack',
          icon: '🐺',
          description: 'Storm-wolves raid the larders until they are driven off.',
          interval: 75,
          appease: { meat: 12 },
          strike: { stockLoss: { berry: 6, meat: 6 }, hostility: 3 },
        },
      },
      {
        label: 'Back away slowly',
        description: 'The forest keeps its wolves; the wolves keep their glade.',
        hostility: 5,
      },
    ],
  },
  {
    id: 'blightedWell',
    name: 'Blighted Well',
    icon: '🕳️',
    kind: 'dangerous',
    description:
      'A stone well, water black as tar. Whatever fell in has been waiting a long time for a bucket to come down.',
    options: [
      {
        label: 'Purify it with herbs',
        description: 'Spend 10 herbs. Clean water for the district.',
        requires: { herb: 10 },
        cost: { herb: 10 },
        reputation: 1,
        hostility: -6,
      },
      {
        label: 'Draw from it anyway',
        description: 'Free clay and amber below the waterline. Something stirs.',
        gain: { clay: 16, amber: 20 },
        threat: {
          name: 'Well Sickness',
          icon: '🤢',
          description: 'A creeping malaise; villagers eat more and gain less.',
          interval: 90,
          appease: { herb: 8 },
          strike: { stockLoss: { berry: 8 } },
          whileActive: [{ kind: 'foodUpkeep', percent: 15 }],
        },
      },
      { label: 'Cap the well', description: 'Some water is better left dark.' },
    ],
  },
  {
    id: 'leaningWatchtower',
    name: 'Leaning Watchtower',
    icon: '🗼',
    kind: 'dangerous',
    description:
      'A pre-Storm watchtower, tilted but standing. From the top you can see every glade on the map — and everything that moves between them.',
    options: [
      {
        label: 'Shore it up',
        description: 'Spend 10 planks. A manned tower calms the woods for good.',
        requires: { plank: 10 },
        cost: { plank: 10 },
        ongoing: {
          name: 'Watchful Eyes',
          icon: '🗼',
          description: 'Hostility rises 10% more slowly for the rest of the run.',
          effects: [{ kind: 'hostilityRate', percent: -10 }],
        },
      },
      {
        label: 'Strip it for stone',
        description: 'The masonry is excellent. The view is lost.',
        gain: { stone: 20, part: 2 },
      },
      { label: 'Leave it to lean', description: 'It has stood this long.' },
    ],
  },
  {
    id: 'abandonedApiary',
    name: 'Abandoned Apiary',
    icon: '🐝',
    kind: 'dangerous',
    description:
      'Rows of hives gone feral. The bees are enormous, ill-tempered, and — a farmhand swears — trainable.',
    options: [
      {
        label: 'Tame the hives',
        description: 'Spend 6 fabric on keeper veils. The farms will never be the same.',
        requires: { fabric: 6 },
        cost: { fabric: 6 },
        ongoing: {
          name: 'Feral Pollinators',
          icon: '🐝',
          description: 'Farms have a 15% chance of doubled output for the rest of the run.',
          effects: [{ kind: 'extraOutput', tag: 'farming', chance: 0.15 }],
        },
      },
      {
        label: 'Raid the honey',
        description: 'Sweet, sticky, and briefly very painful.',
        gain: { berry: 18, amber: 15 },
        hostility: 6,
      },
      { label: 'Give the bees a wide berth', description: 'Sensible.' },
    ],
  },
  {
    id: 'sunkenGranary',
    name: 'Sunken Granary',
    icon: '🌾',
    kind: 'dangerous',
    description:
      'A granary swallowed by the marsh, roof just above the waterline. Most of the grain is spoiled. Most.',
    options: [
      {
        label: 'Drain and excavate',
        description: 'Spend 8 planks shoring the dig for the full store.',
        requires: { plank: 8 },
        cost: { plank: 8 },
        gain: { grain: 25, vegetable: 10, root: 10 },
      },
      {
        label: 'Skim the surface',
        description: 'Take what floats.',
        gain: { grain: 10, mushroom: 6 },
      },
      {
        label: 'Breach the dyke',
        description: 'The whole store floats free — and so does the marsh, right up the settlement paths.',
        gain: { grain: 28, vegetable: 10, root: 8 },
        condition: {
          name: 'Flooded Paths',
          icon: '🌊',
          description: 'Construction is 25% slower until 20 planks are laid as duckboards.',
          resolveBy: { kind: 'stock', resource: 'plank', amount: 20 },
          consume: true,
          whileActive: [{ kind: 'buildSpeed', percent: -25 }],
        },
      },
      {
        label: 'Let the marsh keep it',
        description: 'The forest notes your restraint.',
        hostility: -5,
      },
    ],
  },
  {
    id: 'wanderingMinstrel',
    name: 'Wandering Minstrel',
    icon: '🪕',
    kind: 'dangerous',
    description:
      'A minstrel sheltering under a deadfall, lute miraculously dry. She knows every song the Citadel has banned, and a few it has not heard yet.',
    options: [
      {
        label: 'Offer her a place by the hearth',
        description: 'Pay 20 amber. Her songs stay for the rest of the run.',
        requires: { amber: 20 },
        cost: { amber: 20 },
        ongoing: {
          name: 'Songs of the Road',
          icon: '🪕',
          description: '+2 resolve for every species for the rest of the run.',
          effects: [{ kind: 'resolveFlat', species: 'all', amount: 2 }],
        },
      },
      {
        label: 'Trade rations for a ballad',
        description: 'Spend 6 food; the settlement talks about it for a season.',
        foodCost: 6,
        reputation: 1,
      },
      { label: 'Wish her a dry road', description: 'She bows, and is gone.' },
    ],
  },
  {
    id: 'queensSurveyors',
    name: "Queen's Surveyors",
    icon: '🗺️',
    kind: 'dangerous',
    description:
      'A survey party from the Citadel, weeks overdue and living on boiled bark. Their maps of your progress will land on the Queen’s own desk.',
    options: [
      {
        label: 'Host them properly',
        description: 'Spend 10 food and 5 ale. Their report glows.',
        foodCost: 10,
        requires: { ale: 5 },
        cost: { ale: 5 },
        impatience: -2,
      },
      {
        label: 'Feed them and send them on',
        description: 'Spend 8 food. A fair report.',
        foodCost: 8,
        impatience: -1,
      },
      {
        label: 'Promise them a frontier to map',
        description: 'Their report could make your name — if there is new land to report.',
        condition: {
          name: "The Surveyors' Wager",
          icon: '🗺️',
          description: 'Clear 2 more glades within 5 minutes: +2 reputation. Fail: +1 impatience.',
          resolveBy: { kind: 'gladesCleared', amount: 2 },
          deadline: 300,
          onResolve: { reputation: 2 },
          onFail: { impatience: 1 },
        },
      },
      {
        label: 'Claim you never saw them',
        description: 'They will find their own way back. Eventually.',
        hostility: 4,
      },
    ],
  },
  {
    id: 'lostChildren',
    name: 'Lost Children',
    icon: '🏮',
    kind: 'dangerous',
    description:
      'Two children with one lantern between them, walking the wrong way with great conviction. They are from a settlement that no longer answers.',
    options: [
      {
        label: 'Take them in',
        description: 'Spend 8 food. Two more mouths — and two more pairs of hands, in time.',
        foodCost: 8,
        villagerGain: 2,
        reputation: 1,
      },
      {
        label: 'Send them to the Citadel',
        description: 'Pay 15 amber for an escort. The Queen hears of it.',
        requires: { amber: 15 },
        cost: { amber: 15 },
        impatience: -1,
      },
      {
        label: 'Point them down the road',
        description: 'The lantern bobs away into the rain.',
        impatience: 1,
      },
    ],
  },
  {
    id: 'thunderstruckOak',
    name: 'Thunderstruck Oak',
    icon: '🌳',
    kind: 'dangerous',
    description:
      'An oak split rootside-to-crown by storm-lightning, still smoking. The heartwood is seasoned better than any kiln could manage.',
    options: [
      {
        label: 'Fell and cart the lot',
        description: 'A windfall, literally.',
        gain: { wood: 30, resin: 8 },
        hostility: 6,
      },
      {
        label: 'Take only the fallen half',
        description: 'The forest watches you leave the living wood.',
        gain: { wood: 14 },
      },
      {
        label: 'Leave it as a warning',
        description: 'Even the trees fear the Storm. Hostility eases.',
        hostility: -7,
      },
    ],
  },
  {
    id: 'moulderingCellar',
    name: 'Mouldering Cellar',
    icon: '🍄',
    kind: 'dangerous',
    description:
      'A root cellar from before the Storms, door swollen shut. The smell through the cracks is either excellent cheese or something far worse.',
    options: [
      {
        label: 'Break the door with tools',
        description: 'Spend 1 tool. Shelves of preserves, mostly intact.',
        requires: { tool: 1 },
        cost: { tool: 1 },
        gain: { pickles: 10, mushroom: 12, herb: 6 },
      },
      {
        label: 'Pry it open bare-handed',
        description: 'Slow, and the spores get everywhere.',
        gain: { mushroom: 10 },
        hostility: 4,
      },
      { label: 'Brick it shut', description: 'Some doors are swollen for a reason.' },
    ],
  },
  {
    id: 'stormTornCaravan',
    name: 'Storm-Torn Caravan',
    icon: '🛞',
    kind: 'dangerous',
    description:
      'A trade caravan caught by last season’s Storm. The drivers are gone; the oxen, remarkably, are not. Cargo is scattered across half the glade.',
    options: [
      {
        label: 'Mount a proper salvage',
        description: 'Spend 6 planks on sledges to haul everything home.',
        requires: { plank: 6 },
        cost: { plank: 6 },
        gain: { fabric: 10, tool: 2, amber: 35 },
      },
      {
        label: 'Grab what one trip carries',
        description: 'Quick and quiet.',
        gain: { fabric: 5, amber: 15 },
      },
      {
        label: 'Sign for the cargo on credit',
        description: 'The guild’s factor will want paying — promptly.',
        gain: { fabric: 10, tool: 2, plank: 10 },
        condition: {
          name: "Merchant's Debt",
          icon: '📜',
          description: 'Hold 60 amber within 4 minutes to settle the debt, or the Queen hears of it (+2 impatience).',
          resolveBy: { kind: 'stock', resource: 'amber', amount: 60 },
          consume: true,
          deadline: 240,
          onFail: { impatience: 2 },
        },
      },
      {
        label: 'Report the loss to the Citadel',
        description: 'Honest, and the Queen appreciates honesty. Slightly.',
        impatience: -1,
        hostility: 3,
      },
    ],
  },
  {
    id: 'ratKingsCourt',
    name: "Rat King's Court",
    icon: '🐀',
    kind: 'dangerous',
    description:
      'The glade’s dead hollow tree is a palace of rats — thousands, moving as one, wearing (a forager insists) tiny crowns of woven grass.',
    options: [
      {
        label: 'Smoke out the court',
        description: 'Spend 10 wood. The hollow yields its hoard.',
        requires: { wood: 10 },
        cost: { wood: 10 },
        gain: { grain: 15, amber: 20, scroll: 3 },
        hostility: 5,
      },
      {
        label: 'Leave tribute',
        description: 'Spend 8 grain. The rats stay out of your granaries — all season.',
        requires: { grain: 8 },
        cost: { grain: 8 },
        ongoing: {
          name: "Rat King's Favour",
          icon: '🐀',
          description: 'Villagers eat 8% less — the rats no longer skim the stores.',
          effects: [{ kind: 'foodUpkeep', percent: -8 }],
        },
      },
      {
        label: 'Raid the hoard while they sleep',
        description: 'The court wakes up hungry, and follows you home.',
        gain: { grain: 15, amber: 20 },
        condition: {
          name: 'Rats in the Stores',
          icon: '🐀',
          description: 'Villagers eat 15% more until a new Warehouse is built to seal the grain.',
          resolveBy: { kind: 'buildingId', buildingId: 'warehouse', amount: 1 },
          whileActive: [{ kind: 'foodUpkeep', percent: 15 }],
        },
      },
      { label: 'Pretend you saw nothing', description: 'The crowns watch you go.' },
    ],
  },
  {
    id: 'wardstoneCircle',
    name: 'Wardstone Circle',
    icon: '🪨',
    kind: 'dangerous',
    description:
      'Seven standing stones in a ring, humming faintly. The carvings are Citadel work — a forgotten ward against the forest, missing only its keystone.',
    options: [
      {
        label: 'Restore the keystone',
        description: 'Spend 12 stone and 4 bricks to close the circle.',
        requires: { stone: 12, brick: 4 },
        cost: { stone: 12, brick: 4 },
        ongoing: {
          name: 'The Old Ward',
          icon: '🪨',
          description: 'Hostility rises 15% more slowly for the rest of the run.',
          effects: [{ kind: 'hostilityRate', percent: -15 }],
        },
      },
      {
        label: 'Quarry the stones',
        description: 'Cut stone is cut stone. The hum stops mid-note.',
        gain: { stone: 28 },
        hostility: 12,
      },
      { label: 'Leave the circle broken', description: 'It has failed once already.' },
    ],
  },

  {
    id: 'fogboundFerry',
    name: 'Fogbound Ferry',
    icon: '⛴️',
    kind: 'dangerous',
    description:
      'A flat ferry on a black river nobody mapped, and a ferryman who will not give his name. He says he can bring travellers to your door — for a price.',
    options: [
      {
        label: 'Pay the ferryman',
        description: 'Spend 20 amber. He keeps a crossing open for the rest of the run.',
        requires: { amber: 20 },
        cost: { amber: 20 },
        ongoing: {
          name: 'The Ferry Crossing',
          icon: '⛴️',
          description: 'Newcomers arrive 15% sooner for the rest of the run.',
          effects: [{ kind: 'newcomerRate', percent: -15 }],
        },
      },
      {
        label: 'Break up the ferry for planks',
        description: 'Good seasoned timber. The river remembers.',
        gain: { plank: 14, wood: 6 },
        hostility: 5,
      },
      { label: 'Wave him off', description: 'He poles away into the fog without a word.' },
    ],
  },
  {
    id: 'emberMoths',
    name: 'Ember Moths',
    icon: '🦋',
    kind: 'dangerous',
    description:
      'A cloud of moths with wings like banked coals. They roost in anything warm — a fire bowl, a chimney, a sleeping villager’s hair.',
    options: [
      {
        label: 'Lure them into the braziers',
        description: 'Spend 12 wood on a trail of embers. Moth-warmed braziers need far less wood.',
        requires: { wood: 12 },
        cost: { wood: 12 },
        ongoing: {
          name: 'Moth-Lit Braziers',
          icon: '🦋',
          description: 'Braziers burn 40% less wood for the rest of the run.',
          effects: [{ kind: 'brazierFuel', percent: -40 }],
        },
      },
      {
        label: 'Net them for lamp oil',
        description: 'Glowing resin and a little amber. The forest notices the empty air.',
        gain: { resin: 10, amber: 12 },
        hostility: 4,
      },
      { label: 'Let them drift on', description: 'They go looking for a warmer fire.' },
    ],
  },
  {
    id: 'hermitsGarden',
    name: "Hermit's Garden",
    icon: '🧓',
    kind: 'dangerous',
    description:
      'Neat rows of herbs behind a wall of thorn, and an old hermit who has outlived three viceroys. He is lonely, though he would never say so.',
    options: [
      {
        label: 'Trade for his cuttings',
        description: 'Pay 15 amber for a basket of herbs and roots.',
        requires: { amber: 15 },
        cost: { amber: 15 },
        gain: { herb: 12, root: 10 },
      },
      {
        label: 'Invite him to the hearth',
        description: 'Spend 6 food on a proper welcome. He brings his seeds — and himself.',
        foodCost: 6,
        gain: { herb: 8, vegetable: 6 },
        villagerGain: 1,
        reputation: 1,
      },
      { label: 'Leave him his peace', description: 'He waves, once, without looking up.' },
    ],
  },
  {
    id: 'collapsedMine',
    name: 'Collapsed Mine',
    icon: '⛏️',
    kind: 'dangerous',
    description:
      'A pre-Storm copper mine, its mouth half-fallen. Somebody is tapping on the rock from the inside — slow, patient, in threes.',
    options: [
      {
        label: 'Shore it up and dig them out',
        description: 'Spend 8 planks. Two hardy miners join the settlement.',
        requires: { plank: 8 },
        cost: { plank: 8 },
        villagerGain: 2,
        reputation: 1,
      },
      {
        label: 'Take the ore cart and go',
        description: 'A full cart at the entrance. The tapping turns to scratching, and follows you.',
        gain: { copperOre: 16, stone: 10, amber: 15 },
        threat: {
          name: 'Things in the Shaft',
          icon: '🕳️',
          description: 'Something climbs out of the old workings at night and raids the stockpile.',
          interval: 80,
          appease: { plank: 12 },
          strike: { stockLoss: { stone: 6, copperOre: 4 }, hostility: 3 },
        },
      },
      {
        label: 'Seal the entrance',
        description: 'The tapping stops. The forest heard it stop.',
        hostility: 4,
      },
    ],
  },
  {
    id: 'mirrorPool',
    name: 'Mirror Pool',
    icon: '🪞',
    kind: 'dangerous',
    description:
      'A pool so still it reflects tomorrow. The villagers who looked swear they saw the Queen’s next letter, word for word.',
    options: [
      {
        label: 'Leave an offering of amber',
        description: 'Spend 25 amber. The pool keeps showing you what the Queen will ask.',
        requires: { amber: 25 },
        cost: { amber: 25 },
        reputation: 1,
        ongoing: {
          name: 'Foresight',
          icon: '🪞',
          description: 'Royal decrees allow 25% more time for the rest of the run.',
          effects: [{ kind: 'decreeTime', percent: 25 }],
        },
      },
      {
        label: 'Drink from it',
        description:
          'Clarity, and a scroll’s worth of visions — but nobody sleeps well until they have more room to breathe.',
        gain: { scroll: 6, amber: 15 },
        condition: {
          name: 'Restless Dreams',
          icon: '🌙',
          description: '−2 resolve for every species until two more homes are built.',
          resolveBy: { kind: 'buildingsOfCategory', category: 'housing', amount: 2 },
          whileActive: [{ kind: 'resolveFlat', species: 'all', amount: -2 }],
        },
      },
      { label: 'Throw a stone in', description: 'Tomorrow ripples, and is gone.' },
    ],
  },
  {
    id: 'lostCourier',
    name: "The Queen's Lost Courier",
    icon: '📨',
    kind: 'dangerous',
    description:
      'A royal courier, tangled in bramble and half out of his wits, still clutching a satchel sealed with the Queen’s own wax.',
    options: [
      {
        label: 'Nurse him back to health',
        description: 'Spend 6 food. He rides home singing your praises.',
        foodCost: 6,
        impatience: -1,
      },
      {
        label: 'Read the dispatches first',
        description: 'Amber and secrets — and now the Queen expects news of the frontier.',
        gain: { amber: 25, scroll: 3 },
        condition: {
          name: 'Broken Seals',
          icon: '📨',
          description:
            'The dispatches ask after the frontier: clear 1 more glade within 4 minutes to impress the Queen (+1 reputation), or she hears of the broken seals (+2 impatience).',
          resolveBy: { kind: 'gladesCleared', amount: 1 },
          deadline: 240,
          onResolve: { reputation: 1 },
          onFail: { impatience: 2 },
        },
      },
      {
        label: 'Point him toward the Citadel',
        description: 'He wanders off in roughly the right direction.',
        hostility: 2,
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
        foodCost: 30,
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
  {
    id: 'sleepingTitan',
    name: 'Sleeping Titan',
    icon: '⛰️',
    kind: 'forbidden',
    description:
      'What you took for a hillside has a heartbeat. Moss-covered shoulders rise and fall, slow as seasons. Your clearing crew is standing on its hand.',
    options: [
      {
        label: 'Withdraw on tiptoe',
        description: 'Spend 20 stone walling off the glade. Nobody speaks of it again.',
        requires: { stone: 20 },
        cost: { stone: 20 },
        hostility: -10,
      },
      {
        label: 'Mine the mineral crust',
        description: 'Its back is one long copper seam. It will notice.',
        gain: { copperOre: 20, copperBar: 6, amber: 40 },
        threat: {
          name: 'The Waking Titan',
          icon: '⛰️',
          description: 'It stirs. Every tremor shakes the whole map.',
          interval: 80,
          appease: { stone: 20, amber: 30 },
          strike: { hostility: 8 },
          whileActive: [{ kind: 'hostilityRate', percent: 25 }],
        },
      },
      {
        label: 'Leave, and quickly',
        description: 'The glade stays cleared. Your dreams do not.',
        hostility: 6,
      },
    ],
  },
  {
    id: 'echoingCatacombs',
    name: 'Echoing Catacombs',
    icon: '🕯️',
    kind: 'forbidden',
    description:
      'Stairs spiral down into pre-Storm dark. The dead of an older settlement lie here — with everything they were buried with.',
    options: [
      {
        label: 'Excavate with reverence',
        description: 'Spend 8 incense laying each chamber to rest as you go.',
        requires: { incense: 8 },
        cost: { incense: 8 },
        gain: { amber: 50, scroll: 8, copperBar: 6 },
        reputation: 1,
      },
      {
        label: 'Strip the tombs',
        description: 'The dead object.',
        gain: { amber: 60, tool: 4 },
        threat: {
          name: 'The Restless Dead',
          icon: '💀',
          description: 'They walk the settlement at night. Nobody sleeps well.',
          interval: 70,
          appease: { amber: 35 },
          strike: { impatience: 0.5, hostility: 4 },
          whileActive: [{ kind: 'resolveFlat', species: 'all', amount: -3 }],
        },
      },
      {
        label: 'Seal the stairway',
        description: 'Stone over dark. Done.',
      },
    ],
  },
  {
    id: 'stormheartGrove',
    name: 'Stormheart Grove',
    icon: '🌩️',
    kind: 'forbidden',
    description:
      'A stand of trees that drink the lightning. Their roots keep the soil warm through the worst of the Blightstorm — farmers would kill for ground like this.',
    options: [
      {
        label: 'Transplant the saplings',
        description: 'Spend 4 tools and 10 planks. Your farms learn to love the Storm.',
        requires: { tool: 4, plank: 10 },
        cost: { tool: 4, plank: 10 },
        ongoing: {
          name: 'Stormheart Saplings',
          icon: '🌩️',
          description: 'Farms keep working at 30% speed during the Storm.',
          effects: [{ kind: 'farmsInStorm', percent: 30 }],
        },
      },
      {
        label: 'Fell the grove',
        description: 'The wood sings when you cut it. The forest screams.',
        gain: { wood: 26, resin: 10, amber: 25 },
        hostility: 15,
      },
      {
        label: 'Fence it off',
        description: 'Some ground is not yours to farm.',
        hostility: -6,
      },
    ],
  },
  {
    id: 'abandonedForge',
    name: 'Abandoned Forge',
    icon: '🔥',
    kind: 'forbidden',
    description:
      'A forge of the old empire, chimney still warm after a century. The anvil is a single piece of storm-iron. It remembers being used.',
    options: [
      {
        label: 'Relight the great furnace',
        description: 'Spend 12 bricks and 10 wood. Your smiths inherit a masterwork.',
        requires: { brick: 12, wood: 10 },
        cost: { brick: 12, wood: 10 },
        ongoing: {
          name: 'The Old Forge',
          icon: '⚒️',
          description: 'Smithing and crafting are 20% faster for the rest of the run.',
          effects: [
            { kind: 'productionSpeed', tag: 'smithing', percent: 20 },
            { kind: 'productionSpeed', tag: 'crafting', percent: 20 },
          ],
        },
      },
      {
        label: 'Haul away the fittings',
        description: 'Tools, stock, and the small anvil. The great one stays.',
        gain: { tool: 6, copperBar: 8, part: 4 },
      },
      {
        label: 'Let it cool',
        description: 'A century warm; it can wait another.',
      },
    ],
  },
  {
    id: 'starfallCrater',
    name: 'Starfall Crater',
    icon: '☄️',
    kind: 'forbidden',
    description:
      'Something fell here long before the Storms, and the forest has never grown back over it. The metal in the crater floor matches nothing in your assay books.',
    options: [
      {
        label: 'Assay it properly',
        description: 'Spend 5 scrolls cross-referencing the old surveys.',
        requires: { scroll: 5 },
        cost: { scroll: 5 },
        gain: { copperBar: 10, part: 6, amber: 45 },
        reputation: 2,
      },
      {
        label: 'Dig first, ask later',
        description: 'Whatever it is, it is heavy and it is yours.',
        gain: { copperOre: 16, amber: 25 },
        hostility: 10,
      },
      {
        label: 'Mark it on the map and move on',
        description: 'A mystery for the next viceroy.',
        impatience: 1,
      },
    ],
  },
  {
    id: 'drownedBellTower',
    name: 'Drowned Bell Tower',
    icon: '🔔',
    kind: 'forbidden',
    description:
      'A bell tower standing to its shoulders in a flooded hollow. Every Storm, the bell tolls by itself, and the settlement hears it in their sleep.',
    options: [
      {
        label: 'Raise the bell',
        description:
          'Spend 8 copper bars and 10 planks on a frame. Its toll steadies everyone through the Storm.',
        requires: { copperBar: 8, plank: 10 },
        cost: { copperBar: 8, plank: 10 },
        reputation: 1,
        ongoing: {
          name: 'The Storm Bell',
          icon: '🔔',
          description: '+3 resolve for every species while the Storm rages.',
          effects: [{ kind: 'stormResolve', amount: 3 }],
        },
      },
      {
        label: 'Dive for the bell-metal',
        description: 'A fortune in bronze — and one diver who does not come up.',
        gain: { copperBar: 14, amber: 35 },
        villagerLoss: 1,
      },
      {
        label: 'Melt it where it stands',
        description: 'The bell screams as it goes. Something under the water answers.',
        gain: { copperBar: 12, amber: 30 },
        threat: {
          name: 'The Drowned Choir',
          icon: '🔔',
          description: 'Voices under the water sing through every Storm. Nobody rests.',
          interval: 85,
          appease: { amber: 35 },
          strike: { impatience: 0.5, hostility: 3 },
          whileActive: [{ kind: 'stormResolve', amount: -3 }],
        },
      },
      { label: 'Let it toll', description: 'It has tolled for a century.', hostility: 5 },
    ],
  },
  {
    id: 'fenWitch',
    name: 'The Fen Witch',
    icon: '🧙',
    kind: 'forbidden',
    description:
      'A hut on spindly stilts and a woman who knows the true name of every bog in the forest. She can teach your builders where the ground will hold.',
    options: [
      {
        label: 'Pay her price',
        description: 'Spend 25 amber and 8 clay for her stilts. Her ground-lore halves every terrain penalty.',
        requires: { amber: 25, clay: 8 },
        cost: { amber: 25, clay: 8 },
        ongoing: {
          name: "Witch's Ground-Lore",
          icon: '🧙',
          description:
            'Unfavourable terrain (sinking marsh, rocky farmland) hurts half as much for the rest of the run.',
          effects: [{ kind: 'terrainPenalty', percent: -50 }],
        },
      },
      {
        label: 'Steal her cauldron',
        description: 'Solid copper, full of something valuable. She curses every threshold you own.',
        gain: { copperBar: 6, amber: 45, herb: 10 },
        condition: {
          name: "The Witch's Curse",
          icon: '🧙',
          description:
            'Hostility rises 25% faster until two more homes are raised with warded thresholds.',
          resolveBy: { kind: 'buildingsOfCategory', category: 'housing', amount: 2 },
          whileActive: [{ kind: 'hostilityRate', percent: 25 }],
        },
      },
      { label: 'Bid her good evening', description: 'She cackles. Not unkindly.' },
    ],
  },
  {
    id: 'sealedTreasury',
    name: 'Sealed Treasury',
    icon: '💰',
    kind: 'forbidden',
    description:
      'A strongroom of the old Crown, its seals unbroken, its ledgers still legible. By law every coin inside belongs to the Queen.',
    options: [
      {
        label: 'Open it properly and send it home',
        description: 'Spend 3 parts on the lock. The Queen is delighted, and pays a finder’s fee.',
        requires: { part: 3 },
        cost: { part: 3 },
        gain: { amber: 25 },
        reputation: 2,
      },
      {
        label: 'Skim the coffers',
        description: 'Seventy amber now. The royal auditors will come counting.',
        gain: { amber: 70 },
        condition: {
          name: 'The Royal Audit',
          icon: '📒',
          description:
            'The auditors want a brick counting-house: produce 24 bricks within 5 minutes, or the Queen hears of it (+3 impatience).',
          resolveBy: { kind: 'produced', resource: 'brick', amount: 24 },
          deadline: 300,
          onFail: { impatience: 3 },
        },
      },
      { label: 'Leave it sealed', description: 'Some doors are the Crown’s to open.' },
    ],
  },

  // ---- the Cinderwood's own (biome pool) ------------------------------------
  // The burn scar remembers the settlement whose hearth went cold, and the
  // fire that followed. Drawn only by the Cinderwood's glades.
  {
    id: 'smoulderingHearth',
    name: 'The Smouldering Hearth',
    icon: '🔥',
    kind: 'dangerous',
    pool: 'cinderwood',
    description:
      'The ring of a hearth older than yours, its stones still warm. Under the ash something glows that never quite went out.',
    options: [
      {
        label: 'Rekindle it for the Queen',
        description: 'Spend 15 wood and 4 incense to bank the old flame with the proper rites. Word of it reaches the throne.',
        requires: { wood: 15, incense: 4 },
        cost: { wood: 15, incense: 4 },
        reputation: 1,
        hostility: -4,
      },
      {
        label: 'Carry the embers home',
        description: 'Spend 10 wood on a banked pot of old fire: your hearth burns slower for good. The forest remembers what that fire did.',
        requires: { wood: 10 },
        cost: { wood: 10 },
        hostility: 6,
        ongoing: {
          name: 'Old Embers',
          icon: '🔥',
          description: 'The hearth burns 15% less wood for the rest of the run.',
          effects: [{ kind: 'hearthFuel', percent: -15 }],
        },
      },
      { label: 'Let it sleep', description: 'Some fires should be left to their ash.' },
    ],
  },
  {
    id: 'charredRoost',
    name: 'The Charred Roost',
    icon: '🦅',
    kind: 'dangerous',
    pool: 'cinderwood',
    description:
      'Ash-crows by the hundred on a dead oak, picking at a burned-out caravan. They watch your clearing crew with very bright eyes.',
    options: [
      {
        label: 'Scatter them with smoke',
        description: 'Spend 8 herbs on a smudge fire and take the caravan clean.',
        requires: { herb: 8 },
        cost: { herb: 8 },
        gain: { fabric: 8, tool: 1, amber: 20 },
      },
      {
        label: 'Snatch what you can',
        description: 'The crows follow the loot home.',
        gain: { fabric: 6, amber: 30 },
        threat: {
          name: 'The Ash-Crows',
          icon: '🦅',
          description: 'Crows raid the stores for anything that shines or can be eaten.',
          interval: 80,
          appease: { meat: 10 },
          strike: { stockLoss: { berry: 6, amber: 10 }, hostility: 2 },
        },
      },
      { label: 'Leave them the dead', description: 'The crows were here first.', hostility: -3 },
    ],
  },
  {
    id: 'emberSprites',
    name: 'Ember Sprites',
    icon: '✨',
    kind: 'dangerous',
    pool: 'cinderwood',
    description:
      'Sparks that drift against the wind and gather where your people stand. They are curious, and they are very, very cold away from the ash.',
    options: [
      {
        label: 'Coax them into the braziers',
        description: 'Spend 6 resin to lure them in. Fire that feeds itself.',
        requires: { resin: 6 },
        cost: { resin: 6 },
        ongoing: {
          name: 'Kept Sprites',
          icon: '✨',
          description: 'Braziers burn 40% less wood for the rest of the run.',
          effects: [{ kind: 'brazierFuel', percent: -40 }],
        },
      },
      {
        label: 'Bottle them for the caravans',
        description: 'A curiosity the traders pay well for. The rest of the swarm grieves.',
        gain: { amber: 40 },
        hostility: 8,
      },
      { label: 'Walk on by', description: 'They lose interest by nightfall.' },
    ],
  },
  {
    id: 'ashenPilgrims',
    name: 'Ashen Pilgrims',
    icon: '🚶',
    kind: 'dangerous',
    pool: 'cinderwood',
    description:
      'Grey-robed walkers keeping vigil where the old settlement burned. They pray that no hearth is ever let die again, and they are hungry.',
    options: [
      {
        label: 'Share your fire and bread',
        description: 'Spend 14 food. Two of them stay to tend your hearth.',
        foodCost: 14,
        villagerGain: 2,
      },
      {
        label: 'Ask for their blessing',
        description: 'Give 6 food for their road. They bless every hearth they pass, yours first.',
        foodCost: 6,
        ongoing: {
          name: 'Vigil of the Ash',
          icon: '🚶',
          description: '+1 resolve for every species for the rest of the run, −1 more in each Storm.',
          effects: [
            { kind: 'resolveFlat', species: 'all', amount: 1 },
            { kind: 'stormResolve', amount: -1 },
          ],
        },
      },
      { label: 'Send them on their way', description: 'They go, singing.', hostility: 2 },
    ],
  },
  {
    id: 'glassedClearing',
    name: 'The Glassed Clearing',
    icon: '💎',
    kind: 'dangerous',
    pool: 'cinderwood',
    description:
      'Where the fire burned hottest the sand ran and set: a field of black glass, sharp as a sentence and worth a fortune to the right buyer.',
    options: [
      {
        label: 'Cut it carefully',
        description: 'Spend 2 tools on proper cutting. Clean panes and no blood.',
        requires: { tool: 2 },
        cost: { tool: 2 },
        gain: { amber: 45, brick: 6 },
      },
      {
        label: 'Break it up by hand',
        description: 'Fast and careless: someone will bleed for it.',
        gain: { amber: 35, stone: 12 },
        villagerLoss: 1,
      },
      { label: 'Fence it off', description: 'Nobody needs to walk there.' },
    ],
  },
  {
    id: 'wardenOfCinders',
    name: 'The Warden of Cinders',
    icon: '🗿',
    kind: 'forbidden',
    pool: 'cinderwood',
    description:
      "A figure of fused ash and iron stands where the old settlement's gate was, still guarding it. It turns its head as your people pass.",
    options: [
      {
        label: 'Swear it to your hearth',
        description: 'Spend 6 copper bars on a new collar. It guards your border instead.',
        requires: { copperBar: 6 },
        cost: { copperBar: 6 },
        reputation: 1,
        ongoing: {
          name: 'The Cinder Warden',
          icon: '🗿',
          description: 'Hostility rises 15% more slowly for the rest of the run.',
          effects: [{ kind: 'hostilityRate', percent: -15 }],
        },
      },
      {
        label: 'Topple it for its iron',
        description: 'A hoard of old metal. The forest remembers who woke it.',
        gain: { copperBar: 8, part: 4, amber: 30 },
        threat: {
          name: 'The Waking Ash',
          icon: '🗿',
          description: 'The fallen warden rebuilds itself from the ash, a little more each Storm, and marches.',
          interval: 95,
          appease: { stone: 30, amber: 25 },
          strike: { hostility: 4, impatience: 0.5 },
        },
      },
      { label: 'Give it a wide berth', description: 'It watches you go.' },
    ],
  },
  {
    id: 'heartOfTheBurn',
    name: 'The Heart of the Burn',
    icon: '🌋',
    kind: 'forbidden',
    pool: 'cinderwood',
    description:
      'The fire started here. The ground is hot to the hand, the air shimmers, and something deep below breathes out in slow, long sighs.',
    options: [
      {
        label: 'Build a vent-house over it',
        description: 'Spend 12 bricks to harness the heat. Workshops nearby never go cold.',
        requires: { brick: 12 },
        cost: { brick: 12 },
        ongoing: {
          name: 'The Burn-Heart Vents',
          icon: '🌋',
          description: 'Smithing and cooking work 20% faster for the rest of the run.',
          effects: [
            { kind: 'productionSpeed', tag: 'smithing', percent: 20 },
            { kind: 'productionSpeed', tag: 'cooking', percent: 20 },
          ],
        },
      },
      {
        label: 'Dig for what the fire left',
        description: 'Copper and old coin in the slag. The ground does not like being dug.',
        gain: { copperOre: 20, amber: 50 },
        condition: {
          name: 'The Restless Burn',
          icon: '🌋',
          description: 'Hostility rises 25% faster until 2 more glades are cleared and the heat bleeds away.',
          resolveBy: { kind: 'gladesCleared', amount: 2 },
          whileActive: [{ kind: 'hostilityRate', percent: 25 }],
        },
      },
      { label: 'Let it breathe', description: 'It has been breathing for a hundred years.' },
    ],
  },

  // ---- the ruins field's own (layout pool) ----------------------------------
  {
    id: 'collapsedGatehouse',
    name: 'The Collapsed Gatehouse',
    icon: '🏰',
    kind: 'dangerous',
    pool: 'ruins',
    description:
      'The holdfast\'s gate, fallen across the road. Its arch-stones are cut true, and under them lies the gate-wardens\' strongbox.',
    options: [
      {
        label: 'Shore it and salvage properly',
        description: 'Spend 8 planks. Dressed stone and bricks, and the strongbox.',
        requires: { plank: 8 },
        cost: { plank: 8 },
        gain: { stone: 20, brick: 8, amber: 20 },
      },
      {
        label: 'Pull the strongbox out now',
        description: 'The arch comes down behind your crew.',
        gain: { amber: 30, brick: 4 },
        villagerLoss: 1,
      },
      { label: 'Leave it standing', description: 'It held the road for centuries.' },
    ],
  },
  {
    id: 'kingsCistern',
    name: "The King's Cistern",
    icon: '⛲',
    kind: 'dangerous',
    pool: 'ruins',
    description:
      'A vaulted cistern under the old keep, still full of clean water. Carvings along the rim name a king the Queen would rather forget.',
    options: [
      {
        label: 'Chisel out the old king',
        description: 'Spend 10 stone and 3 scrolls on new carvings and a proper inscription in the Queen\'s name. She hears of it.',
        requires: { stone: 10, scroll: 3 },
        cost: { stone: 10, scroll: 3 },
        reputation: 1,
      },
      {
        label: 'Drink from the king\'s water',
        description: 'Spend 6 planks on pipes: clean water for every kitchen. The Queen frowns at the carvings left standing.',
        requires: { plank: 6 },
        cost: { plank: 6 },
        impatience: 1,
        ongoing: {
          name: "The King's Water",
          icon: '⛲',
          description: 'Villagers eat 8% less for the rest of the run.',
          effects: [{ kind: 'foodUpkeep', percent: -8 }],
        },
      },
      { label: 'Seal the vault', description: 'Water under stone keeps.' },
    ],
  },
  {
    id: 'archiveOfTheHoldfast',
    name: 'Archive of the Holdfast',
    icon: '📚',
    kind: 'dangerous',
    pool: 'ruins',
    description:
      "Shelves of the holdfast's ledgers, dry behind a fallen wall: harvests, levies, the names of the dead. A scholar's treasure, or good kindling.",
    options: [
      {
        label: 'Copy them out',
        description: 'Spend 6 scrolls. The old surveys show where the stone was quarried.',
        requires: { scroll: 6 },
        cost: { scroll: 6 },
        reputation: 1,
        gain: { stone: 15 },
      },
      {
        label: 'Sell the ledgers',
        description: 'Collectors pay well. Some of the names were somebody\'s grandparents.',
        gain: { amber: 35 },
        hostility: 4,
      },
      { label: 'Burn them for warmth', description: 'The ink smells of old winters.', gain: { wood: 12 } },
    ],
  },
]

export const GLADE_EVENTS: Record<string, GladeEventDef> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
)

export const GLADE_EVENT_LIST = defs

/** The default pools: every event but a biome's or a layout's own. */
export function eventsOfKind(kind: 'dangerous' | 'forbidden'): GladeEventDef[] {
  return defs.filter((d) => d.kind === kind && !d.pool)
}

/** A biome's or a layout's own events of one kind (see `GladeEventDef.pool`). */
export function eventsOfPool(pool: string, kind: 'dangerous' | 'forbidden'): GladeEventDef[] {
  return defs.filter((d) => d.kind === kind && d.pool === pool)
}
