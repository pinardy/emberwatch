import * as THREE from 'three'
import { BUILDINGS } from '../../game/content/buildings'
import { footprintOf } from '../../game/engine/actions'
import type { BuildingCategory, BuildingInstance, Obstacle, WorldDeposit } from '../../game/types'
import { DEPOSIT_TINT } from '../mapShared'
import { hash01 } from './models'
import { color, local, part, placeParts, type Part } from './parts'

/**
 * Low-poly models as instanced parts. Every category has its own footprint
 * and roof so districts read without the floating icons:
 *
 * - housing: timber cottages with terracotta gable roofs and windows that
 *   glow warm when someone lives there (shelters are canvas lean-tos);
 * - camps: canvas tents beside a pile of what they gather (logs, stone, clay,
 *   ore, herbs, baskets, hides); the farm is furrowed rows with a shed;
 * - industry: long brick workshops under slate, a tall chimney and a furnace glow;
 * - services: pale plaster halls with steep teal roofs and a gold spire;
 * - storage and trade: wide barns under moss-green roofs, crates and barrels,
 *   a striped market awning;
 * - fire: braziers (and the hearth, drawn by `HearthModel`).
 *
 * Models are authored around a ~0.6 footprint radius and scaled to the def's.
 */

const C = {
  timber: '#8d6a47',
  timberDark: '#5e4630',
  plaster: '#d8c8a2',
  stone: '#8f9296',
  stoneDark: '#5a5d61',
  brick: '#a65d43',
  canvas: '#d6c08f',
  roofHouse: '#c0553a',
  roofSlate: '#4f5c6a',
  roofTeal: '#3f9095',
  roofMoss: '#3f6e4c',
  gold: '#d9b46a',
  door: '#3a2a1c',
  windowOn: '#ffc35a',
  windowOff: '#2b2a27',
  soil: '#6e5435',
  crop: '#9cc24e',
  scaffold: '#a58a58',
  site: '#cfd8d3',
  fire: '#ff9a3c',
  ember: '#ff6a1a',
}

/** Deterministic per-building facing: quarter turns with a small jitter. */
export function buildingYaw(id: string): number {
  return Math.floor(hash01(id, 41) * 4) * (Math.PI / 2) + (hash01(id, 42) - 0.5) * 0.24
}

/** The production chimney's top in model units (the smoke rises from here). */
export const CHIMNEY_TOP: [number, number, number] = [0.32, 1.15, -0.18]

/** World position of a building's chimney top. */
export function chimneyAt(b: BuildingInstance): [number, number, number] {
  const scale = footprintOf(b.defId) / 0.6
  const yaw = buildingYaw(b.id)
  const [lx, ly, lz] = CHIMNEY_TOP
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  // Same rotation `local()` applies: Euler yaw about +Y.
  return [b.pos.x + (lx * c + lz * s) * scale, ly * scale, b.pos.y + (-lx * s + lz * c) * scale]
}

type P = Part

const box = (hex: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) =>
  part('box', 'solid', hex, local(x, y, z, sx, sy, sz, ry))
const glow = (hex: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) =>
  part('box', 'glow', hex, local(x, y, z, sx, sy, sz))

/** A gable roof whose ridge runs along x. */
const gable = (hex: string, y: number, width: number, depth: number, height: number, x = 0, z = 0) =>
  part('prism', 'solid', hex, local(x, y, z, depth, height, width, Math.PI / 2))

function cottage(occupied: boolean): P[] {
  const win = occupied ? C.windowOn : C.windowOff
  return [
    box(C.timber, 0, 0, 0, 0.84, 0.46, 0.7),
    box(C.timberDark, 0, 0, 0, 0.9, 0.06, 0.76),
    gable(C.roofHouse, 0.46, 1.0, 0.86, 0.42),
    box(C.stone, 0.26, 0.6, -0.16, 0.13, 0.42, 0.13),
    box(C.door, 0, 0, 0.352, 0.15, 0.28, 0.02),
    glow(win, -0.25, 0.2, 0.354, 0.14, 0.12, 0.02),
    glow(win, 0.25, 0.2, 0.354, 0.14, 0.12, 0.02),
    glow(win, -0.424, 0.2, 0, 0.02, 0.12, 0.14),
  ]
}

function shelter(occupied: boolean): P[] {
  return [
    part('prism', 'solid', C.canvas, local(0, 0, 0, 0.92, 0.62, 1.0)),
    box(C.timberDark, 0, 0.56, 0, 0.05, 0.08, 1.06),
    box(C.door, 0, 0, 0.5, 0.26, 0.3, 0.02),
    // A lantern by the flap, lit while someone sleeps here.
    box(C.timberDark, 0.34, 0, 0.56, 0.03, 0.34, 0.03),
    glow(occupied ? C.windowOn : C.windowOff, 0.34, 0.32, 0.56, 0.08, 0.09, 0.08),
  ]
}

const tent = (x = -0.14, z = -0.1, s = 1): P =>
  part('pyramid', 'solid', C.canvas, local(x, 0, z, 0.8 * s, 0.64 * s, 0.8 * s))

function logPile(x: number, z: number): P[] {
  return [
    part('log', 'solid', '#7a5638', local(x, 0.06, z - 0.07, 0.5, 0.12, 0.12)),
    part('log', 'solid', '#86603e', local(x, 0.06, z + 0.07, 0.5, 0.12, 0.12)),
    part('log', 'solid', '#6e4d33', local(x, 0.17, z, 0.5, 0.12, 0.12)),
  ]
}

function rockPile(x: number, z: number, hex: string, glint?: string): P[] {
  return [
    part('rock', 'solid', hex, local(x, 0.08, z, 0.26, 0.2, 0.26, 0.3)),
    part('rock', 'solid', hex, local(x + 0.16, 0.06, z + 0.08, 0.2, 0.15, 0.2, 1.1)),
    part('rock', 'solid', glint ?? hex, local(x - 0.06, 0.05, z + 0.17, 0.16, 0.12, 0.16, 2)),
  ]
}

function campAccent(defId: string): P[] {
  switch (defId) {
    case 'woodcuttersCamp':
      return [...logPile(0.3, 0.26), part('cyl', 'solid', '#7a5638', local(0.32, 0, -0.3, 0.16, 0.1, 0.16))]
    case 'stonecuttersCamp':
      return rockPile(0.3, 0.22, C.stone)
    case 'clayPit':
      return [
        part('mound', 'solid', '#9a6646', local(0.24, 0, 0.2, 0.62, 0.16, 0.5)),
        part('disc', 'solid', '#4a3426', local(0.24, 0.085, 0.2, 0.16, 1, 0.12)),
      ]
    case 'copperMine':
      return [
        part('mound', 'solid', C.stoneDark, local(0.22, 0, 0.12, 0.7, 0.42, 0.6)),
        box('#16130f', 0.22, 0, 0.4, 0.2, 0.2, 0.06),
        ...rockPile(-0.3, 0.32, '#8a5a3a', '#c07a42'),
      ]
    case 'herbalistsCamp':
      return [
        part('ico', 'solid', '#5f9a4e', local(0.3, 0.1, 0.24, 0.26, 0.22, 0.26)),
        part('ico', 'solid', '#77ad57', local(0.14, 0.08, 0.36, 0.2, 0.17, 0.2)),
        box(C.timberDark, 0.38, 0, -0.24, 0.03, 0.34, 0.3),
        box('#8fbf6a', 0.38, 0.24, -0.24, 0.05, 0.08, 0.26),
      ]
    case 'foragersCamp':
      return [
        part('cyl', 'solid', '#a07a48', local(0.3, 0, 0.24, 0.2, 0.14, 0.2)),
        part('ico', 'solid', '#c8324a', local(0.3, 0.15, 0.24, 0.14, 0.08, 0.14)),
        part('cyl', 'solid', '#a07a48', local(0.1, 0, 0.36, 0.17, 0.12, 0.17)),
        part('ico', 'solid', '#6a4a8a', local(0.1, 0.13, 0.36, 0.12, 0.07, 0.12)),
      ]
    case 'trappersCamp':
      return [
        box(C.timberDark, 0.18, 0, 0.3, 0.03, 0.4, 0.03),
        box(C.timberDark, 0.46, 0, 0.3, 0.03, 0.4, 0.03),
        box(C.timberDark, 0.32, 0.38, 0.3, 0.32, 0.03, 0.03),
        box('#8a5a3a', 0.32, 0.12, 0.3, 0.24, 0.25, 0.02),
      ]
    default:
      return [box('#a0784a', 0.3, 0, 0.26, 0.2, 0.18, 0.2, 0.3)]
  }
}

function farm(): P[] {
  const out: P[] = []
  for (let i = 0; i < 4; i++) {
    const z = -0.42 + i * 0.24
    out.push(box(C.soil, 0.12, 0, z, 0.86, 0.06, 0.17))
    out.push(box(i % 2 ? C.crop : '#b8c25a', 0.12, 0.06, z, 0.78, 0.07, 0.08))
  }
  out.push(box(C.timber, -0.5, 0, 0.36, 0.28, 0.26, 0.26))
  out.push(gable(C.roofHouse, 0.26, 0.32, 0.32, 0.18, -0.5, 0.36))
  return out
}

function workshop(defId: string): P[] {
  const out: P[] = [
    box(C.brick, 0, 0, 0, 1.0, 0.5, 0.74),
    box(C.stoneDark, 0, 0, 0, 1.06, 0.07, 0.8),
    gable(C.roofSlate, 0.5, 1.12, 0.84, 0.3),
    box(C.stoneDark, CHIMNEY_TOP[0], 0.3, CHIMNEY_TOP[2], 0.17, CHIMNEY_TOP[1] - 0.3, 0.17),
    box(C.door, -0.18, 0, 0.372, 0.22, 0.3, 0.02),
    glow('#ff8a3c', 0.22, 0.08, 0.374, 0.18, 0.13, 0.02),
  ]
  // A yard detail that varies by trade.
  if (defId === 'lumberMill') out.push(...logPile(-0.2, -0.56))
  else if (defId === 'brickyard' || defId === 'smelter')
    out.push(box(C.brick, -0.32, 0, -0.52, 0.26, 0.16, 0.18), box('#b5694d', -0.32, 0.16, -0.52, 0.2, 0.08, 0.14))
  else out.push(box('#a0784a', -0.36, 0, -0.5, 0.18, 0.18, 0.18, 0.4))
  return out
}

function hall(defId: string): P[] {
  if (defId === 'arena') {
    return [
      part('disc', 'solid', '#c9b07a', local(0, 0.02, 0, 0.62, 1, 0.62)),
      part('torus', 'solid', C.stone, local(0, 0.04, 0, 0.66, 1.6, 0.66)),
      box(C.timberDark, -0.5, 0, -0.38, 0.04, 0.7, 0.04),
      box(C.timberDark, 0.5, 0, 0.38, 0.04, 0.7, 0.04),
    ]
  }
  const tall = defId === 'temple' ? 0.8 : 0.55
  return [
    box(C.plaster, 0, 0, 0, 0.86, 0.52, 0.86),
    box(C.stone, 0, 0, 0, 0.92, 0.08, 0.92),
    part('pyramid', 'solid', C.roofTeal, local(0, 0.52, 0, 1.0, tall, 1.0)),
    part('cone', 'solid', C.gold, local(0, 0.5 + tall, 0, 0.08, 0.28, 0.08)),
    box(C.door, 0, 0, 0.432, 0.2, 0.32, 0.02),
    glow('#ffd27a', -0.27, 0.22, 0.434, 0.12, 0.16, 0.02),
    glow('#ffd27a', 0.27, 0.22, 0.434, 0.12, 0.16, 0.02),
  ]
}

function warehouse(): P[] {
  return [
    box(C.timber, 0, 0, 0, 1.14, 0.48, 0.88),
    gable(C.roofMoss, 0.48, 1.24, 0.98, 0.28),
    box(C.door, 0, 0, 0.442, 0.36, 0.36, 0.02),
    box('#a0784a', 0.62, 0, 0.3, 0.2, 0.2, 0.2, 0.3),
    box('#8a6640', 0.6, 0.2, 0.3, 0.15, 0.15, 0.15, 0.7),
    part('cyl', 'solid', '#6e4d33', local(-0.64, 0, 0.32, 0.16, 0.24, 0.16)),
  ]
}

function tradingPost(): P[] {
  const out: P[] = [
    box(C.plaster, 0, 0, -0.1, 0.92, 0.36, 0.56),
    box(C.timberDark, 0, 0.36, -0.1, 0.96, 0.05, 0.6),
  ]
  for (const [x, z] of [[-0.48, 0.42], [0.48, 0.42], [-0.48, -0.36], [0.48, -0.36]] as const) {
    out.push(box(C.timberDark, x, 0, z, 0.05, 0.62, 0.05))
  }
  // A striped awning: alternating red and cream bands.
  for (let i = 0; i < 4; i++) {
    out.push(
      part('prism', 'solid', i % 2 ? '#efe2c4' : '#b8433a', local(-0.375 + i * 0.25, 0.62, 0.03, 0.25, 0.2, 0.9, 0, 0, 0)),
    )
  }
  out.push(box('#a0784a', 0.3, 0, 0.5, 0.18, 0.18, 0.18, 0.2), box(C.gold, -0.25, 0.36, 0.1, 0.16, 0.08, 0.12))
  return out
}

function brazier(lit: boolean): P[] {
  const out: P[] = [
    part('cyl', 'solid', C.stone, local(0, 0, 0, 0.56, 0.5, 0.56)),
    part('cyl', 'solid', '#3b3632', local(0, 0.5, 0, 0.86, 0.18, 0.86)),
  ]
  if (lit) {
    out.push(
      part('cone', 'glow', C.fire, local(0, 0.66, 0, 0.5, 0.5, 0.5)),
      part('cone', 'glow', '#ffd27a', local(0, 0.66, 0, 0.26, 0.34, 0.26)),
      part('disc', 'light', '#ff8a3c', local(0, 0.03, 0, 1.15, 1, 1.15)),
    )
  } else {
    out.push(part('mound', 'solid', '#4a4744', local(0, 0.6, 0, 0.6, 0.16, 0.6)))
  }
  return out
}

/** The finished model of a building, in model units. */
export function modelParts(
  category: BuildingCategory,
  defId: string,
  opts: { occupied: boolean; lit: boolean },
): P[] {
  if (defId === 'brazier') return brazier(opts.lit)
  switch (category) {
    case 'hearth':
      return [] // drawn by HearthModel (animated flame and light)
    case 'housing':
      return defId === 'shelter' ? shelter(opts.occupied) : cottage(opts.occupied)
    case 'gathering':
      return defId === 'smallFarm' ? farm() : [tent(), ...campAccent(defId)]
    case 'production':
      return workshop(defId)
    case 'service':
      return hall(defId)
    case 'logistics':
      return defId === 'tradingPost' ? tradingPost() : warehouse()
  }
}

const POLES: [number, number][] = [
  [-0.48, -0.48],
  [0.48, -0.48],
  [-0.48, 0.48],
  [0.48, 0.48],
]

function constructionSite(progress: number): P[] {
  const height = 0.65 * Math.max(0.12, progress)
  const out: P[] = [part('box', 'ghost', C.site, local(0, 0, 0, 0.8, height, 0.8))]
  for (const [x, z] of POLES) out.push(box(C.scaffold, x, 0, z, 0.06, 0.9, 0.06))
  out.push(
    box(C.scaffold, 0, 0.85, -0.48, 1.02, 0.05, 0.05),
    box(C.scaffold, 0, 0.85, 0.48, 1.02, 0.05, 0.05),
    box(C.scaffold, -0.48, 0.85, 0, 0.05, 0.05, 1.02),
    box(C.scaffold, 0.48, 0.85, 0, 0.05, 0.05, 1.02),
  )
  return out
}

function upgradeScaffold(): P[] {
  const out: P[] = []
  for (const [x, z] of POLES) out.push(box(C.scaffold, x * 1.15, 0, z * 1.15, 0.05, 1, 0.05))
  out.push(
    box(C.scaffold, 0, 0.95, -0.55, 1.18, 0.04, 0.04),
    box(C.scaffold, 0, 0.95, 0.55, 1.18, 0.04, 0.04),
  )
  return out
}

function banner(x: number, z: number): P[] {
  const side = Math.sign(x) || 1
  return [
    box(C.timberDark, x, 0, z, 0.04, 1.24, 0.04),
    box(C.gold, x + side * 0.15, 1.03, z, 0.28, 0.18, 0.02),
  ]
}

/** Upgrade marks: a gold pennant at tier 1; a second and a gilt trim at tier 2. */
function tierTrim(tier: number): P[] {
  if (tier <= 0) return []
  const out = banner(0.52, 0.48)
  if (tier >= 2) out.push(...banner(-0.52, 0.48), part('torus', 'solid', C.gold, local(0, 0.03, 0, 0.66, 0.25, 0.66)))
  return out
}

export interface BuildingModelInput {
  building: BuildingInstance
  /** Construction progress (10% steps are plenty for the frame's height). */
  progress: number
  occupied: boolean
  lit: boolean
  tier: number
  upgrading: boolean
  cold: boolean
}

/** Every instanced part of one building, in world space. */
export function buildingParts(input: BuildingModelInput): P[] {
  const { building } = input
  const def = BUILDINGS[building.defId]
  if (!def) return []
  const radius = footprintOf(building.defId)
  const scale = radius / 0.6
  let parts: P[]
  if (building.built) {
    parts = [
      ...modelParts(def.category, def.id, { occupied: input.occupied, lit: input.lit }),
      ...tierTrim(input.tier),
      ...(input.upgrading ? upgradeScaffold() : []),
    ]
  } else {
    parts = constructionSite(input.progress)
  }
  const yaw = def.category === 'hearth' ? 0 : buildingYaw(building.id)
  placeParts(parts, building.pos.x, building.pos.y, scale, yaw, building.id)
  if (input.cold) {
    parts.push({
      geo: 'disc',
      mat: 'decal',
      color: color('#5f8fd4'),
      matrix: local(building.pos.x, 0.03, building.pos.y, radius + 0.35, 1, radius + 0.35),
    })
  }
  return parts
}

// --- deposits and obstacles ----------------------------------------------------------

function scatter(id: string, count: number, radius: number) {
  return Array.from({ length: count }, (_, i) => {
    const angle = hash01(id, i * 3 + 1) * Math.PI * 2
    const distance = hash01(id, i * 3 + 2) * radius * 0.7
    return {
      x: Math.cos(angle) * distance,
      z: Math.sin(angle) * distance,
      s: 0.7 + hash01(id, i * 3 + 3) * 0.6,
      rot: hash01(id, i * 3 + 4) * Math.PI,
    }
  })
}

const BERRY_SPOTS: [number, number, number][] = [
  [0.13, 0.22, 0.05],
  [-0.1, 0.25, 0.1],
  [0.02, 0.3, -0.12],
]

function boar(x: number, z: number, s: number, rot: number): P[] {
  const out: P[] = [
    part('box', 'solid', '#5a3b26', local(0, 0.07, 0, 0.38, 0.2, 0.2)),
    part('box', 'solid', '#5a3b26', local(0.24, 0.1, 0, 0.13, 0.13, 0.14)),
    part('box', 'solid', '#efe3c4', local(0.31, 0.11, 0.05, 0.05, 0.03, 0.03)),
  ]
  for (const [lx, lz] of [[0.13, 0.07], [0.13, -0.07], [-0.13, 0.07], [-0.13, -0.07]] as const) {
    out.push(part('box', 'solid', '#4a301f', local(lx, 0, lz, 0.05, 0.09, 0.05)))
  }
  return placeParts(out, x, z, s, rot)
}

/** The physical shape of a resource deposit plus its kind-coloured ground ring. */
export function depositParts(deposit: WorldDeposit): P[] {
  const { id, kind, radius } = deposit
  const count = kind === 'trees' ? 4 : kind === 'vegetation' || kind === 'game' ? 3 : 2
  const items = scatter(id, count, radius)
  const out: P[] = []
  switch (kind) {
    case 'trees':
      for (const p of items) {
        const tint = 0.85 + hash01(id, p.rot * 100) * 0.3
        const c = new THREE.Color('#3f7044').multiplyScalar(tint)
        out.push({ geo: 'conifer', mat: 'tree', color: c, matrix: local(p.x, 0, p.z, p.s * 0.8, p.s * 0.95, p.s * 0.8, p.rot) })
      }
      break
    case 'stoneVein':
      for (const p of items) out.push(part('rock', 'solid', '#80858b', local(p.x, 0.1 * p.s, p.z, 0.5 * p.s, 0.35 * p.s, 0.5 * p.s, p.rot)))
      break
    case 'orePatch':
      for (const p of items) {
        out.push(part('rock', 'solid', '#8a6a4f', local(p.x, 0.09 * p.s, p.z, 0.46 * p.s, 0.32 * p.s, 0.46 * p.s, p.rot)))
        out.push(part('rock', 'glow', '#d08a3c', local(p.x, 0.2 * p.s, p.z, 0.1, 0.08, 0.1, p.rot)))
      }
      break
    case 'clayPatch':
      out.push(part('mound', 'solid', '#7a5a43', local(0, 0.01, 0, radius * 1.3, 0.18, radius * 1.3)))
      break
    case 'fertileSoil':
      out.push(part('box', 'solid', '#6d6a35', local(0, 0, 0, radius * 1.7, 0.1, radius * 1.7, hash01(id, 9) * Math.PI)))
      for (let i = 0; i < 3; i++) {
        out.push(part('box', 'solid', '#8a8a3e', local(0, 0.1, (i - 1) * radius * 0.5, radius * 1.4, 0.04, 0.08, hash01(id, 9) * Math.PI)))
      }
      break
    case 'vegetation':
      for (const p of items) {
        const bush: P[] = [part('ico', 'solid', '#3d6a3c', local(0, 0.16 * p.s, 0, 0.44 * p.s, 0.35 * p.s, 0.44 * p.s))]
        for (const [bx, by, bz] of BERRY_SPOTS) {
          bush.push(part('ico', 'solid', '#c8324a', local(bx * p.s, by * p.s, bz * p.s, 0.11, 0.11, 0.11)))
        }
        out.push(...placeParts(bush, p.x, p.z, 1, p.rot))
      }
      break
    case 'game':
      out.push(part('mound', 'solid', '#4f4030', local(0, 0, 0, radius * 1.2, 0.04, radius * 1.2)))
      for (const p of items.slice(0, 2)) out.push(...boar(p.x, p.z, 0.85 + p.s * 0.35, p.rot * 2))
      break
  }
  out.push({ geo: 'ring', mat: 'decal', color: color(DEPOSIT_TINT[kind]), matrix: local(0, 0.025, 0, radius, 1, radius) })
  return placeParts(out, deposit.pos.x, deposit.pos.y, 1)
}

export function obstacleParts(obstacle: Obstacle): P[] {
  const { id, kind, radius } = obstacle
  const out: P[] = []
  if (kind === 'mire') {
    out.push(part('disc', 'solid', '#26332e', local(0, 0.03, 0, radius, 1, radius)))
    out.push(part('disc', 'glow', '#33463f', local(0.1, 0.035, -0.1, radius * 0.4, 1, radius * 0.25)))
  } else {
    for (let i = 0; i < 3; i++) {
      const s = 0.9 + hash01(id, i * 3 + 3) * radius
      out.push(
        part(
          'rock',
          'solid',
          i === 1 ? '#666a70' : '#757a80',
          local(
            (hash01(id, i * 3 + 1) - 0.5) * radius,
            0.09 * s,
            (hash01(id, i * 3 + 2) - 0.5) * radius,
            0.36 * s,
            0.26 * s,
            0.36 * s,
            hash01(id, i * 3 + 4) * Math.PI,
          ),
        ),
      )
    }
  }
  return placeParts(out, obstacle.pos.x, obstacle.pos.y, 1)
}
