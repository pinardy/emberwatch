import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Season } from '../../game/types'
import { REDUCED_MOTION } from '../motion'

/**
 * Sky, fog, light and rain per season. Every season keeps a generous fill
 * (hemisphere + ambient) and a cool rim light from behind, so buildings never
 * sink to black even in the Storm; the Storm darkens the sky and fog instead,
 * and Clearance warms everything golden.
 */

interface SeasonLook {
  bg: string
  fogNear: number
  fogFar: number
  sky: string
  ground: string
  hemi: number
  ambient: string
  ambientIntensity: number
  sun: string
  sunIntensity: number
  rim: string
  rimIntensity: number
  rainCount: number
  rainSpeed: number
  rainOpacity: number
}

const LOOKS: Record<Season, SeasonLook> = {
  drizzle: {
    bg: '#16242a',
    fogNear: 26,
    fogFar: 66,
    sky: '#a9c0c4',
    ground: '#3c4c42',
    hemi: 0.95,
    ambient: '#8fa3a3',
    ambientIntensity: 0.35,
    sun: '#e3eedc',
    sunIntensity: 1.7,
    rim: '#9fb8d0',
    rimIntensity: 0.45,
    rainCount: 420,
    rainSpeed: 8,
    rainOpacity: 0.32,
  },
  clearance: {
    bg: '#1f2419',
    fogNear: 30,
    fogFar: 78,
    sky: '#e9e2c4',
    ground: '#4a4934',
    hemi: 0.85,
    ambient: '#ffe6c0',
    ambientIntensity: 0.2,
    sun: '#ffdca2',
    sunIntensity: 2.3,
    rim: '#ffc890',
    rimIntensity: 0.4,
    rainCount: 0,
    rainSpeed: 0,
    rainOpacity: 0,
  },
  storm: {
    bg: '#070b12',
    fogNear: 20,
    fogFar: 56,
    sky: '#7d8fb0',
    ground: '#2a3240',
    hemi: 1.05,
    ambient: '#6f7f9e',
    ambientIntensity: 0.55,
    sun: '#a7b8dc',
    sunIntensity: 1.0,
    rim: '#9fc0ff',
    rimIntensity: 0.9,
    rainCount: 1400,
    rainSpeed: 17,
    rainOpacity: 0.5,
  },
}

const RAIN_CEILING = 14
const RAIN_AREA = 44

const RAIN_VERTEX = /* glsl */ `
attribute float aSpeed;
uniform float uTime;
uniform float uCeiling;
uniform float uScale;
#include <fog_pars_vertex>
void main() {
  vec3 p = position;
  p.y = mod(position.y - aSpeed * uTime, uCeiling);
  // A slight slant, as if blown.
  p.x += (uCeiling - p.y) * 0.06;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = uScale / -mvPosition.z;
  #include <fog_vertex>
}
`

const RAIN_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
#include <fog_pars_fragment>
void main() {
  // A thin vertical streak inside the point sprite.
  vec2 c = gl_PointCoord - 0.5;
  float streak = smoothstep(0.09, 0.0, abs(c.x + c.y * 0.12)) * smoothstep(0.5, 0.15, abs(c.y));
  if (streak < 0.02) discard;
  gl_FragColor = vec4(uColor, uOpacity * streak);
  #include <fog_fragment>
}
`

/**
 * Rain as one `Points` draw call whose fall happens in the vertex shader
 * (`mod(y - speed·t, ceiling)`): no per-frame CPU loop, no buffer upload.
 */
function Rain({ count, speed, opacity }: { count: number; speed: number; opacity: number }) {
  const { geometry, material } = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const speeds = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * RAIN_AREA
      positions[i * 3 + 1] = Math.random() * RAIN_CEILING
      positions[i * 3 + 2] = (Math.random() - 0.5) * RAIN_AREA
      speeds[i] = speed * (0.7 + Math.random() * 0.6)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1))
    const m = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: { value: 0 },
        uCeiling: { value: RAIN_CEILING },
        uScale: { value: 60 },
        uColor: { value: new THREE.Color('#b9cbe0') },
        uOpacity: { value: opacity },
      },
      vertexShader: RAIN_VERTEX,
      fragmentShader: RAIN_FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: true,
    })
    return { geometry: g, material: m }
  }, [count, speed, opacity])

  useFrame(({ clock, size, viewport }) => {
    material.uniforms.uTime.value = clock.elapsedTime
    // Point size in pixels at 1 unit away, scaled with the canvas height.
    material.uniforms.uScale.value = size.height * viewport.dpr * 0.09
  })

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />
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

/** Sky colour, fog, sun, fill, rim and rain for the current season. */
export function Atmosphere({ season, shadows = true }: { season: Season; shadows?: boolean }) {
  const look = LOOKS[season]
  const rainCount = REDUCED_MOTION ? 0 : look.rainCount
  return (
    <>
      <color attach="background" args={[look.bg]} />
      <fog attach="fog" args={[look.bg, look.fogNear, look.fogFar]} />
      <hemisphereLight args={[look.sky, look.ground, look.hemi]} />
      <ambientLight color={look.ambient} intensity={look.ambientIntensity} />
      <directionalLight
        position={[14, 20, 9]}
        color={look.sun}
        intensity={look.sunIntensity}
        castShadow={shadows}
        // 1024² covers the 28×22 world seen from 15–40 units; casters are
        // only buildings, the hearth and trees.
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-17}
        shadow-camera-right={17}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
        shadow-camera-far={60}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
      />
      {/* Rim: from behind the default view, it outlines roofs against the dark. */}
      <directionalLight position={[-6, 9, -16]} color={look.rim} intensity={look.rimIntensity} />
      {rainCount > 0 && (
        <Rain key={season} count={rainCount} speed={look.rainSpeed} opacity={look.rainOpacity} />
      )}
      {season === 'storm' && !REDUCED_MOTION && <Lightning />}
    </>
  )
}
