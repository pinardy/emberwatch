import { memo, useEffect, useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useCursor } from '@react-three/drei'
import * as THREE from 'three'
import { BUILDINGS } from '../../game/content/buildings'
import { footprintOf } from '../../game/engine/actions'
import { DEPOSIT_ART } from '../../game/content/art'
import { DEPOSIT_INFO } from '../../game/engine/mapgen'
import { useGameStore } from '../../game/store'
import type { BuildingInstance, DepositId, Vec2, WorldDeposit } from '../../game/types'
import { DEPOSIT_TINT, STATUS_BADGE, type MapBuildingStatus } from '../mapShared'
import { REDUCED_MOTION } from '../motion'
import { requestGhost } from './ghostBus'
import {
  BadgeSprite,
  BuildingModel,
  ConstructionSite,
  DepositProp,
  GOLD,
  IconSprite,
  LabelSprite,
  NO_RAYCAST,
  TierTrim,
  UpgradeScaffold,
} from './models'
import { workerSlotsOf } from '../../game/engine/upgrades'

/**
 * Camera-distance buckets for label level-of-detail: everything up close,
 * icons only in the mid range, a clean diorama from afar.
 */
export type ZoomBucket = 'near' | 'mid' | 'far'

export function SelectionRing({
  radius,
  color = GOLD,
  opacity = 0.9,
}: {
  radius: number
  color?: string
  opacity?: number
}) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} raycast={NO_RAYCAST}>
      <ringGeometry args={[radius, radius + 0.12, 32]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} />
    </mesh>
  )
}

/** A slow-breathing ring, used to call attention (adjacency partners). */
export function PulseRing({ radius, color = '#9fc9a3' }: { radius: number; color?: string }) {
  const material = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(({ clock }) => {
    if (REDUCED_MOTION) return
    if (material.current) {
      material.current.opacity = 0.45 + Math.sin(clock.elapsedTime * 3.4) * 0.25
    }
  })
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.055, 0]} raycast={NO_RAYCAST}>
      <ringGeometry args={[radius, radius + 0.1, 32]} />
      <meshBasicMaterial ref={material} color={color} transparent opacity={0.55} side={THREE.DoubleSide} />
    </mesh>
  )
}

/**
 * Shared click behaviour. In build mode a mouse click places at the clicked
 * point; a touch tap only aims the ghost — its ✓ button confirms.
 */
function activate(e: ThreeEvent<MouseEvent>, select: () => void) {
  if (e.delta > 6) return
  e.stopPropagation()
  const state = useGameStore.getState()
  if (state.buildMode) {
    const pos = { x: e.point.x, y: e.point.z }
    if ((e.nativeEvent as PointerEvent).pointerType === 'touch') requestGhost(pos)
    else state.place(pos)
    return
  }
  select()
}

/** Shared unit ring, scaled per deposit: one geometry for every tint. */
const TINT_RING_GEO = new THREE.RingGeometry(0.8, 1, 28)
const TINT_MATS = Object.fromEntries(
  Object.entries(DEPOSIT_TINT).map(([kind, color]) => [
    kind,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  ]),
) as Record<DepositId, THREE.MeshBasicMaterial>

/**
 * A resource deposit. Memoised: the layer passes `amount` explicitly so a
 * harvest re-renders this one node and nothing else (the deposit object
 * itself is mutated in place and never changes identity).
 */
export const DepositNode = memo(function DepositNode({
  deposit,
  selected,
  bucket,
}: {
  deposit: WorldDeposit
  selected: boolean
  bucket: ZoomBucket
  /** Remaining harvests; drives re-rendering of the memoised node. */
  amount?: number | null
}) {
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)
  const r = deposit.radius
  return (
    <group
      position={[deposit.pos.x, 0, deposit.pos.y]}
      onClick={(e) => activate(e, () => useGameStore.getState().selectDeposit(deposit.id))}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHovered(true)
      }}
      onPointerOut={() => setHovered(false)}
    >
      {/* Invisible hit disc so the cluster is easy to tap. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} visible={false}>
        <circleGeometry args={[deposit.radius, 12]} />
      </mesh>
      {/* Kind-coloured ground ring: tells deposits apart at any zoom. */}
      <mesh
        geometry={TINT_RING_GEO}
        material={TINT_MATS[deposit.kind]}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.025, 0]}
        scale={[r, r, 1]}
        raycast={NO_RAYCAST}
      />
      <DepositProp id={deposit.id} kind={deposit.kind} radius={deposit.radius} />
      {/* The kind icon stays at every zoom, larger and higher from afar. */}
      <IconSprite
        icon={DEPOSIT_INFO[deposit.kind].icon}
        art={DEPOSIT_ART[deposit.kind]}
        y={bucket === 'far' ? 1.7 : 1.35}
        size={bucket === 'far' ? 1.05 : 0.7}
      />
      {bucket === 'near' && deposit.amount !== null && (
        <LabelSprite text={String(deposit.amount)} y={0.85} size={0.6} />
      )}
      {selected && <SelectionRing radius={deposit.radius + 0.1} />}
      {hovered && !selected && <SelectionRing radius={deposit.radius + 0.1} opacity={0.35} />}
    </group>
  )
})

/**
 * A building. Memoised: the building object is mutated in place, so the
 * layer passes the few values that change (`progress`, `workers`, `status`)
 * as props, and a sim tick re-renders only the nodes whose values moved.
 */
export const BuildingNode = memo(function BuildingNode({
  building,
  selected,
  bucket,
  cold,
  partnerHint,
  progress: progressProp,
  workers: workersProp,
  status = 'none',
  lit: litProp,
  tier = 0,
  upgrade = -1,
}: {
  building: BuildingInstance
  selected: boolean
  bucket: ZoomBucket
  /** Storm chill: a home beyond every fire, or a brazier gone out. */
  cold: boolean
  /** Pulses while the player is placing this building's adjacency partner. */
  partnerHint: boolean
  /** Construction progress 0..1 (quantised by the layer). */
  progress?: number
  /** Workers assigned. */
  workers?: number
  /** What it is doing right now; drives the status badge. */
  status?: MapBuildingStatus
  /** Warmth sources: whether the fire burns. A prop so going out re-renders. */
  lit?: boolean
  /** Upgrade tier: a prop so a new tier re-renders this node alone. */
  tier?: number
  /** Upgrade progress 0..1 while one is under way (quantised), else -1. */
  upgrade?: number
}) {
  const def = BUILDINGS[building.defId]
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)

  // A short "pop" when construction finishes.
  const body = useRef<THREE.Group>(null)
  const prevBuilt = useRef(building.built)
  const popAt = useRef<number | null>(null)
  useEffect(() => {
    if (!REDUCED_MOTION && building.built && !prevBuilt.current) {
      popAt.current = performance.now()
    }
    prevBuilt.current = building.built
  }, [building.built])
  useFrame(() => {
    const group = body.current
    if (!group || popAt.current === null) return
    const t = (performance.now() - popAt.current) / 450
    if (t >= 1) {
      popAt.current = null
      group.scale.setScalar(1)
      return
    }
    group.scale.setScalar(1 + 0.28 * Math.sin(t * Math.PI))
  })

  if (!def) return null
  const radius = footprintOf(building.defId)
  const scale = radius / 0.6
  const progress =
    progressProp ?? (building.built ? 1 : building.buildProgress / Math.max(1, def.buildSeconds))
  const workers = workersProp ?? building.workers.length
  const iconY = building.built ? 1.15 * scale + 0.45 : 1.35
  const badge = status === 'none' ? null : STATUS_BADGE[status]
  // Problems show at every zoom (bigger from afar); good news only up close.
  const showBadge =
    badge !== null &&
    (badge.problem || (status === 'construction' ? bucket !== 'far' : bucket === 'near'))
  // Up close the badge sits at the icon's shoulder; from afar (icon hidden)
  // it takes the icon's place.
  const far = bucket === 'far'
  const badgeX = far ? 0 : 0.4
  const badgeY = far ? iconY : iconY + 0.32
  const badgeSize = far ? 0.95 : status === 'working' ? 0.28 : 0.4

  return (
    <group
      position={[building.pos.x, 0, building.pos.y]}
      onClick={(e) => activate(e, () => useGameStore.getState().selectBuilding(building.id))}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHovered(true)
      }}
      onPointerOut={() => setHovered(false)}
    >
      {/* Invisible hit disc — models are thin, footprints are the target. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} visible={false}>
        <circleGeometry args={[radius + 0.1, 12]} />
      </mesh>
      <group ref={body}>
        {building.built ? (
          <>
            <BuildingModel category={def.category} scale={scale} defId={building.defId} lit={litProp ?? !building.unlit} />
            <TierTrim tier={tier} scale={scale} />
            {upgrade >= 0 && <UpgradeScaffold scale={scale} />}
          </>
        ) : (
          <ConstructionSite progress={progress} scale={scale} />
        )}
      </group>
      {bucket !== 'far' && <IconSprite icon={def.icon} art={def.art} y={iconY} size={0.75} />}
      {!building.built && bucket !== 'far' && (
        <LabelSprite text={`${Math.round(progress * 10) * 10}%`} y={0.85} size={0.6} />
      )}
      {building.built && workerSlotsOf(building) > 0 && bucket === 'near' && (
        <LabelSprite text={`${workers}/${workerSlotsOf(building)}`} y={1.15 * scale} size={0.65} />
      )}
      {tier > 0 && bucket !== 'far' && (
        <LabelSprite text={'★'.repeat(tier)} y={iconY + 0.48} size={0.5} />
      )}
      {upgrade >= 0 && bucket !== 'far' && (
        <LabelSprite text={`⬆ ${Math.round(upgrade * 10) * 10}%`} y={0.85} size={0.6} />
      )}
      {showBadge && badge && (
        <BadgeSprite icon={badge.icon} color={badge.color} x={badgeX} y={badgeY} size={badgeSize} />
      )}

      {cold && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} raycast={NO_RAYCAST}>
            <circleGeometry args={[radius + 0.35, 24]} />
            <meshBasicMaterial color="#5f8fd4" transparent opacity={0.28} depthWrite={false} />
          </mesh>
          <BadgeSprite
            icon="❄"
            color="#5f8fd4"
            x={far ? (showBadge ? -0.9 : 0) : -0.4}
            y={badgeY}
            size={far ? 0.8 : 0.4}
          />
        </>
      )}

      {selected && <SelectionRing radius={radius + 0.15} />}
      {hovered && !selected && <SelectionRing radius={radius + 0.15} opacity={0.35} />}
      {partnerHint && <PulseRing radius={radius + 0.35} />}
    </group>
  )
})

/** Pulsing warning over a glade with an active threat. */
export function ThreatMarker({ pos }: { pos: Vec2 }) {
  const sprite = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (REDUCED_MOTION) return
    const group = sprite.current
    if (!group) return
    const pulse = 1 + Math.sin(clock.elapsedTime * 4.2) * 0.18
    group.scale.setScalar(pulse)
    group.position.y = 2.6 + Math.sin(clock.elapsedTime * 2.1) * 0.15
  })
  return (
    <group position={[pos.x, 0, pos.y]} raycast={NO_RAYCAST}>
      <group ref={sprite} position={[0, 2.6, 0]}>
        <IconSprite icon="⚠️" art="dangerous" y={0} size={1.1} />
      </group>
    </group>
  )
}
