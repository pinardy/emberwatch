import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { Html, MapControls } from '@react-three/drei'
import * as THREE from 'three'
import type { MapControls as MapControlsImpl } from 'three-stdlib'
import { BUILDINGS } from '../../game/content/buildings'
import { canPlaceBuilding, footprintOf, isReachable } from '../../game/engine/actions'
import { pairsWith } from '../../game/engine/adjacency'
import { HEARTH_WARMTH_RADIUS } from '../../game/engine/balance'
import { describePlacement } from '../../game/engine/placement'
import { isWarmAt, warmthSources } from '../../game/engine/queries'
import { useGameStore, useRun } from '../../game/store'
import type { Glade, RunState, TerrainId, Vec2 } from '../../game/types'
import { Atmosphere } from './Atmosphere'
import { CameraRig } from './CameraRig'
import { FellingForest, ForestCover } from './ForestCover'
import { onGhostRequest } from './ghostBus'
import { MiniMap } from './MiniMap'
import { Paths } from './Paths'
import { Smoke } from './Smoke'
import { Villagers } from './Villagers'
import { BuildBanner } from '../MapView2D'
import { REDUCED_MOTION } from '../motion'
import {
  BuildingNode,
  PulseRing,
  ThreatMarker,
  type ZoomBucket,
  DepositNode,
} from './entities'
import {
  GHOST_BAD_MAT,
  GHOST_OK_MAT,
  GOLD,
  IconSprite,
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

interface CursorState {
  pos: Vec2
  ok: boolean
  reason: string | null
  /** Deposit ids a camp placed here could actually work. */
  reach: string[]
  /** Shared placement hint fragments (adjacency, terrain, warmth). */
  parts: string[]
  /** Touch flow: the ghost is aimed and waiting for its ✓ to confirm. */
  pending: boolean
}

/**
 * The invisible placement plane plus the build-mode ghost. Owns the cursor
 * state so 60 Hz pointer moves re-render this subtree only, not the scene.
 */
function GroundPlane({ run, buildMode }: { run: RunState; buildMode: string | null }) {
  const [cursor, setCursor] = useState<CursorState | null>(null)
  const def = buildMode ? BUILDINGS[buildMode] : undefined

  useEffect(() => {
    if (!buildMode) setCursor(null)
  }, [buildMode])

  const evaluate = useCallback(
    (pos: Vec2): CursorState => {
      const reason = canPlaceBuilding(run, buildMode!, pos)
      const { reach, parts } = describePlacement(run, buildMode!, pos)
      return { pos, ok: reason === null, reason, reach, parts, pending: false }
    },
    [run, buildMode],
  )

  // Taps on deposits/buildings during touch build-mode land here too.
  useEffect(() => {
    if (!buildMode) return
    return onGhostRequest((pos) => setCursor({ ...evaluate(pos), pending: true }))
  }, [buildMode, evaluate])

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    if (!buildMode) return
    // Touch has no hover: the ghost is aimed by taps, not by finger drags.
    if (e.pointerType === 'touch') return
    setCursor(evaluate({ x: e.point.x, y: e.point.z }))
  }

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return
    const state = useGameStore.getState()
    const pos = { x: e.point.x, y: e.point.z }
    if (state.buildMode) {
      // Touch: first tap aims the ghost; its ✓ button places.
      if ((e.nativeEvent as PointerEvent).pointerType === 'touch') {
        setCursor({ ...evaluate(pos), pending: true })
        return
      }
      state.place(pos)
      // The spot just filled up (or errored) — refresh the ghost in place.
      if (useGameStore.getState().buildMode) setCursor(evaluate(pos))
      return
    }
    state.clearSelection()
  }

  const confirmPending = () => {
    if (!cursor?.pending) return
    useGameStore.getState().place(cursor.pos)
    setCursor(null)
  }

  const radius = buildMode ? footprintOf(buildMode) : 0

  // What the floating hint should say, if anything.
  let hint: string | null = null
  if (cursor && def) {
    if (!cursor.ok) hint = cursor.reason
    else hint = cursor.parts.length > 0 ? cursor.parts.join(' · ') : null
  }

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
        <>
          <group position={[cursor.pos.x, 0, cursor.pos.y]} raycast={NO_RAYCAST}>
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
            {/* A brazier shows the homes it would keep warm. */}
            {def.warmth && (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} raycast={NO_RAYCAST}>
                <ringGeometry args={[def.warmth.radius - 0.08, def.warmth.radius, 64]} />
                <meshBasicMaterial color={GOLD} transparent opacity={0.55} side={THREE.DoubleSide} />
              </mesh>
            )}
            {/* A camp shows how far it can reach while you aim it. */}
            {def.gatherRadius && (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} raycast={NO_RAYCAST}>
                <ringGeometry args={[def.gatherRadius - 0.06, def.gatherRadius, 64]} />
                <meshBasicMaterial color="#9fc9a3" transparent opacity={0.35} side={THREE.DoubleSide} />
              </mesh>
            )}
            <IconSprite icon={def.icon} y={1.1} size={0.8} />
            {hint && (
              <Html
                position={[0, 1.9, 0]}
                center
                distanceFactor={12}
                zIndexRange={[20, 0]}
                style={{ pointerEvents: 'none' }}
              >
                <div className={`ghost-hint ${cursor.ok ? 'is-ok' : 'is-bad'}`}>{hint}</div>
              </Html>
            )}
            {cursor.pending && (
              <Html position={[0, 2.7, 0]} center distanceFactor={12} zIndexRange={[25, 0]}>
                <div className="ghost-confirm">
                  <button
                    type="button"
                    className="ok"
                    disabled={!cursor.ok}
                    onClick={confirmPending}
                    aria-label="Confirm placement"
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className="no"
                    onClick={() => setCursor(null)}
                    aria-label="Cancel placement"
                  >
                    ✕
                  </button>
                </div>
              </Html>
            )}
          </group>

          {/* Deposits this camp would actually work light up. */}
          {cursor.reach.map((id) => {
            const deposit = run.deposits[id]
            if (!deposit) return null
            return (
              <group key={id} position={[deposit.pos.x, 0, deposit.pos.y]} raycast={NO_RAYCAST}>
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]} raycast={NO_RAYCAST}>
                  <ringGeometry args={[deposit.radius + 0.05, deposit.radius + 0.18, 32]} />
                  <meshBasicMaterial color="#9fc9a3" transparent opacity={0.8} side={THREE.DoubleSide} />
                </mesh>
              </group>
            )
          })}
        </>
      )}
    </>
  )
}

/** An in-flight camera move: eased glide of both the focus and the camera. */
interface Flight {
  fromPos: THREE.Vector3
  toPos: THREE.Vector3
  fromTarget: THREE.Vector3
  toTarget: THREE.Vector3
  start: number
  duration: number
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function FlightAnimator({
  controls,
  flight,
}: {
  controls: React.MutableRefObject<MapControlsImpl | null>
  flight: React.MutableRefObject<Flight | null>
}) {
  useFrame(() => {
    const f = flight.current
    const c = controls.current
    if (!f || !c) return
    const t = Math.min(1, (performance.now() - f.start) / (f.duration * 1000))
    const eased = easeInOutCubic(t)
    c.target.copy(f.fromTarget).lerp(f.toTarget, eased)
    c.object.position.copy(f.fromPos).lerp(f.toPos, eased)
    c.update()
    if (t >= 1) flight.current = null
  })
  return null
}

/**
 * A warmth source's reach — the hearth's or a brazier's — shown while placing
 * housing or a brazier, or inspecting a fire or a home.
 */
function WarmthRing({
  position = [0, 0.05, 0],
  radius = HEARTH_WARMTH_RADIUS,
}: {
  position?: [number, number, number]
  radius?: number
}) {
  const material = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(({ clock }) => {
    if (REDUCED_MOTION) return
    if (material.current) {
      material.current.opacity = 0.45 + Math.sin(clock.elapsedTime * 2.4) * 0.2
    }
  })
  return (
    <group position={position} raycast={NO_RAYCAST}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}>
        <ringGeometry args={[radius - 0.1, radius, 96]} />
        <meshBasicMaterial ref={material} color={GOLD} transparent side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={NO_RAYCAST}>
        <circleGeometry args={[radius, 96]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.05} depthWrite={false} />
      </mesh>
    </group>
  )
}

export function MapView3D() {
  const run = useRun()
  const buildMode = useGameStore((s) => s.buildMode)
  const selectedBuilding = useGameStore((s) => s.selectedBuilding)
  const selectedDeposit = useGameStore((s) => s.selectedDeposit)
  const selectGlade = useGameStore((s) => s.selectGlade)
  const cameraFocus = useGameStore((s) => s.cameraFocus)

  const shadowsEnabled = useGameStore((s) => s.settings.shadows)
  const controls = useRef<MapControlsImpl | null>(null)
  const flight = useRef<Flight | null>(null)
  const [bucket, setBucket] = useState<ZoomBucket>('mid')
  const [showHelp, setShowHelp] = useState(false)
  const rightClick = useRef<{ x: number; y: number } | null>(null)

  /** Glide (or, under reduced motion, jump) to a new camera pose. */
  const flyTo = useCallback((toTarget: THREE.Vector3, toPos: THREE.Vector3) => {
    const c = controls.current
    if (!c) return
    if (REDUCED_MOTION) {
      c.target.copy(toTarget)
      c.object.position.copy(toPos)
      c.update()
      return
    }
    flight.current = {
      fromPos: c.object.position.clone(),
      fromTarget: c.target.clone(),
      toPos,
      toTarget,
      start: performance.now(),
      duration: 0.45,
    }
  }, [])

  const handleControlsChange = () => {
    const c = controls.current
    if (!c) return
    const distance = c.object.position.distanceTo(c.target)
    const next: ZoomBucket = distance < 13 ? 'near' : distance > 26 ? 'far' : 'mid'
    setBucket((prev) => (prev === next ? prev : next))
  }

  const zoomBy = (factor: number) => {
    const c = controls.current
    if (!c) return
    const camera = c.object
    const offset = camera.position.clone().sub(c.target)
    const length = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, offset.length() * factor))
    camera.position.copy(c.target).add(offset.setLength(length))
    c.update()
  }

  const recenter = useCallback(() => {
    flyTo(new THREE.Vector3(0, 0, 0), new THREE.Vector3(...CAMERA_HOME))
  }, [flyTo])

  /** Keep the current zoom and tilt, but put north back at the top. */
  const faceNorth = () => {
    const c = controls.current
    if (!c) return
    const offset = c.object.position.clone().sub(c.target)
    const horizontal = Math.hypot(offset.x, offset.z)
    offset.x = 0
    offset.z = horizontal
    flyTo(c.target.clone(), c.target.clone().add(offset))
  }

  /** Glide the camera so the world point sits at the focus. */
  const focusOn = useCallback(
    (p: Vec2) => {
      const c = controls.current
      if (!c) return
      const delta = new THREE.Vector3(p.x - c.target.x, 0, p.y - c.target.z)
      flyTo(c.target.clone().add(delta), c.object.position.clone().add(delta))
    },
    [flyTo],
  )

  // Fly-to requests from elsewhere in the UI (threat cards, the minimap).
  useEffect(() => {
    if (!cameraFocus) return
    focusOn(cameraFocus)
    useGameStore.setState({ cameraFocus: null })
  }, [cameraFocus, focusOn])

  if (!run) return null

  const glades = Object.values(run.glades)
  const storm = run.season.season === 'storm'
  const ghostDef = buildMode ? BUILDINGS[buildMode] : undefined
  const selectedCamp = selectedBuilding ? run.buildings[selectedBuilding] : undefined
  const selectedCampDef = selectedCamp ? BUILDINGS[selectedCamp.defId] : undefined
  const hearthSelected = selectedCamp?.defId === 'ancientHearth'
  // Every fire's reach shows while warmth is the question being asked.
  const showWarmth =
    (buildMode && ((BUILDINGS[buildMode]?.housing ?? 0) > 0 || !!BUILDINGS[buildMode]?.warmth)) ||
    hearthSelected ||
    !!selectedCampDef?.warmth ||
    selectedCampDef?.category === 'housing'

  // Buildings that pair with the blueprint in hand, in either direction.
  const adjacencyPartners = ghostDef
    ? Object.values(run.buildings).filter((b) => {
        if (!b.built) return false
        const bDef = BUILDINGS[b.defId]
        return !!bDef && pairsWith(ghostDef.id, b.defId)
      })
    : []

  return (
    <div
      className="map-wrap map-wrap-3d"
      role="application"
      aria-label="Settlement map"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button === 2) rightClick.current = { x: e.clientX, y: e.clientY }
      }}
      onPointerUp={(e) => {
        // A right-click that never turned into a rotate-drag cancels.
        if (e.button !== 2 || !rightClick.current) return
        const moved = Math.hypot(e.clientX - rightClick.current.x, e.clientY - rightClick.current.y)
        rightClick.current = null
        if (moved > 6) return
        const state = useGameStore.getState()
        if (state.buildMode) state.setBuildMode(null)
        else state.clearSelection()
      }}
    >
      <Canvas
        shadows={shadowsEnabled}
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
          onChange={handleControlsChange}
        />
        <CameraRig
          controls={controls}
          world={run.world}
          minDistance={MIN_DISTANCE}
          maxDistance={MAX_DISTANCE}
          home={recenter}
        />
        <FlightAnimator controls={controls} flight={flight} />

        <GroundPlane run={run} buildMode={buildMode} />
        <Paths run={run} />

        {glades.map((glade) => (
          <GladeSurface
            key={glade.id}
            glade={glade}
            onFoggedClick={glade.discovered ? () => selectGlade(glade.id) : undefined}
          />
        ))}

        <ForestCover glades={glades} />
        <FellingForest glades={run.glades} />

        {showWarmth &&
          warmthSources(run).map((w) => (
            <WarmthRing key={`warmth-${w.id}`} position={[w.pos.x, 0.05, w.pos.y]} radius={w.radius} />
          ))}

        {/* Gather reach of the selected camp. */}
        {selectedCamp && selectedCampDef?.gatherRadius && (
          <group position={[selectedCamp.pos.x, 0, selectedCamp.pos.y]} raycast={NO_RAYCAST}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} raycast={NO_RAYCAST}>
              <ringGeometry
                args={[selectedCampDef.gatherRadius - 0.06, selectedCampDef.gatherRadius, 64]}
              />
              <meshBasicMaterial color="#9fc9a3" transparent opacity={0.4} side={THREE.DoubleSide} />
            </mesh>
          </group>
        )}

        {/* Buildings that would pair with the blueprint in hand. */}
        {adjacencyPartners.map((b) => (
          <group key={`adj-${b.id}`} position={[b.pos.x, 0, b.pos.y]} raycast={NO_RAYCAST}>
            <PulseRing radius={footprintOf(b.defId) + 0.35} />
          </group>
        ))}

        {run.obstacles.map((obstacle) =>
          run.glades[obstacle.gladeId]?.cleared ? (
            <ObstacleAt key={obstacle.id} id={obstacle.id} kind={obstacle.kind} radius={obstacle.radius} pos={obstacle.pos} />
          ) : null,
        )}

        {Object.values(run.deposits).map((deposit) =>
          run.glades[deposit.gladeId]?.cleared ? (
            <DepositNode
              key={deposit.id}
              deposit={deposit}
              selected={selectedDeposit === deposit.id}
              bucket={bucket}
            />
          ) : null,
        )}

        {Object.values(run.buildings).map((building) => {
          const def = BUILDINGS[building.defId]
          const cold =
            storm &&
            building.built &&
            (def?.housing ?? 0) > 0 &&
            !isWarmAt(run, building.pos)
          return (
            <BuildingNode
              key={building.id}
              building={building}
              selected={selectedBuilding === building.id}
              bucket={bucket}
              cold={cold}
              partnerHint={adjacencyPartners.some((b) => b.id === building.id)}
            />
          )
        })}

        {bucket !== 'far' && <Villagers run={run} />}
        <Smoke run={run} />

        {run.threats.map((threat) => {
          const glade = run.glades[threat.gladeId]
          return glade ? <ThreatMarker key={threat.id} pos={glade.center} /> : null
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

      <MiniMap run={run} controls={controls} />

      <div className="map-controls">
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(0.8)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1.25)}>
          −
        </button>
        <button type="button" aria-label="Face north" title="Face north" onClick={faceNorth}>
          🧭
        </button>
        <button type="button" aria-label="Recentre" title="Recentre (H)" onClick={recenter}>
          ⌖
        </button>
        <button
          type="button"
          aria-label="Controls help"
          title="Controls"
          className={showHelp ? 'is-active' : ''}
          onClick={() => setShowHelp((v) => !v)}
        >
          ?
        </button>
      </div>

      {showHelp && (
        <div className="controls-help" role="dialog" aria-label="Controls">
          <strong>Controls</strong>
          <ul>
            <li><em>Pan</em> — drag · WASD / arrows · mouse at edge</li>
            <li><em>Rotate</em> — right-drag · Q / E</li>
            <li><em>Zoom</em> — wheel toward cursor · pinch</li>
            <li><em>Home</em> — H or ⌖ · <em>North</em> — 🧭</li>
            <li><em>Select</em> — click · <em>Deselect / cancel</em> — right-click or Esc</li>
            <li><em>Jump</em> — click the minimap</li>
            <li><em>Pause</em> — Space · <em>Speed</em> — 1 / 2 / 3</li>
          </ul>
          <button type="button" onClick={() => setShowHelp(false)}>
            Close
          </button>
        </div>
      )}

      {buildMode && <BuildBanner buildMode={buildMode} />}
    </div>
  )
}

/** Obstacle wrapper kept here — it has no interactions or LOD of its own. */
function ObstacleAt({
  id,
  kind,
  radius,
  pos,
}: {
  id: string
  kind: 'crag' | 'mire'
  radius: number
  pos: Vec2
}) {
  return (
    <group position={[pos.x, 0, pos.y]}>
      <ObstacleProp id={id} kind={kind} radius={radius} />
    </group>
  )
}

export default MapView3D
