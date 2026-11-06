import { RESOURCES } from '../game/content/resources'
import type { ConditionOutcome, CornerstoneEffect, ResourceId, ThreatSpec } from '../game/types'

/**
 * Plain-language summaries of what a threat actually does, built from its
 * numbers rather than its flavour text: a player deciding whether to pay it
 * off needs to see the bill.
 */

/** "+3", "−3" (a real minus sign); `format` writes the magnitude. */
export function signed(n: number, format: (abs: number) => string = String): string {
  return `${n > 0 ? '+' : '−'}${format(Math.abs(n))}`
}

/** "steals 6 Berries, 6 Meat · hostility +3 · takes a villager". */
export function describeStrike(threat: ThreatSpec): string {
  const parts: string[] = []
  const strike = threat.strike
  if (strike.stockLoss) {
    const goods = (Object.entries(strike.stockLoss) as [ResourceId, number][])
      .map(([id, amount]) => `${amount} ${RESOURCES[id]?.icon ?? ''}${RESOURCES[id]?.name ?? id}`)
      .join(', ')
    parts.push(`steals ${goods}`)
  }
  if (strike.villagerLoss) {
    parts.push(
      strike.villagerLoss === 1 ? 'takes a villager' : `takes ${strike.villagerLoss} villagers`,
    )
  }
  if (strike.hostility) parts.push(`hostility ${signed(strike.hostility)}`)
  if (strike.impatience) parts.push(`impatience ${signed(strike.impatience)}`)
  return parts.join(' · ') || 'no direct damage'
}

/** The standing penalty a threat applies while it is loose, if any. */
export function describeWhileActive(effects: CornerstoneEffect[] | undefined): string | null {
  if (!effects || effects.length === 0) return null
  const parts: string[] = []
  for (const e of effects) {
    switch (e.kind) {
      case 'resolveFlat':
        parts.push(`resolve ${signed(e.amount)}${e.species === 'all' ? ' for everyone' : ''}`)
        break
      case 'hostilityRate':
        parts.push(`hostility grows ${signed(e.percent)}%`)
        break
      case 'foodUpkeep':
        parts.push(`food eaten ${signed(e.percent)}%`)
        break
      case 'productionSpeed':
        parts.push(`production ${signed(e.percent)}%`)
        break
      case 'impatienceRate':
        parts.push(`impatience grows ${signed(e.percent)}%`)
        break
      case 'hearthFuel':
        parts.push(`hearth burns ${signed(e.percent)}% wood`)
        break
      default:
        break
    }
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

/** What a condition pays or costs when it ends: "👑 +2", "🌩️ −5 ⏳ +1". */
export function outcomeWords(o: ConditionOutcome | undefined): string {
  if (!o) return ''
  const parts: string[] = []
  if (o.reputation) parts.push(`👑 +${o.reputation}`)
  if (o.hostility) parts.push(`🌩️ ${signed(o.hostility)}`)
  if (o.impatience) parts.push(`⏳ ${signed(o.impatience)}`)
  if (o.villagerLoss) parts.push(`🪦 −${o.villagerLoss}`)
  if (o.gain) parts.push('supplies')
  return parts.join(' ')
}
