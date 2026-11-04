import { BUILDINGS } from '../content/buildings'
import { TERRAIN } from '../content/terrain'
import type { DepositId, RunState, TerrainEffect, TerrainId, Vec2 } from '../types'
import { adjacencyHints, adjacencyStatusAt, type AdjacencyStatus } from './adjacency'
import { gladeAt } from './mapgen'
import { depositsInRangeOf, terrainEffectsFor } from './production'
import { homesWithin, isWarmAt } from './queries'

/**
 * Everything the placement ghost has to say about a spot, computed once and
 * shared by both renderers (and the Inspector for terrain lines) so the hint,
 * the sim and the panel never disagree.
 */
export interface PlacementPreview {
  /** Deposit ids a camp placed here could actually work. */
  reach: string[]
  /** Every adjacency bonus of the def, with the partners it would count. */
  adjacency: AdjacencyStatus[]
  /** The ground under the spot. */
  terrain: TerrainId | null
  /** Terrain effects that would apply to this building. */
  terrainEffects: TerrainEffect[]
  /** Housing only: would it be warm in the Storm here? */
  warm: boolean | null
  /** Warmth sources only: homes its radius would cover. */
  warms: number | null
  /** Ready-to-show hint fragments, in priority order. */
  parts: string[]
}

/** "+25% farming", "−20% build speed", "+25% clay". */
export function describeTerrainEffect(effect: TerrainEffect): string {
  const sign = effect.percent >= 0 ? '+' : '−'
  const amount = `${sign}${Math.abs(effect.percent)}%`
  switch (effect.kind) {
    case 'workSpeed':
      return `${amount} ${effect.tag}`
    case 'yield':
      return `${amount} ${effect.resource === 'copperOre' ? 'copper ore' : effect.resource}`
    case 'buildSpeed':
      return `${amount} build speed`
  }
}

/** "🌾 Fertile ground: +25% farming", or null when the ground is neutral. */
export function terrainHint(defId: string, terrain: TerrainId | null | undefined): string | null {
  if (!terrain) return null
  const effects = terrainEffectsFor(defId, terrain)
  if (effects.length === 0) return null
  const info = TERRAIN[terrain]
  return `${info.icon} ${info.name}: ${effects.map(describeTerrainEffect).join(', ')}`
}

export function describePlacement(s: RunState, defId: string, pos: Vec2): PlacementPreview {
  const def = BUILDINGS[defId]
  const parts: string[] = []

  let reach: string[] = []
  if (def?.gatherRadius) {
    const needed = new Set(
      def.recipes.map((r) => r.requiresDeposit).filter((d): d is DepositId => !!d),
    )
    if (needed.size > 0) {
      const inRange = depositsInRangeOf(s, pos, def.gatherRadius)
      reach = [...needed].flatMap((kind) => inRange[kind] ?? [])
      parts.push(`${reach.length} deposit${reach.length === 1 ? '' : 's'} in reach`)
    }
  }

  const adjacency = adjacencyStatusAt(s, def, pos)
  parts.push(...adjacencyHints(adjacency))

  const terrain = gladeAt(s.glades, pos)?.terrain ?? null
  const terrainEffects = terrain ? terrainEffectsFor(defId, terrain) : []
  const ground = terrainHint(defId, terrain)
  if (ground) parts.push(ground)

  let warm: boolean | null = null
  if ((def?.housing ?? 0) > 0 && def?.category === 'housing') {
    warm = isWarmAt(s, pos)
    parts.push(warm ? '🔥 Warm in the Storm' : '❄ Cold in the Storm — build a brazier')
  }

  let warms: number | null = null
  if (def?.warmth) {
    warms = homesWithin(s, pos, def.warmth.radius).length
    parts.push(`🔥 Warms ${warms} home${warms === 1 ? '' : 's'}`)
  }

  return { reach, adjacency, terrain, terrainEffects, warm, warms, parts }
}
