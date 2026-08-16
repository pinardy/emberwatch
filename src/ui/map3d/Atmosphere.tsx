import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Season } from '../../game/types'
import { REDUCED_MOTION } from '../motion'

interface SeasonLook {
  bg: string
  fogNear: number
  fogFar: number
  sky: string
  ground: string
  hemi: number
  sun: string
  sunIntensity: number
  rainCount: number
  rainSpeed: number
  rainOpacity: number
}

const LOOKS: Record<Season, SeasonLook> = {
  drizzle: {
    bg: '#101b1e',
    fogNear: 22,
    fogFar: 60,
    sky: '#8aa2a8',
    ground: '#31413a',
    hemi: 0.55,
    sun: '#d8e6d2',
    sunIntensity: 1.7,
    rainCount: 350,
    rainSpeed: 7,
    rainOpacity: 0.35,
  },
  clearance: {
    bg: '#16211b',
    fogNear: 26,
    fogFar: 70,
    sky: '#a8b98f',
    ground: '#3a4433',
    hemi: 0.6,
    sun: '#ffe8bb',
    sunIntensity: 2.3,
    rainCount: 0,
    rainSpeed: 0,
    rainOpacity: 0,
  },
  storm: {
    bg: '#0a0f16',
    fogNear: 16,
    fogFar: 48,
    sky: '#5d6f8c',
    ground: '#232b33',
    hemi: 0.45,
    sun: '#93a7cc',
    sunIntensity: 1.0,
    rainCount: 1100,
    rainSpeed: 16,
    rainOpacity: 0.5,
  },
}

const RAIN_CEILING = 14
const RAIN_AREA = 40

function Rain({ count, speed, opacity }: { count: number; speed: number; opacity: number }) {
  const points = useRef<THREE.Points>(null)
  const drops = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const velocity = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * RAIN_AREA
      positions[i * 3 + 1] = Math.random() * RAIN_CEILING
      positions[i * 3 + 2] = (Math.random() - 0.5) * RAIN_AREA
      velocity[i] = speed * (0.7 + Math.random() * 0.6)
    }
    return { positions, velocity }
  }, [count, speed])

  useFrame((_, rawDelta) => {
    const mesh = points.current
    if (!mesh) return
    const delta = Math.min(rawDelta, 0.1)
    const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] -= drops.velocity[i] * delta
      if (arr[i * 3 + 1] < 0) arr[i * 3 + 1] = RAIN_CEILING
    }
    attr.needsUpdate = true
  })

  return (
    <points ref={points} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[drops.positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#a7bccc" size={0.07} transparent opacity={opacity} depthWrite={false} />
    </points>
  )
}

/** Occasional storm lightning: a cold flash that decays over a few frames. */
function Lightning() {
  const light = useRef<THREE.DirectionalLight>(null)
  const nextAt = useRef(0)
  useFrame(({ clock }, delta) => {
    const flash = light.current
    if (!flash) return
    const t = clock.elapsedTime
    if (nextAt.current === 0) nextAt.current = t + 3 + Math.random() * 6
    if (t >= nextAt.current) {
      flash.intensity = 2.4
      nextAt.current = t + 4 + Math.random() * 9
    } else if (flash.intensity > 0) {
      flash.intensity = Math.max(0, flash.intensity - 11 * delta)
    }
  })
  return <directionalLight ref={light} position={[7, 26, -9]} color="#cfe0ff" intensity={0} />
}

/** Sky colour, fog, sun and rain for the current season. */
export function Atmosphere({ season }: { season: Season }) {
  const look = LOOKS[season]
  const rainCount = REDUCED_MOTION ? 0 : look.rainCount
  return (
    <>
      <color attach="background" args={[look.bg]} />
      <fog attach="fog" args={[look.bg, look.fogNear, look.fogFar]} />
      <hemisphereLight args={[look.sky, look.ground, look.hemi]} />
      <directionalLight
        position={[14, 20, 9]}
        color={look.sun}
        intensity={look.sunIntensity}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
        shadow-camera-far={70}
        shadow-bias={-0.0004}
      />
      {rainCount > 0 && (
        <Rain key={season} count={rainCount} speed={look.rainSpeed} opacity={look.rainOpacity} />
      )}
      {season === 'storm' && !REDUCED_MOTION && <Lightning />}
    </>
  )
}
