import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useCursor } from '@react-three/drei'
import * as THREE from 'three'
import { BUILDINGS } from '../../game/content/buildings'
import { footprintOf } from '../../game/engine/actions'
import type { IconId } from '../../art/icons'
import { DEPOSIT_ART } from '../../game/content/art'
import { STATUS_BADGE_ART } from '../../game/content/artFamilies'
import { DEPOSIT_INFO } from '../../game/engine/mapgen'
import { useGameStore } from '../../game/store'
import type { BuildingInstance, RunState, Vec2, WorldDeposit } from '../../game/types'
import { STATUS_BADGE, type MapBuildingStatus } from '../mapShared'
import { REDUCED_MOTION } from '../motion'
import { assignHomes } from '../villagerRoutes'
import { requestGhost } from './ghostBus'
import { HearthModel } from './Hearth'
import { buildingModelKey, useRunKey } from './layerKeys'
import { GOLD, NO_RAYCAST } from './models'
import { buildingParts, depositParts, obstacleParts } from './modelParts'
import { PartInstances, type Part, type PopMap } from './parts'
import { BatchSprite } from './spriteBatch'
import { artTile, badgeTile, labelTile } from './sprites'
import { workerSlotsOf } from '../../game/engine/upgrades'
import { isColdHousing, isUnlitWarmthSource } from '../mapShared'
import { warmthSources } from '../../game/engine/queries'

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

/** One shared invisible hit disc per radius: clicks land on footprints, not thin models. */
const HIT_GEOS = new Map<number, THREE.CircleGeometry>()
function hitGeometry(radius: number): THREE.CircleGeometry {
  const key = Math.round(radius * 100)
  let g = HIT_GEOS.get(key)
  if (!g) {
    g = new THREE.CircleGeometry(key / 100, 12).rotateX(-Math.PI / 2) as THREE.CircleGeometry
    HIT_GEOS.set(key, g)
  }
  return g
}

/**
 * Every deposit and obstacle prop on cleared ground, instanced: rebuilt only
 * when one appears or disappears (a harvest changes the amount label, not
 * the props).
 */
export const DepositInstances = memo(function DepositInstances({
  run,
  signature,
}: {
  run: RunState
  /** Which deposits and obstacles stand; the only thing the props depend on. */
  signature: string
}) {
  const parts = useMemo(() => {
    const out: Part[] = []
    for (const d of Object.values(run.deposits)) {
      if (run.glades[d.gladeId]?.cleared) out.push(...depositParts(d))
    }
    for (const o of run.obstacles) {
      if (run.glades[o.gladeId]?.cleared) out.push(...obstacleParts(o))
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, signature])
  return <PartInstances parts={parts} />
})

/**
 * A resource deposit's interactive footprint, icon and amount. Memoised: the
 * layer passes `amount` explicitly so a harvest re-renders this one node.
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
  const { x, y: z } = deposit.pos
  return (
    <>
      <group
        position={[x, 0, z]}
        onClick={(e) => activate(e, () => useGameStore.getState().selectDeposit(deposit.id))}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        {/* Invisible hit disc so the cluster is easy to tap. */}
        <mesh geometry={hitGeometry(deposit.radius)} position={[0, 0.015, 0]} visible={false} />
        {selected && <SelectionRing radius={deposit.radius + 0.1} />}
        {hovered && !selected && <SelectionRing radius={deposit.radius + 0.1} opacity={0.35} />}
      </group>
      {/* The kind icon stays at every zoom, larger and higher from afar. */}
      <BatchSprite
        tile={artTile(DEPOSIT_INFO[deposit.kind].icon, DEPOSIT_ART[deposit.kind])}
        x={x}
        y={bucket === 'far' ? 1.7 : 1.35}
        z={z}
        size={bucket === 'far' ? 1.05 : 0.7}
      />
      {bucket === 'near' && deposit.amount !== null && (
        <BatchSprite tile={labelTile(String(deposit.amount))} x={x} y={0.85} z={z} size={0.6} />
      )}
    </>
  )
})

/**
 * Every building's model as instanced parts. Rebuilt when what the models
 * show changes (`buildingModelKey`: built, tier, upgrade, lit, cold, who is
 * home, construction in 10% steps) — never on an ordinary tick. A building
 * that just finished pops by scaling its own instances for a beat.
 */
export const BuildingInstances = memo(function BuildingInstances({ run }: { run: RunState }) {
  const key = useRunKey(buildingModelKey)
  const pops = useRef<PopMap>(new Map())
  const prevBuilt = useRef<Set<string> | null>(null)

  const parts = useMemo(() => {
    const homes = assignHomes(run)
    const occupied = new Set<string>()
    for (const home of homes.values()) occupied.add(home.id)
    const sources = warmthSources(run)
    const out: Part[] = []
    for (const b of Object.values(run.buildings)) {
      const def = BUILDINGS[b.defId]
      if (!def) continue
      const raw = b.built ? 1 : b.buildProgress / Math.max(1, def.buildSeconds)
      out.push(
        ...buildingParts({
          building: b,
          progress: Math.min(1, Math.round(raw * 10) / 10),
          occupied: occupied.has(b.id),
          lit: !b.unlit,
          tier: b.tier ?? 0,
          upgrading: b.upgradeProgress !== undefined,
          cold: isColdHousing(run, b, sources) || isUnlitWarmthSource(b),
        }),
      )
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, key])

  // A short "pop" when construction finishes.
  useEffect(() => {
    const built = new Set(Object.values(run.buildings).filter((b) => b.built).map((b) => b.id))
    const prev = prevBuilt.current
    prevBuilt.current = built
    if (!prev || REDUCED_MOTION) return
    const now = performance.now()
    for (const id of built) {
      if (prev.has(id)) continue
      const b = run.buildings[id]
      pops.current.set(id, { start: now, x: b.pos.x, z: b.pos.y })
    }
  }, [run, key])

  useFrame(() => {
    const now = performance.now()
    for (const [id, pop] of pops.current) if (now - pop.start > 500) pops.current.delete(id)
  })

  return <PartInstances parts={parts} castShadow pops={pops.current} />
})

/**
 * A building's interactive footprint, floating icon, labels and badges (the
 * model itself is instanced by `BuildingInstances`). Memoised: the building
 * object is mutated in place, so the layer passes the few values that change
 * (`progress`, `workers`, `status`) as props, and a sim tick re-renders only
 * the nodes whose values moved.
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
  /** Warmth sources: whether the fire burns (the model reads it itself). */
  lit?: boolean
  /** Upgrade tier: a prop so a new tier re-renders this node alone. */
  tier?: number
  /** Upgrade progress 0..1 while one is under way (quantised), else -1. */
  upgrade?: number
}) {
  const def = BUILDINGS[building.defId]
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)

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
  const { x, y: z } = building.pos
  const slots = building.built ? workerSlotsOf(building) : 0

  return (
    <>
      <group
        position={[x, 0, z]}
        onClick={(e) => activate(e, () => useGameStore.getState().selectBuilding(building.id))}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        {/* Invisible hit disc — models are thin, footprints are the target. */}
        <mesh geometry={hitGeometry(radius + 0.1)} position={[0, 0.015, 0]} visible={false} />
        {def.category === 'hearth' && building.built && <HearthModel scale={scale} />}
        {selected && <SelectionRing radius={radius + 0.15} />}
        {hovered && !selected && <SelectionRing radius={radius + 0.15} opacity={0.35} />}
        {partnerHint && <PulseRing radius={radius + 0.35} />}
      </group>

      {!far && <BatchSprite tile={artTile(def.icon, def.art)} x={x} y={iconY} z={z} size={0.75} />}
      {!building.built && !far && (
        <BatchSprite tile={labelTile(`${Math.round(progress * 10) * 10}%`)} x={x} y={0.85} z={z} size={0.6} />
      )}
      {slots > 0 && bucket === 'near' && (
        <BatchSprite tile={labelTile(`${workers}/${slots}`)} x={x} y={1.15 * scale} z={z} size={0.65} />
      )}
      {tier > 0 && !far && <BatchSprite tile={labelTile('★'.repeat(tier))} x={x} y={iconY + 0.48} z={z} size={0.5} />}
      {upgrade >= 0 && !far && (
        <BatchSprite tile={labelTile(`⬆ ${Math.round(upgrade * 10) * 10}%`)} x={x} y={0.85} z={z} size={0.6} />
      )}
      {showBadge && badge && (
        <BatchSprite
          tile={badgeTile(badge.icon, badge.color, badge.art)}
          x={x}
          y={badgeY}
          z={z}
          size={badgeSize}
          offsetX={badgeX}
        />
      )}
      {cold && (
        <BatchSprite
          tile={badgeTile('❄', '#5f8fd4', STATUS_BADGE_ART.cold)}
          x={x}
          y={badgeY}
          z={z}
          size={far ? 0.8 : 0.4}
          offsetX={far ? (showBadge ? -0.9 : 0) : -0.4}
        />
      )}
    </>
  )
})

/** Pulsing warning over a glade with an active threat. */
/** `art` is the threat's own framed icon; the plain warning sign stands in without it. */
export function ThreatMarker({ pos, art }: { pos: Vec2; art?: IconId }) {
  return <BatchSprite tile={artTile('⚠️', art ?? 'dangerous')} x={pos.x} y={2.6} z={pos.y} size={1.1} pulse />
}
