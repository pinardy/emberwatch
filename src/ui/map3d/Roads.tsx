import { memo } from 'react'
import * as THREE from 'three'
import { ROAD_HALF_WIDTH } from '../../game/engine/balance'
import type { RoadPreview } from '../../game/engine/roads'
import { useGameStore } from '../../game/store'
import type { RoadSegment, RunState, Vec2 } from '../../game/types'
import { placementHint } from '../mapShared'
import { roadKey, useRunKey } from './layerKeys'
import { GhostConfirm3D, GhostHint3D, GOLD, NO_RAYCAST } from './models'
import { useStaticGeometry } from './staticGeometry'

/**
 * Roads in the 3D scene: one merged, flat mesh for every stretch (with round
 * joints so bends read as one road), rebuilt only when a road is laid or
 * lifted — `roadKey` holds still across sim ticks. Plus the road tool's
 * ghost: the stretch about to be laid, or the one about to be lifted.
 */

const ROAD_Y = 0.045
const JOINT_SEGMENTS = 10

// Packed gravel: lighter and more solid than the worn dirt of `Paths`.
const ROAD_MAT = new THREE.MeshStandardMaterial({
  color: '#b59d74',
  roughness: 1,
  polygonOffset: true,
  polygonOffsetFactor: -2,
})

/**
 * Flat road ribbons in world XZ at y=0: a quad per stretch and a disc at each
 * end so stretches meeting at an angle join without a notch.
 */
export function roadGeometry(roads: RoadSegment[], halfWidth = ROAD_HALF_WIDTH + 0.03): THREE.BufferGeometry {
  const positions: number[] = []
  const disc = (c: Vec2) => {
    for (let i = 0; i < JOINT_SEGMENTS; i++) {
      const a0 = (i / JOINT_SEGMENTS) * Math.PI * 2
      const a1 = ((i + 1) / JOINT_SEGMENTS) * Math.PI * 2
      positions.push(
        c.x, 0, c.y,
        c.x + Math.cos(a1) * halfWidth, 0, c.y + Math.sin(a1) * halfWidth,
        c.x + Math.cos(a0) * halfWidth, 0, c.y + Math.sin(a0) * halfWidth,
      )
    }
  }
  for (const r of roads) {
    const length = Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y)
    if (length < 1e-6) continue
    const nx = (-(r.b.y - r.a.y) / length) * halfWidth
    const ny = ((r.b.x - r.a.x) / length) * halfWidth
    positions.push(
      r.a.x + nx, 0, r.a.y + ny, r.b.x + nx, 0, r.b.y + ny, r.b.x - nx, 0, r.b.y - ny,
      r.a.x + nx, 0, r.a.y + ny, r.b.x - nx, 0, r.b.y - ny, r.a.x - nx, 0, r.a.y - ny,
    )
    disc(r.a)
    disc(r.b)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  // Face up whichever way the quad wound.
  const normals = new Float32Array(positions.length)
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  return geometry
}

export const RoadLayer = memo(function RoadLayer({ run }: { run: RunState }) {
  const key = useRunKey(roadKey)
  if (!key) return null
  return <RoadMesh roads={run.roads ?? []} roadsKey={key} />
})

function RoadMesh({ roads, roadsKey }: { roads: RoadSegment[]; roadsKey: string }) {
  const geometry = useStaticGeometry(() => roadGeometry(roads), [roadsKey])
  return (
    <mesh
      geometry={geometry}
      material={ROAD_MAT}
      position={[0, ROAD_Y, 0]}
      receiveShadow
      raycast={NO_RAYCAST}
    />
  )
}

/** A flat bar between two points, for the ghost. */
function Bar({ a, b, color, width = 0.36, y = 0.09 }: { a: Vec2; b: Vec2; color: string; width?: number; y?: number }) {
  const dx = b.x - a.x
  const dz = b.y - a.y
  const length = Math.hypot(dx, dz)
  if (length < 1e-3) return null
  return (
    <group position={[(a.x + b.x) / 2, y, (a.y + b.y) / 2]} rotation={[0, -Math.atan2(dz, dx), 0]} raycast={NO_RAYCAST}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}>
        <planeGeometry args={[length, width]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function Marker({ p, color, radius = 0.22, beacon = false }: { p: Vec2; color: string; radius?: number; beacon?: boolean }) {
  return (
    <group position={[p.x, 0, p.y]} raycast={NO_RAYCAST}>
      <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}>
        <ringGeometry args={[radius * 0.55, radius, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* A thin post, so a road's end shows even inside a building it snapped to. */}
      {beacon && (
        <mesh position={[0, 1.1, 0]} raycast={NO_RAYCAST}>
          <cylinderGeometry args={[0.05, 0.05, 2.2, 8]} />
          <meshBasicMaterial color={color} transparent opacity={0.85} />
        </mesh>
      )}
    </group>
  )
}

export interface RoadCursor {
  pos: Vec2
  pending: boolean
  preview: RoadPreview
}

/**
 * The road tool's ghost: where the road being laid ends so far (its anchor),
 * the stretch the next click would lay, or — erasing — the stretch it would
 * lift. Touch taps aim it, and its ✓ lays it, like a building ghost.
 */
export function RoadGhost3D({
  run,
  cursor,
  onConfirm,
  onCancel,
}: {
  run: RunState
  cursor: RoadCursor | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const anchor = useGameStore((s) => s.roadAnchor)
  const preview = cursor?.preview
  const lifting = preview?.removeId ? (run.roads ?? []).find((r) => r.id === preview.removeId) : null
  const hint = preview ? placementHint(preview.reason, preview.parts) : null
  const color = preview?.ok ? '#6fbf72' : '#c05050'
  return (
    <>
      {anchor && <Marker p={anchor} color={GOLD} radius={0.3} beacon />}
      {preview?.from && <Bar a={preview.from} b={preview.to} color={color} />}
      {lifting && <Bar a={lifting.a} b={lifting.b} color="#c05050" width={0.5} />}
      {preview && (
        <group position={[preview.to.x, 0, preview.to.y]} raycast={NO_RAYCAST}>
          <Marker p={{ x: 0, y: 0 }} color={color} />
          {hint && <GhostHint3D y={1.2} ok={preview.ok} hint={hint} />}
          {cursor?.pending && (
            <GhostConfirm3D
              y={2}
              ok={preview.ok}
              confirmLabel={preview.removeId ? 'Lift this road' : 'Lay this road'}
              cancelLabel="Cancel road"
              onConfirm={onConfirm}
              onCancel={onCancel}
            />
          )}
        </group>
      )}
    </>
  )
}
