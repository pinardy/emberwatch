import { memo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useRunKey, villagerKey } from './layerKeys'
import type { RunState, SpeciesId, Vec2, Villager } from '../../game/types'
import { NO_RAYCAST, hash01 } from './models'

/**
 * Purely cosmetic villagers. Workers shuttle between the hearth and their
 * workplace, clearing crews trudge toward their glade, idlers drift around
 * the fire. Positions are a function of (villager id, clock), so nothing here
 * touches or depends on sim state beyond what is already rendered.
 */

const BODY_GEO = new THREE.CapsuleGeometry(0.07, 0.12, 2, 8)
const HEAD_GEO = new THREE.SphereGeometry(0.06, 8, 6)
const HEAD_MAT = new THREE.MeshStandardMaterial({ color: '#e8d6c0', roughness: 1 })
const SPECIES_MATS: Record<SpeciesId, THREE.MeshStandardMaterial> = {
  human: new THREE.MeshStandardMaterial({ color: '#d9b48a', roughness: 1 }),
  beaver: new THREE.MeshStandardMaterial({ color: '#8a5f3a', roughness: 1 }),
  lizard: new THREE.MeshStandardMaterial({ color: '#7ba05a', roughness: 1 }),
  harpy: new THREE.MeshStandardMaterial({ color: '#a184c9', roughness: 1 }),
  fox: new THREE.MeshStandardMaterial({ color: '#c9743f', roughness: 1 }),
}

const HEARTH: Vec2 = { x: 0, y: 0 }
const WALK_SPEED = 1.15

function routeFor(v: Villager, run: RunState): { a: Vec2; b: Vec2 } | null {
  if (!v.assignment) return null
  if (v.assignment.startsWith('clearing:')) {
    const glade = run.glades[v.assignment.slice('clearing:'.length)]
    return glade ? { a: HEARTH, b: glade.center } : null
  }
  const building = run.buildings[v.assignment]
  return building ? { a: HEARTH, b: building.pos } : null
}

export const Villagers = memo(function Villagers({ run }: { run: RunState }) {
  // Positions animate in useFrame; React only cares who exists and where
  // they are headed.
  useRunKey(villagerKey)
  const group = useRef<THREE.Group>(null)
  const villagers = Object.values(run.villagers)

  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    const t = clock.elapsedTime
    villagers.forEach((v, i) => {
      const child = g.children[i]
      if (!child) return
      const phase = hash01(v.id, 1)
      const route = routeFor(v, run)
      let px: number
      let pz: number
      if (!route) {
        // Idle: a slow drift around the hearth.
        const r = 1.3 + hash01(v.id, 2) * 1.3
        const w = 0.22 + hash01(v.id, 3) * 0.18
        const angle = t * w + phase * Math.PI * 2
        px = Math.cos(angle) * r
        pz = Math.sin(angle) * r
      } else {
        const dx = route.b.x - route.a.x
        const dy = route.b.y - route.a.y
        const length = Math.hypot(dx, dy)
        if (length < 0.8) {
          px = route.b.x + 0.4
          pz = route.b.y
        } else {
          const period = (2 * length) / WALK_SPEED
          const s = ((t + phase * period) % period) / period
          const k = s < 0.5 ? s * 2 : 2 - s * 2
          // Sideways offset so a crew does not walk single file.
          const off = (hash01(v.id, 4) - 0.5) * 0.7
          px = route.a.x + dx * k + (-dy / length) * off
          pz = route.a.y + dy * k + (dx / length) * off
        }
      }
      child.position.set(px, 0.02 + Math.abs(Math.sin(t * 6 + phase * 10)) * 0.03, pz)
    })
  })

  return (
    <group ref={group} raycast={NO_RAYCAST}>
      {villagers.map((v) => (
        <group key={v.id} raycast={NO_RAYCAST}>
          <mesh geometry={BODY_GEO} material={SPECIES_MATS[v.species]} position={[0, 0.14, 0]} castShadow raycast={NO_RAYCAST} />
          <mesh geometry={HEAD_GEO} material={HEAD_MAT} position={[0, 0.31, 0]} raycast={NO_RAYCAST} />
        </group>
      ))}
    </group>
  )
})
