import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { NO_RAYCAST } from './models'

/**
 * Instanced low-poly parts. Buildings, deposits and obstacles are described as
 * lists of parts — a unit geometry, a material class, a world matrix and a
 * colour — and every part sharing a geometry and material class is drawn by
 * one `InstancedMesh`. Colour lives on the instance, so a hundred buildings in
 * a dozen palettes are still a dozen draw calls.
 */

// --- unit geometries -----------------------------------------------------------
// Authored to sit on y = 0 and span about one unit, so a part's scale is its size.

/** A gable roof: 1 wide (x), 1 deep (z), 1 tall, ridge along z. */
function prismGeometry(): THREE.BufferGeometry {
  const a = [-0.5, 0, -0.5]
  const b = [0.5, 0, -0.5]
  const c = [0, 1, -0.5]
  const d = [-0.5, 0, 0.5]
  const e = [0.5, 0, 0.5]
  const f = [0, 1, 0.5]
  const tris = [
    [a, c, b], // back gable
    [d, e, f], // front gable
    [a, d, f], [a, f, c], // left slope
    [b, c, f], [b, f, e], // right slope
    [a, b, e], [a, e, d], // floor
  ]
  const positions = tris.flat(2)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

const up = (g: THREE.BufferGeometry, dy: number) => g.translate(0, dy, 0)

/** Unit footprint: x and z span [-0.5, 0.5]. */
export const GEOS = {
  box: up(new THREE.BoxGeometry(1, 1, 1), 0.5),
  prism: prismGeometry(),
  pyramid: up(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4), 0.5),
  cone: up(new THREE.ConeGeometry(0.5, 1, 7, 1), 0.5),
  cyl: up(new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1), 0.5),
  /** A log lying along x. */
  log: new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1).rotateZ(Math.PI / 2),
  dome: new THREE.SphereGeometry(0.5, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2),
  ico: new THREE.IcosahedronGeometry(0.5, 0),
  rock: new THREE.DodecahedronGeometry(0.5, 0),
  mound: new THREE.SphereGeometry(0.5, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2),
  /** Flat disc on the ground, radius 1. */
  disc: new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2),
  /** Flat ring on the ground, radii 0.8–1. */
  ring: new THREE.RingGeometry(0.8, 1, 28).rotateX(-Math.PI / 2),
  /** Ground torus of radius 1 (the hearth's kerb, tier trims). */
  torus: new THREE.TorusGeometry(1, 0.12, 5, 16).rotateX(-Math.PI / 2),
  conifer: coniferGeometry(),
  broadleaf: broadleafGeometry(),
} as const

export type GeoId = keyof typeof GEOS

/**
 * A layered conifer: trunk and three stacked tiers, 1 unit tall. Vertex
 * colours keep the trunk brown while the instance colour tints the canopy.
 */
export function coniferGeometry(): THREE.BufferGeometry {
  const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const n = g.getAttribute('position').count
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return g.toNonIndexed()
  }
  const trunk = new THREE.Color('#7a5638')
  const leaf = new THREE.Color('#ffffff')
  const shade = new THREE.Color('#c9d6c8')
  const parts = [
    paint(up(new THREE.CylinderGeometry(0.05, 0.07, 0.22, 5), 0.11), trunk),
    paint(up(new THREE.ConeGeometry(0.42, 0.42, 7), 0.36), shade),
    paint(up(new THREE.ConeGeometry(0.33, 0.38, 7), 0.6), leaf),
    paint(up(new THREE.ConeGeometry(0.22, 0.32, 7), 0.84), leaf),
  ]
  const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!
  merged.computeVertexNormals()
  return merged
}

/** A round broadleaf: trunk and a lumpy two-blob crown, about 1 unit tall. */
export function broadleafGeometry(): THREE.BufferGeometry {
  const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const ng = g.index ? g.toNonIndexed() : g
    const n = ng.getAttribute('position').count
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3)
    ng.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    ng.deleteAttribute('uv')
    return ng
  }
  const trunk = new THREE.Color('#7a5638')
  const leaf = new THREE.Color('#ffffff')
  const shade = new THREE.Color('#d2dcc8')
  const parts = [
    paint(up(new THREE.CylinderGeometry(0.05, 0.08, 0.36, 5), 0.18), trunk),
    paint(new THREE.IcosahedronGeometry(0.34, 0).translate(0, 0.58, 0), leaf),
    paint(new THREE.IcosahedronGeometry(0.24, 0).translate(0.16, 0.48, 0.1), shade),
    paint(new THREE.IcosahedronGeometry(0.22, 0).translate(-0.14, 0.78, -0.06), leaf),
  ]
  for (const p of parts) p.deleteAttribute('uv')
  const merged = mergeGeometries(parts)!
  merged.computeVertexNormals()
  return merged
}

// --- materials -------------------------------------------------------------------
export const MATS = {
  /** Lit, flat-shaded, instance-coloured. */
  solid: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, flatShading: true }),
  /** Like `solid`, keeping baked vertex colours (brown trunks under tinted canopies). */
  tree: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true, vertexColors: true }),
  /** Unlit and untonemapped: windows, embers, flames — reads in any weather. */
  glow: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
  /** Translucent ghost frame of a construction site. */
  ghost: new THREE.MeshStandardMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.45,
    roughness: 1,
    depthWrite: false,
  }),
  /** Flat translucent ground decals (deposit tint rings, cold discs). */
  decal: new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
  /** Additive pools of firelight on the ground. */
  light: new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  }),
} as const

export type MatId = keyof typeof MATS

export interface Part {
  geo: GeoId
  mat: MatId
  matrix: THREE.Matrix4
  color: THREE.Color
  /** Owning entity (a building id), for per-owner animation. */
  owner?: string
}

const COLOR_CACHE = new Map<string, THREE.Color>()
/** Shared, never-mutated colour per hex string. */
export function color(hex: string): THREE.Color {
  let c = COLOR_CACHE.get(hex)
  if (!c) {
    c = new THREE.Color(hex)
    COLOR_CACHE.set(hex, c)
  }
  return c
}

const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const _s = new THREE.Vector3()

/** A local part transform: position, size, yaw (and optional pitch/roll). */
export function local(
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  ry = 0,
  rx = 0,
  rz = 0,
): THREE.Matrix4 {
  _e.set(rx, ry, rz)
  _q.setFromEuler(_e)
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz))
}

/**
 * Places a model authored in local units at a world spot: translate, yaw,
 * uniform scale. Mutates and returns `parts`' matrices.
 */
export function placeParts(parts: Part[], x: number, z: number, scale: number, yaw = 0, owner?: string): Part[] {
  const base = local(x, 0, z, scale, scale, scale, yaw)
  for (const p of parts) {
    p.matrix.premultiply(base)
    if (owner) p.owner = owner
  }
  return parts
}

/** Builder sugar: `part('box', 'solid', '#8a6a48', local(...))`. */
export function part(geo: GeoId, mat: MatId, hex: string, matrix: THREE.Matrix4): Part {
  return { geo, mat, matrix, color: color(hex) }
}

const CAPACITY_STEP = 32

/** Pop animation state shared by a `PartInstances`: owner id → start time (ms). */
export type PopMap = Map<string, { start: number; x: number; z: number }>

const POP_MS = 450
const _m = new THREE.Matrix4()
const _t = new THREE.Matrix4()

function GroupMesh({
  geo,
  mat,
  parts,
  castShadow,
  receiveShadow,
  pops,
}: {
  geo: GeoId
  mat: MatId
  parts: Part[]
  castShadow: boolean
  receiveShadow: boolean
  pops?: PopMap
}) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const capacity = Math.max(CAPACITY_STEP, Math.ceil(parts.length / CAPACITY_STEP) * CAPACITY_STEP)
  const animating = useRef(false)

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    m.count = parts.length
    for (let i = 0; i < parts.length; i++) {
      m.setMatrixAt(i, parts[i].matrix)
      m.setColorAt(i, parts[i].color)
    }
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
  }, [parts, capacity])

  useFrame(() => {
    const m = mesh.current
    if (!m || !pops) return
    if (pops.size === 0 && !animating.current) return
    const now = performance.now()
    let any = false
    for (let i = 0; i < parts.length; i++) {
      const owner = parts[i].owner
      const pop = owner ? pops.get(owner) : undefined
      if (!pop) continue
      const t = (now - pop.start) / POP_MS
      const k = t >= 1 ? 1 : 1 + 0.28 * Math.sin(t * Math.PI)
      _t.makeTranslation(pop.x, 0, pop.z)
      _m.makeScale(k, k, k).premultiply(_t)
      _t.makeTranslation(-pop.x, 0, -pop.z)
      _m.multiply(_t).multiply(parts[i].matrix)
      m.setMatrixAt(i, _m)
      any = true
    }
    if (any) m.instanceMatrix.needsUpdate = true
    animating.current = any
  })

  return (
    <instancedMesh
      key={capacity}
      ref={mesh}
      args={[GEOS[geo], MATS[mat], capacity]}
      castShadow={castShadow && mat === 'solid'}
      receiveShadow={receiveShadow && (mat === 'solid' || mat === 'decal')}
      raycast={NO_RAYCAST}
      renderOrder={mat === 'decal' || mat === 'light' ? 1 : 0}
    />
  )
}

/** Draws a list of parts as one instanced mesh per geometry × material class. */
export function PartInstances({
  parts,
  castShadow = false,
  receiveShadow = true,
  pops,
}: {
  parts: Part[]
  castShadow?: boolean
  receiveShadow?: boolean
  pops?: PopMap
}) {
  const groups = useMemo(() => {
    const out = new Map<string, Part[]>()
    for (const p of parts) {
      const key = `${p.geo}|${p.mat}`
      let list = out.get(key)
      if (!list) out.set(key, (list = []))
      list.push(p)
    }
    return [...out.entries()]
  }, [parts])
  return (
    <>
      {groups.map(([key, list]) => {
        const [geo, mat] = key.split('|') as [GeoId, MatId]
        return (
          <GroupMesh
            key={key}
            geo={geo}
            mat={mat}
            parts={list}
            castShadow={castShadow}
            receiveShadow={receiveShadow}
            pops={pops}
          />
        )
      })}
    </>
  )
}
