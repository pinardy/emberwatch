import { describe, expect, it } from 'vitest'
import { BUILDINGS } from '../content/buildings'
import { eventsOfKind, eventsOfPool, GLADE_EVENT_LIST, GLADE_EVENTS } from '../content/gladeEvents'
import { BIOMES, BIOME_LIST, LAYOUTS, LAYOUT_LIST } from '../content/layouts'
import { TERRAIN } from '../content/terrain'
import { migrateRun } from '../persistence'
import { runProblem } from '../runCheck'
import type { BiomeId, BuildingInstance, LayoutId, RunState, Vec2 } from '../types'
import { canPlaceBuilding, placeBuilding } from './actions'
import { createRun } from './createRun'
import { distToSegment } from './geometry'
import { DEPOSIT_INFO, gladeAt } from './mapgen'
import { describePlacement } from './placement'
import { terrainSeasonMultiplier, terrainWorkMultiplier, workRate } from './production'
import { computeModifiers } from './modifiers'
import { isWarmAt, isWarmHome, warmHousing } from './queries'
import { mapgenHooksFor } from './runModifiers'
import { drawTerrainPlan, migrateWorld } from './terrainPlan'

/**
 * Map layouts and biomes: the plan each seed draws, what each layout and the
 * Cinderwood generate, the Cinderwood's quirk, and older saves.
 */

const SPECIES = ['human', 'beaver', 'lizard'] as const
const run = (seed: number, layout: LayoutId, biome: BiomeId = 'woodland') =>
  createRun({ seed, species: [...SPECIES], layout, biome, modifiers: [] })

/** Glade ids the hearth reaches over the neighbour lists. */
function reachableFromHearth(s: RunState): Set<string> {
  const seen = new Set(['glade0'])
  const queue = ['glade0']
  while (queue.length > 0) {
    for (const n of s.glades[queue.shift()!].neighbors) {
      if (!seen.has(n)) {
        seen.add(n)
        queue.push(n)
      }
    }
  }
  return seen
}

const SEEDS = [1, 7, 42, 99, 777, 2024, 31337, 424242]

describe('the terrain plan', () => {
  it('is a pure function of the seed and the land, and pins on request', () => {
    for (const seed of SEEDS) {
      expect(drawTerrainPlan(seed)).toEqual(drawTerrainPlan(seed))
      expect(drawTerrainPlan(seed, {}, { layout: 'ridge', biome: 'cinderwood' })).toEqual({
        layout: 'ridge',
        biome: 'cinderwood',
      })
    }
    // A created run records what it drew.
    const s = createRun({ seed: 99, species: [...SPECIES] })
    const plan = drawTerrainPlan(99, mapgenHooksFor(s.runModifiers))
    expect(s.world.layout).toBe(plan.layout)
    expect(s.world.biome).toBe(plan.biome)
  })

  it('keeps the rings in the old woodland the commonest map, and draws every layout and biome', () => {
    const counts: Record<string, number> = {}
    for (let seed = 0; seed < 1000; seed++) {
      const plan = drawTerrainPlan(seed)
      counts[plan.layout] = (counts[plan.layout] ?? 0) + 1
      counts[plan.biome] = (counts[plan.biome] ?? 0) + 1
    }
    expect(counts.rings).toBeGreaterThanOrEqual(400)
    for (const layout of LAYOUT_LIST) expect(counts[layout.id], layout.id).toBeGreaterThanOrEqual(120)
    expect(counts.woodland).toBeGreaterThanOrEqual(600)
    expect(counts.cinderwood).toBeGreaterThanOrEqual(200)
  })

  it('lets a land lean the odds (a floodplain has its river)', () => {
    let plain = 0
    let flood = 0
    const hooks = mapgenHooksFor(['fertileFloodplain'])
    for (let seed = 0; seed < 600; seed++) {
      if (drawTerrainPlan(seed).layout === 'river') plain++
      if (drawTerrainPlan(seed, hooks).layout === 'river') flood++
    }
    expect(flood).toBeGreaterThan(plain * 1.8)
  })
})

describe('map layouts', () => {
  it('generate the same map twice for a seed, on every layout and biome', () => {
    for (const layout of LAYOUT_LIST) {
      for (const biome of BIOME_LIST) {
        const a = run(42, layout.id, biome.id)
        const b = run(42, layout.id, biome.id)
        expect(JSON.stringify([a.world, a.glades, a.deposits, a.obstacles])).toBe(
          JSON.stringify([b.world, b.glades, b.deposits, b.obstacles]),
        )
      }
    }
  })

  it('leave every glade reachable from the hearth, with symmetric neighbours', () => {
    for (const layout of LAYOUT_LIST) {
      for (const seed of SEEDS) {
        const s = run(seed, layout.id, seed % 2 ? 'cinderwood' : 'woodland')
        expect(reachableFromHearth(s).size, `${layout.id} ${seed}`).toBe(Object.keys(s.glades).length)
        for (const g of Object.values(s.glades)) {
          for (const n of g.neighbors) expect(s.glades[n].neighbors, `${layout.id} ${seed}`).toContain(g.id)
        }
      }
    }
  })

  it('the rings carry no barrier; the river and the ridge carry theirs, open only at crossings', () => {
    for (const seed of SEEDS) {
      expect(run(seed, 'rings').world.barriers).toBeUndefined()
      expect(run(seed, 'ruins').world.barriers).toBeUndefined()
      const river = run(seed, 'river')
      expect(river.world.barriers?.map((b) => b.kind)).toEqual(['river'])
      expect(river.world.barriers![0].crossings.length).toBeGreaterThanOrEqual(2)
      const ridge = run(seed, 'ridge')
      expect(ridge.world.barriers?.map((b) => b.kind)).toEqual(['cliff'])
      expect(ridge.world.barriers![0].crossings.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('a river cuts the glades across it but at a ford, and the water blocks building and roads', () => {
    for (const seed of SEEDS) {
      const s = run(seed, 'river')
      const barrier = s.world.barriers![0]
      const water = s.obstacles.filter((o) => o.kind === 'water')
      expect(water.length).toBeGreaterThan(10)
      // Every border the river runs along: the two glades either side are
      // neighbours only where a ford opens it.
      for (const [a, b] of barrier.segments) {
        const mid: Vec2 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const water = s.obstacles.some((o) => o.kind === 'water' && Math.hypot(o.pos.x - mid.x, o.pos.y - mid.y) < 0.7)
        expect(water).toBe(true)
      }
      // Nothing is scattered into the water.
      for (const d of Object.values(s.deposits)) {
        for (const o of water) {
          expect(Math.hypot(d.pos.x - o.pos.x, d.pos.y - o.pos.y)).toBeGreaterThanOrEqual(d.radius + o.radius - 1e-6)
        }
      }
      // Placement refuses the water.
      s.stock.wood = 100
      const spot = water[0]
      for (const g of Object.values(s.glades)) g.cleared = true
      expect(canPlaceBuilding(s, 'shelter', spot.pos)).not.toBeNull()
      // The fords themselves stay open.
      for (const c of barrier.crossings) {
        expect(water.every((o) => Math.hypot(o.pos.x - c.x, o.pos.y - c.y) >= o.radius)).toBe(true)
      }
    }
  })

  it("the ridge: the hearth starts with few ways out, and the spine leads on", () => {
    let starts = 0
    for (const seed of SEEDS) {
      const s = run(seed, 'ridge')
      const rings = run(seed, 'rings')
      expect(s.glades.glade0.neighbors.length).toBeLessThanOrEqual(3)
      expect(s.glades.glade0.neighbors.length).toBeLessThan(rings.glades.glade0.neighbors.length)
      starts += s.glades.glade0.neighbors.length
      expect(s.obstacles.filter((o) => o.kind === 'cliff').length).toBeGreaterThan(10)
    }
    expect(starts / SEEDS.length).toBeLessThan(3)
  })

  it('the ruins scatter more glades, with salvage only there and the ruins’ own events first', () => {
    for (const seed of SEEDS) {
      const s = run(seed, 'ruins')
      expect(Object.keys(s.glades).length).toBeGreaterThan(15)
      expect(Object.values(s.deposits).filter((d) => d.kind === 'ruins').length).toBeGreaterThanOrEqual(3)
      const pooled = Object.values(s.glades).filter((g) => g.eventId && GLADE_EVENTS[g.eventId].pool === 'ruins')
      expect(pooled.length).toBeGreaterThan(0)
      for (const layout of ['rings', 'river', 'ridge'] as LayoutId[]) {
        const other = run(seed, layout)
        expect(Object.values(other.deposits).some((d) => d.kind === 'ruins')).toBe(false)
        expect(Object.values(other.glades).some((g) => g.eventId && GLADE_EVENTS[g.eventId].pool)).toBe(false)
      }
    }
  })

  it('every layout is data the generator reads, named and described for the screens', () => {
    for (const def of LAYOUT_LIST) {
      expect(LAYOUTS[def.id]).toBe(def)
      expect(def.name.length).toBeGreaterThan(0)
      expect(def.blurb.length).toBeLessThanOrEqual(140)
      if (def.split) expect(def.barrier).toBeDefined()
    }
  })
})

describe('the Cinderwood', () => {
  it('claims a region of cinder flats with its own deposits and events, on every layout', () => {
    for (const layout of LAYOUT_LIST) {
      for (const seed of SEEDS.slice(0, 4)) {
        const s = run(seed, layout.id, 'cinderwood')
        const cinder = Object.values(s.glades).filter((g) => g.terrain === 'cinder')
        expect(cinder.length, `${layout.id} ${seed}`).toBeGreaterThanOrEqual(3)
        expect(s.glades.glade0.terrain).toBe('clearing')
        for (const d of Object.values(s.deposits)) {
          if (d.kind === 'deadfall' || d.kind === 'fireweed') expect(s.glades[d.gladeId].terrain).toBe('cinder')
        }
        expect(Object.values(s.deposits).some((d) => d.kind === 'deadfall')).toBe(true)
        expect(Object.values(s.deposits).some((d) => d.kind === 'fireweed')).toBe(true)
        for (const g of Object.values(s.glades)) {
          const pool = g.eventId ? GLADE_EVENTS[g.eventId].pool : undefined
          if (pool === 'cinderwood') expect(g.terrain).toBe('cinder')
        }
        // Little lives on the ash to cut back: its glades clear faster.
        const woodland = run(seed, layout.id, 'woodland')
        for (const g of cinder) {
          const same = woodland.glades[g.id]
          if (same && same.kind === g.kind) expect(g.clearWork).toBeLessThan(same.clearWork)
        }
      }
    }
  })

  it('never appears in the old woodland', () => {
    for (const layout of LAYOUT_LIST) {
      const s = run(31337, layout.id, 'woodland')
      expect(Object.values(s.glades).some((g) => g.terrain === 'cinder')).toBe(false)
      expect(Object.values(s.deposits).some((d) => d.kind === 'deadfall' || d.kind === 'fireweed')).toBe(false)
    }
  })

  it('has 5–8 events of its own, kept out of the default pools, each resolvable', () => {
    const own = GLADE_EVENT_LIST.filter((e) => e.pool === 'cinderwood')
    expect(own.length).toBeGreaterThanOrEqual(5)
    expect(own.length).toBeLessThanOrEqual(8)
    expect(eventsOfPool('cinderwood', 'dangerous').length + eventsOfPool('cinderwood', 'forbidden').length).toBe(own.length)
    for (const kind of ['dangerous', 'forbidden'] as const) {
      expect(eventsOfKind(kind).some((e) => e.pool)).toBe(false)
    }
    for (const e of own) {
      const last = e.options[e.options.length - 1]
      expect(last.requires, e.id).toBeUndefined()
      expect(last.foodCost, e.id).toBeUndefined()
    }
  })

  it('its two deposits are worked by existing camps with recipes made for them', () => {
    const recipeFor = (deposit: string) =>
      Object.values(BUILDINGS).flatMap((b) => b.recipes.map((r) => ({ b, r }))).filter((x) => x.r.requiresDeposit === deposit)
    expect(recipeFor('deadfall').map((x) => x.b.id)).toEqual(['woodcuttersCamp'])
    expect(recipeFor('fireweed').map((x) => x.b.id)).toEqual(['herbalistsCamp'])
    expect(recipeFor('ruins').map((x) => x.b.id)).toEqual(['stonecuttersCamp'])
    // Richer than the plain recipe they stand in for.
    const wood = BUILDINGS.woodcuttersCamp.recipes
    const per = (id: string) => {
      const r = wood.find((x) => x.id === id)!
      return (r.outputs.wood ?? 0) / r.seconds
    }
    expect(per('deadwood')).toBeGreaterThan(per('wood'))
    const fire = BUILDINGS.herbalistsCamp.recipes.find((r) => r.id === 'fireweed')!
    expect(fire.outputs.herb).toBeGreaterThan(0)
    expect(fire.outputs.plantFiber).toBeGreaterThan(0)
    for (const d of ['deadfall', 'fireweed', 'ruins'] as const) expect(DEPOSIT_INFO[d].note).toBeTruthy()
    expect(BIOMES.cinderwood.terrain).toBe('cinder')
  })
})

describe("the Cinderwood's quirk: warm ash", () => {
  /** A Cinderwood run in the Storm with a cleared cinder glade and a home on it, beyond the hearth. */
  function stormOnAsh(): { s: RunState; home: BuildingInstance } {
    const s = run(777, 'rings', 'cinderwood')
    const glade = Object.values(s.glades)
      .filter((g) => g.terrain === 'cinder')
      .sort((a, b) => Math.hypot(b.center.x, b.center.y) - Math.hypot(a.center.x, a.center.y))[0]
    glade.cleared = true
    s.stock.wood = 200
    s.season.season = 'storm'
    s.season.elapsed = s.season.length
    let pos = glade.center
    for (const dx of [0, 1, -1, 2, -2]) {
      const p = { x: glade.center.x + dx, y: glade.center.y + 1.6 }
      if (canPlaceBuilding(s, 'shelter', p) === null) {
        pos = p
        break
      }
    }
    expect(placeBuilding(s, 'shelter', pos)).toBeNull()
    const home = Object.values(s.buildings).find((b) => b.defId === 'shelter')!
    home.built = true
    return { s, home }
  }

  it('keeps homes on cinder flats warm in the Storm, beyond every fire', () => {
    const { s, home } = stormOnAsh()
    expect(gladeAt(s.glades, home.pos)?.terrain).toBe('cinder')
    expect(isWarmHome(s, home)).toBe(true)
    expect(isWarmAt(s, home.pos)).toBe(true)
    expect(warmHousing(s, 0)).toBeGreaterThanOrEqual(BUILDINGS.shelter.housing ?? 1)
    // The same home on ordinary ground that far out would be cold.
    const plain = run(777, 'rings', 'woodland')
    const far = Object.values(plain.glades).sort((a, b) => Math.hypot(b.center.x, b.center.y) - Math.hypot(a.center.x, a.center.y))[0]
    expect(isWarmAt(plain, far.center, 0)).toBe(false)
    // And the placement ghost says so.
    expect(describePlacement(s, 'shelter', home.pos).warm).toBe(true)
  })

  it('slows farms there, and every workplace in the Storm only', () => {
    expect(terrainWorkMultiplier('smallFarm', 'cinder')).toBeLessThan(1)
    expect(terrainWorkMultiplier('woodcuttersCamp', 'cinder')).toBe(1)
    expect(terrainSeasonMultiplier('woodcuttersCamp', 'cinder', 'storm')).toBeLessThan(1)
    expect(terrainSeasonMultiplier('woodcuttersCamp', 'cinder', 'drizzle')).toBe(1)
    expect(terrainSeasonMultiplier('woodcuttersCamp', 'forest', 'storm')).toBe(1)
    // Homes do no work to slow.
    expect(terrainSeasonMultiplier('shelter', 'cinder', 'storm')).toBe(1)
    expect(TERRAIN.cinder.effects.some((e) => e.kind === 'warmHomes')).toBe(true)
  })

  it('the Storm rate is what the tick applies to a camp on the ash', () => {
    const { s } = stormOnAsh()
    const glade = Object.values(s.glades).find((g) => g.terrain === 'cinder' && g.cleared)!
    const camp: BuildingInstance = {
      id: 'tcamp',
      defId: 'woodcuttersCamp',
      pos: glade.center,
      gladeId: glade.id,
      built: true,
      buildProgress: 0,
      workers: ['v0'],
      activeRecipeId: 'deadwood',
      recipeProgress: 0,
      paused: false,
      depositsInRange: {},
    }
    s.buildings.tcamp = camp
    const mods = computeModifiers(s)
    const storm = workRate(s, camp, mods)
    s.season.season = 'drizzle'
    const drizzle = workRate(s, camp, mods)
    expect(storm / drizzle).toBeCloseTo(terrainSeasonMultiplier('woodcuttersCamp', 'cinder', 'storm'), 5)
  })
})

describe('older saves', () => {
  it('load as the rings in the old woodland, and pass the shape check', () => {
    const s = createRun({ seed: 99, species: [...SPECIES], layout: 'river', biome: 'cinderwood' })
    const old = JSON.parse(JSON.stringify(s)) as RunState
    delete old.world.layout
    delete old.world.biome
    delete old.world.barriers
    expect(runProblem(old)).toBeNull()
    const migrated = migrateRun(old)!
    expect(migrated.world.layout).toBe('rings')
    expect(migrated.world.biome).toBe('woodland')
    expect(migrated.world.barriers).toBeUndefined()
  })

  it('a new save round-trips its layout, biome and barriers through the shape check', () => {
    const s = createRun({ seed: 99, species: [...SPECIES], layout: 'ridge', biome: 'cinderwood' })
    const copy = JSON.parse(JSON.stringify(s))
    expect(runProblem(copy)).toBeNull()
    const migrated = migrateRun(copy)!
    expect(migrated.world).toEqual(s.world)
  })

  it('refuses a mangled layout, biome or barrier list; migration repairs what it can', () => {
    const s = createRun({ seed: 99, species: [...SPECIES], layout: 'river' })
    for (const bad of [{ layout: 'volcano' }, { biome: 7 }, { barriers: [{ kind: 'lava', segments: [], crossings: [] }] }, { barriers: [{ kind: 'river', segments: [[{ x: 0 }]], crossings: [] }] }]) {
      const copy = JSON.parse(JSON.stringify(s))
      Object.assign(copy.world, bad)
      expect(runProblem(copy)).toMatch(/world is damaged/)
    }
    const odd = JSON.parse(JSON.stringify(s)) as RunState
    ;(odd.world as unknown as Record<string, unknown>).layout = 'volcano'
    ;(odd.world as unknown as Record<string, unknown>).barriers = 'nope'
    migrateWorld(odd)
    expect(odd.world.layout).toBe('rings')
    expect(odd.world.barriers).toBeUndefined()
  })
})

describe('barrier geometry', () => {
  it("a ford's middle is clear of the river's own course", () => {
    for (const seed of SEEDS) {
      const barrier = run(seed, 'river').world.barriers![0]
      for (const c of barrier.crossings) {
        for (const [a, b] of barrier.segments) expect(distToSegment(c, a, b)).toBeGreaterThan(0.5)
      }
    }
  })
})
