import { memo, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { BUILDINGS } from '../../game/content/buildings'
import type { RunState } from '../../game/types'
import { buildingStatusKind, type StatusContext } from '../mapShared'
import { REDUCED_MOTION } from '../motion'
import { smokeKey, useRunKey } from './layerKeys'
import { NO_RAYCAST } from './models'
import { chimneyAt } from './modelParts'

/**
 * Wisps of smoke over the hearth and every working production chimney.
 * A handful of points per emitter, recycled on a loop, all in ONE `Points`
 * draw call — cosmetic only.
 */

const MAX_EMITTERS = 12
const PUFFS = 6
const RISE = 1.7
const CYCLE_SECONDS = 4.5

const SMOKE_MAT = new THREE.PointsMaterial({
  color: '#9aa0a4',
  size: 0.17,
  transparent: true,
  opacity: 0.32,
  depthWrite: false,
})

function SmokeColumns({ emitters }: { emitters: [number, number, number][] }) {
  const points = useRef<THREE.Points>(null)
  const count = emitters.length * PUFFS
  const { geometry, seeds } = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    const s = Array.from({ length: count }, (_, i) => ({
      offset: (i % PUFFS) / PUFFS,
      wobble: Math.random() * Math.PI * 2,
    }))
    return { geometry: g, seeds: s }
  }, [count])

  useFrame(({ clock }) => {
    const attr = geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    const t = clock.elapsedTime
    for (let e = 0; e < emitters.length; e++) {
      const [ex, ey, ez] = emitters[e]
      for (let p = 0; p < PUFFS; p++) {
        const i = e * PUFFS + p
        const age = (t / CYCLE_SECONDS + seeds[i].offset) % 1
        const sway = 0.05 + age * 0.14
        arr[i * 3] = ex + Math.sin(t * 0.9 + seeds[i].wobble + age * 5) * sway
        arr[i * 3 + 1] = ey + age * RISE
        arr[i * 3 + 2] = ez + Math.cos(t * 0.7 + seeds[i].wobble + age * 4) * sway
      }
    }
    attr.needsUpdate = true
  })

  return (
    <points
      ref={points}
      geometry={geometry}
      material={SMOKE_MAT}
      raycast={NO_RAYCAST}
      frustumCulled={false}
    />
  )
}

export const Smoke = memo(function Smoke({ run }: { run: RunState }) {
  // Re-render only when the set of smoking chimneys changes.
  const key = useRunKey(smokeKey)
  const emitters = useMemo(() => {
    const out: [number, number, number][] = []
    if (!run.coldHearth) out.push([0, 0.75, 0])
    const ctx: StatusContext = {}
    for (const b of Object.values(run.buildings)) {
      const def = BUILDINGS[b.defId]
      // Only chimneys that are really producing: staffed, supplied, with room.
      if (def?.category !== 'production' || buildingStatusKind(run, b, ctx) !== 'working') continue
      out.push(chimneyAt(b))
      if (out.length >= MAX_EMITTERS) break
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, key])
  if (REDUCED_MOTION || emitters.length === 0) return null
  return <SmokeColumns key={emitters.length} emitters={emitters} />
})
