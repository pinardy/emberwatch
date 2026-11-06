import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { HEARTH_STYLES } from '../../game/content/meta'
import { useGameStore } from '../../game/store'
import { REDUCED_MOTION } from '../motion'
import { NO_RAYCAST, hash01 } from './models'

/**
 * The Ancient Hearth: a stone fire pit — a paved disc, a kerb of rough
 * stones, crossed charred logs on a bed of embers and a three-tongued flame
 * that flickers (still under reduced motion), with a warm point light and a
 * pool of firelight on the ground. When the hearth goes cold only embers
 * remain. Authored in model units (~0.6 footprint), scaled by the caller.
 */

function kerbGeometry(): THREE.BufferGeometry {
  const rocks: THREE.BufferGeometry[] = []
  const n = 12
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + hash01('kerb', i) * 0.2
    const s = 0.07 + hash01('kerb', i + 50) * 0.035
    const g = new THREE.DodecahedronGeometry(1, 0)
    g.scale(s * 1.2, s * 0.9, s)
    g.rotateY(a + hash01('kerb', i + 99) * 2)
    g.translate(Math.cos(a) * 0.5, s * 0.55, Math.sin(a) * 0.5)
    g.deleteAttribute('uv')
    rocks.push(g.index ? g.toNonIndexed() : g)
  }
  const merged = mergeGeometries(rocks)!
  merged.computeVertexNormals()
  return merged
}

function logsGeometry(): THREE.BufferGeometry {
  const logs: THREE.BufferGeometry[] = []
  for (let i = 0; i < 4; i++) {
    const g = new THREE.CylinderGeometry(0.035, 0.04, 0.42, 6)
    g.rotateZ(Math.PI / 2 - 0.5)
    g.translate(-0.1, 0.09, 0)
    g.rotateY((i / 4) * Math.PI * 2 + 0.3)
    g.deleteAttribute('uv')
    logs.push(g.index ? g.toNonIndexed() : g)
  }
  return mergeGeometries(logs)!
}

const KERB_GEO = kerbGeometry()
const LOGS_GEO = logsGeometry()
const PLATFORM_GEO = new THREE.CylinderGeometry(0.62, 0.66, 0.05, 16).translate(0, 0.025, 0)
const EMBER_GEO = new THREE.CircleGeometry(0.3, 14).rotateX(-Math.PI / 2)
const POOL_GEO = new THREE.CircleGeometry(1.2, 28).rotateX(-Math.PI / 2)
const FLAME_GEO = new THREE.ConeGeometry(1, 1, 7, 1).translate(0, 0.5, 0)

const STONE_MAT = new THREE.MeshStandardMaterial({ color: '#7d7a76', roughness: 1, flatShading: true })
const PLATFORM_MAT = new THREE.MeshStandardMaterial({ color: '#5c5853', roughness: 1, flatShading: true })
const LOG_MAT = new THREE.MeshStandardMaterial({ color: '#4a3220', roughness: 1, flatShading: true })

interface FlameLook {
  outer: THREE.MeshBasicMaterial
  mid: THREE.MeshBasicMaterial
  core: THREE.MeshBasicMaterial
  ember: THREE.MeshBasicMaterial
  pool: THREE.MeshBasicMaterial
  light: string
}

const LOOKS = new Map<string, FlameLook>()

function flameLook(style: string | undefined): FlameLook {
  const id = style && HEARTH_STYLES[style] ? style : 'ember'
  let look = LOOKS.get(id)
  if (look) return look
  const { flame, light } = HEARTH_STYLES[id]
  const base = new THREE.Color(flame)
  const basic = (c: THREE.Color, opacity = 1) =>
    new THREE.MeshBasicMaterial({ color: c, toneMapped: false, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 })
  look = {
    outer: basic(base.clone(), 0.92),
    mid: basic(base.clone().lerp(new THREE.Color('#ffd27a'), 0.55)),
    core: basic(new THREE.Color('#fff4c4')),
    ember: basic(base.clone().multiplyScalar(0.9)),
    pool: new THREE.MeshBasicMaterial({
      color: light,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
    light,
  }
  LOOKS.set(id, look)
  return look
}

const COLD_EMBER = new THREE.MeshBasicMaterial({ color: '#5a2a14' })

export function HearthModel({ scale }: { scale: number }) {
  const style = useGameStore((s) => s.run?.citadel?.hearthStyle)
  const cold = useGameStore((s) => s.run?.coldHearth ?? false)
  const look = useMemo(() => flameLook(style), [style])
  const outer = useRef<THREE.Mesh>(null)
  const mid = useRef<THREE.Mesh>(null)
  const core = useRef<THREE.Mesh>(null)
  const light = useRef<THREE.PointLight>(null)

  useFrame(({ clock }) => {
    if (REDUCED_MOTION || cold) return
    const t = clock.elapsedTime
    const f = (a: number, b: number, c: number) => Math.sin(t * a) * 0.5 + Math.sin(t * b + 1.3) * 0.3 + Math.sin(t * c + 2.1) * 0.2
    if (outer.current) {
      outer.current.scale.set(0.25 + f(5.1, 8.3, 13.7) * 0.02, 0.7 + f(6.3, 9.7, 15.1) * 0.1, 0.25 + f(4.7, 7.9, 12.3) * 0.02)
      outer.current.rotation.y = t * 0.6
    }
    if (mid.current) {
      mid.current.scale.set(0.17, 0.55 + f(7.7, 11.3, 17.9) * 0.09, 0.17)
      mid.current.rotation.y = -t * 0.9
    }
    if (core.current) core.current.scale.set(0.09, 0.36 + f(9.1, 13.9, 19.3) * 0.06, 0.09)
    if (light.current) light.current.intensity = 8 + f(7.3, 11.1, 16.7) * 1.6
  })

  return (
    <group scale={[scale, scale, scale]}>
      <mesh geometry={PLATFORM_GEO} material={PLATFORM_MAT} receiveShadow raycast={NO_RAYCAST} />
      <mesh geometry={KERB_GEO} material={STONE_MAT} position={[0, 0.05, 0]} castShadow raycast={NO_RAYCAST} />
      <mesh geometry={EMBER_GEO} material={cold ? COLD_EMBER : look.ember} position={[0, 0.056, 0]} raycast={NO_RAYCAST} />
      <mesh geometry={LOGS_GEO} material={LOG_MAT} position={[0, 0.03, 0]} castShadow raycast={NO_RAYCAST} />
      {!cold && (
        <>
          <mesh ref={outer} geometry={FLAME_GEO} material={look.outer} position={[0, 0.08, 0]} scale={[0.25, 0.7, 0.25]} raycast={NO_RAYCAST} />
          <mesh ref={mid} geometry={FLAME_GEO} material={look.mid} position={[0, 0.08, 0]} scale={[0.17, 0.55, 0.17]} raycast={NO_RAYCAST} />
          <mesh ref={core} geometry={FLAME_GEO} material={look.core} position={[0, 0.08, 0]} scale={[0.09, 0.36, 0.09]} raycast={NO_RAYCAST} />
          <mesh geometry={POOL_GEO} material={look.pool} position={[0, 0.03, 0]} renderOrder={1} raycast={NO_RAYCAST} />
        </>
      )}
      <pointLight
        ref={light}
        position={[0, 0.7, 0]}
        color={look.light}
        intensity={cold ? 0 : 8}
        distance={7}
        decay={2}
      />
    </group>
  )
}
