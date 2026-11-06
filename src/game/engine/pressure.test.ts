import { describe, expect, it } from 'vitest'
import { isIconId } from '../../art/icons'
import { conditionArt, threatArt } from '../content/artFamilies'
import { BLUEPRINT_POOL, BUILDINGS, STARTING_BLUEPRINTS } from '../content/buildings'
import { CORNERSTONES, CORNERSTONE_LIST } from '../content/cornerstones'
import { GLADE_EVENTS } from '../content/gladeEvents'
import { SPECIES } from '../content/species'
import { STORM_BLIGHTS, STORM_BLIGHT_LIST } from '../content/stormBlights'
import { migrateRun } from '../persistence'
import type { BuildingInstance, RunState, Season } from '../types'
import { DUMP_LOT, assignWorker, dumpStock } from './actions'
import {
  DRAFT_PITY,
  IMPATIENCE_STALL_RATE,
  OPENING_BLUEPRINT_PICKS,
  REWARD_MILESTONES,
  SEASON_LENGTH,
  STORM_BLIGHT_MIN_HOSTILITY,
  THREAT_STRIKES_BEFORE_LOSS,
  WARD_HOSTILITY_PER_OFFERING,
} from './balance'
import { announceBlight, blightPrepAmount, blightsAt, pendingBlight } from './blights'
import { blueprintDraftSize } from './citadel'
import { createRun } from './createRun'
import { collectWarnings } from './diagnostics'
import {
  describeStakes,
  draftOwesChain,
  gladeStakes,
  offerBlueprint,
  relevantBlueprints,
  rerollChoice,
  resolveGladeEvent,
  stepThreats,
  takeChoice,
  unleashThreat,
} from './events'
import { buildingStatus } from './forecast'
import { computeModifiers } from './modifiers'
import { larderHeadroom, stepProduction, storageLimitFor } from './production'
import { population, speciesCounts, storageUsed } from './queries'
import {
  addImpatience,
  impatienceRate,
  stalledShare,
  stallingImpatienceRate,
} from './society'
import { stepConditions } from './structure'
import { tick } from './tick'

/**
 * Mid-run pressure: the meters that push back on a settlement — the Queen's
 * impatience, the forest's hostility as Storm blights, threats that escalate
 * — and the levers a player has against them.
 */

const SEED = 4711

/** A run past its opening drafts, with no map modifiers to bend the rules. */
function newRun(): RunState {
  const s = createRun({ seed: SEED, species: ['human', 'beaver', 'lizard'], modifiers: [] })
  let guard = 0
  while (s.pendingChoices.length > 0 && guard++ < 20) {
    takeChoice(s, s.pendingChoices[0].options[0])
  }
  return s
}

describe('impatience relief', () => {
  it('borrows from whole points so the meter visibly drops', () => {
    const s = newRun()
    s.impatience = 7
    s.impatienceProgress = 0.5
    addImpatience(s, -2)
    expect(s.impatience).toBe(5)
    expect(s.impatienceProgress).toBeCloseTo(0.5)
    addImpatience(s, -0.75)
    expect(s.impatience).toBe(4)
    expect(s.impatienceProgress).toBeCloseTo(0.75)
  })

  it('never goes below zero', () => {
    const s = newRun()
    s.impatience = 1
    s.impatienceProgress = 0.25
    addImpatience(s, -3)
    expect(s.impatience).toBe(0)
    expect(s.impatienceProgress).toBe(0)
  })

  it('still carries upward overflow as before', () => {
    const s = newRun()
    s.impatience = 2
    s.impatienceProgress = 0.75
    addImpatience(s, 1.5)
    expect(s.impatience).toBe(4)
    expect(s.impatienceProgress).toBeCloseTo(0.25)
  })

  it('a glade event that calms the Queen lowers the meter the player sees', () => {
    const s = newRun()
    s.impatience = 7
    s.impatienceProgress = 0.5
    s.stock = { ...s.stock, berry: 40, ale: 10 }
    s.pendingChoices.push({ kind: 'gladeEvent', options: ['queensSurveyors'] })
    const host = GLADE_EVENTS.queensSurveyors.options.findIndex((o) => o.impatience === -2)
    resolveGladeEvent(s, host)
    expect(s.impatience + s.impatienceProgress).toBeCloseTo(5.5)
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stands a finished building at an out-of-the-way spot (no placement rules). */
function stand(s: RunState, defId: string, recipeId?: string): BuildingInstance {
  const id = `test_${defId}_${Object.keys(s.buildings).length}`
  const b: BuildingInstance = {
    id,
    defId,
    pos: { x: 99, y: 99 },
    gladeId: 'glade0',
    built: true,
    buildProgress: BUILDINGS[defId].buildSeconds,
    workers: [],
    activeRecipeId: recipeId ?? BUILDINGS[defId].recipes[0]?.id ?? '',
    recipeProgress: 0,
    tier: 0,
    paused: false,
    depositsInRange: {},
  }
  s.buildings[id] = b
  return b
}

/** Moves the calendar to the given season of the given year, at its start. */
function setSeason(s: RunState, year: number, season: Season): void {
  s.season = { year, season, elapsed: 0, length: SEASON_LENGTH[season] }
}

/** Ticks the run up to (and just past) the end of the current season. */
function finishSeason(s: RunState): void {
  s.season.elapsed = s.season.length - 0.0625
  tick(s, 0.125)
}

function setAllResolve(s: RunState, offset: number): void {
  for (const sp of s.speciesPool) s.resolve[sp] = SPECIES[sp].resolveTarget + offset
}

// ---------------------------------------------------------------------------
// The Queen notices a stalling settlement
// ---------------------------------------------------------------------------

describe('impatience reacts to stalling', () => {
  it('adds nothing in Year 1, before any service could stand', () => {
    const s = newRun()
    setAllResolve(s, -10)
    expect(stallingImpatienceRate(s)).toBe(0)
  })

  it('from Year 2 rises at the full rate while every species is below its threshold', () => {
    const s = newRun()
    setSeason(s, 2, 'drizzle')
    setAllResolve(s, -3)
    expect(stalledShare(s)).toBe(1)
    expect(stallingImpatienceRate(s)).toBeCloseTo(IMPATIENCE_STALL_RATE)
    const base = impatienceRate(s, computeModifiers(s))
    setAllResolve(s, 3)
    expect(stallingImpatienceRate(s)).toBe(0)
    // The HUD's rate is the sim's rate: the stall term is part of it.
    expect(base - impatienceRate(s, computeModifiers(s))).toBeCloseTo(IMPATIENCE_STALL_RATE)
  })

  it('scales with the share of villagers whose species is stalling', () => {
    const s = newRun()
    setSeason(s, 3, 'drizzle')
    setAllResolve(s, 5)
    const counts = speciesCounts(s)
    const [first] = s.speciesPool
    s.resolve[first] = SPECIES[first].resolveTarget - 1
    expect(stalledShare(s)).toBeCloseTo(counts[first] / population(s))
  })

  it('makes an idling settlement lose patience faster through a tick', () => {
    const idle = newRun()
    setSeason(idle, 2, 'drizzle')
    const earning = JSON.parse(JSON.stringify(idle)) as RunState
    setAllResolve(idle, -8)
    setAllResolve(earning, 8)
    for (let i = 0; i < 80; i++) {
      // Hold resolve where it is so only the stall term differs.
      setAllResolve(idle, -8)
      setAllResolve(earning, 8)
      tick(idle, 0.125)
      tick(earning, 0.125)
    }
    const gap =
      idle.impatience + idle.impatienceProgress - (earning.impatience + earning.impatienceProgress)
    expect(gap).toBeCloseTo(IMPATIENCE_STALL_RATE * 10, 2)
  })
})

// ---------------------------------------------------------------------------
// Storm blights
// ---------------------------------------------------------------------------

describe('Storm blights', () => {
  it('unlock by hostility band, and the forest is quiet below the first', () => {
    expect(blightsAt(STORM_BLIGHT_MIN_HOSTILITY - 1)).toEqual([])
    const low = blightsAt(STORM_BLIGHT_MIN_HOSTILITY).map((b) => b.id)
    const high = blightsAt(100).map((b) => b.id)
    expect(low.length).toBeGreaterThan(0)
    expect(high.length).toBe(STORM_BLIGHT_LIST.length)
    for (const def of STORM_BLIGHT_LIST) {
      expect(def.minHostility).toBeGreaterThanOrEqual(STORM_BLIGHT_MIN_HOSTILITY)
      expect(blightsAt(def.minHostility - 0.5).map((b) => b.id)).not.toContain(def.id)
    }
  })

  it('every blight is drawn, makes its goods with starting buildings, and threatens something', () => {
    for (const def of STORM_BLIGHT_LIST) {
      expect(isIconId(conditionArt(def)), def.id).toBe(true)
      const makers = STARTING_BLUEPRINTS.filter((id) =>
        BUILDINGS[id]?.recipes.some((r) => (r.outputs[def.prep.resource] ?? 0) > 0),
      )
      expect(makers.length, `${def.id} prep`).toBeGreaterThan(0)
      const strike = def.strike
      expect(!!(strike.condition || strike.threat || strike.spoil || strike.villagerLoss), def.id).toBe(true)
      if (strike.condition) {
        expect(strike.condition.passesWithStorm, def.id).toBe(true)
        expect(isIconId(conditionArt(strike.condition)), strike.condition.name).toBe(true)
      }
      if (strike.threat) expect(isIconId(threatArt(strike.threat)), strike.threat.name).toBe(true)
    }
  })

  it('is forecast as Clearance begins, from Year 2, with a countdown to the Storm', () => {
    const s = newRun()
    s.hostility = 30
    setSeason(s, 1, 'drizzle')
    finishSeason(s)
    expect(s.season.season).toBe('clearance')
    expect(pendingBlight(s)).toBeUndefined()

    const t = newRun()
    t.hostility = 30
    setSeason(t, 2, 'drizzle')
    finishSeason(t)
    const forecast = pendingBlight(t)!
    expect(forecast).toBeDefined()
    expect(forecast.breaksWithStorm).toBe(true)
    expect(forecast.resolveBy.kind).toBe('produced')
    expect(forecast.timeLeft).toBeGreaterThan(t.season.length - 1)
    expect(t.stormBlights?.forecast).toBe(1)
    expect(t.log.some((e) => e.text.includes(forecast.name) && e.text.includes('restless'))).toBe(true)
  })

  it('does not fail on its timer: it strikes when the Storm breaks', () => {
    const s = newRun()
    setSeason(s, 2, 'clearance')
    announceBlight(s, STORM_BLIGHTS.risingWaters)
    stepConditions(s, s.season.length + 50)
    expect(pendingBlight(s)?.timeLeft).toBe(0)
    finishSeason(s)
    expect(s.season.season).toBe('storm')
    expect(pendingBlight(s)).toBeUndefined()
    const flood = s.conditions.find((c) => c.name === 'Flooded Workshops')!
    expect(flood.passesWithStorm).toBe(true)
    expect(flood.timeLeft).toBeCloseTo(s.season.length - s.season.elapsed, 0)
    expect(computeModifiers(s).productionSpeed.all).toBeCloseTo(-0.4)
    expect(s.stormBlights).toMatchObject({ forecast: 1, struck: 1, blunted: 0 })

    // …and it lifts, without penalty, when the Storm passes.
    finishSeason(s)
    expect(s.season.season).toBe('drizzle')
    expect(s.conditions.find((c) => c.name === 'Flooded Workshops')).toBeUndefined()
    expect(computeModifiers(s).productionSpeed.all ?? 0).toBe(0)
  })

  it('is turned aside by making its goods during the Clearance', () => {
    const s = newRun()
    setSeason(s, 2, 'clearance')
    const forecast = announceBlight(s, STORM_BLIGHTS.leakingRoofs)
    const goal = forecast.resolveBy
    expect(goal.kind).toBe('produced')
    if (goal.kind !== 'produced') return
    // Goods already in store do not count: only what is made from now.
    s.stock.plank = 500
    stepConditions(s, 0.125)
    expect(pendingBlight(s)).toBeDefined()
    s.producedTotals.plank = (s.producedTotals.plank ?? 0) + goal.amount
    stepConditions(s, 0.125)
    expect(pendingBlight(s)).toBeUndefined()
    expect(s.stormBlights?.blunted).toBe(1)
    finishSeason(s)
    expect(s.conditions.find((c) => c.name === 'Leaking Roofs')).toBeUndefined()
  })

  it('asks for more each year', () => {
    const s = newRun()
    const def = STORM_BLIGHTS.leakingRoofs
    setSeason(s, 2, 'clearance')
    const y2 = blightPrepAmount(s, def)
    setSeason(s, 4, 'clearance')
    expect(y2).toBe(def.prep.amount)
    expect(blightPrepAmount(s, def)).toBeGreaterThan(y2)
  })

  it('a fever takes a villager and the run counts it lost', () => {
    const s = newRun()
    setSeason(s, 3, 'clearance')
    announceBlight(s, STORM_BLIGHTS.stormFever)
    const pop = population(s)
    finishSeason(s)
    expect(population(s)).toBe(pop - 1)
    expect(s.stats.villagersLost).toBe(1)
    expect(s.conditions.some((c) => c.name === 'Storm Fever')).toBe(true)
  })

  it('damp rots a share of every raw food stack', () => {
    const s = newRun()
    setSeason(s, 2, 'clearance')
    s.stock = { ...s.stock, berry: 50, root: 20, wood: 30 }
    announceBlight(s, STORM_BLIGHTS.dampStores)
    finishSeason(s)
    expect(s.stock.berry).toBeLessThanOrEqual(30)
    expect(s.stock.root).toBeLessThanOrEqual(12)
    expect(s.stock.wood).toBeLessThanOrEqual(30)
    expect(s.stock.wood).toBeGreaterThan(20)
  })

  it('a stirring beast becomes a threat', () => {
    const s = newRun()
    setSeason(s, 3, 'clearance')
    announceBlight(s, STORM_BLIGHTS.somethingStirs)
    finishSeason(s)
    expect(s.threats.map((t) => t.name)).toContain('The Storm Stalker')
  })
})

// ---------------------------------------------------------------------------
// Hostility counterplay: the hearth's offerings, and the stakes on the map
// ---------------------------------------------------------------------------

describe("the hearth's offerings", () => {
  it('a firekeeper burning herbs calms the forest', () => {
    const s = newRun()
    const hearth = s.buildings.hearth
    expect(BUILDINGS[hearth.defId].ward).toBeDefined()
    s.hostility = 40
    s.stock.herb = 40
    expect(assignWorker(s, hearth.id)).toBeNull()
    const herbs = s.stock.herb
    for (let i = 0; i < 8 * 25; i++) stepProduction(s, 0.125, computeModifiers(s))
    expect(s.hostility).toBeLessThan(40 - WARD_HOSTILITY_PER_OFFERING + 1e-9)
    expect(s.stock.herb).toBeLessThan(herbs)
  })

  it('an empty hearth is not flagged as missing a worker', () => {
    const s = newRun()
    expect(buildingStatus(s, s.buildings.hearth, computeModifiers(s)).kind).toBe('none')
  })
})

describe('glade stakes on the plate', () => {
  it("names what a glade's event could lead to, without naming the event", () => {
    const s = newRun()
    const glade = Object.values(s.glades).find((g) => g.eventId === undefined && !g.cleared)!
    glade.eventId = 'howlingDen'
    const stakes = gladeStakes(s, glade.id)
    expect(stakes).toContain('threat')
    expect(gladeStakes(s, 'glade0')).toEqual([])
    // Worst first.
    const order = ['lives', 'threat', 'condition', 'reputation', 'pact']
    expect([...stakes].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(stakes)
    expect(describeStakes(['threat', 'reputation'])).toBe('a threat or reputation')
  })
})

// ---------------------------------------------------------------------------
// Threats worth weighing
// ---------------------------------------------------------------------------

describe('threats escalate when ignored', () => {
  it('each strike makes the next harder and the price of peace higher', () => {
    const s = newRun()
    const spec = GLADE_EVENTS.howlingDen.options.find((o) => o.threat)!.threat!
    const before = JSON.stringify(spec)
    const threat = unleashThreat(s, spec, 'glade1')
    s.stock = { ...s.stock, berry: 500, meat: 500 }
    const appease0 = { ...threat.appease }
    const loss0 = { ...threat.strike.stockLoss }
    stepThreats(s, threat.interval + 0.01)
    expect(threat.strikes).toBe(1)
    for (const [id, n] of Object.entries(appease0)) {
      expect(threat.appease[id as keyof typeof threat.appease]).toBeGreaterThan(n ?? 0)
    }
    for (const [id, n] of Object.entries(loss0)) {
      expect(threat.strike.stockLoss?.[id as keyof typeof loss0]).toBeGreaterThan(n ?? 0)
    }
    // The content it came from is untouched.
    expect(JSON.stringify(spec)).toBe(before)
  })

  it('takes villagers once it has struck often enough', () => {
    const s = newRun()
    const spec = GLADE_EVENTS.howlingDen.options.find((o) => o.threat)!.threat!
    const threat = unleashThreat(s, spec, 'glade1')
    for (let i = 0; i < THREAT_STRIKES_BEFORE_LOSS; i++) stepThreats(s, threat.interval)
    expect(threat.strike.villagerLoss).toBe(1)
    expect(s.log[0].text).toMatch(/grows bold|bolder/)
    const pop = population(s)
    stepThreats(s, threat.interval)
    expect(population(s)).toBe(pop - 1)
  })

  it('a threat from an older save, with no strike count, escalates from zero', () => {
    const s = newRun()
    s.threats.push({
      id: 'tOld',
      gladeId: 'glade1',
      name: 'Old Menace',
      icon: '🐺',
      description: '',
      interval: 10,
      timer: 1,
      appease: { wood: 10 },
      strike: { hostility: 2 },
    })
    stepThreats(s, 2)
    expect(s.threats[0].strikes).toBe(1)
    expect(s.threats[0].appease.wood).toBe(12)
  })
})

// ---------------------------------------------------------------------------
// Drafts that are not solved
// ---------------------------------------------------------------------------

describe('blueprint drafts', () => {
  it('owe the first draft of a run a piece of a wanted chain, then only after a drought', () => {
    const fresh = createRun({ seed: SEED, species: ['human', 'beaver', 'lizard'], modifiers: [] })
    expect(draftOwesChain(fresh)).toBe(true)
    fresh.draftDrought = 0
    expect(draftOwesChain(fresh)).toBe(false)
    fresh.draftDrought = DRAFT_PITY
    expect(draftOwesChain(fresh)).toBe(true)
  })

  it('a pity draft carries the chain piece; a drought counts drafts without one', () => {
    const s = newRun()
    s.pendingChoices = []
    s.draftDrought = DRAFT_PITY
    offerBlueprint(s, false)
    const relevant = relevantBlueprints(s)
    expect(s.pendingChoices[0].options).toContain(relevant[0])
    takeChoice(s, s.pendingChoices[0].options[0])
    expect(s.draftDrought).toBe(0)

    // A draft offering nothing wanted adds to the drought.
    const wanted = new Set(relevantBlueprints(s))
    const unwanted = BLUEPRINT_POOL.filter((id) => !wanted.has(id) && !s.unlockedBuildings.includes(id))
    s.pendingChoices.push({ kind: 'blueprint', options: unwanted.slice(0, 3) })
    takeChoice(s, unwanted[0])
    expect(s.draftDrought).toBe(1)
  })

  it('a milestone draft offers two blueprints and a cornerstone, and either can be taken', () => {
    const s = newRun()
    s.pendingChoices = []
    s.clock = 600
    offerBlueprint(s)
    const choice = s.pendingChoices[0]
    expect(choice.mixed).toBe(true)
    const stones = choice.options.filter((id) => CORNERSTONES[id])
    expect(stones).toHaveLength(1)
    expect(choice.options.filter((id) => BUILDINGS[id])).toHaveLength(blueprintDraftSize(s) - 1)
    takeChoice(s, stones[0])
    expect(s.cornerstones).toContain(stones[0])
    expect(s.pendingChoices).toHaveLength(0)
  })

  it('a reroll keeps the mix and shows none of what was offered', () => {
    const s = newRun()
    s.pendingChoices = []
    s.clock = 600
    s.stock.amber = 500
    offerBlueprint(s)
    const shown = [...s.pendingChoices[0].options]
    expect(rerollChoice(s)).toBeNull()
    const fresh = s.pendingChoices[0].options
    expect(fresh.some((id) => shown.includes(id))).toBe(false)
    expect(fresh.filter((id) => CORNERSTONES[id])).toHaveLength(1)
  })

  it('building and cornerstone ids never collide, so a mixed pick is unambiguous', () => {
    for (const def of CORNERSTONE_LIST) expect(BUILDINGS[def.id], def.id).toBeUndefined()
  })
})

describe('cornerstones', () => {
  it('every run opens on a cornerstone pick after its blueprints', () => {
    const s = createRun({ seed: SEED, species: ['human', 'fox', 'harpy'], modifiers: [] })
    expect(s.pendingChoices.map((c) => c.kind)).toEqual([
      ...Array(OPENING_BLUEPRINT_PICKS).fill('blueprint'),
      'cornerstone',
    ])
  })

  it('milestones fall on odd reputation', () => {
    for (const m of REWARD_MILESTONES) expect(m % 2).toBe(1)
    expect(REWARD_MILESTONES[0]).toBe(1)
  })

  it('Modest Needs is no longer a free service chain at common odds', () => {
    const def = CORNERSTONES.modestNeeds
    expect(def.rarity).toBe('epic')
    const effect = def.effects.find((e) => e.kind === 'needsFewerServices')
    expect(effect && 'amount' in effect ? effect.amount : 1).toBeLessThan(1)
  })
})

// ---------------------------------------------------------------------------
// The stockpile cap never starves the settlement
// ---------------------------------------------------------------------------

describe('a full stockpile', () => {
  function fullOfWood(): RunState {
    const s = newRun()
    s.stock = { wood: s.storageCap, grain: 0, amber: 10 }
    return s
  }

  it('lets food keep coming into a larder reserve past the cap', () => {
    const s = fullOfWood()
    s.stock = { wood: s.storageCap - 1, grain: 4 }
    const cook = stand(s, 'cookhouse', 'biscuit')
    expect(assignWorker(s, cook.id)).toBeNull()
    const mill = stand(s, 'lumberMill', 'plank')
    expect(assignWorker(s, mill.id)).toBeNull()
    cook.recipeProgress = BUILDINGS.cookhouse.recipes[0].seconds
    mill.recipeProgress = BUILDINGS.lumberMill.recipes[0].seconds
    stepProduction(s, 0, computeModifiers(s))
    expect(s.stock.biscuit ?? 0).toBeGreaterThan(0)
    expect(s.stock.plank ?? 0).toBe(0)
    expect(storageUsed(s)).toBeGreaterThan(s.storageCap)
    expect(storageUsed(s)).toBeLessThanOrEqual(s.storageCap + larderHeadroom(s.storageCap))
    // The status line agrees with the tick: the mill is held at the brim.
    expect(buildingStatus(s, mill, computeModifiers(s)).kind).toBe('storageFull')
  })

  it('food stops only once the reserve is full too', () => {
    const recipe = BUILDINGS.cookhouse.recipes[0]
    expect(storageLimitFor(recipe, 100)).toBe(100 + larderHeadroom(100))
    expect(storageLimitFor(BUILDINGS.lumberMill.recipes[0], 100)).toBe(100)
  })

  it('can be eased by dumping a chosen good', () => {
    const s = fullOfWood()
    const wood = s.stock.wood ?? 0
    expect(dumpStock(s, 'wood')).toBeNull()
    expect(s.stock.wood).toBe(wood - DUMP_LOT)
    expect(dumpStock(s, 'amber')).not.toBeNull()
    expect(dumpStock(s, 'tool')).not.toBeNull()
    expect(dumpStock(s, 'wood', 1e9)).toBeNull()
    expect(s.stock.wood ?? 0).toBe(0)
  })

  it('names the real fix when the warehouse needs what the stopped producers make', () => {
    const s = fullOfWood()
    const camp = stand(s, 'stonecuttersCamp')
    expect(assignWorker(s, camp.id)).toBeNull()
    const vein = Object.values(s.deposits).find((d) => d.kind === 'stoneVein')!
    camp.depositsInRange = { stoneVein: [vein.id] }
    camp.recipeProgress = 999
    const warning = collectWarnings(s).find((w) => w.id === 'storage-full')!
    expect(warning).toBeDefined()
    expect(warning.text).toMatch(/full of Wood/)
    expect(warning.text).toMatch(/Warehouse needs \d+ more Stone/)
    expect(warning.text).toMatch(/dump some Wood/)
    expect(warning.text).not.toMatch(/sell surplus/)
  })
})

// ---------------------------------------------------------------------------
// Saves from before this round
// ---------------------------------------------------------------------------

describe('older saves', () => {
  it('load and play on with defaults for every new field', () => {
    const s = newRun()
    const old = JSON.parse(JSON.stringify(s)) as Record<string, unknown>
    delete old.stormBlights
    delete old.draftDrought
    const run = migrateRun(old)!
    expect(run).not.toBeNull()
    run.hostility = 30
    setSeason(run, 2, 'drizzle')
    finishSeason(run)
    expect(pendingBlight(run)).toBeDefined()
    expect(run.stormBlights?.forecast).toBe(1)
    expect(draftOwesChain(run)).toBe(true)
  })
})
