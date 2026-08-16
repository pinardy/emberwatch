import { useRef, useState } from 'react'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { Html, MapControls } from '@react-three/drei'
import * as THREE from 'three'
import type { MapControls as MapControlsImpl } from 'three-stdlib'
import { BUILDINGS } from '../../game/content/buildings'
import { canPlaceBuilding, footprintOf, isReachable } from '../../game/engine/actions'
import { HEARTH_WARMTH_RADIUS } from '../../game/engine/balance'
import { DEPOSIT_INFO } from '../../game/engine/mapgen'
import { useGameStore, useRun } from '../../game/store'
import type { Glade, RunState, TerrainId, Vec2, WorldInfo } from '../../game/types'
import { Atmosphere } from './Atmosphere'
import { ForestCover } from './ForestCover'
import { BuildBanner } from '../MapView2D'
import { usePanKeys } from '../usePanKeys'
import {
  BuildingModel,
  ConstructionSite,
  DepositProp,
  GHOST_BAD_MAT,
  GHOST_OK_MAT,
  GOLD,
  IconSprite,
  LabelSprite,
  NO_RAYCAST,
  ObstacleProp,
} from './models'

const CAMERA_HOME: [number, number, number] = [0, 15, 12]
const MIN_DISTANCE = 4
const MAX_DISTANCE = 40

/** Cleared-glade ground colours, a touch brighter than the 2D palette. */
const TERRAIN_3D: Record<TerrainId, string> = {
  clearing: '#5d7050',
  forest: '#47654a',
  marsh: '#4c6055',
  rock: '#62666c',
  fertile: '#7d8749',
}

/** World (x, y) → scene (x, 0, z). */
function groundPos(p: Vec2): [number, number, number] {
  return [p.x, 0, p.y]
}

/** Flat mesh of a glade polygon, sitting just above the forest floor. */
function GladeSurface({ glade, onFoggedClick }: { glade: Glade; onFoggedClick?: () => void }) {
  const shape = new THREE.Shape(glade.polygon.map((p) => new THREE.Vector2(p.x, -p.y)))
  const cleared = glade.cleared
  const color = cleared
    ? TERRAIN_3D[glade.terrain]
    : glade.discovered
      ? '#18211d'
      : '#10171a'
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, cleared ? 0.02 : 0.01, 0]}
      receiveShadow
      // Cleared ground lets clicks fall through to the placement plane.
      raycast={cleared ? NO_RAYCAST : undefined}
      onClick={
        cleared
          ? undefined
          : (e) => {
              if (e.delta > 6) return
              e.stopPropagation()
              onFoggedClick?.()
            }
      }
    >
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color={color} roughness={1} />
    </mesh>
  )
}

/**
 * The invisible placement plane plus the build-mode ghost. Owns the cursor
 * state so 60 Hz pointer moves re-render this subtree only, not the scene.
 */
function GroundPlane({ run, buildMode }: { run: RunState; buildMode: string | null }) {
  const [cursor, setCursor] = useState<{ pos: Vec2; ok: boolean } | null>(null)
  const def = buildMode ? BUILDINGS[buildMode] : undefined

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    if (!buildMode) return
    const pos = { x: e.point.x, y: e.point.z }
    setCursor({ pos, ok: canPlaceBuilding(run, buildMode, pos) === null })
  }

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return
    const state = useGameStore.getState()
    const pos = { x: e.point.x, y: e.point.z }
    if (state.buildMode) {
      state.place(pos)
      setCursor((c) => (c ? { ...c, ok: canPlaceBuilding(run, state.buildMode!, c.pos) === null } : c))
      return
    }
    state.clearSelection()
  }

  const radius = buildMode ? footprintOf(buildMode) : 0

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        receiveShadow
        onPointerMove={handleMove}
        onClick={handleClick}
      >
        <planeGeometry args={[run.world.width + 24, run.world.height + 24]} />
        <meshStandardMaterial color="#0d1418" roughness={1} />
      </mesh>

      {buildMode && def && cursor && (
        <group position={groundPos(cursor.pos)} raycast={NO_RAYCAST}>
          <group scale={[1, 1, 1]}>
            <mesh
              material={cursor.ok ? GHOST_OK_MAT : GHOST_BAD_MAT}
              position={[0, 0.35, 0]}
              raycast={NO_RAYCAST}
            >
              <cylinderGeometry args={[radius, radius, 0.7, 24]} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} raycast={NO_RAYCAST}>
              <ringGeometry args={[radius, radius + 0.08, 32]} />
              <meshBasicMaterial
                color={cursor.ok ? '#6fbf72' : '#c05050'}
                transparent
                opacity={0.9}
                side={THREE.DoubleSide}
              />
            </mesh>
            {/* A camp shows how far it can reach while you aim it. */}
            {def.gatherRadius && (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} raycast={NO_RAYCAST}>
                <ringGeometry args={[def.gatherRadius - 0.06, def.gatherRadius, 64]} />
                <meshBasicMaterial color="#9fc9a3" transparent opacity={0.35} side={THREE.DoubleSide} />
              </mesh>
            )}
            <IconSprite icon={def.icon} y={1.1} size={0.8} />
          </group>
        </group>
      )}
    </>
  )
}

// Scratch vectors so keyboard panning allocates nothing per frame.
const PAN_FORWARD = new THREE.Vector3()
const PAN_RIGHT = new THREE.Vector3()
const PAN_BEFORE = new THREE.Vector3()
const WORLD_UP = new THREE.Vector3(0, 1, 0)

/**
 * WASD / arrow-key camera panning. Directions are camera-relative on the
 * ground plane — W always pushes toward the top of the screen no matter how
 * the view has been rotated — and speed scales with zoom so panning feels the
 * same up close and pulled back.
 */
function KeyboardPan({
  controls,
  world,
}: {
  controls: React.MutableRefObject<MapControlsImpl | null>
  world: WorldInfo
}) {
  const held = usePanKeys()

  useFrame((_, rawDelta) => {
    const c = controls.current
    const keys = held.current
    if (!c || keys.size === 0) return
    let x = 0
    let z = 0
    if (keys.has('up')) z += 1
    if (keys.has('down')) z -= 1
    if (keys.has('left')) x -= 1
    if (keys.has('right')) x += 1
    if (x === 0 && z === 0) return
    // Diagonals must not be √2 faster.
    const norm = Math.hypot(x, z)
    x /= norm
    z /= norm

    const camera = c.object
    PAN_FORWARD.subVectors(c.target, camera.position)
    PAN_FORWARD.y = 0
    if (PAN_FORWARD.lengthSq() < 1e-6) PAN_FORWARD.set(0, 0, -1)
    PAN_FORWARD.normalize()
    PAN_RIGHT.crossVectors(PAN_FORWARD, WORLD_UP)

    const delta = Math.min(rawDelta, 0.1)
    const speed = Math.max(4, camera.position.distanceTo(c.target)) * 0.45 * delta

    PAN_BEFORE.copy(c.target)
    c.target
      .addScaledVector(PAN_FORWARD, z * speed)
      .addScaledVector(PAN_RIGHT, x * speed)
    // Keep the focus on (or just beyond) the world.
    c.target.x = THREE.MathUtils.clamp(c.target.x, -(world.width / 2 + 2), world.width / 2 + 2)
    c.target.z = THREE.MathUtils.clamp(c.target.z, -(world.height / 2 + 2), world.height / 2 + 2)
    camera.position.add(c.target).sub(PAN_BEFORE)
    c.update()
  })

  return null
}

/** The hearth's reach, shown while placing housing. Breathes like its 2D twin. */
function WarmthRing() {
  const material = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(({ clock }) => {
    if (material.current) {
      material.current.opacity = 0.45 + Math.sin(clock.elapsedTime * 2.4) * 0.2
    }
  })
  return (
    <group position={[0, 0.05, 0]} raycast={NO_RAYCAST}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}>
        <ringGeometry args={[HEARTH_WARMTH_RADIUS - 0.1, HEARTH_WARMTH_RADIUS, 96]} />
        <meshBasicMaterial ref={material} color={GOLD} transparent side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}>
        <circleGeometry args={[HEARTH_WARMTH_RADIUS, 96]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.05} depthWrite={false} />
      </mesh>
    </group>
  )
}

function SelectionRing({ radius, color = GOLD }: { radius: number; color?: string }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} raycast={NO_RAYCAST}>
      <ringGeometry args={[radius, radius + 0.12, 32]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} side={THREE.DoubleSide} />
    </mesh>
  )
}

export function MapView3D() {
  const run = useRun()
  const buildMode = useGameStore((s) => s.buildMode)
  const selectedBuilding = useGameStore((s) => s.selectedBuilding)
  const selectedDeposit = useGameStore((s) => s.selectedDeposit)
  const selectGlade = useGameStore((s) => s.selectGlade)

  const controls = useRef<MapControlsImpl | null>(null)

  const zoomBy = (factor: number) => {
    const c = controls.current
    if (!c) return
    const camera = c.object
    const offset = camera.position.clone().sub(c.target)
    const length = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, offset.length() * factor))
    camera.position.copy(c.target).add(offset.setLength(length))
    c.update()
  }

  const recenter = () => {
    const c = controls.current
    if (!c) return
    c.target.set(0, 0, 0)
    c.object.position.set(...CAMERA_HOME)
    c.update()
  }

  if (!run) return null

  const glades = Object.values(run.glades)
  const selectedCamp = selectedBuilding ? run.buildings[selectedBuilding] : undefined
  const selectedCampDef = selectedCamp ? BUILDINGS[selectedCamp.defId] : undefined

  return (
    <div className="map-wrap map-wrap-3d" role="application" aria-label="Settlement map">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: CAMERA_HOME, fov: 42, near: 0.5, far: 150 }}
      >
        <Atmosphere season={run.season.season} />

        <MapControls
          ref={controls}
          enableDamping
          dampingFactor={0.1}
          minDistance={MIN_DISTANCE}
          maxDistance={MAX_DISTANCE}
          // Keep the camera above the treeline; straight-down to a low oblique.
          maxPolarAngle={Math.PI / 2.45}
          panSpeed={1.1}
          rotateSpeed={0.7}
        />
        <KeyboardPan controls={controls} world={run.world} />

        <GroundPlane run={run} buildMode={buildMode} />

        {glades.map((glade) => (
          <GladeSurface
            key={glade.id}
            glade={glade}
            onFoggedClick={glade.discovered ? () => selectGlade(glade.id) : undefined}
          />
        ))}

        <ForestCover glades={glades} />

        {buildMode && (BUILDINGS[buildMode]?.housing ?? 0) > 0 && <WarmthRing />}

        {/* Gather reach of the selected camp. */}
        {selectedCamp && selectedCampDef?.gatherRadius && (
          <group position={groundPos(selectedCamp.pos)} raycast={NO_RAYCAST}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} raycast={NO_RAYCAST}>
              <ringGeometry
                args={[selectedCampDef.gatherRadius - 0.06, selectedCampDef.gatherRadius, 64]}
              />
              <meshBasicMaterial color="#9fc9a3" transparent opacity={0.4} side={THREE.DoubleSide} />
            </mesh>
          </group>
        )}

        {run.obstacles.map((obstacle) =>
          run.glades[obstacle.gladeId]?.cleared ? (
            <group key={obstacle.id} position={groundPos(obstacle.pos)}>
              <ObstacleProp id={obstacle.id} kind={obstacle.kind} radius={obstacle.radius} />
            </group>
          ) : null,
        )}

        {Object.values(run.deposits).map((deposit) => {
          if (!run.glades[deposit.gladeId]?.cleared) return null
          return (
            <group
              key={deposit.id}
              position={groundPos(deposit.pos)}
              onClick={(e) => {
                if (e.delta > 6) return
                e.stopPropagation()
                const state = useGameStore.getState()
                if (state.buildMode) {
                  state.place({ x: e.point.x, y: e.point.z })
                  return
                }
                state.selectDeposit(deposit.id)
              }}
            >
              {/* Invisible hit disc so the cluster is easy to tap. */}
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} visible={false}>
                <circleGeometry args={[deposit.radius, 12]} />
              </mesh>
              <DepositProp id={deposit.id} kind={deposit.kind} radius={deposit.radius} />
              <IconSprite icon={DEPOSIT_INFO[deposit.kind].icon} y={1.35} size={0.7} />
              {deposit.amount !== null && (
                <LabelSprite text={String(deposit.amount)} y={0.85} size={0.6} />
              )}
              {selectedDeposit === deposit.id && <SelectionRing radius={deposit.radius + 0.1} />}
            </group>
          )
        })}

        {Object.values(run.buildings).map((building) => {
          const def = BUILDINGS[building.defId]
          if (!def) return null
          const radius = footprintOf(building.defId)
          const scale = radius / 0.6
          return (
            <group
              key={building.id}
              position={groundPos(building.pos)}
              onClick={(e) => {
                if (e.delta > 6) return
                e.stopPropagation()
                const state = useGameStore.getState()
                if (state.buildMode) {
                  state.place({ x: e.point.x, y: e.point.z })
                  return
                }
                state.selectBuilding(building.id)
              }}
            >
              {/* Invisible hit disc — models are thin, footprints are the target. */}
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} visible={false}>
                <circleGeometry args={[radius + 0.1, 12]} />
              </mesh>
              {building.built ? (
                <BuildingModel category={def.category} scale={scale} />
              ) : (
                <ConstructionSite
                  progress={building.buildProgress / Math.max(1, def.buildSeconds)}
                  scale={scale}
                />
              )}
              <IconSprite icon={def.icon} y={building.built ? 1.15 * scale + 0.45 : 1.0} size={0.75} />
              {building.built && def.workerSlots > 0 && (
                <LabelSprite
                  text={`${building.workers.length}/${def.workerSlots}`}
                  y={1.15 * scale}
                  size={0.65}
                />
              )}
              {building.paused && <IconSprite icon="⏸" y={1.15 * scale + 0.95} size={0.45} />}
              {selectedBuilding === building.id && <SelectionRing radius={radius + 0.15} />}
            </group>
          )
        })}

        {/* Name plates over discovered, uncleared glades. */}
        {glades.map((glade) => {
          if (!glade.discovered || glade.cleared) return null
          const reachable = isReachable(run, glade.id)
          const pct = glade.clearWork > 0 ? glade.clearProgress / glade.clearWork : 0
          return (
            <Html
              key={glade.id}
              position={[glade.center.x, 1.7, glade.center.y]}
              center
              distanceFactor={14}
              zIndexRange={[20, 0]}
            >
              <button
                type="button"
                className={`glade-plate-3d ${reachable ? '' : 'is-locked'}`}
                onClick={() => selectGlade(glade.id)}
              >
                <small>
                  {glade.kind === 'small'
                    ? '🌿 Small'
                    : glade.kind === 'dangerous'
                      ? '⚠ Dangerous'
                      : '☠ Forbidden'}
                </small>
                <strong>{glade.name}</strong>
                {pct > 0 && (
                  <span className="glade-plate-3d-bar">
                    <span style={{ width: `${Math.min(100, pct * 100)}%` }} />
                  </span>
                )}
                {glade.clearers > 0 && <em>⛏ {glade.clearers}</em>}
              </button>
            </Html>
          )
        })}
      </Canvas>

      <div className="map-controls">
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(0.8)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1.25)}>
          −
        </button>
        <button type="button" aria-label="Recentre" onClick={recenter}>
          ⌖
        </button>
      </div>

      {buildMode && <BuildBanner buildMode={buildMode} />}
    </div>
  )
}

export default MapView3D
