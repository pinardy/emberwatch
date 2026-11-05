import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SPECIES } from '../../game/content/species'
import { useGameStore } from '../../game/store'
import type { RunState, SpeciesId } from '../../game/types'
import { REDUCED_MOTION } from '../motion'
import {
  advanceViewClock,
  deriveVillagerRoutes,
  poseAt,
  type Pose,
  type VillagerRoute,
} from '../villagerRoutes'
import { useRunKey, villagerRouteKey } from './layerKeys'
import { NO_RAYCAST } from './models'

/**
 * Walking villagers, purely cosmetic. Each one loops through a day derived
 * from the run (home → work → a meal at the hearth, along the roads where they
 * run — see `villagerRoutes.ts`) and played back against the sim clock, so
 * they stop when the game is paused and hurry at 3×.
 *
 * Two instanced meshes (bodies tinted per species, heads) draw everyone in
 * two draw calls. Routes are rebuilt only when `villagerRouteKey` changes; a
 * frame walks a binary search per villager and writes matrices in place, with
 * no allocation. Under reduced motion they stand still at their work.
 */

// Geometry is offset so an instance's position is the villager's feet.
const BODY_GEO = new THREE.CapsuleGeometry(0.07, 0.12, 2, 8).translate(0, 0.14, 0)
const HEAD_GEO = new THREE.SphereGeometry(0.06, 8, 6).translate(0, 0.31, 0)
const BODY_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 })
const HEAD_MAT = new THREE.MeshStandardMaterial({ color: '#e8d6c0', roughness: 1 })
const SPECIES_COLORS = Object.fromEntries(
  Object.values(SPECIES).map((sp) => [sp.id, new THREE.Color(sp.color)]),
) as Record<SpeciesId, THREE.Color>

// Scratch objects for the frame loop.
const POSE: Pose = { x: 0, y: 0, moving: false }
const MATRIX = new THREE.Matrix4()

/** Instance capacity grows in steps so a newcomer rarely remounts the meshes. */
const CAPACITY_STEP = 16

function place(
  routes: VillagerRoute[],
  t: number,
  body: THREE.InstancedMesh,
  head: THREE.InstancedMesh,
  still: boolean,
): void {
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i]
    let x: number
    let z: number
    let bob = 0
    if (still) {
      x = route.rest.x
      z = route.rest.y
    } else {
      poseAt(route, t, POSE)
      x = POSE.x
      z = POSE.y
      // A little step bounce while walking.
      if (POSE.moving) bob = Math.abs(Math.sin(t * 9 + route.phase)) * 0.03
    }
    MATRIX.makeTranslation(x, 0.02 + bob, z)
    body.setMatrixAt(i, MATRIX)
    head.setMatrixAt(i, MATRIX)
  }
  body.instanceMatrix.needsUpdate = true
  head.instanceMatrix.needsUpdate = true
}

export const Villagers = memo(function Villagers({ run }: { run: RunState }) {
  // React only cares who exists, what they do and where they can walk.
  const key = useRunKey(villagerRouteKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const routes = useMemo(() => deriveVillagerRoutes(run), [run, key])
  const capacity = Math.max(CAPACITY_STEP, Math.ceil(routes.length / CAPACITY_STEP) * CAPACITY_STEP)
  const body = useRef<THREE.InstancedMesh>(null)
  const head = useRef<THREE.InstancedMesh>(null)
  const viewClock = useRef(run.clock)

  useLayoutEffect(() => {
    const b = body.current
    const h = head.current
    if (!b || !h) return
    b.count = routes.length
    h.count = routes.length
    routes.forEach((route, i) => b.setColorAt(i, SPECIES_COLORS[route.species]))
    if (b.instanceColor) b.instanceColor.needsUpdate = true
    place(routes, viewClock.current, b, h, REDUCED_MOTION)
  }, [routes, capacity])

  useFrame((_, delta) => {
    const b = body.current
    const h = head.current
    if (REDUCED_MOTION || !b || !h) return
    const { speed } = useGameStore.getState()
    const running = run.phase === 'playing' && run.pendingChoices.length === 0
    viewClock.current = advanceViewClock(viewClock.current, delta, running ? speed : 0, run.clock)
    place(routes, viewClock.current, b, h, false)
  })

  return (
    <>
      <instancedMesh
        key={`body-${capacity}`}
        ref={body}
        args={[BODY_GEO, BODY_MAT, capacity]}
        castShadow
        frustumCulled={false}
        raycast={NO_RAYCAST}
      />
      <instancedMesh
        key={`head-${capacity}`}
        ref={head}
        args={[HEAD_GEO, HEAD_MAT, capacity]}
        frustumCulled={false}
        raycast={NO_RAYCAST}
      />
    </>
  )
})
