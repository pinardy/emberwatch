import { BIOME_ART, LAYOUT_ART } from '../game/content/art'
import { BIOMES, LAYOUTS } from '../game/content/layouts'
import { isUnusualPlan, type TerrainPlan } from '../game/engine/terrainPlan'
import type { BiomeDef, LayoutDef, WorldInfo } from '../game/types'
import { Icon } from './Icon'

/**
 * The ground a run is founded on — its layout and biome — as the setup
 * screen, the Founding and the Orders panel show it. The default (rings in
 * the old woodland) is named in one quiet line; anything else gets a card
 * per half, so the player knows what is coming before setting out.
 */
export function TerrainPlanLine({
  plan,
  compact = false,
}: {
  plan: TerrainPlan
  /** One line, names only (the Founding's land strip). */
  compact?: boolean
}) {
  const layout = LAYOUTS[plan.layout]
  const biome = BIOMES[plan.biome]
  if (!layout || !biome) return null
  const parts: (LayoutDef | BiomeDef)[] = [layout, ...(biome.terrain ? [biome] : [])]
  const art = (d: LayoutDef | BiomeDef) =>
    d.id in LAYOUT_ART ? LAYOUT_ART[d.id as LayoutDef['id']] : BIOME_ART[d.id as BiomeDef['id']]
  if (compact || !isUnusualPlan(plan)) {
    return (
      <ul className="land-inline terrain-plan" aria-label="The ground">
        {parts.map((d) => (
          <li key={d.id} className="land-tag terrain-tag" title={d.blurb} data-ground={d.id}>
            <span aria-hidden>
              <Icon id={art(d)} emoji={d.icon} />
            </span>{' '}
            {d.name}
          </li>
        ))}
      </ul>
    )
  }
  return (
    <div className="chip-column terrain-plan" role="list" aria-label="The ground">
      {parts.map((d) => (
        <div className="cornerstone-chip land-chip terrain-chip" key={d.id} role="listitem" data-ground={d.id}>
          <span aria-hidden>
            <Icon id={art(d)} emoji={d.icon} />
          </span>
          <div>
            <strong>{d.name}</strong> <em className="land-tone">{d.id in LAYOUT_ART ? 'Layout' : 'Biome'}</em>
            <small>{d.blurb}</small>
          </div>
        </div>
      ))}
    </div>
  )
}

/** The run's own plan, read off its world (rings in the old woodland for older saves). */
export function planOf(world: WorldInfo): TerrainPlan {
  return { layout: world.layout ?? 'rings', biome: world.biome ?? 'woodland' }
}
