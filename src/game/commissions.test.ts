import { beforeEach, describe, expect, it } from 'vitest'
import { BUILDINGS } from './content/buildings'
import {
  COMMISSIONS,
  COMMISSION_LIST,
  COMMISSION_OFFER_SIZE,
  commissionOffer,
  commissionsOpenedBy,
  judgeCommission,
  termStatus,
  unlockedCommissions,
} from './content/commissions'
import { CORNERSTONES } from './content/cornerstones'
import { META_UPGRADES, META_UPGRADE_LIST } from './content/meta'
import { bankRun, defaultMeta, migrateMeta, supplyBreakdown } from './engine/meta'
import { RUN_MODIFIERS } from './content/runModifiers'
import { COMMISSION_ONGOING_ID, commissionLand } from './engine/citadel'
import { createRun } from './engine/createRun'
import { computeModifiers } from './engine/modifiers'
import { drawRunModifiers } from './engine/runModifiers'
import { migrateRun } from './persistence'
import { stepDecree } from './engine/structure'
import type { MetaState, RunState, SpeciesId } from './types'

const TRIO: SpeciesId[] = ['human', 'beaver', 'lizard']
const SEED = 4242

function run(commission?: string, seed = SEED): RunState {
  return createRun({ seed, species: TRIO, commission })
}

function owning(...ids: string[]): MetaState {
  const out = new Set<string>()
  const visit = (id: string) => {
    for (const req of META_UPGRADES[id]?.requires ?? []) visit(req)
    out.add(id)
  }
  ids.forEach(visit)
  return { ...defaultMeta(), upgrades: [...out] }
}

const ALL_UPGRADES = META_UPGRADE_LIST.map((d) => d.id)

/** A finished copy of `s`: won or lost, as it stands. */
function ended(s: RunState, phase: 'won' | 'lost'): RunState {
  return { ...s, phase, reputation: phase === 'won' ? s.maxReputation : s.reputation }
}

describe('commissions: content', () => {
  it('has unique ids, real unlocks, lands and blueprints, and at least one term each', () => {
    expect(new Set(COMMISSION_LIST.map((d) => d.id)).size).toBe(COMMISSION_LIST.length)
    for (const def of COMMISSION_LIST) {
      expect(def.terms.length, def.id).toBeGreaterThan(0)
      expect(def.bonusPercent, def.id).toBeGreaterThan(0)
      expect(def.bonusPercent, def.id).toBeLessThanOrEqual(100)
      if (def.unlockedBy) expect(META_UPGRADES[def.unlockedBy], def.id).toBeDefined()
      if (def.land) expect(RUN_MODIFIERS[def.land], def.id).toBeDefined()
      for (const b of def.startBlueprints ?? []) expect(BUILDINGS[b], def.id).toBeDefined()
      // Every commission is a trade-off: something to pay for its reward.
      expect(
        (def.effects?.length ?? 0) +
          (def.startHostility ? 1 : 0) +
          (def.startStockPercent ? 1 : 0) +
          (def.land ? 1 : 0),
        def.id,
      ).toBeGreaterThan(0)
    }
  })

  it('opens three from the first run and the rest through the Citadel tree', () => {
    const open = unlockedCommissions([])
    expect(open).toHaveLength(COMMISSION_OFFER_SIZE)
    expect(open.every((d) => !d.unlockedBy)).toBe(true)
    expect(unlockedCommissions(ALL_UPGRADES)).toHaveLength(COMMISSION_LIST.length)
    // Each locked one is opened by exactly the upgrade it names.
    for (const def of COMMISSION_LIST.filter((d) => d.unlockedBy)) {
      expect(commissionsOpenedBy(def.unlockedBy!)).toContain(def)
      const without = owning(def.unlockedBy!).upgrades.filter((u) => u !== def.unlockedBy)
      expect(unlockedCommissions(without)).not.toContain(def)
      expect(unlockedCommissions(owning(def.unlockedBy!).upgrades)).toContain(def)
    }
  })
})

describe('commissions: the offer before a run', () => {
  it('offers the whole open board while it holds three or fewer', () => {
    expect(commissionOffer(defaultMeta())).toEqual(unlockedCommissions([]).map((d) => d.id))
  })

  it('draws three distinct open commissions, the same for the same Citadel', () => {
    const meta = { ...owning(...ALL_UPGRADES), runsWon: 3, runsLost: 2 }
    const offer = commissionOffer(meta)
    expect(offer).toHaveLength(COMMISSION_OFFER_SIZE)
    expect(new Set(offer).size).toBe(COMMISSION_OFFER_SIZE)
    for (const id of offer) expect(COMMISSIONS[id]).toBeDefined()
    expect(commissionOffer({ ...meta })).toEqual(offer)
  })

  it('rotates after each finished run', () => {
    const base = owning(...ALL_UPGRADES)
    const offers = new Set(
      Array.from({ length: 8 }, (_, i) => commissionOffer({ ...base, runsLost: i }).join()),
    )
    expect(offers.size).toBeGreaterThan(1)
  })

  it('always shows a newly opened commission that has never been taken', () => {
    for (let round = 0; round < 6; round++) {
      const meta = { ...owning('merchantCharter'), runsWon: round }
      expect(commissionOffer(meta), `round ${round}`).toContain('tradeTown')
    }
    // Once taken, it goes back into the ordinary draw.
    const taken: MetaState = {
      ...owning('merchantCharter', 'citadelBlessing'),
      history: [{ seed: 1, won: true, years: 3, reputation: 18, at: 0, commission: { id: 'tradeTown', met: true } }],
    }
    for (let round = 0; round < 6; round++) {
      expect(commissionOffer({ ...taken, runsWon: round }), `round ${round}`).toContain('queensFavourite')
    }
  })
})

describe('commissions: the founding', () => {
  it('without a commission, or with an unknown one, founds exactly the standard run', () => {
    const plain = run()
    expect(plain.commission).toBeUndefined()
    expect(run('noSuchCommission')).toEqual(plain)
    expect(plain.ongoing.some((e) => e.id === COMMISSION_ONGOING_ID)).toBe(false)
  })

  it('records the commission and folds its effects in like a pact', () => {
    for (const def of COMMISSION_LIST) {
      const s = run(def.id)
      expect(s.commission).toBe(def.id)
      if (def.effects?.length) {
        const entry = s.ongoing.find((e) => e.id === COMMISSION_ONGOING_ID)
        expect(entry?.effects, def.id).toEqual(def.effects)
      }
      expect(s.log.some((l) => l.text.includes(def.name)), def.id).toBe(true)
    }
    const mods = computeModifiers(run('holdFrontier'))
    expect(mods.gladeLoot).toBeCloseTo(computeModifiers(run()).gladeLoot * 1.4, 5)
  })

  it('Hold the Frontier starts the forest restless', () => {
    expect(run().hostility).toBe(0)
    expect(run('holdFrontier').hostility).toBe(8)
  })

  it('Light Wagons carries 15% less of everything', () => {
    const plain = run()
    const light = run('lightWagons')
    for (const [id, amount] of Object.entries(plain.stock)) {
      expect(light.stock[id as keyof typeof plain.stock], id).toBe(Math.round((amount ?? 0) * 0.85))
    }
  })

  it('Found a Trade Town grants the Trading Post and swaps timber for amber', () => {
    const plain = run()
    const trade = run('tradeTown')
    expect(plain.unlockedBuildings).not.toContain('tradingPost')
    expect(trade.unlockedBuildings).toContain('tradingPost')
    expect(trade.stock.amber).toBe((plain.stock.amber ?? 0) + 20)
    expect(trade.stock.wood).toBe((plain.stock.wood ?? 0) - 10)
  })

  it("The Queen's Favourite lays a rare cornerstone without moving the run's RNG", () => {
    const plain = run()
    const fav = run('queensFavourite')
    const extra = fav.cornerstones.filter((id) => !plain.cornerstones.includes(id))
    expect(extra).toHaveLength(1)
    expect(CORNERSTONES[extra[0]].rarity).toBe('rare')
    // Same map, same species, same opening: only the twist differs.
    expect(fav.glades).toEqual(plain.glades)
    expect(fav.villagers).toEqual(plain.villagers)
    expect(fav.pendingChoices.map((c) => c.kind)).toEqual(plain.pendingChoices.map((c) => c.kind))
  })

  it('The Deep Works always has Rich Veins, keeping what of the draw fits, and the copper plans', () => {
    expect(run().unlockedBuildings).not.toContain('smelter')
    expect(run('deepWorks').unlockedBuildings).toEqual(expect.arrayContaining(['copperMine', 'smelter']))
    for (const seed of [1, 7, 42, 99, 777, 4242]) {
      const s = run('deepWorks', seed)
      expect(s.runModifiers[0]).toBe('richVeins')
      expect(s.runModifiers).toEqual(commissionLand(drawRunModifiers(seed), 'deepWorks'))
      expect(s.runModifiers.length).toBeLessThanOrEqual(2)
    }
    expect(commissionLand(['longStorms'], undefined)).toEqual(['longStorms'])
    expect(commissionLand(['longStorms', 'richVeins'], 'deepWorks')).toEqual(['richVeins', 'longStorms'])
  })
})

describe('commissions: judging the objective', () => {
  let s: RunState
  beforeEach(() => {
    s = run('holdFrontier')
  })

  it('reads as open while the run is played, and is never met before the end', () => {
    const v = judgeCommission(s)!
    expect(v.final).toBe(false)
    expect(v.met).toBe(false)
    expect(v.terms[0].label).toBe('Hold the settlement')
    expect(v.terms.every((t) => t.state === 'open')).toBe(true)
    expect(v.terms[1].detail).toBe('0/12')
  })

  it('is met by a win with every term held, and not by a loss or a short win', () => {
    s.stats.gladesCleared = 12
    expect(judgeCommission(ended(s, 'won'))!.met).toBe(true)
    expect(judgeCommission(ended(s, 'lost'))!.met).toBe(false)
    s.stats.gladesCleared = 11
    const short = judgeCommission(ended(s, 'won'))!
    expect(short.met).toBe(false)
    expect(short.terms[1].state).toBe('failed')
  })

  it('guards fail the moment they break and hold once judged', () => {
    const light = run('lightWagons')
    expect(judgeCommission(light)!.terms[1].state).toBe('open')
    expect(judgeCommission(ended(light, 'won'))!.met).toBe(true)
    // Home by Year 3 as well: a fourth year fails the wager.
    light.season = { ...light.season, year: 4 }
    expect(judgeCommission(light)!.terms[2].state).toBe('failed')
    expect(judgeCommission(ended(light, 'won'))!.met).toBe(false)
    light.season = { ...light.season, year: 3 }
    light.stats.villagersLost = 1
    expect(judgeCommission(light)!.terms[1].state).toBe('failed')
    expect(judgeCommission(ended(light, 'won'))!.met).toBe(false)

    const storm = run('stormWatch')
    expect(judgeCommission(ended(storm, 'won'))!.met).toBe(true)
    storm.hostility = 26
    expect(judgeCommission(ended(storm, 'won'))!.terms[2]).toMatchObject({ state: 'failed', detail: '26/25' })
    storm.hostility = 25
    expect(judgeCommission(ended(storm, 'won'))!.met).toBe(true)
    storm.feats = { ...storm.feats!, hearthWentCold: true }
    expect(judgeCommission(storm)!.terms[1].state).toBe('failed')
    expect(judgeCommission(ended(storm, 'won'))!.met).toBe(false)
  })

  it('a deadline fails once its year is past', () => {
    const survey = run('royalSurvey')
    survey.season.year = 3
    expect(judgeCommission(ended(survey, 'won'))!.met).toBe(true)
    survey.season.year = 4
    expect(judgeCommission(survey)!.terms[1].state).toBe('failed')
    expect(judgeCommission(ended(survey, 'won'))!.met).toBe(false)
  })

  it('Royal Works brings the herald round a quarter more often (no decree comes while the envoy rides)', () => {
    const works = run('royalWorks')
    const plain = run()
    expect(computeModifiers(works).decreeInterval).toBeCloseTo(0.75)
    expect(computeModifiers(plain).decreeInterval).toBe(1)
    for (const s of [works, plain]) {
      s.decree = null
      s.decreeTimer = 100
      stepDecree(s, 3)
    }
    expect(100 - works.decreeTimer).toBeCloseTo(4)
    expect(100 - plain.decreeTimer).toBeCloseTo(3)
    expect(COMMISSIONS.royalWorks.terms).toEqual([{ kind: 'decrees', amount: 3 }])
  })

  it('counts caravans, decrees and impatience from the run', () => {
    const trade = run('tradeTown')
    const [post, caravans] = COMMISSIONS.tradeTown.terms
    trade.caravan.visits = 4
    expect(termStatus(caravans, trade)).toMatchObject({ state: 'open', detail: '4/5' })
    trade.caravan.visits = 5
    expect(termStatus(caravans, trade).state).toBe('met')
    expect(termStatus(post, ended(trade, 'won')).state).toBe('failed')

    const works = run('royalWorks')
    works.feats = { ...works.feats!, decreesMet: 2 }
    expect(termStatus(COMMISSIONS.royalWorks.terms[0], works).state).toBe('open')
    works.feats = { ...works.feats!, decreesMet: 3 }
    expect(termStatus(COMMISSIONS.royalWorks.terms[0], works).state).toBe('met')

    const fav = run('queensFavourite')
    const calm = COMMISSIONS.queensFavourite.terms[0]
    fav.impatience = fav.maxImpatience - 1
    // Soothing can still bring it down, so it is only failed once judged.
    expect(termStatus(calm, fav).state).toBe('open')
    expect(termStatus(calm, ended(fav, 'won')).state).toBe('failed')
    fav.impatience = 1
    expect(termStatus(calm, ended(fav, 'won')).state).toBe('met')

    const frontier = run('holdFrontier')
    const forest = COMMISSIONS.holdFrontier.terms[1]
    frontier.hostility = 41
    expect(termStatus(forest, frontier)).toMatchObject({ state: 'open', detail: '41/40' })
    expect(termStatus(forest, ended(frontier, 'won')).state).toBe('failed')
    frontier.hostility = 40
    expect(termStatus(forest, ended(frontier, 'won')).state).toBe('met')
  })
})

describe('commissions: the reward', () => {
  it('a met commission pays its share of the run, and the edict multiplies it', () => {
    const s = run('holdFrontier')
    s.stats.gladesCleared = 12
    s.stats.ordersCompleted = 8
    s.season.year = 4
    const plainWon = ended({ ...s, commission: undefined }, 'won')
    const won = ended(s, 'won')
    const base = supplyBreakdown(plainWon)
    const paid = supplyBreakdown(won)
    const bonus = Math.round((base.subtotal * 65) / 100)
    expect(paid.commission).toEqual({ id: 'holdFrontier', met: true, bonus })
    expect(paid.subtotal).toBe(base.subtotal + bonus)
    expect(paid.lines.at(-1)?.label).toMatch(/Commission met: Hold the Frontier/)
    const edict = supplyBreakdown({ ...won, edict: 2 })
    expect(edict.total).toBe(paid.subtotal + Math.round(paid.subtotal * 0.5))
    // Found a Trade Town doubles the run's own payout.
    const trade = ended({ ...run('tradeTown'), stats: s.stats, season: s.season }, 'won')
    trade.caravan.visits = 6
    trade.buildings.post = { ...trade.buildings.hearth, id: 'post', defId: 'tradingPost' }
    const doubled = supplyBreakdown(trade)
    expect(doubled.commission?.met).toBe(true)
    expect(doubled.subtotal).toBe(2 * supplyBreakdown({ ...trade, commission: undefined }).subtotal)
  })

  it('an unmet commission pays nothing extra, and no commission leaves the payout as it was', () => {
    const s = ended(run('holdFrontier'), 'lost')
    const b = supplyBreakdown(s)
    expect(b.commission).toEqual({ id: 'holdFrontier', met: false, bonus: 0 })
    expect(b.lines.some((l) => l.label.startsWith('Commission'))).toBe(false)
    const plain = supplyBreakdown(ended(run(), 'lost'))
    expect(plain.commission).toBeUndefined()
    expect(plain.lines.map((l) => l.label)).toEqual([
      'Settlement founded',
      'Reputation earned',
      'Glades reclaimed',
      'Orders fulfilled',
      'Years endured',
    ])
  })

  it('the ledger records the commission and whether it was met', () => {
    const s = run('holdFrontier')
    s.stats.gladesCleared = 14
    const meta = bankRun(defaultMeta(), ended(s, 'won'), 1000)
    expect(meta.history[0].commission).toEqual({ id: 'holdFrontier', met: true })
    expect(meta.citadelSupplies).toBe(supplyBreakdown(ended(s, 'won')).total)
    expect(bankRun(defaultMeta(), ended(run(), 'won'), 1000).history[0].commission).toBeUndefined()
  })
})

describe('commissions: saves', () => {
  it('Citadel saves from before commissions load, and mangled entries are dropped', () => {
    const old = {
      version: 3,
      citadelSupplies: 12,
      runsWon: 2,
      runsLost: 1,
      upgrades: ['deeperStores', 'unlockFox', 'merchantCharter'],
      history: [
        { seed: 1, won: true, years: 3, reputation: 18, at: 5 },
        { seed: 2, won: false, years: 4, reputation: 9, at: 4, commission: { id: 'holdFrontier', met: false } },
        { seed: 3, won: true, years: 3, reputation: 18, at: 3, commission: { id: 'nope', met: true } },
        { seed: 4, won: true, years: 3, reputation: 18, at: 2, commission: 'tradeTown' },
      ],
    }
    const meta = migrateMeta(old)
    expect(meta.citadelSupplies).toBe(12)
    expect(meta.history.map((e) => e.commission)).toEqual([
      undefined,
      { id: 'holdFrontier', met: false },
      undefined,
      undefined,
    ])
    // The old Citadel's progress already opens the Trade Town.
    expect(commissionOffer(meta)).toContain('tradeTown')
  })

  it('runs from before commissions load without one; a commission survives a save', () => {
    const old = run() as Partial<RunState>
    delete old.commission
    expect(migrateRun(JSON.parse(JSON.stringify(old)))?.commission).toBeUndefined()
    const mangled = { ...JSON.parse(JSON.stringify(old)), commission: 42 }
    expect(migrateRun(mangled)?.commission).toBeUndefined()

    // A save is the run as JSON, read back through the same migration.
    const loaded = migrateRun(JSON.parse(JSON.stringify(run('stormWatch'))))!
    expect(loaded.commission).toBe('stormWatch')
    expect(judgeCommission(loaded)?.def.id).toBe('stormWatch')
  })
})
