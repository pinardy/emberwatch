import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { distToPolygonEdge, pointInPolygon, polygonBounds } from '../../game/engine/geometry'
import type { Glade, GladeKind, Obstacle, TerrainId } from '../../game/types'
import { GLADE_KIND_STYLE } from '../mapShared'
import { REDUCED_MOTION } from '../motion'
import { NO_RAYCAST, hash01 } from './models'
import { GEOS } from './parts'

/**
 * The wild forest blanketing every glade you have not cleared yet. One
 * instanced draw call for hundreds of canopies; clearing a glade fells its
 * trees by rebuilding the instance list.
 */

export interface TreeInstance {
  x: number
  z: number
  s: number
  discovered: boolean
  /** Glade kind: discovered canopies are tinted by it. */
  kind: GladeKind
  /** Burned ground (the Cinderwood): a dead, charred snag instead of a canopy. */
  charred?: boolean
}

/** Ground no tree stands on: a river's water, a cliff's edge. */
export type TreeBlocker = Pick<Obstacle, 'pos' | 'radius'>

/** The barrier obstacles trees keep off (water and cliff edges). */
export function treeBlockers(obstacles: readonly Obstacle[]): TreeBlocker[] {
  return obstacles.filter((o) => o.kind === 'water' || o.kind === 'cliff')
}

/** Terrains whose forest is dead and burned: thinner, sparser, charcoal. */
const CHARRED: ReadonlySet<TerrainId> = new Set<TerrainId>(['cinder'])

export function treesFor(glades: Glade[], blockers: readonly TreeBlocker[] = []): TreeInstance[] {
  const out: TreeInstance[] = []
  const spacing = 1.15
  for (const glade of glades) {
    const charred = CHARRED.has(glade.terrain)
    const { minX, minY, maxX, maxY } = polygonBounds(glade.polygon)
    let ix = 0
    for (let x = minX; x <= maxX; x += spacing, ix++) {
      let iy = 0
      for (let y = minY; y <= maxY; y += spacing, iy++) {
        const salt = ix * 731 + iy * 37
        const jx = x + (hash01(glade.id, salt + 1) - 0.5) * 0.9
        const jy = y + (hash01(glade.id, salt + 2) - 0.5) * 0.9
        const p = { x: jx, y: jy }
        if (!pointInPolygon(p, glade.polygon)) continue
        if (distToPolygonEdge(p, glade.polygon) < 0.2) continue
        // Keep the centre open so the glade's name plate reads clearly.
        if (glade.discovered && Math.hypot(jx - glade.center.x, jy - glade.center.y) < 1.2) continue
        // A burn scar stands thin: about half its snags survive.
        if (charred && hash01(glade.id, salt + 4) < 0.45) continue
        if (blockers.some((b) => Math.hypot(jx - b.pos.x, jy - b.pos.y) < b.radius + 0.25)) continue
        out.push({
          x: jx,
          z: jy,
          s: 0.75 + hash01(glade.id, salt + 3) * 0.75,
          discovered: glade.discovered,
          kind: glade.kind,
          ...(charred ? { charred: true } : {}),
        })
      }
    }
  }
  return out
}

export function ForestCover({ glades, obstacles = [] }: { glades: Glade[]; obstacles?: readonly Obstacle[] }) {
  const uncleared = glades.filter((g) => !g.cleared)
  const signature = uncleared.map((g) => `${g.id}${g.discovered ? 'd' : ''}`).join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trees = useMemo(() => treesFor(uncleared, treeBlockers(obstacles)), [signature])
  if (trees.length === 0) return null
  return <ForestInstances key={signature} trees={trees} />
}

/** Discovered canopies wear their glade kind: green, olive-amber, bruised violet. */
const DISCOVERED_CANOPY = Object.fromEntries(
  Object.entries(GLADE_KIND_STYLE).map(([kind, style]) => [kind, new THREE.Color(style.canopy)]),
) as Record<GladeKind, THREE.Color>
const HIDDEN_CANOPY = new THREE.Color('#22362a')
const HIDDEN_BROADLEAF = new THREE.Color('#2b3826')
/** Dead wood: charcoal, a shade warmer once the glade is in view. */
const CHARRED_CANOPY = new THREE.Color('#231d1a')
const CHARRED_DISCOVERED = new THREE.Color('#3a2c26')

const TREE_MAT = new THREE.MeshStandardMaterial({
  color: '#ffffff',
  roughness: 1,
  flatShading: true,
  vertexColors: true,
})

/** Broadleaf share of the woods: a mixed forest reads less like a field of cones. */
const BROADLEAF_SHARE = 0.32

/**
 * The forest as two instanced meshes (layered conifers and round broadleaves),
 * each tree tinted by its glade kind with a little per-tree variation in
 * shade and hue so the canopy is not one flat colour.
 */
function ForestInstances({ trees }: { trees: TreeInstance[] }) {
  const conifer = useRef<THREE.InstancedMesh>(null)
  const broadleaf = useRef<THREE.InstancedMesh>(null)
  const split = useMemo(() => {
    const c: TreeInstance[] = []
    const b: TreeInstance[] = []
    for (const tree of trees) (treeNoise(tree, 5) < BROADLEAF_SHARE ? b : c).push(tree)
    return { c, b }
  }, [trees])

  useLayoutEffect(() => {
    const helper = new THREE.Object3D()
    const tint = new THREE.Color()
    const fill = (mesh: THREE.InstancedMesh | null, list: TreeInstance[], broad: boolean) => {
      if (!mesh) return
      list.forEach((tree, i) => {
        const h = treeNoise(tree, 1)
        const s = tree.s * (broad ? 1.05 : 1.2)
        // A charred snag: stripped to a narrow spike.
        const girth = tree.charred ? 0.42 : 1
        helper.position.set(tree.x, 0, tree.z)
        helper.scale.set(s * (0.9 + h * 0.2) * girth, s * (0.9 + treeNoise(tree, 2) * 0.3), s * (0.9 + h * 0.2) * girth)
        helper.rotation.set(0, treeNoise(tree, 3) * Math.PI * 2, 0)
        helper.updateMatrix()
        mesh.setMatrixAt(i, helper.matrix)
        const base = tree.charred
          ? tree.discovered
            ? CHARRED_DISCOVERED
            : CHARRED_CANOPY
          : tree.discovered
            ? DISCOVERED_CANOPY[tree.kind]
            : broad
              ? HIDDEN_BROADLEAF
              : HIDDEN_CANOPY
        tint.copy(base)
        if (broad && tree.discovered && !tree.charred) tint.offsetHSL(0.03, -0.02, 0.03)
        tint.offsetHSL((treeNoise(tree, 4) - 0.5) * 0.04, 0, (h - 0.5) * 0.08)
        mesh.setColorAt(i, tint)
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
    }
    fill(conifer.current, split.c, false)
    fill(broadleaf.current, split.b, true)
  }, [split])

  return (
    <>
      {split.c.length > 0 && (
        <instancedMesh
          ref={conifer}
          args={[GEOS.conifer, TREE_MAT, split.c.length]}
          castShadow
          receiveShadow={false}
          raycast={NO_RAYCAST}
        />
      )}
      {split.b.length > 0 && (
        <instancedMesh
          ref={broadleaf}
          args={[GEOS.broadleaf, TREE_MAT, split.b.length]}
          castShadow
          receiveShadow={false}
          raycast={NO_RAYCAST}
        />
      )}
    </>
  )
}

/** Stable per-tree noise in [0, 1). */
function treeNoise(tree: TreeInstance, salt: number): number {
  const v = Math.sin(tree.x * 12.9898 + tree.z * 78.233 + salt * 37.719) * 43758.5453
  return v - Math.floor(v)
}

// ---------------------------------------------------------------------------
// Felling animation
// ---------------------------------------------------------------------------

const FELL_SECONDS = 1.1

interface FallingGrove {
  id: string
  trees: TreeInstance[]
  start: number
}

/**
 * When a glade is cleared, `ForestCover` drops its trees instantly. This
 * component notices the transition and replays the same trees sinking into
 * the ground for a beat, so clearing reads as felling rather than a blink.
 */
export function FellingForest({
  glades,
  obstacles = [],
}: {
  glades: Record<string, Glade>
  obstacles?: readonly Obstacle[]
}) {
  const prevCleared = useRef<Set<string> | null>(null)
  const [falling, setFalling] = useState<FallingGrove[]>([])

  // Glades mutate in place, so compare cleared ids after every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- no deps on purpose; it sets state only on a new clearing
  useEffect(() => {
    if (REDUCED_MOTION) return
    const cleared = Object.values(glades).filter((g) => g.cleared)
    if (prevCleared.current === null) {
      // First render of a run: nothing is "newly" cleared.
      prevCleared.current = new Set(cleared.map((g) => g.id))
      return
    }
    const fresh = cleared.filter((g) => !prevCleared.current!.has(g.id))
    if (fresh.length === 0) return
    prevCleared.current = new Set(cleared.map((g) => g.id))
    setFalling((current) => [
      ...current,
      ...fresh.map((g) => ({
        id: g.id,
        trees: treesFor([{ ...g, cleared: false, discovered: true }], treeBlockers(obstacles)),
        start: performance.now(),
      })),
    ])
  })

  if (falling.length === 0) return null
  return (
    <>
      {falling.map((grove) => (
        <SinkingTrees
          key={grove.id}
          grove={grove}
          onDone={() => setFalling((current) => current.filter((g) => g.id !== grove.id))}
        />
      ))}
    </>
  )
}

function SinkingTrees({ grove, onDone }: { grove: FallingGrove; onDone: () => void }) {
  const group = useRef<THREE.Group>(null)
  const done = useRef(false)
  useFrame(() => {
    const t = (performance.now() - grove.start) / (FELL_SECONDS * 1000)
    if (t >= 1) {
      if (!done.current) {
        done.current = true
        onDone()
      }
      return
    }
    // Sink vertically in place; x/z stay 1 so positions do not slide.
    group.current?.scale.set(1, Math.max(0.001, 1 - t * t), 1)
  })
  return (
    <group ref={group}>
      <ForestInstances trees={grove.trees} />
    </group>
  )
}
