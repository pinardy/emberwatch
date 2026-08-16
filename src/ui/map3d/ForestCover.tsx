import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { distToPolygonEdge, pointInPolygon, polygonBounds } from '../../game/engine/geometry'
import type { Glade } from '../../game/types'
import { NO_RAYCAST, hash01 } from './models'

/**
 * The wild forest blanketing every glade you have not cleared yet. One
 * instanced draw call for hundreds of canopies; clearing a glade fells its
 * trees by rebuilding the instance list.
 */

interface TreeInstance {
  x: number
  z: number
  s: number
  discovered: boolean
}

function treesFor(glades: Glade[]): TreeInstance[] {
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

const DISCOVERED_CANOPY = new THREE.Color('#2e4f36')
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
      instanced.setColorAt(i, tree.discovered ? DISCOVERED_CANOPY : HIDDEN_CANOPY)
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
