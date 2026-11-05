import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { Html, MapControls } from '@react-three/drei'
import * as THREE from 'three'
import type { MapControls as MapControlsImpl } from 'three-stdlib'
import { GLADE_ART } from '../../game/content/art'
import { BUILDINGS } from '../../game/content/buildings'
import { canPlaceBuilding, footprintOf } from '../../game/engine/actions'
import { pairsWith } from '../../game/engine/adjacency'
import { HEARTH_WARMTH_RADIUS } from '../../game/engine/balance'
import { describePlacement } from '../../game/engine/placement'
import { warmthSources } from '../../game/engine/queries'
import { useGameStore } from '../../game/store'
import type { Glade, RunState, Vec2 } from '../../game/types'
import { Atmosphere } from './Atmosphere'
import { CameraRig } from './CameraRig'
import { FellingForest, ForestCover } from './ForestCover'
import { onGhostRequest } from './ghostBus'
import { MiniMap } from './MiniMap'
import { Paths } from './Paths'
import { Smoke } from './Smoke'
import { Villagers } from './Villagers'
import { Icon } from '../Icon'
import { BuildBanner, WarmthToggle } from '../MapView2D'
import {
  GLADE_KIND_STYLE,
  MAP_KEYS,
  gladeAccessText,
  gladeFill,
  gladeLook,
  gladePlateInfo,
  useCameraFocus,
  useMapKey,
  useMapOverlays,
  useWarmthRingVisible,
  type GladeAccess,
  type GladeLook,
} from '../mapShared'
import { useEscapeLayer } from '../useGameLoop'
import { REDUCED_MOTION } from '../motion'
import {
  BuildingNode,
  ThreatMarker,
  type ZoomBucket,
  DepositNode,
} from './entities'
import {
  buildingKey,
  buildingViews,
  clearedKey,
  depositKey,
  forestKey,
  gladePlateKey,
  gladeSurfaceKey,
  threatKey,
  useRunKey,
  warmthKey,
} from './layerKeys'
import {
  GHOST_BAD_MAT,
  GHOST_OK_MAT,
  GOLD,
  IconSprite,
  NO_RAYCAST,
  ObstacleProp,
} from './models'
import { gladeEdgeGeometry, gladeFillGeometry, useStaticGeometry } from './staticGeometry'

const CAMERA_HOME: [number, number, number] = [0, 15, 12]
const MIN_DISTANCE = 4
const MAX_DISTANCE = 40

/** Width of a fogged glade's kind border, in world units. */
const EDGE_WIDTH = 0.16

/**
 * Flat mesh of a glade polygon, sitting just above the forest floor.
 * Memoised on its look: the polygon never changes, so its geometry is built
 * once per mount and a sim tick never touches it.
 */
const GladeSurface = memo(function GladeSurface({
  glade,
  look,
  access,
}: {
  glade: Glade
  look: GladeLook
  access: GladeAccess
}) {
  const geometry = useStaticGeometry(() => gladeFillGeometry(glade.polygon), [glade.polygon])
  const cleared = look === 'visible'
  return (
    <>
      <mesh
        geometry={geometry}
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
                if (look === 'fogged') useGameStore.getState().selectGlade(glade.id)
              }
        }
      >
        <meshStandardMaterial color={gladeFill(glade, '3d')} roughness={1} />
      </mesh>
      {look === 'fogged' && <GladeEdge glade={glade} access={access} />}
    </>
  )
})

/**
 * The kind border of a fogged glade: solid for small, long dashes for
 * dangerous, tight dots for forbidden. Bright when reachable, dim when out
 * of reach, breathing while a crew is clearing it.
 */
function GladeEdge({ glade, access }: { glade: Glade; access: GladeAccess }) {
  const style = GLADE_KIND_STYLE[glade.kind]
  const geometry = useStaticGeometry(
    () => gladeEdgeGeometry(glade.polygon, style.dash, EDGE_WIDTH),
    [glade.polygon, style.dash],
  )
  const material = useRef<THREE.MeshBasicMaterial>(null)
  const base = access === 'locked' ? 0.3 : 0.9
  useFrame(({ clock }) => {
    if (access !== 'clearing' || REDUCED_MOTION || !material.current) return
    material.current.opacity = 0.55 + Math.sin(clock.elapsedTime * 4) * 0.35
  })
  return (
    <mesh geometry={geometry} position={[0, 0.03, 0]} raycast={NO_RAYCAST}>
      <meshBasicMaterial
        ref={material}
        color={access === 'clearing' ? '#9fe09a' : style.edge}
        transparent
        opacity={base}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
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
            <IconSprite icon={def.icon} art={def.art} y={1.1} size={0.8} />
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
 * A warmth source's reach — the hearth's or a brazier's — shown while the
 * overlay is toggled on (R / 🔥), placing housing or a brazier, or inspecting
 * a fire or a home.
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

/*
 * Scene layers. The run is mutated in place and the store bumps `version`
 * on every tick, so nothing here subscribes to `version` directly: each
 * layer subscribes to a key of exactly what it draws (see layerKeys.ts) and
 * re-renders only when that changes. Leaf nodes are memoised on primitive
 * props, so even a layer re-render touches only the nodes that moved.
 */

function SeasonAtmosphere() {
  const season = useGameStore((s) => s.run?.season.season ?? 'drizzle')
  return <Atmosphere season={season} />
}

const GladeLayer = memo(function GladeLayer({ run }: { run: RunState }) {
  useRunKey(gladeSurfaceKey)
  return (
    <>
      {Object.values(run.glades).map((glade) => {
        const look = gladeLook(glade)
        return (
          <GladeSurface
            key={glade.id}
            glade={glade}
            look={look}
            access={look === 'fogged' ? gladePlateInfo(run, glade).access : 'locked'}
          />
        )
      })}
    </>
  )
})

const ForestLayer = memo(function ForestLayer({ run }: { run: RunState }) {
  useRunKey(forestKey)
  return (
    <>
      <ForestCover glades={Object.values(run.glades)} />
      <FellingForest glades={run.glades} />
    </>
  )
})

const ObstacleLayer = memo(function ObstacleLayer({ run }: { run: RunState }) {
  useRunKey(clearedKey)
  return (
    <>
      {run.obstacles.map((obstacle) =>
        run.glades[obstacle.gladeId]?.cleared ? (
          <ObstacleAt key={obstacle.id} id={obstacle.id} kind={obstacle.kind} radius={obstacle.radius} pos={obstacle.pos} />
        ) : null,
      )}
    </>
  )
})

const DepositLayer = memo(function DepositLayer({ run, bucket }: { run: RunState; bucket: ZoomBucket }) {
  useRunKey(depositKey)
  const selectedDeposit = useGameStore((s) => s.selectedDeposit)
  return (
    <>
      {Object.values(run.deposits).map((deposit) =>
        run.glades[deposit.gladeId]?.cleared ? (
          <DepositNode
            key={deposit.id}
            deposit={deposit}
            amount={deposit.amount}
            selected={selectedDeposit === deposit.id}
            bucket={bucket}
          />
        ) : null,
      )}
    </>
  )
})

const BuildingLayer = memo(function BuildingLayer({
  run,
  bucket,
  buildMode,
}: {
  run: RunState
  bucket: ZoomBucket
  buildMode: string | null
}) {
  useRunKey(buildingKey)
  const selectedBuilding = useGameStore((s) => s.selectedBuilding)
  const ghostDef = buildMode ? BUILDINGS[buildMode] : undefined
  return (
    <>
      {buildingViews(run).map(({ building, progress, workers, status, cold, lit, tier, upgrade }) => {
        // Buildings that pair with the blueprint in hand, in either direction.
        const partnerHint =
          !!ghostDef && building.built && !!BUILDINGS[building.defId] && pairsWith(ghostDef.id, building.defId)
        return (
          <BuildingNode
            key={building.id}
            building={building}
            selected={selectedBuilding === building.id}
            bucket={bucket}
            cold={cold}
            partnerHint={partnerHint}
            progress={progress}
            workers={workers}
            status={status}
            lit={lit}
            tier={tier}
            upgrade={upgrade}
          />
        )
      })}
    </>
  )
})

/** Every live warmth source's reach: the hearth and each lit brazier. */
const WarmthLayer = memo(function WarmthLayer({ run }: { run: RunState }) {
  useRunKey(warmthKey)
  return (
    <>
      {warmthSources(run).map((w) => (
        <WarmthRing key={`warmth-${w.id}`} position={[w.pos.x, 0.05, w.pos.y]} radius={w.radius} />
      ))}
    </>
  )
})

const ThreatLayer = memo(function ThreatLayer({ run }: { run: RunState }) {
  useRunKey(threatKey)
  return (
    <>
      {run.threats.map((threat) => {
        const glade = run.glades[threat.gladeId]
        return glade ? <ThreatMarker key={threat.id} pos={glade.center} /> : null
      })}
    </>
  )
})

/** Name plates over discovered, uncleared glades. */
const GladePlates = memo(function GladePlates({ run }: { run: RunState }) {
  useRunKey(gladePlateKey)
  return (
    <>
      {Object.values(run.glades).map((glade) => {
        if (gladeLook(glade) !== 'fogged') return null
        const info = gladePlateInfo(run, glade)
        return (
          <GladePlate
            key={glade.id}
            glade={glade}
            access={info.access}
            percent={Math.floor(info.pct * 100)}
            clearers={info.clearers}
          />
        )
      })}
    </>
  )
})

const GladePlate = memo(function GladePlate({
  glade,
  access,
  percent,
  clearers,
}: {
  glade: Glade
  access: GladeAccess
  percent: number
  clearers: number
}) {
  const locked = access === 'locked'
  return (
    <Html
      position={[glade.center.x, 1.7, glade.center.y]}
      center
      distanceFactor={14}
      zIndexRange={[20, 0]}
    >
      <button
        type="button"
        className={`glade-plate-3d is-${glade.kind} is-${access} ${locked ? 'is-locked' : ''}`}
        style={{ '--kind-color': GLADE_KIND_STYLE[glade.kind].edge } as React.CSSProperties}
        onClick={() => useGameStore.getState().selectGlade(glade.id)}
      >
        <small>
          <Icon id={GLADE_ART[glade.kind]} /> {GLADE_KIND_STYLE[glade.kind].label}
        </small>
        <strong>{glade.name}</strong>
        {percent > 0 && (
          <span className="glade-plate-3d-bar">
            <span style={{ width: `${Math.min(100, percent)}%` }} />
          </span>
        )}
        <em>
          {gladeAccessText({ access, reachable: !locked, pct: percent / 100, clearers })}
        </em>
      </button>
    </Html>
  )
})

export function MapView3D() {
  // The run object is stable for a whole run: subscribing to it (not to the
  // per-tick `version`) keeps this shell from re-rendering every tick.
  const run = useGameStore((s) => s.run)
  const buildMode = useGameStore((s) => s.buildMode)
  const selectedBuilding = useGameStore((s) => s.selectedBuilding)
  const showWarmth = useWarmthRingVisible()

  const shadowsEnabled = useGameStore((s) => s.settings.shadows)
  const controls = useRef<MapControlsImpl | null>(null)
  const flight = useRef<Flight | null>(null)
  const [bucket, setBucket] = useState<ZoomBucket>('mid')
  const [showHelp, setShowHelp] = useState(false)
  useEscapeLayer(showHelp, () => setShowHelp(false))
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
  useCameraFocus(focusOn)
  // R toggles the warmth radius (H → home lives in the CameraRig).
  useMapKey(MAP_KEYS.warmth, () => useMapOverlays.getState().toggleWarmth())

  if (!run) return null

  const selectedCamp = selectedBuilding ? run.buildings[selectedBuilding] : undefined
  const selectedCampDef = selectedCamp ? BUILDINGS[selectedCamp.defId] : undefined

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
        <SeasonAtmosphere />

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

        <GladeLayer run={run} />
        <ForestLayer run={run} />

        {showWarmth && <WarmthLayer run={run} />}

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

        <ObstacleLayer run={run} />
        <DepositLayer run={run} bucket={bucket} />
        {/* Adjacency partners pulse inside their BuildingNode (partnerHint). */}
        <BuildingLayer run={run} bucket={bucket} buildMode={buildMode} />

        {bucket !== 'far' && <Villagers run={run} />}
        <Smoke run={run} />

        <ThreatLayer run={run} />
        <GladePlates run={run} />
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
        <WarmthToggle />
        <button
          type="button"
          aria-label="Controls help"
          aria-expanded={showHelp}
          title="Controls (Esc closes)"
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
            <li><em>Warmth radius</em> — R or 🔥</li>
            <li><em>Select</em> — click · <em>Deselect / cancel</em> — right-click or Esc</li>
            <li><em>Jump</em> — click the minimap</li>
            <li><em>Pause</em> — Space · <em>Speed</em> — 1 / 2 / 3</li>
            <li><em>Panels</em> — B build · P people · O orders · T trade · L log</li>
            <li><em>Close</em> — Esc closes this help and tips</li>
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
