import { useMemo } from 'react'
import * as THREE from 'three'
import { HEARTH_STYLES } from '../../game/content/meta'
import type { BuildingCategory, DepositId } from '../../game/types'
import type { IconId } from '../../art/icons'
import { badgeTexture, emojiTexture, iconTexture, labelTexture } from './sprites'

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
const BERRY_GEO = new THREE.SphereGeometry(0.055, 6, 4)

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
const BERRY_MAT = new THREE.MeshStandardMaterial({ color: '#c8324a', roughness: 0.6 })
const HIDE_MAT = new THREE.MeshStandardMaterial({ color: '#5a3b26', roughness: 1 })
const TUSK_MAT = new THREE.MeshStandardMaterial({ color: '#efe3c4', roughness: 0.8 })
const TRAMPLED_MAT = new THREE.MeshStandardMaterial({ color: '#4f4030', roughness: 1 })
const FIRE_MAT = new THREE.MeshStandardMaterial({
  color: '#ff9a3c',
  emissive: '#ff6a1a',
  emissiveIntensity: 1.6,
})
/** Hearth flames bought as Citadel cosmetics (`HEARTH_STYLES`), built on first use. */
const HEARTH_FLAME_MATS = new Map<string, THREE.MeshStandardMaterial>()
function hearthFlame(style: string | undefined): { mat: THREE.Material; light: string } {
  const look = style ? HEARTH_STYLES[style] : undefined
  if (!look || style === 'ember') return { mat: FIRE_MAT, light: '#ffab52' }
  let mat = HEARTH_FLAME_MATS.get(style!)
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color: look.flame, emissive: look.flame, emissiveIntensity: 1.6 })
    HEARTH_FLAME_MATS.set(style!, mat)
  }
  return { mat, light: look.light }
}
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

/**
 * A floating icon: the drawn `art` when there is one, else the emoji `icon`.
 * Either way the texture is baked once per id and shared by every sprite.
 */
export function IconSprite({
  icon,
  art,
  y,
  size,
}: {
  icon: string
  art?: IconId
  y: number
  size: number
}) {
  const map = useMemo(() => (art ? iconTexture(art) : emojiTexture(icon)), [art, icon])
  return (
    <sprite position={[0, y, 0]} scale={[size, size, 1]} raycast={NO_RAYCAST}>
      <spriteMaterial map={map} transparent depthWrite={false} />
    </sprite>
  )
}

/** Round coloured status badge (building states). */
export function BadgeSprite({
  icon,
  art,
  color,
  x = 0,
  y,
  size,
}: {
  icon: string
  art?: IconId
  color: string
  x?: number
  y: number
  size: number
}) {
  const map = useMemo(() => badgeTexture(icon, color, art), [icon, color, art])
  // `x` shifts the badge sideways in screen space (via the sprite's anchor),
  // so it stays beside the icon whichever way the camera faces.
  return (
    <sprite
      position={[0, y, 0]}
      center={new THREE.Vector2(0.5 - x / size, 0.5)}
      scale={[size, size, 1]}
      raycast={NO_RAYCAST}
    >
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
      // Berry bushes: green mounds dotted with red, never mistaken for game.
      return (
        <>
          {items.map((p, i) => (
            <group key={i} position={[p.x, 0, p.z]} rotation={[0, p.rot, 0]}>
              <mesh
                geometry={BUSH_GEO}
                material={BUSH_MAT}
                position={[0, 0.16 * p.s, 0]}
                scale={[p.s, p.s * 0.8, p.s]}
                castShadow
                raycast={NO_RAYCAST}
              />
              {BERRY_SPOTS.map(([bx, by, bz], j) => (
                <mesh
                  key={j}
                  geometry={BERRY_GEO}
                  material={BERRY_MAT}
                  position={[bx * p.s, by * p.s, bz * p.s]}
                  raycast={NO_RAYCAST}
                />
              ))}
            </group>
          ))}
        </>
      )
    case 'game':
      // Game trails: a trampled clearing with a couple of grazing boars.
      return (
        <>
          <mesh
            geometry={MOUND_GEO}
            material={TRAMPLED_MAT}
            position={[0, 0.005, 0]}
            scale={[radius * 1.2, 0.04, radius * 1.2]}
            receiveShadow
            raycast={NO_RAYCAST}
          />
          {items.slice(0, 2).map((p, i) => (
            <Boar key={i} x={p.x} z={p.z} s={0.85 + p.s * 0.35} rot={p.rot * 2} />
          ))}
        </>
      )
  }
}

const BERRY_SPOTS: [number, number, number][] = [
  [0.13, 0.22, 0.05],
  [-0.1, 0.25, 0.1],
  [0.02, 0.3, -0.12],
]

/** A low-poly boar: body, snout and a pale tusk. */
function Boar({ x, z, s, rot }: { x: number; z: number; s: number; rot: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={[s, s, s]}>
      <mesh geometry={BOX_GEO} material={HIDE_MAT} position={[0, 0.17, 0]} scale={[0.38, 0.2, 0.2]} castShadow raycast={NO_RAYCAST} />
      <mesh geometry={BOX_GEO} material={HIDE_MAT} position={[0.24, 0.17, 0]} scale={[0.13, 0.13, 0.14]} castShadow raycast={NO_RAYCAST} />
      <mesh geometry={BOX_GEO} material={TUSK_MAT} position={[0.31, 0.13, 0.05]} scale={[0.05, 0.03, 0.03]} raycast={NO_RAYCAST} />
      {LEG_SPOTS.map(([lx, lz], i) => (
        <mesh key={i} geometry={BOX_GEO} material={HIDE_MAT} position={[lx, 0.04, lz]} scale={[0.05, 0.09, 0.05]} raycast={NO_RAYCAST} />
      ))}
    </group>
  )
}

const LEG_SPOTS: [number, number][] = [
  [0.13, 0.07],
  [0.13, -0.07],
  [-0.13, 0.07],
  [-0.13, -0.07],
]

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
  flame,
}: {
  category: BuildingCategory
  scale?: number
  /** Picks a def-specific model from `SPECIAL_MODELS` when there is one. */
  defId?: string
  /** Warmth sources: whether the fire is burning. */
  lit?: boolean
  /** The hearth's cosmetic flame style (`HEARTH_STYLES` id). */
  flame?: string
}) {
  const Special = defId ? SPECIAL_MODELS[defId] : undefined
  const body = (() => {
    if (Special) return <Special lit={lit} />
    switch (category) {
      case 'hearth': {
        const fire = hearthFlame(flame)
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
            <mesh geometry={FIRE_GEO} material={fire.mat} position={[0, 0.3, 0]} raycast={NO_RAYCAST} />
            <pointLight position={[0, 0.9, 0]} color={fire.light} intensity={9} distance={7} decay={2} />
          </>
        )
      }
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

// --- upgrade tiers -------------------------------------------------------------
const BANNER_POLE_MAT = new THREE.MeshStandardMaterial({ color: '#4c3a28', roughness: 1 })
const BANNER_MAT = new THREE.MeshStandardMaterial({
  color: GOLD,
  roughness: 0.6,
  metalness: 0.25,
  side: THREE.DoubleSide,
})
const TRIM_GEO = new THREE.TorusGeometry(0.66, 0.03, 4, 28)

/** One pennant on a pole at a footprint corner (x, z in model units). */
function Banner({ x, z }: { x: number; z: number }) {
  const side = Math.sign(x) || 1
  return (
    <>
      <mesh geometry={BOX_GEO} material={BANNER_POLE_MAT} position={[x, 0.62, z]} scale={[0.04, 1.24, 0.04]} castShadow raycast={NO_RAYCAST} />
      <mesh geometry={BOX_GEO} material={BANNER_MAT} position={[x + side * 0.15, 1.12, z]} scale={[0.28, 0.18, 0.02]} castShadow raycast={NO_RAYCAST} />
    </>
  )
}

/**
 * The subtle model change an upgrade brings, the same for every silhouette:
 * a gold pennant at tier 1; a second pennant and a gilded trim round the
 * footing at tier 2. Authored in model units and scaled like the model.
 */
export function TierTrim({ tier, scale = 1 }: { tier: number; scale?: number }) {
  if (tier <= 0) return null
  return (
    <group scale={[scale, scale, scale]}>
      <Banner x={0.52} z={0.48} />
      {tier >= 2 && (
        <>
          <Banner x={-0.52} z={0.48} />
          <mesh geometry={TRIM_GEO} material={BANNER_MAT} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} raycast={NO_RAYCAST} />
        </>
      )}
    </group>
  )
}

/** Scaffolding raised around a finished building while it is upgraded. */
export function UpgradeScaffold({ scale = 1 }: { scale?: number }) {
  return (
    <group scale={[scale * 1.15, scale, scale * 1.15]}>
      {SCAFFOLD_POLES.map(([px, pz], i) => (
        <mesh
          key={i}
          geometry={BOX_GEO}
          material={SCAFFOLD_MAT}
          position={[px, 0.5, pz]}
          scale={[0.05, 1, 0.05]}
          castShadow
          raycast={NO_RAYCAST}
        />
      ))}
      <mesh geometry={BOX_GEO} material={SCAFFOLD_MAT} position={[0, 0.97, -0.48]} scale={[1.02, 0.04, 0.04]} raycast={NO_RAYCAST} />
      <mesh geometry={BOX_GEO} material={SCAFFOLD_MAT} position={[0, 0.97, 0.48]} scale={[1.02, 0.04, 0.04]} raycast={NO_RAYCAST} />
    </group>
  )
}
