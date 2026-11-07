import type { TradeAgreementId } from '../types'

/**
 * Trade agreements: one per run, signed with amber at the Trading Post. Each
 * bends every caravan that follows toward one way of using trade — buying the
 * service goods you cannot make, trading more often, or selling surplus — so
 * signing one is a commitment, not a discount.
 */
export interface TradeAgreementDef {
  id: TradeAgreementId
  name: string
  icon: string
  /** One line for the Trade panel: what changes for the rest of the run. */
  description: string
}

export const TRADE_AGREEMENTS: Record<TradeAgreementId, TradeAgreementDef> = {
  provisioners: {
    id: 'provisioners',
    name: "Provisioners' Guild",
    icon: '🍺',
    description:
      'Every caravan also carries a lot of a service good your venues hand out — one you cannot make yet, when there is one.',
  },
  barges: {
    id: 'barges',
    name: 'River Barges',
    icon: '🛶',
    description: 'Caravans call 35% more often and stay 40 seconds longer.',
  },
  factors: {
    id: 'factors',
    name: "Factors' Compact",
    icon: '⚖️',
    description: 'Caravans pay 50% more for everything you sell them — triple for the good they want.',
  },
}

export const TRADE_AGREEMENT_LIST: TradeAgreementDef[] = Object.values(TRADE_AGREEMENTS)
