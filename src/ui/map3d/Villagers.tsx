import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
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
 * Two instanced meshes (bodies and heads, both tinted per species) draw
 * everyone in two draw calls; they cast no shadow (the shadow pass is kept
 * for buildings and trees). Routes are rebuilt only when `villagerRouteKey` changes; a
 * frame walks a binary search per villager and writes matrices in place, with
 * no allocation. Under reduced motion they stand still at their work.
 */

// Geometry is offset so an instance's position is the villager's feet.
// A little figure: dark legs, a tapered tunic with arms (tinted per species
// by the instance colour; vertex colours keep the legs dark), and a head.
function figureGeometry(): THREE.BufferGeometry {
  const paint = (g: THREE.BufferGeometry, hex: string) => {
    const ng = g.index ? g.toNonIndexed() : g
    ng.deleteAttribute('uv')
    const c = new THREE.Color(hex)
    const n = ng.getAttribute('position').count
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3)
    ng.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return ng
  }
  const parts = [
    paint(new THREE.BoxGeometry(0.038, 0.13, 0.045).translate(-0.028, 0.065, 0), '#3a3430'),
    paint(new THREE.BoxGeometry(0.038, 0.13, 0.045).translate(0.028, 0.065, 0), '#3a3430'),
    paint(new THREE.CylinderGeometry(0.052, 0.078, 0.19, 7).translate(0, 0.215, 0), '#ffffff'),
    paint(new THREE.BoxGeometry(0.03, 0.13, 0.034).rotateZ(0.18).translate(-0.078, 0.215, 0), '#e6e6e6'),
    paint(new THREE.BoxGeometry(0.03, 0.13, 0.034).rotateZ(-0.18).translate(0.078, 0.215, 0), '#e6e6e6'),
    paint(new THREE.CylinderGeometry(0.06, 0.06, 0.025, 7).translate(0, 0.302, 0), '#cfcfcf'),
  ]
  const merged = mergeGeometries(parts)!
  merged.computeVertexNormals()
  return merged.scale(1.15, 1.15, 1.15)
}

const BODY_GEO = figureGeometry()
const HEAD_GEO = new THREE.IcosahedronGeometry(0.068, 1).translate(0, 0.37, 0).scale(1.15, 1.15, 1.15)
const BODY_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true, vertexColors: true })
const HEAD_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true })
const SPECIES_COLORS = Object.fromEntries(
  Object.values(SPECIES).map((sp) => [sp.id, new THREE.Color(sp.color)]),
) as Record<SpeciesId, THREE.Color>
/** Heads: a paler shade of the species colour, so a crowd reads by species. */
const HEAD_COLORS = Object.fromEntries(
  Object.values(SPECIES).map((sp) => [sp.id, new THREE.Color(sp.color).lerp(new THREE.Color('#f3e6d2'), 0.55)]),
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
    routes.forEach((route, i) => {
      b.setColorAt(i, SPECIES_COLORS[route.species])
      h.setColorAt(i, HEAD_COLORS[route.species])
    })
    if (b.instanceColor) b.instanceColor.needsUpdate = true
    if (h.instanceColor) h.instanceColor.needsUpdate = true
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
