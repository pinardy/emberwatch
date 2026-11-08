import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { distToPolygonEdge, distToSegment, pointInPolygon } from '../../game/engine/geometry'
import type { Barrier, Glade, RunState, TerrainId, Vec2 } from '../../game/types'
import { GLADE_KIND_STYLE, SPARED_STYLE, gladeAccess, gladeFill, gladeLook, type GladeAccess } from '../mapShared'
import { REDUCED_MOTION } from '../motion'
import { gladeSurfaceKey, useRunKey } from './layerKeys'
import { NO_RAYCAST } from './models'
import { GEOS, MATS } from './parts'
import { gladeEdgeGeometry, mapStats, useStaticGeometry } from './staticGeometry'

/**
 * The ground: one vertex-coloured grid for the whole world (each glade painted
 * by its terrain, or its fog while uncleared, with a darker seam where glades
 * meet), a speckled procedural texture for grain up close, and rolling dark
 * hills beyond the forest edge. Glade polygons never move, so the grid and
 * which glade each vertex belongs to are computed once; clearing or
 * discovering a glade only repaints vertex colours.
 */

/** Grid spacing inside the world, world units. */
const STEP = 0.3
/** Seam width where two glades meet. */
const SEAM = 0.32
const MARGIN = 14

let noiseTex: THREE.CanvasTexture | null = null

/** A tiling speckle of lighter and darker flecks — grass, grit, pebbles. */
function groundTexture(): THREE.CanvasTexture | null {
  if (noiseTex) return noiseTex
  if (typeof document === 'undefined') return null
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#e8e8e8'
  ctx.fillRect(0, 0, size, size)
  let seed = 7
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  // Soft blotches, then fine flecks and short grass strokes.
  for (let i = 0; i < 70; i++) {
    const v = 205 + Math.floor(rand() * 50)
    ctx.fillStyle = `rgba(${v},${v},${v},0.35)`
    ctx.beginPath()
    ctx.arc(rand() * size, rand() * size, 6 + rand() * 18, 0, Math.PI * 2)
    ctx.fill()
  }
  for (let i = 0; i < 1400; i++) {
    const v = rand() < 0.5 ? 170 + Math.floor(rand() * 40) : 245 + Math.floor(rand() * 10)
    ctx.fillStyle = `rgb(${v},${v},${v})`
    const x = rand() * size
    const y = rand() * size
    if (rand() < 0.6) ctx.fillRect(x, y, 1 + rand() * 1.5, 1 + rand() * 1.5)
    else ctx.fillRect(x, y, 1, 2 + rand() * 3)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 4
  noiseTex = texture
  return texture
}

const GROUND_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, vertexColors: true })
const HILLS_MAT = new THREE.MeshStandardMaterial({
  color: '#ffffff',
  roughness: 1,
  vertexColors: true,
  flatShading: true,
})

/** Cheap smooth value noise in [0, 1). */
function vnoise(x: number, y: number): number {
  const h = (i: number, j: number) => {
    const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453
    return v - Math.floor(v)
  }
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = h(xi, yi)
  const b = h(xi + 1, yi)
  const c = h(xi, yi + 1)
  const d = h(xi + 1, yi + 1)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

interface GroundGrid {
  geometry: THREE.BufferGeometry
  /** Glade index per vertex, -1 outside every glade. */
  owner: Int16Array
  /** 0 at a glade's border, 1 a seam's width inside it. */
  seam: Float32Array
  /** Per-vertex brightness jitter. */
  jitter: Float32Array
  /** Fine noise in [0, 1) for a terrain's own texture (the Cinderwood's embers). */
  fleck: Float32Array
  /**
   * A barrier painted into the ground: 0 none, else its kind's index in
   * `BARRIER_PAINT` (+1), with `barrierEdge` 1 at its course and 0 at its
   * banks — so a river or a cliff costs no draw call of its own.
   */
  barrier: Uint8Array
  barrierEdge: Float32Array
}

/** How each barrier is painted into the ground grid. */
const BARRIER_PAINT: { kind: Barrier['kind']; half: number; core: THREE.Color; bank: THREE.Color; crossing: THREE.Color }[] = [
  { kind: 'river', half: 0.62, core: new THREE.Color('#2f6690'), bank: new THREE.Color('#3a3d2c'), crossing: new THREE.Color('#9a8458') },
  { kind: 'cliff', half: 0.42, core: new THREE.Color('#25211e'), bank: new THREE.Color('#6f6862'), crossing: new THREE.Color('#7d6c4f') },
]
/** Ground within this of a crossing is its ford or pass, not the barrier. */
const CROSSING_REACH = 0.85
/** A biome terrain's ember flecks (cleared ground; dimmer under the fog). */
const TERRAIN_FLECK: Partial<Record<TerrainId, { color: THREE.Color; above: number }>> = {
  cinder: { color: new THREE.Color('#ff7a2e'), above: 0.86 },
}

function buildGrid(glades: Glade[], width: number, height: number, barriers: Barrier[] = []): GroundGrid {
  const cols = Math.ceil(width / STEP) + 1
  const rows = Math.ceil(height / STEP) + 1
  const geometry = new THREE.PlaneGeometry(width, height, cols - 1, rows - 1).rotateX(-Math.PI / 2)
  const pos = geometry.getAttribute('position')
  const n = pos.count
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
  const owner = new Int16Array(n)
  const seam = new Float32Array(n)
  const jitter = new Float32Array(n)
  const fleck = new Float32Array(n)
  const barrier = new Uint8Array(n)
  const barrierEdge = new Float32Array(n)
  const p: Vec2 = { x: 0, y: 0 }
  for (let i = 0; i < n; i++) {
    p.x = pos.getX(i)
    p.y = pos.getZ(i)
    uv.setXY(i, p.x / 2.6, p.y / 2.6)
    let found = -1
    for (let g = 0; g < glades.length; g++) {
      if (pointInPolygon(p, glades[g].polygon)) {
        found = g
        break
      }
    }
    owner[i] = found
    seam[i] = found >= 0 ? Math.min(1, distToPolygonEdge(p, glades[found].polygon) / SEAM) : 0
    jitter[i] = (vnoise(p.x * 0.55, p.y * 0.55) - 0.5) * 0.16 + (vnoise(p.x * 2.1 + 9, p.y * 2.1) - 0.5) * 0.07
    fleck[i] = vnoise(p.x * 3.7 + 21, p.y * 3.7 - 5)
    for (const b of barriers) {
      const paint = BARRIER_PAINT.findIndex((k) => k.kind === b.kind)
      if (paint < 0) continue
      const half = BARRIER_PAINT[paint].half
      let d = Infinity
      for (const [a, c] of b.segments) d = Math.min(d, distToSegment(p, a, c))
      if (d > half * 1.35) continue
      const crossing = b.crossings.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < CROSSING_REACH)
      barrier[i] = crossing ? 128 + paint + 1 : paint + 1
      barrierEdge[i] = Math.max(0, 1 - d / (half * 1.35))
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  mapStats.geometriesCreated++
  return { geometry, owner, seam, jitter, fleck, barrier, barrierEdge }
}

/**
 * Dark wooded hills rising beyond the forest edge, framing the valley. Only
 * the ring outside the world is built, so no pixel of the world is shaded twice.
 */
function hillsGeometry(width: number, height: number): THREE.BufferGeometry {
  const w = width + MARGIN * 2
  const h = height + MARGIN * 2
  const step = 1.1
  const cols = Math.round(w / step)
  const rows = Math.round(h / step)
  const low = new THREE.Color('#25362b')
  const high = new THREE.Color('#3a4a36')
  const c = new THREE.Color()
  const vertex = (i: number, j: number): [number, number, number, boolean] => {
    const x = -w / 2 + (i / cols) * w
    const z = -h / 2 + (j / rows) * h
    const out = Math.max(Math.abs(x) - width / 2, Math.abs(z) - height / 2)
    return [x, hillY(x, z, width, height), z, out > -0.01]
  }
  const positions: number[] = []
  const colors: number[] = []
  const push = (v: [number, number, number, boolean]) => {
    positions.push(v[0], v[1], v[2])
    c.copy(low).lerp(high, Math.min(1, Math.max(0, v[1] / 3 + vnoise(v[0] * 0.6 + 3, v[2] * 0.6) * 0.3)))
    colors.push(c.r, c.g, c.b)
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = vertex(i, j)
      const b = vertex(i + 1, j)
      const d = vertex(i, j + 1)
      const e = vertex(i + 1, j + 1)
      // Skip quads wholly inside the world: the ground grid covers those.
      if (!a[3] && !b[3] && !d[3] && !e[3]) continue
      push(a); push(d); push(b)
      push(b); push(d); push(e)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

/** Height of the land beyond the world's edge (flat, just below the ground, inside). */
function hillY(x: number, z: number, width: number, height: number): number {
  const out = Math.max(Math.abs(x) - width / 2, Math.abs(z) - height / 2)
  if (out <= 0) return -0.02
  const rise = Math.min(1, out / 7)
  return rise * rise * (1.2 + vnoise(x * 0.25, z * 0.25) * 2.6) + vnoise(x * 0.9, z * 0.9) * 0.25 * rise
}

/** How far beyond the edge the border woods reach (fog swallows the rest). */
const BORDER_DEPTH = 9

/**
 * Dark woods on the hills around the world: the valley sits inside a forest
 * instead of floating on a slab. Two instanced draw calls, no shadows.
 */
const BorderForest = memo(function BorderForest({ width, height }: { width: number; height: number }) {
  const conifer = useRef<THREE.InstancedMesh>(null)
  const broadleaf = useRef<THREE.InstancedMesh>(null)
  const trees = useMemo(() => {
    const c: [number, number, number, number, number][] = []
    const b: typeof c = []
    const spacing = 1.25
    for (let x = -width / 2 - BORDER_DEPTH; x <= width / 2 + BORDER_DEPTH; x += spacing) {
      for (let z = -height / 2 - BORDER_DEPTH; z <= height / 2 + BORDER_DEPTH; z += spacing) {
        const jx = x + (vnoise(x * 3.1, z * 1.7) - 0.5) * 1.0
        const jz = z + (vnoise(x * 1.3 + 5, z * 2.9) - 0.5) * 1.0
        const out = Math.max(Math.abs(jx) - width / 2, Math.abs(jz) - height / 2)
        if (out < 0.4 || out > BORDER_DEPTH) continue
        const s = 0.95 + vnoise(jx * 2.3, jz * 2.3) * 0.7
        const shade = vnoise(jx * 0.7 + 11, jz * 0.7)
        ;(vnoise(jx * 4.7, jz * 4.7) < 0.3 ? b : c).push([jx, hillY(jx, jz, width, height) - 0.05, jz, s, shade])
      }
    }
    return { c, b }
  }, [width, height])
  useLayoutEffect(() => {
    const helper = new THREE.Object3D()
    const tint = new THREE.Color()
    const fill = (mesh: THREE.InstancedMesh | null, list: [number, number, number, number, number][], base: string) => {
      if (!mesh) return
      list.forEach(([x, y, z, s, shade], i) => {
        helper.position.set(x, y, z)
        helper.scale.setScalar(s * 1.25)
        helper.rotation.set(0, shade * 9, 0)
        helper.updateMatrix()
        mesh.setMatrixAt(i, helper.matrix)
        mesh.setColorAt(i, tint.set(base).offsetHSL(0, 0, (shade - 0.5) * 0.06))
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
    }
    fill(conifer.current, trees.c, '#22382a')
    fill(broadleaf.current, trees.b, '#2c3a26')
  }, [trees])
  return (
    <>
      <instancedMesh ref={conifer} args={[GEOS.conifer, MATS.tree, trees.c.length]} raycast={NO_RAYCAST} />
      <instancedMesh ref={broadleaf} args={[GEOS.broadleaf, MATS.tree, trees.b.length]} raycast={NO_RAYCAST} />
    </>
  )
})

const SEAM_SHADE = 0.72

export const GroundSurface = memo(function GroundSurface({ run }: { run: RunState }) {
  const key = useRunKey(gladeSurfaceKey)
  const glades = useMemo(() => Object.values(run.glades), [run])
  const grid = useMemo(
    () => buildGrid(glades, run.world.width, run.world.height, run.world.barriers),
    [glades, run.world],
  )
  const hills = useStaticGeometry(() => hillsGeometry(run.world.width, run.world.height), [run.world])
  const material = useMemo(() => {
    const tex = groundTexture()
    if (tex && GROUND_MAT.map !== tex) {
      GROUND_MAT.map = tex
      GROUND_MAT.needsUpdate = true
    }
    return GROUND_MAT
  }, [])

  useEffect(() => () => grid.geometry.dispose(), [grid])

  useLayoutEffect(() => {
    const colors = grid.geometry.getAttribute('color') as THREE.BufferAttribute
    const arr = colors.array as Float32Array
    const fills = glades.map((g) => new THREE.Color(gladeFill(g, '3d')))
    const cleared = glades.map((g) => gladeLook(g) === 'visible')
    const flecks = glades.map((g) => (gladeLook(g) === 'hidden' ? undefined : TERRAIN_FLECK[g.terrain]))
    const outside = new THREE.Color('#151d1a')
    const c = new THREE.Color()
    for (let i = 0; i < grid.owner.length; i++) {
      const g = grid.owner[i]
      const base = g >= 0 ? fills[g] : outside
      // Cleared ground gets a visible seam and more grain; fogged ground stays quiet.
      const seam = g >= 0 ? grid.seam[i] : 1
      const edge = cleared[g] ? SEAM_SHADE + (1 - SEAM_SHADE) * seam : 0.9 + 0.1 * seam
      const k = edge * (1 + grid.jitter[i] * (cleared[g] ? 1 : 0.5))
      c.setRGB(base.r * k, base.g * k, base.b * k)
      // A biome's own texture: the Cinderwood's embers glint through the ash.
      const fleck = g >= 0 ? flecks[g] : undefined
      if (fleck && grid.fleck[i] > fleck.above) {
        const t = Math.min(1, (grid.fleck[i] - fleck.above) / (1 - fleck.above) * 2.2) * (cleared[g] ? 0.9 : 0.35)
        c.lerp(fleck.color, t)
      }
      // A river or cliff runs whatever the fog: it is the lie of the land.
      const mark = grid.barrier[i]
      if (mark) {
        const paint = BARRIER_PAINT[(mark & 127) - 1]
        const e = grid.barrierEdge[i]
        if (mark & 128) c.lerp(paint.crossing, Math.min(1, e * 1.6))
        else {
          // Banks first, then the water (or the drop) itself.
          c.lerp(paint.bank, Math.min(1, e * 3))
          if (e > 0.35) c.lerp(paint.core, Math.min(1, (e - 0.35) * 4))
        }
      }
      arr[i * 3] = c.r
      arr[i * 3 + 1] = c.g
      arr[i * 3 + 2] = c.b
    }
    colors.needsUpdate = true
  }, [grid, glades, key])

  return (
    <>
      <mesh geometry={grid.geometry} material={material} position={[0, 0.012, 0]} receiveShadow raycast={NO_RAYCAST} />
      <mesh geometry={hills} material={HILLS_MAT} raycast={NO_RAYCAST} />
      <BorderForest width={run.world.width} height={run.world.height} />
    </>
  )
})

/** Width of a fogged glade's kind border, in world units. */
const EDGE_WIDTH = 0.16

const EDGE_MAT = new THREE.MeshBasicMaterial({
  color: '#ffffff',
  vertexColors: true,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
})

/**
 * Kind borders of fogged glades — solid for small, long dashes for
 * dangerous, tight dots for forbidden; bright when reachable, dim when out of
 * reach — merged into one mesh. A glade being cleared breathes on its own.
 */
export const GladeEdges = memo(function GladeEdges({ run }: { run: RunState }) {
  const key = useRunKey(gladeSurfaceKey)
  const { still, clearing } = useMemo(() => {
    const s: { glade: Glade; access: GladeAccess }[] = []
    const c: Glade[] = []
    for (const glade of Object.values(run.glades)) {
      if (gladeLook(glade) !== 'fogged') continue
      const access = gladeAccess(run, glade)
      if (access === 'clearing') c.push(glade)
      else s.push({ glade, access })
    }
    return { still: s, clearing: c }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, key])
  const merged = useStaticGeometry(() => {
    const parts = still.map(({ glade, access }) => {
      const style = GLADE_KIND_STYLE[glade.kind]
      // Left to the forest: a wide, faint mint band instead of the kind's crisp line.
      const spared = access === 'spared'
      const g = gladeEdgeGeometry(glade.polygon, spared ? null : style.dash, spared ? EDGE_WIDTH * 2.2 : EDGE_WIDTH)
      const c = new THREE.Color(spared ? SPARED_STYLE.edge : style.edge)
      const a = access === 'locked' ? 0.3 : spared ? 0.3 : 0.9
      const n = g.getAttribute('position').count
      const colors = new Float32Array(n * 4)
      for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b, a], i * 4)
      g.setAttribute('color', new THREE.BufferAttribute(colors, 4))
      return g
    })
    return parts.length > 0 ? mergeGeometries(parts)! : new THREE.BufferGeometry()
  }, [still])
  return (
    <>
      {still.length > 0 && (
        <mesh geometry={merged} material={EDGE_MAT} position={[0, 0.03, 0]} renderOrder={1} raycast={NO_RAYCAST} />
      )}
      {clearing.map((glade) => (
        <ClearingEdge key={glade.id} glade={glade} />
      ))}
    </>
  )
})

function ClearingEdge({ glade }: { glade: Glade }) {
  const style = GLADE_KIND_STYLE[glade.kind]
  const geometry = useStaticGeometry(
    () => gladeEdgeGeometry(glade.polygon, style.dash, EDGE_WIDTH),
    [glade.polygon, style.dash],
  )
  const material = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(({ clock }) => {
    if (REDUCED_MOTION || !material.current) return
    material.current.opacity = 0.55 + Math.sin(clock.elapsedTime * 4) * 0.35
  })
  return (
    <mesh geometry={geometry} position={[0, 0.03, 0]} renderOrder={1} raycast={NO_RAYCAST}>
      <meshBasicMaterial ref={material} color="#9fe09a" transparent opacity={0.9} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  )
}
