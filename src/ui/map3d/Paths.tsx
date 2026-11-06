import { memo } from 'react'
import * as THREE from 'three'
import { footprintOf } from '../../game/engine/actions'
import type { RunState } from '../../game/types'
import { pathKey, useRunKey } from './layerKeys'
import { NO_RAYCAST } from './models'
import { useStaticGeometry } from './staticGeometry'

/**
 * Worn dirt strips between the hearth and every finished building — the
 * routes the cosmetic villagers already walk, made visible in the ground.
 * One merged mesh for every strip, rebuilt only when a building is finished
 * or removed (`pathKey`).
 */

const PATH_MAT = new THREE.MeshBasicMaterial({
  color: '#3f3428',
  transparent: true,
  opacity: 0.38,
  depthWrite: false,
  side: THREE.DoubleSide,
})

const HALF_WIDTH = 0.17

/** Flat strips in world XZ at y = 0, one quad per finished building. */
export function pathGeometry(run: RunState): THREE.BufferGeometry {
  const positions: number[] = []
  for (const b of Object.values(run.buildings)) {
    if (!b.built || b.defId === 'ancientHearth') continue
    const dx = b.pos.x
    const dz = b.pos.y
    const full = Math.hypot(dx, dz)
    // Trim the hearth ring and the building footprint off the strip.
    const length = full - footprintOf(b.defId) - 1.1
    if (length < 0.6) continue
    const ux = dx / full
    const uz = dz / full
    const t0 = 1.1
    const t1 = 1.1 + length
    const nx = -uz * HALF_WIDTH
    const nz = ux * HALF_WIDTH
    const ax = ux * t0
    const az = uz * t0
    const bx = ux * t1
    const bz = uz * t1
    positions.push(
      ax + nx, 0, az + nz, bx - nx, 0, bz - nz, bx + nx, 0, bz + nz,
      ax + nx, 0, az + nz, ax - nx, 0, az - nz, bx - nx, 0, bz - nz,
    )
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geometry
}

export const Paths = memo(function Paths({ run }: { run: RunState }) {
  // Re-render only when the set of finished buildings changes.
  const key = useRunKey(pathKey)
  const geometry = useStaticGeometry(() => pathGeometry(run), [run, key])
  return (
    <mesh
      geometry={geometry}
      material={PATH_MAT}
      position={[0, 0.035, 0]}
      raycast={NO_RAYCAST}
      renderOrder={1}
    />
  )
})
