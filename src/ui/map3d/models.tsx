import { useMemo } from 'react'
import * as THREE from 'three'
import type { BuildingCategory, DepositId } from '../../game/types'
import { emojiTexture, labelTexture } from './sprites'

/**
 * Low-poly props shared across the 3D scene: geometries and materials are
 * module singletons so a hundred trees cost matrices, not shader programs.
 */

/** Decorative meshes opt out of raycasting so clicks fall through to the ground. */
export const NO_RAYCAST = () => null

export const GOLD = '#d9b46a'

// --- geometries -------------------------------------------------------------
const TRUNK_GEO = new THREE.CylinderGeometry(0.05, 0.07, 0.2, 5)
const PINE_GEO = new THREE.ConeGeometry(0.24, 0.62, 6)
const ROCK_GEO = new THREE.DodecahedronGeometry(0.18, 0)
const BOX_GEO = new THREE.BoxGeometry(1, 1, 1)
const ROOF_GEO = new THREE.ConeGeometry(0.72, 0.5, 4)
const TENT_GEO = new THREE.ConeGeometry(0.55, 0.65, 4)
const DOME_GEO = new THREE.SphereGeometry(0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)
const FIRE_GEO = new THREE.ConeGeometry(0.22, 0.5, 6)
const RING_GEO = new THREE.TorusGeometry(0.42, 0.09, 6, 12)
const BUSH_GEO = new THREE.IcosahedronGeometry(0.22, 0)
const MOUND_GEO = new THREE.SphereGeometry(0.4, 10, 6)

// --- materials ---------------------------------------------------------------
export const TRUNK_MAT = new THREE.MeshStandardMaterial({ color: '#4c3a28', roughness: 1 })
export const PINE_MAT = new THREE.MeshStandardMaterial({ color: '#2f5138', roughness: 1 })
const ROCK_MAT = new THREE.MeshStandardMaterial({ color: '#71757b', roughness: 1 })
const ORE_MAT = new THREE.MeshStandardMaterial({ color: '#8a6a4f', roughness: 0.8 })
const WALL_MAT = new THREE.MeshStandardMaterial({ color: '#8a6a48', roughness: 0.9 })
const ROOF_MAT = new THREE.MeshStandardMaterial({ color: '#96503e', roughness: 0.9 })
const STONE_MAT = new THREE.MeshStandardMaterial({ color: '#84878c', roughness: 1 })
const CANVAS_MAT = new THREE.MeshStandardMaterial({ color: '#a89066', roughness: 1 })
const BUSH_MAT = new THREE.MeshStandardMaterial({ color: '#3d6a3c', roughness: 1 })
const CLAY_MAT = new THREE.MeshStandardMaterial({ color: '#7a5a43', roughness: 1 })
const SOIL_MAT = new THREE.MeshStandardMaterial({ color: '#6d6a35', roughness: 1 })
const MIRE_MAT = new THREE.MeshStandardMaterial({ color: '#26332e', roughness: 0.4 })
const FIRE_MAT = new THREE.MeshStandardMaterial({
  color: '#ff9a3c',
  emissive: '#ff6a1a',
  emissiveIntensity: 1.6,
})
export const GHOST_OK_MAT = new THREE.MeshStandardMaterial({
  color: '#6fbf72',
  transparent: true,
  opacity: 0.5,
  roughness: 1,
  depthWrite: false,
})
export const GHOST_BAD_MAT = new THREE.MeshStandardMaterial({
  color: '#c05050',
  transparent: true,
  opacity: 0.5,
  roughness: 1,
  depthWrite: false,
})
const SITE_MAT = new THREE.MeshStandardMaterial({
  color: '#cfd8d3',
  transparent: true,
  opacity: 0.45,
  roughness: 1,
})
const SCAFFOLD_MAT = new THREE.MeshStandardMaterial({ color: '#a58a58', roughness: 1 })

// --- brazier -----------------------------------------------------------------
const PLINTH_GEO = new THREE.CylinderGeometry(0.26, 0.34, 0.5, 8)
const BOWL_GEO = new THREE.CylinderGeometry(0.46, 0.24, 0.2, 10, 1, true)
const ASH_GEO = new THREE.SphereGeometry(0.3, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2)
const IRON_MAT = new THREE.MeshStandardMaterial({
  color: '#3b3632',
  roughness: 0.6,
  metalness: 0.5,
  side: THREE.DoubleSide,
})
const ASH_MAT = new THREE.MeshStandardMaterial({ color: '#4a4744', roughness: 1 })
/** Ground glow instead of a point light: extra lights recompile every shader. */
const GLOW_MAT = new THREE.MeshBasicMaterial({
  color: '#ff9a3c',
  transparent: true,
  opacity: 0.22,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
})
const GLOW_GEO = new THREE.CircleGeometry(1.1, 24)

/**
 * A fire bowl on a stone plinth. Lit, it carries a flame and a warm pool of
 * light on the ground; cold, a heap of grey ash.
 */
export function BrazierModel({ lit = true }: { lit?: boolean }) {
  return (
    <>
      <mesh geometry={PLINTH_GEO} material={STONE_MAT} position={[0, 0.25, 0]} castShadow raycast={NO_RAYCAST} />
      <mesh geometry={BOWL_GEO} material={IRON_MAT} position={[0, 0.6, 0]} castShadow raycast={NO_RAYCAST} />
      {lit ? (
        <>
          <mesh geometry={FIRE_GEO} material={FIRE_MAT} position={[0, 0.82, 0]} scale={[1.3, 1.1, 1.3]} raycast={NO_RAYCAST} />
          <mesh geometry={GLOW_GEO} material={GLOW_MAT} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} raycast={NO_RAYCAST} />
        </>
      ) : (
        <mesh geometry={ASH_GEO} material={ASH_MAT} position={[0, 0.58, 0]} scale={[1, 0.45, 1]} raycast={NO_RAYCAST} />
      )}
    </>
  )
}

/** Def-specific silhouettes that replace the category model. */
const SPECIAL_MODELS: Record<string, (props: { lit?: boolean }) => React.JSX.Element> = {
  brazier: BrazierModel,
}

/** Deterministic per-id jitter so prop layouts survive re-renders. */
export function hash01(key: string, salt: number): number {
  let h = 2166136261 ^ (salt * 2654435761)
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

export function IconSprite({ icon, y, size }: { icon: string; y: number; size: number }) {
  const map = useMemo(() => emojiTexture(icon), [icon])
  return (
    <sprite position={[0, y, 0]} scale={[size, size, 1]} raycast={NO_RAYCAST}>
      <spriteMaterial map={map} transparent depthWrite={false} />
    </sprite>
  )
}

export function LabelSprite({ text, y, size }: { text: string; y: number; size: number }) {
  const map = useMemo(() => labelTexture(text), [text])
  return (
    <sprite position={[0, y, 0]} scale={[size, size, 1]} raycast={NO_RAYCAST}>
      <spriteMaterial map={map} transparent depthWrite={false} />
    </sprite>
  )
}

function Pine({ x, z, s }: { x: number; z: number; s: number }) {
  return (
    <group position={[x, 0, z]} scale={[s, s, s]}>
      <mesh geometry={TRUNK_GEO} material={TRUNK_MAT} position={[0, 0.1, 0]} castShadow raycast={NO_RAYCAST} />
      <mesh geometry={PINE_GEO} material={PINE_MAT} position={[0, 0.5, 0]} castShadow raycast={NO_RAYCAST} />
    </group>
  )
}

function Boulder({ x, z, s, rot, material = ROCK_MAT }: { x: number; z: number; s: number; rot: number; material?: THREE.Material }) {
  return (
    <mesh
      geometry={ROCK_GEO}
      material={material}
      position={[x, 0.09 * s, z]}
      scale={[s, s * 0.7, s]}
      rotation={[0, rot, 0]}
      castShadow
      raycast={NO_RAYCAST}
    />
  )
}

/** The physical shape of a resource deposit, spread across its footprint. */
export function DepositProp({ id, kind, radius }: { id: string; kind: DepositId; radius: number }) {
  const items = useMemo(() => {
    const count = kind === 'trees' ? 4 : kind === 'vegetation' || kind === 'game' ? 3 : 2
    return Array.from({ length: count }, (_, i) => {
      const angle = hash01(id, i * 3 + 1) * Math.PI * 2
      const distance = hash01(id, i * 3 + 2) * radius * 0.7
      return {
        x: Math.cos(angle) * distance,
        z: Math.sin(angle) * distance,
        s: 0.7 + hash01(id, i * 3 + 3) * 0.6,
        rot: hash01(id, i * 3 + 4) * Math.PI,
      }
    })
  }, [id, kind, radius])

  switch (kind) {
    case 'trees':
      return (
        <>
          {items.map((p, i) => (
            <Pine key={i} x={p.x} z={p.z} s={p.s * 1.15} />
          ))}
        </>
      )
    case 'stoneVein':
      return (
        <>
          {items.map((p, i) => (
            <Boulder key={i} x={p.x} z={p.z} s={p.s * 1.4} rot={p.rot} />
          ))}
        </>
      )
    case 'orePatch':
      return (
        <>
          {items.map((p, i) => (
            <Boulder key={i} x={p.x} z={p.z} s={p.s * 1.3} rot={p.rot} material={ORE_MAT} />
          ))}
        </>
      )
    case 'clayPatch':
      return (
        <mesh
          geometry={MOUND_GEO}
          material={CLAY_MAT}
          position={[0, 0.02, 0]}
          scale={[radius * 1.3, 0.35, radius * 1.3]}
          receiveShadow
          raycast={NO_RAYCAST}
        />
      )
    case 'fertileSoil':
      return (
        <group raycast={NO_RAYCAST}>
          <mesh
            geometry={BOX_GEO}
            material={SOIL_MAT}
            position={[0, 0.05, 0]}
            scale={[radius * 1.7, 0.1, radius * 1.7]}
            rotation={[0, hash01(id, 9) * Math.PI, 0]}
            receiveShadow
            raycast={NO_RAYCAST}
          />
        </group>
      )
    case 'vegetation':
    case 'game':
      return (
        <>
          {items.map((p, i) => (
            <mesh
              key={i}
              geometry={BUSH_GEO}
              material={BUSH_MAT}
              position={[p.x, 0.16 * p.s, p.z]}
              scale={[p.s, p.s * 0.8, p.s]}
              rotation={[0, p.rot, 0]}
              castShadow
              raycast={NO_RAYCAST}
            />
          ))}
        </>
      )
  }
}

export function ObstacleProp({ id, kind, radius }: { id: string; kind: 'crag' | 'mire'; radius: number }) {
  const rocks = useMemo(
    () =>
      Array.from({ length: 3 }, (_, i) => ({
        x: (hash01(id, i * 3 + 1) - 0.5) * radius,
        z: (hash01(id, i * 3 + 2) - 0.5) * radius,
        s: 0.9 + hash01(id, i * 3 + 3) * radius,
        rot: hash01(id, i * 3 + 4) * Math.PI,
      })),
    [id, radius],
  )
  if (kind === 'mire') {
    return (
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} material={MIRE_MAT} receiveShadow raycast={NO_RAYCAST}>
        <circleGeometry args={[radius, 20]} />
      </mesh>
    )
  }
  return (
    <>
      {rocks.map((p, i) => (
        <Boulder key={i} x={p.x} z={p.z} s={p.s} rot={p.rot} />
      ))}
    </>
  )
}

/**
 * Low-poly building silhouettes per category; the icon sprite floating above
 * disambiguates the exact def. Models are authored around a ~0.6 footprint
 * and scaled to the def's actual radius.
 */
export function BuildingModel({
  category,
  scale = 1,
  defId,
  lit,
}: {
  category: BuildingCategory
  scale?: number
  /** Picks a def-specific model from `SPECIAL_MODELS` when there is one. */
  defId?: string
  /** Warmth sources: whether the fire is burning. */
  lit?: boolean
}) {
  const Special = defId ? SPECIAL_MODELS[defId] : undefined
  const body = (() => {
    if (Special) return <Special lit={lit} />
    switch (category) {
      case 'hearth':
        return (
          <>
            <mesh
              geometry={RING_GEO}
              material={STONE_MAT}
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, 0.06, 0]}
              castShadow
              raycast={NO_RAYCAST}
            />
            <mesh geometry={FIRE_GEO} material={FIRE_MAT} position={[0, 0.3, 0]} raycast={NO_RAYCAST} />
            <pointLight position={[0, 0.9, 0]} color="#ffab52" intensity={9} distance={7} decay={2} />
          </>
        )
      case 'housing':
        return (
          <>
            <mesh geometry={BOX_GEO} material={WALL_MAT} position={[0, 0.28, 0]} scale={[0.85, 0.56, 0.85]} castShadow raycast={NO_RAYCAST} />
            <mesh geometry={ROOF_GEO} material={ROOF_MAT} position={[0, 0.8, 0]} rotation={[0, Math.PI / 4, 0]} castShadow raycast={NO_RAYCAST} />
          </>
        )
      case 'gathering':
        return (
          <mesh geometry={TENT_GEO} material={CANVAS_MAT} position={[0, 0.32, 0]} rotation={[0, Math.PI / 4, 0]} castShadow raycast={NO_RAYCAST} />
        )
      case 'production':
        return (
          <>
            <mesh geometry={BOX_GEO} material={WALL_MAT} position={[0, 0.3, 0]} scale={[1.05, 0.6, 0.8]} castShadow raycast={NO_RAYCAST} />
            <mesh geometry={BOX_GEO} material={ROOF_MAT} position={[0, 0.66, 0]} scale={[1.15, 0.12, 0.9]} castShadow raycast={NO_RAYCAST} />
            <mesh geometry={BOX_GEO} material={STONE_MAT} position={[0.32, 0.9, -0.18]} scale={[0.16, 0.5, 0.16]} castShadow raycast={NO_RAYCAST} />
          </>
        )
      case 'service':
        return (
          <>
            <mesh geometry={BOX_GEO} material={WALL_MAT} position={[0, 0.26, 0]} scale={[0.9, 0.52, 0.9]} castShadow raycast={NO_RAYCAST} />
            <mesh geometry={DOME_GEO} material={ROOF_MAT} position={[0, 0.52, 0]} castShadow raycast={NO_RAYCAST} />
          </>
        )
      case 'logistics':
        return (
          <>
            <mesh geometry={BOX_GEO} material={WALL_MAT} position={[0, 0.24, 0]} scale={[1.2, 0.48, 0.95]} castShadow raycast={NO_RAYCAST} />
            <mesh geometry={BOX_GEO} material={STONE_MAT} position={[0, 0.54, 0]} scale={[1.3, 0.1, 1.05]} castShadow raycast={NO_RAYCAST} />
          </>
        )
    }
  })()
  return <group scale={[scale, scale, scale]}>{body}</group>
}

const SCAFFOLD_POLES: [number, number][] = [
  [-0.48, -0.48],
  [0.48, -0.48],
  [-0.48, 0.48],
  [0.48, 0.48],
]

/** A construction site: scaffolding around a ghost frame that rises with progress. */
export function ConstructionSite({ progress, scale = 1 }: { progress: number; scale?: number }) {
  const height = 0.65 * Math.max(0.12, progress)
  return (
    <group scale={[scale, scale, scale]}>
      <mesh
        geometry={BOX_GEO}
        material={SITE_MAT}
        position={[0, height / 2, 0]}
        scale={[0.8, height, 0.8]}
        raycast={NO_RAYCAST}
      />
      {SCAFFOLD_POLES.map(([px, pz], i) => (
        <mesh
          key={i}
          geometry={BOX_GEO}
          material={SCAFFOLD_MAT}
          position={[px, 0.45, pz]}
          scale={[0.06, 0.9, 0.06]}
          castShadow
          raycast={NO_RAYCAST}
        />
      ))}
      <mesh geometry={BOX_GEO} material={SCAFFOLD_MAT} position={[0, 0.87, -0.48]} scale={[1.02, 0.05, 0.05]} raycast={NO_RAYCAST} />
      <mesh geometry={BOX_GEO} material={SCAFFOLD_MAT} position={[0, 0.87, 0.48]} scale={[1.02, 0.05, 0.05]} raycast={NO_RAYCAST} />
      <mesh geometry={BOX_GEO} material={SCAFFOLD_MAT} position={[-0.48, 0.87, 0]} scale={[0.05, 0.05, 1.02]} raycast={NO_RAYCAST} />
      <mesh geometry={BOX_GEO} material={SCAFFOLD_MAT} position={[0.48, 0.87, 0]} scale={[0.05, 0.05, 1.02]} raycast={NO_RAYCAST} />
    </group>
  )
}
