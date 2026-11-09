import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../content/buildings'
import { COMMISSIONS, termStatus } from '../content/commissions'
import { CORNERSTONES } from '../content/cornerstones'
import { RESOURCES } from '../content/resources'
import { TRADE_AGREEMENT_LIST } from '../content/tradeAgreements'
import { migrateRun } from '../persistence'
import type { RunState } from '../types'
import { findPlacement, placeBuilding } from './actions'
import { CARAVAN_INTERVAL, CARAVAN_OFFERS, CARAVAN_STAY, CARAVAN_WANT_BONUS, TRADE_LOT } from './balance'
import { createRun } from './createRun'
import { relevantBlueprints } from './serviceChains'
import { takeChoice } from './drafts'
import { storageUsed } from './queries'
import {
  AGREEMENT_PRICE,
  BARGES_EXTRA_STAY,
  BARGES_FREQUENCY,
  COMMISSION_LOT,
  COMMISSION_MARKUP,
  FACTORS_SELL_BONUS,
  PROVISIONS_LOT,
  RARE_BLUEPRINT_PRICE,
  RARE_CORNERSTONE_PRICE,
  RARE_FIRST_VISIT,
  RARE_PRICE_GROWTH,
  buyOffer,
  buyRare,
  caravanInterval,
  commissionPrice,
  commissionShipment,
  defaultCaravan,
  provisionsGood,
  rarePrice,
  sellPrice,
  sellResource,
  settlementServiceGoods,
  signAgreement,
  stepCaravan,
} from './trade'

/** A run past its opening drafts, with no map modifiers, and a built Trading Post. */
function tradingRun(seed = 4242): RunState {
  const s = createRun({ seed, species: ['human', 'beaver', 'lizard'], modifiers: [] })
  let guard = 0
  while (s.pendingChoices.length > 0 && guard++ < 10) takeChoice(s, s.pendingChoices[0].options[0])
  if (!s.unlockedBuildings.includes('tradingPost')) s.unlockedBuildings.push('tradingPost')
  placeBuilding(s, 'tradingPost', findPlacement(s, 'tradingPost')!)
  Object.values(s.buildings).find((b) => b.defId === 'tradingPost')!.built = true
  return s
}

/** Brings the next caravan into town. */
function arrive(s: RunState): void {
  if (s.caravan.here) stepCaravan(s, s.caravan.timer + 0.01) // see the current one off first
  stepCaravan(s, s.caravan.timer + 0.01)
  expect(s.caravan.here).toBe(true)
}

describe('caravan rare items', () => {
  it('carries nothing rare on the first visit, then a wanted blueprint from the second', () => {
    const s = tradingRun()
    arrive(s)
    expect(s.caravan.visits).toBe(1)
    expect(s.caravan.rare ?? null).toBeNull()

    const wanted = relevantBlueprints(s).slice(0, 2)
    expect(wanted.length).toBeGreaterThan(0)
    arrive(s)
    expect(s.caravan.visits).toBe(RARE_FIRST_VISIT)
    const rare = s.caravan.rare!
    expect(rare.kind).toBe('blueprint')
    expect(wanted).toContain(rare.id)
    expect(rare.price).toBe(RARE_BLUEPRINT_PRICE)
    // It leaves with the caravan.
    stepCaravan(s, s.caravan.timer + 0.01)
    expect(s.caravan.rare).toBeNull()
  })

  it('buying the blueprint unlocks it, and every rare item after costs more', () => {
    const s = tradingRun()
    arrive(s)
    arrive(s)
    const rare = s.caravan.rare!
    s.stock.amber = RARE_BLUEPRINT_PRICE - 1
    expect(buyRare(s)).toBe('Not enough amber.')
    expect(s.unlockedBuildings).not.toContain(rare.id)

    s.stock.amber = RARE_BLUEPRINT_PRICE + 5
    expect(buyRare(s)).toBeNull()
    expect(s.unlockedBuildings).toContain(rare.id)
    expect(s.stock.amber).toBe(5)
    expect(s.caravan.raresBought).toBe(1)
    expect(buyRare(s)).toBe('Already bought.')

    arrive(s)
    const next = s.caravan.rare!
    expect(next.id).not.toBe(rare.id)
    expect(next.price).toBe(
      (next.kind === 'blueprint' ? RARE_BLUEPRINT_PRICE : RARE_CORNERSTONE_PRICE) + RARE_PRICE_GROWTH,
    )
  })

  it('offers a cornerstone once no wanted blueprint is left, and lays it when bought', () => {
    const s = tradingRun()
    // Unlocking a venue reveals its missing workshop, so draft until nothing is wanted.
    for (let i = 0; i < 5; i++) for (const id of relevantBlueprints(s)) s.unlockedBuildings.push(id)
    expect(relevantBlueprints(s)).toEqual([])
    arrive(s)
    arrive(s)
    const rare = s.caravan.rare!
    expect(rare.kind).toBe('cornerstone')
    expect(CORNERSTONES[rare.id]).toBeTruthy()
    expect(rare.price).toBe(RARE_CORNERSTONE_PRICE)
    s.stock.amber = 1000
    expect(buyRare(s)).toBeNull()
    expect(s.cornerstones).toContain(rare.id)
    expect(s.stock.amber).toBe(1000 - RARE_CORNERSTONE_PRICE)
  })

  it('never sells what a queued draft is already offering', () => {
    const s = tradingRun()
    const wanted = relevantBlueprints(s).slice(0, 2)
    s.pendingChoices.push({ kind: 'blueprint', options: [...wanted] })
    arrive(s)
    arrive(s)
    if (s.caravan.rare) expect(wanted).not.toContain(s.caravan.rare.id)
  })

  it('cornerstone trade discounts apply to rare items', () => {
    const s = tradingRun()
    arrive(s)
    arrive(s)
    const full = rarePrice(s)
    const discount = Object.values(CORNERSTONES).find((c) =>
      c.effects.some((e) => e.kind === 'tradePrices' && e.percent === -25),
    )!
    s.cornerstones.push(discount.id)
    expect(rarePrice(s)).toBe(Math.ceil(full * 0.75))
  })
})

describe('commissioned shipments', () => {
  it('pays up front and delivers the lot with the next caravan', () => {
    const s = tradingRun()
    const price = commissionPrice(s, 'ale')
    expect(price).toBe(Math.ceil(RESOURCES.ale.value * COMMISSION_LOT * COMMISSION_MARKUP))
    s.stock.amber = price + 10
    expect(commissionShipment(s, 'ale')).toBeNull()
    expect(s.stock.amber).toBe(10)
    expect(s.caravan.commission).toEqual({ resource: 'ale', amount: COMMISSION_LOT })
    // One at a time.
    s.stock.amber = 1000
    expect(commissionShipment(s, 'tea')).toBe('A shipment is already on its way.')

    const before = s.stock.ale ?? 0
    arrive(s)
    expect(s.stock.ale ?? 0).toBe(before + COMMISSION_LOT)
    expect(s.caravan.commission).toBeNull()
  })

  it('refuses without caravans, amber, or for amber itself', () => {
    const s = createRun({ seed: 7, species: ['human', 'beaver', 'lizard'], modifiers: [] })
    s.stock.amber = 1000
    expect(commissionShipment(s, 'ale')).toBe('No caravans call here yet.')
    const t = tradingRun()
    t.stock.amber = 0
    expect(commissionShipment(t, 'ale')).toBe('Not enough amber.')
    t.stock.amber = 1000
    expect(commissionShipment(t, 'amber')).toBe('The caravans do not carry that.')
  })

  it('holds what does not fit as a paid lot to collect from the caravan', () => {
    const s = tradingRun()
    s.stock.amber = 1000
    commissionShipment(s, 'brick')
    // Leave room for only 5 bricks.
    s.stock.stone = (s.stock.stone ?? 0) + (s.storageCap - storageUsed(s) - 5)
    const bricks = s.stock.brick ?? 0
    arrive(s)
    expect(s.stock.brick ?? 0).toBe(bricks + 5)
    const held = s.caravan.offers[0]
    expect(held).toMatchObject({ resource: 'brick', amount: COMMISSION_LOT - 5, prepaid: true, sold: false })
    expect(buyOffer(s, 0)).toBe('The stockpile is full.')
    s.stock.stone = 0
    const amber = s.stock.amber
    expect(buyOffer(s, 0)).toBeNull()
    expect(s.stock.amber).toBe(amber) // already paid for
    expect(s.stock.brick).toBe(bricks + COMMISSION_LOT)
  })

  it('collects as much of a paid lot as there is room for', () => {
    const s = tradingRun()
    s.stock.amber = 1000
    commissionShipment(s, 'brick')
    s.stock.stone = (s.stock.stone ?? 0) + (s.storageCap - storageUsed(s))
    const bricks = s.stock.brick ?? 0
    arrive(s)
    expect(s.caravan.offers[0]).toMatchObject({ amount: COMMISSION_LOT, prepaid: true })
    // Room for four: four come off the caravan, the rest wait.
    s.stock.stone = (s.stock.stone ?? 0) - 4
    expect(buyOffer(s, 0)).toBeNull()
    expect(s.stock.brick).toBe(bricks + 4)
    expect(s.caravan.offers[0]).toMatchObject({ amount: COMMISSION_LOT - 4, sold: false })
    s.stock.stone = 0
    expect(buyOffer(s, 0)).toBeNull()
    expect(s.stock.brick).toBe(bricks + COMMISSION_LOT)
    expect(s.caravan.offers[0].sold).toBe(true)
  })

  it('never takes paid goods away: a leaving caravan unloads what fits and leaves the rest at the hearth', () => {
    const s = tradingRun()
    s.stock.amber = 1000
    commissionShipment(s, 'brick')
    s.stock.stone = (s.stock.stone ?? 0) + (s.storageCap - storageUsed(s) - 2)
    const bricks = s.stock.brick ?? 0
    arrive(s)
    expect(s.stock.brick).toBe(bricks + 2)
    // Still no room when it packs up, bar three more.
    s.stock.stone = (s.stock.stone ?? 0) - 3
    stepCaravan(s, s.caravan.timer + 0.01)
    expect(s.caravan.here).toBe(false)
    expect(s.stock.brick).toBe(bricks + 5)
    expect(s.caravan.held).toEqual([{ resource: 'brick', amount: COMMISSION_LOT - 5 }])
    expect(s.log.some((l) => /left at the hearth|leaves the rest/.test(l.text))).toBe(true)
    // Room frees: the rest is unloaded, with no caravan in town.
    s.stock.stone = 0
    stepCaravan(s, 0.1)
    expect(s.stock.brick).toBe(bricks + COMMISSION_LOT)
    expect(s.caravan.held).toEqual([])
  })

  it('a leaving caravan unloads the whole paid lot when there is room by then', () => {
    const s = tradingRun()
    s.stock.amber = 1000
    commissionShipment(s, 'ale')
    s.stock.stone = (s.stock.stone ?? 0) + (s.storageCap - storageUsed(s))
    const ale = s.stock.ale ?? 0
    arrive(s)
    s.stock.stone = 0
    stepCaravan(s, s.caravan.timer + 0.01)
    expect(s.stock.ale).toBe(ale + COMMISSION_LOT)
    expect(s.caravan.held ?? []).toEqual([])
  })
})

describe('trade agreements', () => {
  it('signs once per run, for a fixed price, only where caravans call', () => {
    const none = createRun({ seed: 7, species: ['human', 'beaver', 'lizard'], modifiers: [] })
    none.stock.amber = 1000
    expect(signAgreement(none, 'factors')).toBe('No caravans call here yet.')

    const s = tradingRun()
    s.stock.amber = AGREEMENT_PRICE - 1
    expect(signAgreement(s, 'factors')).toBe('Not enough amber.')
    s.stock.amber = AGREEMENT_PRICE
    expect(signAgreement(s, 'factors')).toBeNull()
    expect(s.caravan.agreement).toBe('factors')
    expect(s.stock.amber ?? 0).toBe(0)
    s.stock.amber = 1000
    expect(signAgreement(s, 'barges')).toBe('An agreement is already signed for this run.')
    expect(TRADE_AGREEMENT_LIST.map((a) => a.id).sort()).toEqual(['barges', 'factors', 'provisioners'])
  })

  it("Factors' Compact: caravans pay half again for everything sold", () => {
    const s = tradingRun()
    arrive(s)
    const other = (['plank', 'stone', 'brick'] as const).find((r) => r !== s.caravan.wants)!
    const plain = sellPrice(s, other, TRADE_LOT)
    const wanted = sellPrice(s, s.caravan.wants, TRADE_LOT)
    s.stock.amber = AGREEMENT_PRICE
    signAgreement(s, 'factors')
    expect(sellPrice(s, other, TRADE_LOT)).toBe(
      Math.floor(RESOURCES[other].value * TRADE_LOT * FACTORS_SELL_BONUS),
    )
    expect(sellPrice(s, other, TRADE_LOT)).toBeGreaterThan(plain)
    expect(sellPrice(s, s.caravan.wants, TRADE_LOT)).toBe(
      Math.floor(RESOURCES[s.caravan.wants].value * TRADE_LOT * CARAVAN_WANT_BONUS * FACTORS_SELL_BONUS),
    )
    expect(sellPrice(s, s.caravan.wants, TRADE_LOT)).toBeGreaterThan(wanted)
    s.stock[other] = TRADE_LOT
    expect(sellResource(s, other)).toBeNull()
    expect(s.stock.amber).toBe(Math.floor(RESOURCES[other].value * TRADE_LOT * FACTORS_SELL_BONUS))
  })

  it('River Barges: caravans call more often and stay longer', () => {
    const s = tradingRun()
    expect(caravanInterval(s)).toBe(CARAVAN_INTERVAL)
    s.stock.amber = AGREEMENT_PRICE
    signAgreement(s, 'barges')
    expect(caravanInterval(s)).toBeCloseTo(CARAVAN_INTERVAL / BARGES_FREQUENCY)
    arrive(s)
    expect(s.caravan.timer).toBe(CARAVAN_STAY + BARGES_EXTRA_STAY)
    stepCaravan(s, s.caravan.timer + 0.01)
    expect(s.caravan.timer).toBeCloseTo(CARAVAN_INTERVAL / BARGES_FREQUENCY)
  })

  it("Provisioners' Guild: every caravan carries a service good the settlement cannot make", () => {
    const s = tradingRun()
    const goods = settlementServiceGoods(s)
    expect(goods.length).toBeGreaterThan(0)
    const good = provisionsGood(s)!
    expect(goods).toContain(good)
    // It prefers a good no unlocked building makes.
    const makers = s.unlockedBuildings.filter((id) =>
      BUILDINGS[id]?.recipes.some((r) => ((r.outputs as Record<string, number>)[good] ?? 0) > 0),
    )
    const someoneMissing = goods.some(
      (g) => !s.unlockedBuildings.some((id) => BUILDINGS[id]?.recipes.some((r) => ((r.outputs as Record<string, number>)[g] ?? 0) > 0)),
    )
    if (someoneMissing) expect(makers).toEqual([])

    s.stock.amber = AGREEMENT_PRICE
    signAgreement(s, 'provisioners')
    arrive(s)
    const lot = s.caravan.offers.find((o) => o.resource === good)!
    expect(lot).toBeTruthy()
    expect(lot.amount).toBeGreaterThanOrEqual(PROVISIONS_LOT)
    expect(s.caravan.offers.length).toBeGreaterThanOrEqual(CARAVAN_OFFERS)
  })
})

describe('the Found a Trade Town commission', () => {
  it('still counts caravans welcomed, and its quicker caravans stack with River Barges', () => {
    const s = createRun({ seed: 4242, species: ['human', 'beaver', 'lizard'], modifiers: [], commission: 'tradeTown' })
    let guard = 0
    while (s.pendingChoices.length > 0 && guard++ < 10) takeChoice(s, s.pendingChoices[0].options[0])
    expect(s.unlockedBuildings).toContain('tradingPost')
    placeBuilding(s, 'tradingPost', findPlacement(s, 'tradingPost')!)
    Object.values(s.buildings).find((b) => b.defId === 'tradingPost')!.built = true
    // The commission's 20% quicker caravans come through the shared interval.
    expect(caravanInterval(s)).toBeCloseTo(CARAVAN_INTERVAL * 0.8)
    s.stock.amber = AGREEMENT_PRICE
    expect(signAgreement(s, 'barges')).toBeNull()
    expect(caravanInterval(s)).toBeCloseTo((CARAVAN_INTERVAL * 0.8) / BARGES_FREQUENCY)

    const caravans = COMMISSIONS.tradeTown.terms.find((term) => term.kind === 'caravans')!
    expect(caravans).toMatchObject({ amount: 5 })
    for (let visit = 1; visit <= 5; visit++) {
      arrive(s)
      expect(termStatus(caravans, s).detail).toBe(`${visit}/5`)
      // Rare items and commissions do not touch the count.
      s.stock.amber = 10_000
      buyRare(s)
      if (!s.caravan.commission) commissionShipment(s, 'plank')
    }
    expect(termStatus(caravans, s).state).toBe('met')
  })
})

describe('trade save compatibility', () => {
  it('a caravan saved before the amber levers loads with none of them', () => {
    const s = tradingRun()
    const raw = JSON.parse(JSON.stringify(s)) as RunState
    raw.caravan = { here: false, timer: 30, offers: [], wants: 'plank', visits: 3 } as RunState['caravan']
    const loaded = migrateRun(raw)!
    expect(loaded.caravan.rare ?? null).toBeNull()
    expect(loaded.caravan.commission ?? null).toBeNull()
    expect(loaded.caravan.agreement ?? null).toBeNull()
    expect(caravanInterval(loaded)).toBe(CARAVAN_INTERVAL)
    loaded.stock.amber = 1000
    expect(signAgreement(loaded, 'barges')).toBeNull()
    // And a save with no caravan at all gets the default one.
    const bare = JSON.parse(JSON.stringify(s)) as Partial<RunState>
    delete bare.caravan
    expect(migrateRun(bare)!.caravan).toEqual(defaultCaravan())
  })
})
