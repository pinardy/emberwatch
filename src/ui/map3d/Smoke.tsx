import { memo, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { BUILDINGS } from '../../game/content/buildings'
import { withRunCache } from '../../game/engine/runCache'
import { frameDerived } from '../../game/frameDerived'
import type { RunState } from '../../game/types'
import { useHudValue } from '../mapShared'
import { REDUCED_MOTION } from '../motion'
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
  useEffect(() => () => geometry.dispose(), [geometry])

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

type Emitter = [number, number, number]

/** The hearth while lit, and every production chimney that is really working. */
export function smokeEmitters(run: RunState, version: number): { key: string; value: Emitter[] } {
  return withRunCache(run, () => emitters(run, version))
}

function emitters(run: RunState, version: number): { key: string; value: Emitter[] } {
  const derived = frameDerived(run, version)
  let key = run.coldHearth ? 'cold;' : 'lit;'
  const value: Emitter[] = run.coldHearth ? [] : [[0, 0.75, 0]]
  for (const b of Object.values(run.buildings)) {
    // Only chimneys that are really producing: staffed, supplied, with room.
    if (BUILDINGS[b.defId]?.category !== 'production' || derived.status(b).kind !== 'working') continue
    key += `${b.id},`
    if (value.length < MAX_EMITTERS) value.push(chimneyAt(b))
  }
  return { key, value }
}

export const Smoke = memo(function Smoke() {
  // Re-render only when the set of smoking chimneys changes.
  const emitters = useHudValue(smokeEmitters)
  if (REDUCED_MOTION || !emitters || emitters.length === 0) return null
  return <SmokeColumns key={emitters.length} emitters={emitters} />
})
