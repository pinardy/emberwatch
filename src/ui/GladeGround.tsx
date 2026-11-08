import { BIOME_LIST } from '../game/content/layouts'
import { TERRAIN } from '../game/content/terrain'
import { DEPOSIT_INFO } from '../game/engine/mapgen'
import { describeTerrainEffect } from '../game/engine/placement'
import { layoutOf } from '../game/engine/terrainPlan'
import type { Glade, RunState } from '../game/types'
import { Icon } from './Icon'
import { TERRAIN_FOG } from './mapShared'

/**
 * The Inspector's account of a glade's ground: its terrain and what that does
 * to buildings, and — for a biome's ground, which shows through the fog — the
 * biome, its quirk and the deposits found only there.
 */
export function GladeGround({ glade }: { glade: Glade }) {
  // Ordinary ground stays hidden under the fog; a biome's shows through it.
  const visible = glade.cleared || (glade.discovered && !!TERRAIN_FOG[glade.terrain])
  if (!visible || glade.kind === 'settlement') return null
  const terrain = TERRAIN[glade.terrain]
  const biome = BIOME_LIST.find((b) => b.terrain === glade.terrain)
  const own = biome
    ? [...new Set(biome.themes?.flatMap((t) => t.deposits) ?? [])].filter((d) => DEPOSIT_INFO[d].note)
    : []
  return (
    <section className="inspector-section glade-ground" data-terrain={glade.terrain}>
      <h3>
        <Icon of={terrain} /> {terrain.name}
        {biome ? <small className="muted"> · {biome.name}</small> : null}
      </h3>
      <p className="muted">{terrain.blurb}</p>
      {terrain.effects.length > 0 && (
        <p className="muted">{terrain.effects.map(describeTerrainEffect).join(' · ')}</p>
      )}
      {own.length > 0 && (
        <p className="muted">Found only here: {own.map((d) => DEPOSIT_INFO[d].name).join(', ')}.</p>
      )}
      {biome && !glade.cleared && biome.clearWorkScale && biome.clearWorkScale < 1 && (
        <p className="muted">Little lives here to cut back: it clears faster.</p>
      )}
    </section>
  )
}

/** Why a glade is out of reach on a layout with a barrier: the river or the cliffs. */
export function barrierReachHint(run: RunState): string | null {
  const layout = layoutOf(run.world)
  if (!layout.barrier) return null
  return layout.barrier === 'river'
    ? 'The river is crossed only at its fords: a glade across it is reached from the glade on the other side of a ford.'
    : 'The cliffs are crossed only at their passes: the lowland is reached from a glade at the top of a pass.'
}
