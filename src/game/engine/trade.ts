import { RESOURCES, RESOURCE_LIST } from '../content/resources'
import type { CaravanState, ResourceId, RunState } from '../types'
import {
  CARAVAN_FIRST_ARRIVAL,
  CARAVAN_INTERVAL,
  CARAVAN_MARKUP,
  CARAVAN_OFFERS,
  CARAVAN_STAY,
  CARAVAN_WANT_BONUS,
  TRADE_LOT,
} from './balance'
import { pushLog } from './createRun'
import { computeModifiers, type Modifiers } from './modifiers'
import { canAfford, grant, spend, storageUsed } from './queries'
import { makeRng } from './rng'

/**
 * Caravans. Once a Trading Post stands, one arrives on a cycle with a rotating
 * stock of lots to buy and one good it pays double for — so every visit asks
 * "what is this caravan worth to *this* settlement?", not "open shop, buy X".
 */

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
  return Object.values(s.buildings).some((b) => b.defId === 'tradingPost' && b.built)
}

/** Goods a caravan may carry: everything tradable except amber itself. */
const CARAVAN_POOL: ResourceId[] = RESOURCE_LIST.filter(
  (r) => r.category !== 'currency',
).map((r) => r.id)

/** Goods a caravan may crave — things worth hauling back to the Citadel. */
const WANT_POOL: ResourceId[] = RESOURCE_LIST.filter(
  (r) => r.category !== 'currency' && r.value >= 2,
).map((r) => r.id)

function rollOffers(s: RunState): void {
  const rng = makeRng(s.seed, s.rngCursor)
  const goods = rng.sample(CARAVAN_POOL, CARAVAN_OFFERS)
  s.caravan.offers = goods.map((resource) => {
    const amount = rng.range(5, 12)
    const price = Math.max(
      1,
      Math.ceil((RESOURCES[resource]?.value ?? 1) * amount * CARAVAN_MARKUP),
    )
    return { resource, amount, price, sold: false }
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

export function stepCaravan(s: RunState, dt: number, mods: Modifiers = computeModifiers(s)): void {
  // No road, no caravans: the timer only runs once a Trading Post stands.
  if (!caravanAvailable(s, mods)) return

  s.caravan.timer -= dt
  if (s.caravan.timer > 0) return

  if (s.caravan.here) {
    s.caravan.here = false
    s.caravan.timer = CARAVAN_INTERVAL * mods.caravanInterval
    s.caravan.offers = []
    pushLog(s, '🐫 The caravan packs up and moves on.', 'info')
  } else {
    s.caravan.here = true
    s.caravan.timer = CARAVAN_STAY
    s.caravan.visits++
    rollOffers(s)
    pushLog(
      s,
      `🐫 A caravan has arrived — it pays double for ${RESOURCES[s.caravan.wants]?.name}.`,
      'good',
    )
  }
}

/** Asking price for an offer after cornerstone discounts. */
export function offerPrice(s: RunState, index: number): number {
  const offer = s.caravan.offers[index]
  if (!offer) return 0
  const mods = computeModifiers(s)
  return Math.max(1, Math.ceil(offer.price * mods.tradePrices))
}

export function buyOffer(s: RunState, index: number): string | null {
  const offer = s.caravan.offers[index]
  if (!s.caravan.here || !offer) return 'The caravan is not here.'
  if (offer.sold) return 'That lot is already sold.'
  const price = offerPrice(s, index)
  if ((s.stock.amber ?? 0) < price) return 'Not enough amber.'
  if (storageUsed(s) + offer.amount > s.storageCap) return 'The stockpile is full.'
  spend(s.stock, { amber: price })
  grant(s.stock, { [offer.resource]: offer.amount }, s.storageCap, storageUsed(s))
  offer.sold = true
  pushLog(
    s,
    `Bought ${offer.amount} × ${RESOURCES[offer.resource]?.name} for ${price} amber.`,
    'info',
  )
  return null
}

/** What the caravan pays for one lot of `resource` right now. */
export function sellPrice(s: RunState, resource: ResourceId, amount: number): number {
  const base = (RESOURCES[resource]?.value ?? 1) * amount
  const bonus = s.caravan.here && s.caravan.wants === resource ? CARAVAN_WANT_BONUS : 1
  return Math.max(1, Math.floor(base * bonus))
}

export function sellResource(s: RunState, resource: ResourceId): string | null {
  if (!s.caravan.here) return 'No caravan to sell to.'
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
