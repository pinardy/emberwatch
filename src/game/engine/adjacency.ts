import { BUILDINGS, CATEGORY_LABELS } from '../content/buildings'
import type { AdjacencyBonus, BuildingDef, BuildingInstance, RunState, Vec2 } from '../types'
import { ADJACENCY_RANGE } from './balance'
import { dist } from './geometry'
import { baseServiceCapacity } from './upgrades'

/**
 * Neighbourhood rules. A building can list several adjacency bonuses; each is
 * satisfied by *built* partners within `ADJACENCY_RANGE`, matched by def id or
 * by category. Speed bonuses feed the production rate, capacity bonuses feed a
 * service's reach. Shared by the sim, the placement ghost and the Inspector so
 * all three agree.
 */

/** Does a building of `otherDefId` count as a partner for `bonus`? */
export function matchesPartner(bonus: AdjacencyBonus, otherDefId: string): boolean {
  if (bonus.nearId) return bonus.nearId === otherDefId
  if (bonus.nearCategory) return BUILDINGS[otherDefId]?.category === bonus.nearCategory
  return false
}

/** True when either building lists the other as a partner. */
export function pairsWith(defIdA: string, defIdB: string): boolean {
  const a = BUILDINGS[defIdA]
  const b = BUILDINGS[defIdB]
  return (
    (a?.adjacency ?? []).some((bonus) => matchesPartner(bonus, defIdB)) ||
    (b?.adjacency ?? []).some((bonus) => matchesPartner(bonus, defIdA))
  )
}

/** "Clay Pit" or "any housing" — how a partner reads in hints. */
export function partnerName(bonus: AdjacencyBonus): string {
  if (bonus.nearId) return BUILDINGS[bonus.nearId]?.name ?? bonus.nearId
  if (bonus.nearCategory === 'housing') return 'home'
  if (bonus.nearCategory) return CATEGORY_LABELS[bonus.nearCategory].toLowerCase()
  return 'nothing'
}

export function partnerIcon(bonus: AdjacencyBonus): string {
  if (bonus.nearId) return BUILDINGS[bonus.nearId]?.icon ?? '🔗'
  if (bonus.nearCategory === 'housing') return '🏠'
  return '🔗'
}

/** One-line description of a bonus, e.g. "+10% capacity per housing (max 3)". */
export function describeBonus(bonus: AdjacencyBonus): string {
  const what = bonus.effect === 'capacity' ? 'capacity' : 'work speed'
  const max = bonus.maxPartners ?? 1
  return max > 1
    ? `+${bonus.percent}% ${what} per ${partnerName(bonus)} nearby (up to ${max})`
    : `+${bonus.percent}% ${what} beside ${bonus.nearCategory ? 'any ' : 'a '}${partnerName(bonus)}`
}

export interface AdjacencyStatus {
  bonus: AdjacencyBonus
  /** Partners counted, capped at `maxPartners`. */
  partners: number
  /** Percent currently granted by this bonus. */
  percent: number
}

/**
 * Evaluates every adjacency bonus of `def` for a building standing (or about
 * to stand) at `pos`. `selfId` excludes the building itself.
 */
export function adjacencyStatusAt(
  s: RunState,
  def: BuildingDef | undefined,
  pos: Vec2,
  selfId?: string,
): AdjacencyStatus[] {
  if (!def?.adjacency) return []
  const buildings = Object.values(s.buildings)
  return def.adjacency.map((bonus) => {
    const max = bonus.maxPartners ?? 1
    let partners = 0
    for (const other of buildings) {
      if (partners >= max) break
      if (!other.built || other.id === selfId) continue
      if (!matchesPartner(bonus, other.defId)) continue
      if (dist(pos, other.pos) <= ADJACENCY_RANGE) partners++
    }
    return { bonus, partners, percent: partners * bonus.percent }
  })
}

export function adjacencyStatus(s: RunState, b: BuildingInstance): AdjacencyStatus[] {
  return adjacencyStatusAt(s, BUILDINGS[b.defId], b.pos, b.id)
}

function sumPercent(statuses: AdjacencyStatus[], effect: 'speed' | 'capacity'): number {
  let sum = 0
  for (const status of statuses) {
    if ((status.bonus.effect ?? 'speed') === effect) sum += status.percent
  }
  return sum
}

/**
 * Work-speed multiplier from satisfied adjacencies (a mill beside its felling
 * grounds, a cookhouse beside the farm). Bonuses from different partners add
 * up. A linear scan over a few dozen buildings, cheap enough to read every tick.
 */
export function adjacencyMultiplier(s: RunState, b: BuildingInstance): number {
  const def = BUILDINGS[b.defId]
  if (!def?.adjacency) return 1
  return 1 + sumPercent(adjacencyStatus(s, b), 'speed') / 100
}

/**
 * A service's effective capacity: its base (with any upgrade tiers), raised by
 * the homes around it and its supplier next door. The neighbourhood percent
 * applies to the upgraded base, so a hall in a good spot gains the most.
 * Rounded down so the number players see is whole.
 */
export function serviceCapacity(s: RunState, b: BuildingInstance): number {
  const def = BUILDINGS[b.defId]
  if (!def?.service) return 0
  const base = baseServiceCapacity(b)
  if (!def.adjacency) return base
  return Math.floor(base * (1 + sumPercent(adjacencyStatus(s, b), 'capacity') / 100))
}

/** Hint fragments for the bonuses a building would get at `pos`. */
export function adjacencyHints(statuses: AdjacencyStatus[]): string[] {
  const out: string[] = []
  for (const status of statuses) {
    if (status.percent <= 0) continue
    const what = status.bonus.effect === 'capacity' ? 'capacity' : ''
    const name = partnerName(status.bonus)
    const by = status.bonus.nearCategory
      ? `${status.partners} ${name}${status.partners > 1 ? 's' : ''}`
      : name
    out.push(`+${status.percent}%${what ? ` ${what}` : ''} beside ${by}`)
  }
  return out
}
