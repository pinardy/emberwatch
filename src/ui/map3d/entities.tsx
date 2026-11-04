import { useEffect, useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useCursor } from '@react-three/drei'
import * as THREE from 'three'
import { BUILDINGS } from '../../game/content/buildings'
import { footprintOf } from '../../game/engine/actions'
import { DEPOSIT_INFO } from '../../game/engine/mapgen'
import { useGameStore } from '../../game/store'
import type { BuildingInstance, Vec2, WorldDeposit } from '../../game/types'
import { REDUCED_MOTION } from '../motion'
import { requestGhost } from './ghostBus'
import {
  BuildingModel,
  ConstructionSite,
  DepositProp,
  GOLD,
  IconSprite,
  LabelSprite,
  NO_RAYCAST,
} from './models'

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

export function DepositNode({
  deposit,
  selected,
  bucket,
}: {
  deposit: WorldDeposit
  selected: boolean
  bucket: ZoomBucket
}) {
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)
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
      <DepositProp id={deposit.id} kind={deposit.kind} radius={deposit.radius} />
      {bucket !== 'far' && <IconSprite icon={DEPOSIT_INFO[deposit.kind].icon} y={1.35} size={0.7} />}
      {bucket === 'near' && deposit.amount !== null && (
        <LabelSprite text={String(deposit.amount)} y={0.85} size={0.6} />
      )}
      {selected && <SelectionRing radius={deposit.radius + 0.1} />}
      {hovered && !selected && <SelectionRing radius={deposit.radius + 0.1} opacity={0.35} />}
    </group>
  )
}

export function BuildingNode({
  building,
  selected,
  bucket,
  cold,
  partnerHint,
}: {
  building: BuildingInstance
  selected: boolean
  bucket: ZoomBucket
  /** Storm chill: this housing stands beyond the hearth's warmth. */
  cold: boolean
  /** Pulses while the player is placing this building's adjacency partner. */
  partnerHint: boolean
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
  const progress = building.built ? 1 : building.buildProgress / Math.max(1, def.buildSeconds)
  const iconY = building.built ? 1.15 * scale + 0.45 : 1.35

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
          <BuildingModel category={def.category} scale={scale} defId={building.defId} lit={!building.unlit} />
        ) : (
          <ConstructionSite progress={progress} scale={scale} />
        )}
      </group>
      {bucket !== 'far' && <IconSprite icon={def.icon} y={iconY} size={0.75} />}
      {!building.built && bucket !== 'far' && (
        <LabelSprite text={`${Math.round(progress * 10) * 10}%`} y={0.85} size={0.6} />
      )}
      {building.built && def.workerSlots > 0 && bucket === 'near' && (
        <LabelSprite text={`${building.workers.length}/${def.workerSlots}`} y={1.15 * scale} size={0.65} />
      )}
      {building.paused && bucket !== 'far' && <IconSprite icon="⏸" y={iconY + 0.5} size={0.45} />}

      {cold && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} raycast={NO_RAYCAST}>
            <circleGeometry args={[radius + 0.35, 24]} />
            <meshBasicMaterial color="#5f8fd4" transparent opacity={0.28} depthWrite={false} />
          </mesh>
          {bucket !== 'far' && <IconSprite icon="❄" y={iconY + 0.5} size={0.45} />}
        </>
      )}

      {selected && <SelectionRing radius={radius + 0.15} />}
      {hovered && !selected && <SelectionRing radius={radius + 0.15} opacity={0.35} />}
      {partnerHint && <PulseRing radius={radius + 0.35} />}
    </group>
  )
}

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
        <IconSprite icon="⚠️" y={0} size={1.1} />
      </group>
    </group>
  )
}
