import * as THREE from 'three'
import { footprintOf } from '../../game/engine/actions'
import type { RunState } from '../../game/types'
import { NO_RAYCAST } from './models'

/**
 * Worn dirt strips between the hearth and every finished building — the
 * routes the cosmetic villagers already walk, made visible in the ground.
 */

const PATH_MAT = new THREE.MeshBasicMaterial({
  color: '#3f3428',
  transparent: true,
  opacity: 0.38,
  depthWrite: false,
})

export function Paths({ run }: { run: RunState }) {
  return (
    <>
      {Object.values(run.buildings).map((b) => {
        if (!b.built || b.defId === 'ancientHearth') return null
        const dx = b.pos.x
        const dz = b.pos.y
        const full = Math.hypot(dx, dz)
        // Trim the hearth ring and the building footprint off the strip.
        const length = full - footprintOf(b.defId) - 1.1
        if (length < 0.6) return null
        const t = (1.1 + length / 2) / full
        return (
          <group
            key={b.id}
            position={[dx * t, 0.035, dz * t]}
            rotation={[0, -Math.atan2(dz, dx), 0]}
            raycast={NO_RAYCAST}
          >
            <mesh rotation={[-Math.PI / 2, 0, 0]} material={PATH_MAT} raycast={NO_RAYCAST}>
              <planeGeometry args={[length, 0.34]} />
            </mesh>
          </group>
        )
      })}
    </>
  )
}
