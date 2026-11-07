import { feats } from './feats'
import { resourceName } from '../content/resources'
import type { ActiveThreat, ResourceId, RunState, ThreatSpec } from '../types'
import {
  IMPATIENCE_PER_VILLAGER_LOST,
  THREAT_APPEASE_GROWTH,
  THREAT_STRIKE_GROWTH,
  THREAT_STRIKES_BEFORE_LOSS,
} from './balance'
import { canAfford, spend } from './queries'
import { pushLog } from './runLog'
import { addImpatience, loseVillager, pickVictim } from './society'
import { recordEvent } from './timeline'

/**
 * Threats: forest creatures a glade event (or a failed condition) sets loose.
 * Each strikes on a timer, growing bolder with every strike, until the
 * settlement pays it off.
 */

/**
 * Sets a threat loose. Its numbers are copied, never shared with the content
 * that declared it: an ignored threat raises them in place as it grows bolder.
 */
export function unleashThreat(s: RunState, spec: ThreatSpec, gladeId: string): ActiveThreat {
  const threat: ActiveThreat = {
    ...spec,
    appease: { ...spec.appease },
    strike: {
      ...spec.strike,
      ...(spec.strike.stockLoss ? { stockLoss: { ...spec.strike.stockLoss } } : {}),
    },
    id: `t${s.threatCounter++}`,
    gladeId,
    timer: spec.interval,
    strikes: 0,
  }
  s.threats.push(threat)
  recordEvent(s, 'threat', spec.name)
  pushLog(s, `${spec.name} is loose. Appease it before it strikes.`, 'bad')
  return threat
}

/**
 * An ignored threat grows bolder: after each strike its next one hits
 * `THREAT_STRIKE_GROWTH` harder and paying it off costs `THREAT_APPEASE_GROWTH`
 * more. From `THREAT_STRIKES_BEFORE_LOSS` strikes on it also takes a villager.
 * The numbers are raised on the threat itself, so the threat bar always shows
 * the next strike and today's price.
 */
export function escalateThreat(threat: ActiveThreat): void {
  threat.strikes = (threat.strikes ?? 0) + 1
  const strike = threat.strike
  const grow = 1 + THREAT_STRIKE_GROWTH
  if (strike.stockLoss) {
    for (const [id, amount] of Object.entries(strike.stockLoss)) {
      strike.stockLoss[id as ResourceId] = Math.ceil((amount ?? 0) * grow)
    }
  }
  if (strike.hostility) strike.hostility = Math.round(strike.hostility * grow * 2) / 2
  if (strike.impatience) strike.impatience = Math.round(strike.impatience * grow * 100) / 100
  if (threat.strikes >= THREAT_STRIKES_BEFORE_LOSS && !strike.villagerLoss) strike.villagerLoss = 1
  for (const [id, amount] of Object.entries(threat.appease)) {
    // Amber prices climb too; everything rounds up to whole units.
    threat.appease[id as ResourceId] = Math.ceil((amount ?? 0) * (1 + THREAT_APPEASE_GROWTH))
  }
}

/** An amount for a log line: whole units, or one decimal below ten. */
function logAmount(n: number): string {
  const tenths = Math.round(n * 10) / 10
  return n >= 10 || Number.isInteger(tenths) ? String(Math.round(n)) : tenths.toFixed(1)
}

/**
 * Threats strike on a timer until they are appeased. Each strike is logged, so
 * a player who ignores one can read exactly what it is costing them — and
 * each one makes the next worse (see `escalateThreat`).
 */
export function stepThreats(s: RunState, dt: number): void {
  for (const threat of s.threats) {
    threat.timer -= dt
    if (threat.timer > 0) continue
    threat.timer += threat.interval

    const strike = threat.strike
    const parts: string[] = []
    if (strike.hostility) {
      s.hostility = Math.max(0, s.hostility + strike.hostility)
      parts.push(`hostility +${logAmount(strike.hostility)}`)
    }
    if (strike.impatience) {
      addImpatience(s, strike.impatience)
      parts.push(`the Queen frets`)
    }
    if (strike.stockLoss) {
      for (const [id, amount] of Object.entries(strike.stockLoss)) {
        const key = id as keyof typeof s.stock
        const taken = Math.min(s.stock[key] ?? 0, amount ?? 0)
        if (taken > 0) {
          spend(s.stock, { [key]: taken })
          parts.push(`${logAmount(taken)} ${resourceName(key)} stolen`)
        }
      }
    }
    if (strike.villagerLoss) {
      for (let i = 0; i < strike.villagerLoss; i++) {
        const victim = pickVictim(s)
        if (!victim) break
        loseVillager(s, victim)
        addImpatience(s, IMPATIENCE_PER_VILLAGER_LOST)
        parts.push(`${victim.name} is taken`)
      }
    }
    const before = threat.strike.villagerLoss ?? 0
    escalateThreat(threat)
    const bolder =
      !before && threat.strike.villagerLoss
        ? ' It grows bold: its next strike will take a villager.'
        : ' It grows bolder.'
    pushLog(
      s,
      `${threat.icon} ${threat.name} strikes — ${parts.join(', ') || 'the settlement shudders'}.${bolder}`,
      'bad',
    )
  }
}

/** Pays a threat off. Returns an error string, or null on success. */
export function appeaseThreat(s: RunState, threatId: string): string | null {
  const threat = s.threats.find((t) => t.id === threatId)
  if (!threat) return 'No such threat.'
  if (!canAfford(s.stock, threat.appease)) return 'Not enough to appease it.'
  spend(s.stock, threat.appease)
  s.threats = s.threats.filter((t) => t.id !== threatId)
  feats(s).threatsAppeased++
  recordEvent(s, 'appeased', threat.name)
  pushLog(s, `${threat.icon} ${threat.name} has been dealt with.`, 'good')
  return null
}
