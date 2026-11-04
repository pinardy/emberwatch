import { memo, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { BUILDINGS } from '../../game/content/buildings'
import { footprintOf } from '../../game/engine/actions'
import type { RunState } from '../../game/types'
import { buildingStatusKind, type StatusContext } from '../mapShared'
import { REDUCED_MOTION } from '../motion'
import { smokeKey, useRunKey } from './layerKeys'
import { NO_RAYCAST } from './models'

/**
 * Wisps of smoke over the hearth and every working production chimney.
 * A handful of points per emitter, recycled on a loop — cosmetic only.
 */

const MAX_EMITTERS = 12
const PUFFS = 6
const RISE = 1.7
const CYCLE_SECONDS = 4.5

function SmokeColumn({ position }: { position: [number, number, number] }) {
  const points = useRef<THREE.Points>(null)
  const seeds = useMemo(
    () =>
      Array.from({ length: PUFFS }, (_, i) => ({
        offset: i / PUFFS,
        wobble: Math.random() * Math.PI * 2,
      })),
    [],
  )
  const positions = useMemo(() => new Float32Array(PUFFS * 3), [])

  useFrame(({ clock }) => {
    const mesh = points.current
    if (!mesh) return
    const t = clock.elapsedTime
    for (let i = 0; i < PUFFS; i++) {
      const age = (t / CYCLE_SECONDS + seeds[i].offset) % 1
      const sway = 0.05 + age * 0.14
      positions[i * 3] = Math.sin(t * 0.9 + seeds[i].wobble + age * 5) * sway
      positions[i * 3 + 1] = age * RISE
      positions[i * 3 + 2] = Math.cos(t * 0.7 + seeds[i].wobble + age * 4) * sway
    }
    const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    attr.needsUpdate = true
  })

  return (
    <points ref={points} position={position} raycast={NO_RAYCAST} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#9aa0a4" size={0.17} transparent opacity={0.32} depthWrite={false} />
    </points>
  )
}

export const Smoke = memo(function Smoke({ run }: { run: RunState }) {
  // Re-render only when the set of smoking chimneys changes.
  useRunKey(smokeKey)
  if (REDUCED_MOTION) return null

  const emitters: { id: string; position: [number, number, number] }[] = []
  if (!run.coldHearth) emitters.push({ id: 'hearth', position: [0, 0.75, 0] })
  const ctx: StatusContext = {}
  for (const b of Object.values(run.buildings)) {
    const def = BUILDINGS[b.defId]
    // Only chimneys that are really producing: staffed, supplied, with room.
    if (def?.category !== 'production' || buildingStatusKind(run, b, ctx) !== 'working') continue
    const scale = footprintOf(b.defId) / 0.6
    // The chimney block sits at (0.32, 0.9, -0.18) in the model's local space.
    emitters.push({
      id: b.id,
      position: [b.pos.x + 0.32 * scale, 1.15 * scale, b.pos.y - 0.18 * scale],
    })
    if (emitters.length >= MAX_EMITTERS) break
  }

  return (
    <>
      {emitters.map((e) => (
        <SmokeColumn key={e.id} position={e.position} />
      ))}
    </>
  )
})
