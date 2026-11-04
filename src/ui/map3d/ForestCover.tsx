import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { distToPolygonEdge, pointInPolygon, polygonBounds } from '../../game/engine/geometry'
import type { Glade, GladeKind } from '../../game/types'
import { GLADE_KIND_STYLE } from '../mapShared'
import { REDUCED_MOTION } from '../motion'
import { NO_RAYCAST, hash01 } from './models'

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
}

export function treesFor(glades: Glade[]): TreeInstance[] {
  const out: TreeInstance[] = []
  const spacing = 1.15
  for (const glade of glades) {
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
        out.push({
          x: jx,
          z: jy,
          s: 0.75 + hash01(glade.id, salt + 3) * 0.75,
          discovered: glade.discovered,
          kind: glade.kind,
        })
      }
    }
  }
  return out
}

export function ForestCover({ glades }: { glades: Glade[] }) {
  const uncleared = glades.filter((g) => !g.cleared)
  const signature = uncleared.map((g) => `${g.id}${g.discovered ? 'd' : ''}`).join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trees = useMemo(() => treesFor(uncleared), [signature])
  if (trees.length === 0) return null
  return <ForestInstances key={signature} trees={trees} />
}

/** Discovered canopies wear their glade kind: green, olive-amber, bruised violet. */
const DISCOVERED_CANOPY = Object.fromEntries(
  Object.entries(GLADE_KIND_STYLE).map(([kind, style]) => [kind, new THREE.Color(style.canopy)]),
) as Record<GladeKind, THREE.Color>
const HIDDEN_CANOPY = new THREE.Color('#1b2b22')

function ForestInstances({ trees }: { trees: TreeInstance[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const instanced = mesh.current
    if (!instanced) return
    const helper = new THREE.Object3D()
    trees.forEach((tree, i) => {
      helper.position.set(tree.x, tree.s * 0.5, tree.z)
      helper.scale.set(tree.s, tree.s, tree.s)
      helper.rotation.y = tree.s * 7 // pseudo-random facing, stable per tree
      helper.updateMatrix()
      instanced.setMatrixAt(i, helper.matrix)
      instanced.setColorAt(i, tree.discovered ? DISCOVERED_CANOPY[tree.kind] : HIDDEN_CANOPY)
    })
    instanced.instanceMatrix.needsUpdate = true
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true
  }, [trees])

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, trees.length]}
      castShadow
      raycast={NO_RAYCAST}
      frustumCulled={false}
    >
      <coneGeometry args={[0.42, 1.15, 6]} />
      <meshStandardMaterial color="#ffffff" roughness={1} />
    </instancedMesh>
  )
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
export function FellingForest({ glades }: { glades: Record<string, Glade> }) {
  const prevCleared = useRef<Set<string> | null>(null)
  const [falling, setFalling] = useState<FallingGrove[]>([])

  // Glades mutate in place, so compare cleared ids after every render.
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
        trees: treesFor([{ ...g, cleared: false, discovered: true }]),
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
