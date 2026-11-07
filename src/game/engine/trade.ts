import { BUILDINGS, BUILDING_LIST } from '../content/buildings'
import { CORNERSTONES, RARITY_WEIGHTS } from '../content/cornerstones'
import { RESOURCES, RESOURCE_LIST } from '../content/resources'
import { SPECIES } from '../content/species'
import { TRADE_AGREEMENTS } from '../content/tradeAgreements'
import type {
  CaravanOffer,
  CaravanRare,
  CaravanState,
  ResourceId,
  RunState,
  TradeAgreementId,
} from '../types'
import {
  CARAVAN_FIRST_ARRIVAL,
  CARAVAN_INTERVAL,
  CARAVAN_MARKUP,
  CARAVAN_OFFERS,
  CARAVAN_STAY,
  CARAVAN_WANT_BONUS,
  TRADE_LOT,
} from './balance'
import { cornerstonePool } from './citadel'
import { relevantBlueprints } from './events'
import { pushLog } from './runLog'
import { computeModifiers, type Modifiers } from './modifiers'
import { canAfford, grant, spend, storageUsed } from './queries'
import { makeRng } from './rng'
import { memoByBuildings } from './runCache'
import { recordEvent } from './timeline'

/**
 * Caravans. Once a Trading Post stands, one arrives on a cycle with a rotating
 * stock of lots to buy and one good it pays double for — so every visit asks
 * "what is this caravan worth to *this* settlement?", not "open shop, buy X".
 *
 * Amber is what the caravan trades in, and it buys more than goods:
 *  - from the second visit on, each caravan carries one **rare item** — a
 *    blueprint toward a service the settlement wants, or a cornerstone once
 *    none is left — at a price that climbs with every one bought;
 *  - a **commission** pays now for a lot of any good, delivered with the next
 *    caravan, so a missing service good can be bridged until its chain stands;
 *  - one **trade agreement** per run bends every later caravan toward buying
 *    service goods, calling more often, or paying more for surplus.
 */

// ---------------------------------------------------------------------------
// Prices of the amber levers (kept here, beside the only code that reads them)
// ---------------------------------------------------------------------------

/** Visit from which caravans carry a rare item. */
export const RARE_FIRST_VISIT = 2
/** Asking price of a rare blueprint / cornerstone before any is bought. */
export const RARE_BLUEPRINT_PRICE = 100
export const RARE_CORNERSTONE_PRICE = 140
/** Added to every later rare item's price per rare item already bought. */
export const RARE_PRICE_GROWTH = 50
/** Units in a commissioned shipment, and its markup over base value. */
export const COMMISSION_LOT = 12
export const COMMISSION_MARKUP = 1.3
/** Amber to sign a trade agreement (once per run). */
export const AGREEMENT_PRICE = 120
/** Units in the Provisioners' Guild's extra service-good lot. */
export const PROVISIONS_LOT = 10
/** River Barges: time between visits is divided by this; visits run longer. */
export const BARGES_FREQUENCY = 1.35
export const BARGES_EXTRA_STAY = 40
/** Factors' Compact: multiplier on everything the caravan pays you. */
export const FACTORS_SELL_BONUS = 1.5

export function defaultCaravan(): CaravanState {
  return {
    here: false,
    timer: CARAVAN_FIRST_ARRIVAL,
    offers: [],
    wants: 'plank',
    visits: 0,
  }
}

export function hasTradingPost(s: RunState): boolean {
  return memoByBuildings(s, 'hasTradingPost', () =>
    Object.values(s.buildings).some((b) => b.defId === 'tradingPost' && b.built),
  )
}

/** Goods a caravan may carry: everything tradable except amber itself. */
export const CARAVAN_POOL: ResourceId[] = RESOURCE_LIST.filter(
  (r) => r.category !== 'currency',
).map((r) => r.id)

/** Goods a caravan may crave — things worth hauling back to the Citadel. */
const WANT_POOL: ResourceId[] = RESOURCE_LIST.filter(
  (r) => r.category !== 'currency' && r.value >= 2,
).map((r) => r.id)

/** A lot of `amount` units at the caravan's usual markup. */
function lotPrice(resource: ResourceId, amount: number): number {
  return Math.max(1, Math.ceil((RESOURCES[resource]?.value ?? 1) * amount * CARAVAN_MARKUP))
}

function rollOffers(s: RunState): void {
  const rng = makeRng(s.seed, s.rngCursor)
  const goods = rng.sample(CARAVAN_POOL, CARAVAN_OFFERS)
  s.caravan.offers = goods.map((resource) => {
    const amount = rng.range(5, 12)
    return { resource, amount, price: lotPrice(resource, amount), sold: false }
  })
  s.caravan.wants = rng.pick(WANT_POOL)
  s.rngCursor = rng.cursor()
}

/**
 * Whether caravans call at all: once a Trading Post stands, or anywhere when a
 * run modifier has traders wandering the roads.
 */
export function caravanAvailable(s: RunState, mods: Modifiers = computeModifiers(s)): boolean {
  return mods.caravanWithoutPost || hasTradingPost(s)
}

/** Seconds between visits, after modifiers and the River Barges. */
export function caravanInterval(s: RunState, mods: Modifiers = computeModifiers(s)): number {
  const barges = s.caravan.agreement === 'barges' ? BARGES_FREQUENCY : 1
  return (CARAVAN_INTERVAL * mods.caravanInterval) / barges
}

/** Seconds a caravan stays in town. */
export function caravanStay(s: RunState): number {
  return CARAVAN_STAY + (s.caravan.agreement === 'barges' ? BARGES_EXTRA_STAY : 0)
}

export function stepCaravan(s: RunState, dt: number, mods: Modifiers = computeModifiers(s)): void {
  if (s.caravan.held?.length) unloadHeld(s)
  // No road, no caravans: the timer only runs once a Trading Post stands.
  if (!caravanAvailable(s, mods)) return

  s.caravan.timer -= dt
  if (s.caravan.timer > 0) return

  if (s.caravan.here) {
    s.caravan.here = false
    s.caravan.timer = caravanInterval(s, mods)
    leavePaidLots(s)
    s.caravan.offers = []
    s.caravan.rare = null
    pushLog(s, '🐫 The caravan packs up and moves on.', 'info')
  } else {
    s.caravan.here = true
    s.caravan.timer = caravanStay(s)
    s.caravan.visits++
    rollOffers(s)
    addProvisions(s)
    rollRare(s)
    pushLog(
      s,
      `🐫 A caravan has arrived — it pays double for ${RESOURCES[s.caravan.wants]?.name}.`,
      'good',
    )
    deliverCommission(s)
  }
}

// ---------------------------------------------------------------------------
// Buying and selling goods
// ---------------------------------------------------------------------------

/** Asking price for an offer after cornerstone discounts (nothing for a paid lot). */
export function offerPrice(s: RunState, index: number): number {
  const offer = s.caravan.offers[index]
  if (!offer) return 0
  if (offer.prepaid) return 0
  const mods = computeModifiers(s)
  return Math.max(1, Math.ceil(offer.price * mods.tradePrices))
}

export function buyOffer(s: RunState, index: number): string | null {
  const offer = s.caravan.offers[index]
  if (!s.caravan.here || !offer) return 'The caravan is not here.'
  if (offer.sold) return offer.prepaid ? 'That shipment is already collected.' : 'That lot is already sold.'
  if (offer.prepaid) return collectPaidLot(s, offer)
  const price = offerPrice(s, index)
  if ((s.stock.amber ?? 0) < price) return 'Not enough amber.'
  if (storageUsed(s) + offer.amount > s.storageCap) return 'The stockpile is full.'
  spend(s.stock, { amber: price })
  grant(s.stock, { [offer.resource]: offer.amount }, s.storageCap, storageUsed(s))
  offer.sold = true
  pushLog(s, `Bought ${offer.amount} × ${RESOURCES[offer.resource]?.name} for ${price} amber.`, 'info')
  return null
}

/** Whole units of room left in the stockpile. */
function roomLeft(s: RunState): number {
  return Math.max(0, Math.floor(s.storageCap - storageUsed(s)))
}

/**
 * Collects as much of a paid commission lot as the stockpile has room for;
 * whatever does not fit stays on the caravan to collect later.
 */
function collectPaidLot(s: RunState, offer: CaravanOffer): string | null {
  const take = Math.min(offer.amount, roomLeft(s))
  if (take <= 0) return 'The stockpile is full.'
  grant(s.stock, { [offer.resource]: take })
  offer.amount -= take
  if (offer.amount <= 0) {
    offer.amount = take
    offer.sold = true
  }
  const name = RESOURCES[offer.resource]?.name ?? offer.resource
  pushLog(
    s,
    offer.sold
      ? `Collected the commissioned ${take} × ${name}.`
      : `Collected ${take} × ${name} of the commission; ${offer.amount} more wait on the caravan for room.`,
    'info',
  )
  return null
}

/**
 * A caravan never leaves with goods already paid for: as it packs up, any
 * uncollected commission is unloaded into the stockpile as far as room allows,
 * and the rest is left at the hearth, unloaded as room frees.
 */
function leavePaidLots(s: RunState): void {
  for (const offer of s.caravan.offers) {
    if (!offer.prepaid || offer.sold || offer.amount <= 0) continue
    const take = Math.min(offer.amount, roomLeft(s))
    if (take > 0) grant(s.stock, { [offer.resource]: take })
    const left = offer.amount - take
    const name = RESOURCES[offer.resource]?.name ?? offer.resource
    if (left > 0) {
      const held = (s.caravan.held ??= [])
      const same = held.find((h) => h.resource === offer.resource)
      if (same) same.amount += left
      else held.push({ resource: offer.resource, amount: left })
      pushLog(
        s,
        `🐫 The caravan leaves the rest of your commission at the hearth: ${left} × ${name}, unloaded as room frees.`,
        'info',
      )
    } else {
      pushLog(s, `🐫 The caravan unloads the rest of your commission before it leaves: ${take} × ${name}.`, 'info')
    }
  }
}

/** Moves commissioned goods left at the hearth into the stockpile as room frees. */
function unloadHeld(s: RunState): void {
  const held = s.caravan.held
  if (!held) return
  for (const lot of held) {
    const take = Math.min(lot.amount, roomLeft(s))
    if (take <= 0) continue
    grant(s.stock, { [lot.resource]: take })
    lot.amount -= take
    if (lot.amount <= 0) {
      pushLog(s, `🐫 The last of the commissioned ${RESOURCES[lot.resource]?.name ?? lot.resource} is unloaded.`, 'info')
    }
  }
  s.caravan.held = held.filter((lot) => lot.amount > 0)
}

/** What the caravan pays for one lot of `resource` right now. */
export function sellPrice(s: RunState, resource: ResourceId, amount: number): number {
  const base = (RESOURCES[resource]?.value ?? 1) * amount
  const bonus = s.caravan.here && s.caravan.wants === resource ? CARAVAN_WANT_BONUS : 1
  const factors = s.caravan.agreement === 'factors' ? FACTORS_SELL_BONUS : 1
  return Math.max(1, Math.floor(base * bonus * factors))
}

export function sellResource(s: RunState, resource: ResourceId): string | null {
  if (!s.caravan.here) return 'No caravan to sell to.'
  if (resource === 'amber') return 'The caravan deals in amber; it does not buy it.'
  if (!canAfford(s.stock, { [resource]: TRADE_LOT })) {
    return `You need ${TRADE_LOT} to make a lot.`
  }
  const paid = sellPrice(s, resource, TRADE_LOT)
  spend(s.stock, { [resource]: TRADE_LOT })
  grant(s.stock, { amber: paid })
  pushLog(
    s,
    `Sold ${TRADE_LOT} × ${RESOURCES[resource]?.name} for ${paid} amber.`,
    'info',
  )
  return null
}

// ---------------------------------------------------------------------------
// Rare items: a blueprint or a cornerstone for sale
// ---------------------------------------------------------------------------

/** Ids already on offer in a queued draft — never sold twice over. */
function inDrafts(s: RunState): Set<string> {
  return new Set(s.pendingChoices.flatMap((c) => (c.kind === 'blueprint' || c.kind === 'cornerstone' ? c.options : [])))
}

/**
 * The rare item for this visit: a locked blueprint toward a service the
 * settlement wants (one of the two most useful, at random), or — once none is
 * left — a cornerstone drawn by rarity. Nothing on the first visit.
 */
function rollRare(s: RunState): void {
  s.caravan.rare = null
  if (s.caravan.visits < RARE_FIRST_VISIT) return
  const offered = inDrafts(s)
  const bought = s.caravan.raresBought ?? 0
  const rng = makeRng(s.seed, s.rngCursor)
  const blueprints = relevantBlueprints(s).filter((id) => !offered.has(id)).slice(0, 2)
  let rare: CaravanRare | null = null
  if (blueprints.length > 0) {
    rare = {
      kind: 'blueprint',
      id: rng.pick(blueprints),
      price: RARE_BLUEPRINT_PRICE + bought * RARE_PRICE_GROWTH,
      sold: false,
    }
  } else {
    const stones = cornerstonePool(s).filter((c) => !s.cornerstones.includes(c.id) && !offered.has(c.id))
    if (stones.length > 0) {
      rare = {
        kind: 'cornerstone',
        id: rng.weighted(stones, (c) => RARITY_WEIGHTS[c.rarity]).id,
        price: RARE_CORNERSTONE_PRICE + bought * RARE_PRICE_GROWTH,
        sold: false,
      }
    }
  }
  s.rngCursor = rng.cursor()
  s.caravan.rare = rare
}

/** Display name of a rare item. */
export function rareName(rare: Pick<CaravanRare, 'kind' | 'id'>): string {
  return rare.kind === 'blueprint'
    ? (BUILDINGS[rare.id]?.name ?? rare.id)
    : (CORNERSTONES[rare.id]?.name ?? rare.id)
}

/** What the rare item costs right now, after cornerstone discounts. */
export function rarePrice(s: RunState): number {
  const rare = s.caravan.rare
  if (!rare) return 0
  return Math.max(1, Math.ceil(rare.price * computeModifiers(s).tradePrices))
}

export function buyRare(s: RunState): string | null {
  const rare = s.caravan.rare
  if (!s.caravan.here || !rare) return 'The caravan carries nothing rare this visit.'
  if (rare.sold) return 'Already bought.'
  if (rare.kind === 'blueprint' && s.unlockedBuildings.includes(rare.id)) return 'You already have that blueprint.'
  if (rare.kind === 'cornerstone' && s.cornerstones.includes(rare.id)) return 'That cornerstone is already laid.'
  const price = rarePrice(s)
  if ((s.stock.amber ?? 0) < price) return 'Not enough amber.'
  spend(s.stock, { amber: price })
  rare.sold = true
  s.caravan.raresBought = (s.caravan.raresBought ?? 0) + 1
  const name = rareName(rare)
  if (rare.kind === 'blueprint') {
    s.unlockedBuildings.push(rare.id)
    pushLog(s, `Blueprint bought from the caravan: ${name}, for ${price} amber.`, 'good')
  } else {
    s.cornerstones.push(rare.id)
    recordEvent(s, 'cornerstone', name)
    pushLog(s, `Cornerstone bought from the caravan: ${name}, for ${price} amber.`, 'good')
  }
  return null
}

// ---------------------------------------------------------------------------
// Commissions: pay now, delivered with the next caravan
// ---------------------------------------------------------------------------

/** Goods that can be commissioned: anything the caravans trade in. */
export const COMMISSION_GOODS: ResourceId[] = CARAVAN_POOL

/** Amber to commission a lot of `resource`, after cornerstone discounts. */
export function commissionPrice(s: RunState, resource: ResourceId): number {
  const base = (RESOURCES[resource]?.value ?? 1) * COMMISSION_LOT * COMMISSION_MARKUP
  return Math.max(1, Math.ceil(base * computeModifiers(s).tradePrices))
}

export function commissionShipment(s: RunState, resource: ResourceId): string | null {
  if (!caravanAvailable(s)) return 'No caravans call here yet.'
  if (!COMMISSION_GOODS.includes(resource)) return 'The caravans do not carry that.'
  if (s.caravan.commission) return 'A shipment is already on its way.'
  const price = commissionPrice(s, resource)
  if ((s.stock.amber ?? 0) < price) return 'Not enough amber.'
  spend(s.stock, { amber: price })
  s.caravan.commission = { resource, amount: COMMISSION_LOT }
  pushLog(
    s,
    `Commissioned ${COMMISSION_LOT} × ${RESOURCES[resource]?.name} for ${price} amber — it comes with the next caravan.`,
    'info',
  )
  return null
}

/**
 * Hands over a commissioned shipment as the caravan arrives: what fits goes
 * straight into the stockpile, and the rest waits on the caravan as a paid lot
 * to collect once there is room.
 */
function deliverCommission(s: RunState): void {
  const order = s.caravan.commission
  if (!order) return
  s.caravan.commission = null
  const name = RESOURCES[order.resource]?.name ?? order.resource
  const added = grant(s.stock, { [order.resource]: order.amount }, s.storageCap, storageUsed(s))
  const left = order.amount - added
  if (left > 0) {
    s.caravan.offers.unshift({ resource: order.resource, amount: left, price: 0, sold: false, prepaid: true })
    pushLog(
      s,
      added > 0
        ? `🐫 The commissioned ${name} arrives: ${added} unloaded, ${left} wait on the caravan for room.`
        : `🐫 The commissioned ${name} arrives, but the stockpile is full — collect it from the caravan.`,
      'info',
    )
  } else {
    pushLog(s, `🐫 The commissioned ${order.amount} × ${name} arrives with the caravan.`, 'good')
  }
}

// ---------------------------------------------------------------------------
// Trade agreements: once per run, they change every caravan that follows
// ---------------------------------------------------------------------------

export function signAgreement(s: RunState, id: TradeAgreementId): string | null {
  if (!caravanAvailable(s)) return 'No caravans call here yet.'
  if (!TRADE_AGREEMENTS[id]) return 'No such agreement.'
  if (s.caravan.agreement) return 'An agreement is already signed for this run.'
  if ((s.stock.amber ?? 0) < AGREEMENT_PRICE) return 'Not enough amber.'
  spend(s.stock, { amber: AGREEMENT_PRICE })
  s.caravan.agreement = id
  if (id === 'barges' && !s.caravan.here) {
    // The next caravan is already on the river.
    s.caravan.timer = Math.min(s.caravan.timer, caravanInterval(s))
  }
  pushLog(s, `⚖️ Trade agreement signed: ${TRADE_AGREEMENTS[id].name}, for ${AGREEMENT_PRICE} amber.`, 'good')
  return null
}

/** Service goods the venues of this settlement's needs hand out. */
export function settlementServiceGoods(s: RunState): ResourceId[] {
  const needs = new Set<string>()
  for (const v of Object.values(s.villagers)) for (const need of SPECIES[v.species]?.needs ?? []) needs.add(need)
  const goods: ResourceId[] = []
  for (const venue of BUILDING_LIST) {
    if (!venue.service || !needs.has(venue.service.need)) continue
    for (const good of Object.keys(venue.recipes[0]?.inputs ?? {}) as ResourceId[]) {
      if (!goods.includes(good)) goods.push(good)
    }
  }
  return goods
}

/** True when some building this run can raise makes `good`. */
function canMake(s: RunState, good: ResourceId): boolean {
  return s.unlockedBuildings.some((id) =>
    BUILDINGS[id]?.recipes.some((r) => ((r.outputs as Record<string, number>)[good] ?? 0) > 0),
  )
}

/**
 * The Provisioners' Guild's extra lot: a service good the settlement's venues
 * use, preferring one it has no blueprint to make.
 */
export function provisionsGood(s: RunState): ResourceId | null {
  const goods = settlementServiceGoods(s)
  return goods.find((g) => !canMake(s, g)) ?? goods[0] ?? null
}

function addProvisions(s: RunState): void {
  if (s.caravan.agreement !== 'provisioners') return
  const good = provisionsGood(s)
  if (!good) return
  const existing = s.caravan.offers.find((o) => o.resource === good)
  if (existing) {
    existing.amount += PROVISIONS_LOT
    existing.price = lotPrice(good, existing.amount)
  } else {
    s.caravan.offers.push({ resource: good, amount: PROVISIONS_LOT, price: lotPrice(good, PROVISIONS_LOT), sold: false })
  }
}
