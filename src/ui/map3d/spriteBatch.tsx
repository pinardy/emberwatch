import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { REDUCED_MOTION } from '../motion'
import { NO_RAYCAST } from './models'
import type { SpriteTile } from './sprites'

/**
 * Every floating icon, label, badge and glade plate on the 3D map, drawn as
 * camera-facing quads in ONE instanced draw call per atlas. A three.js
 * `Sprite` is a draw call of its own and cannot be batched; at 106 buildings
 * the map had ~300 of them.
 *
 * Tiles are painted once per distinct key into a shared canvas atlas. A new
 * tile is copied into the GPU texture as a sub-image (no full re-upload);
 * a tile no sprite uses any more stays cached until its slot is needed.
 * Components register sprites with `<BatchSprite>`, which is a plain React
 * child that renders nothing itself: mounting adds an instance, a prop change
 * updates it, unmounting removes it.
 */

export const batchStats = { tilesDrawn: 0, subUploads: 0, fullUploads: 0 }

interface Slot {
  index: number
  refs: number
  /** Last time it was released, for least-recently-used eviction. */
  stamp: number
}

export class SpriteAtlas {
  readonly cols: number
  readonly rows: number
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private scratch: HTMLCanvasElement | null = null
  private scratchCtx: CanvasRenderingContext2D | null = null
  texture: THREE.CanvasTexture | null = null
  private slots = new Map<string, Slot>()
  private free: number[] = []
  /** Freshly painted tiles waiting for their GPU copy: slot → pixels. */
  private pending = new Map<number, ImageData>()
  private clock = 0
  /** Set when the GPU copy must be rebuilt from the canvas (first use, new renderer). */
  needsFullUpload = true

  constructor(
    readonly width: number,
    readonly height: number,
    readonly tileW: number,
    readonly tileH: number,
  ) {
    this.cols = Math.floor(width / tileW)
    this.rows = Math.floor(height / tileH)
    for (let i = this.cols * this.rows - 1; i >= 0; i--) this.free.push(i)
  }

  private ensure(): boolean {
    if (this.canvas) return true
    if (typeof document === 'undefined') return false
    const canvas = document.createElement('canvas')
    canvas.width = this.width
    canvas.height = this.height
    const ctx = canvas.getContext('2d')
    const scratch = document.createElement('canvas')
    scratch.width = this.tileW
    scratch.height = this.tileH
    const scratchCtx = scratch.getContext('2d', { willReadFrequently: true })
    if (!ctx || !scratchCtx) return false
    this.canvas = canvas
    this.ctx = ctx
    this.scratch = scratch
    this.scratchCtx = scratchCtx
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    // Rows run top-down in UV space, which keeps sub-image copies simple.
    texture.flipY = false
    texture.anisotropy = 4
    this.texture = texture
    return true
  }

  /** Takes a reference to `tile`, painting it on first use. -1 when the atlas is full. */
  acquire(tile: SpriteTile): number {
    const hit = this.slots.get(tile.key)
    if (hit) {
      hit.refs++
      return hit.index
    }
    if (!this.ensure()) return -1
    let index = this.free.pop()
    if (index === undefined) {
      // Evict the least recently released tile nobody is using.
      let victim: [string, Slot] | null = null
      for (const entry of this.slots) {
        if (entry[1].refs === 0 && (!victim || entry[1].stamp < victim[1].stamp)) victim = entry
      }
      if (!victim) return -1
      this.slots.delete(victim[0])
      index = victim[1].index
    }
    this.paint(index, tile)
    this.slots.set(tile.key, { index, refs: 1, stamp: 0 })
    return index
  }

  release(key: string): void {
    const slot = this.slots.get(key)
    if (!slot) return
    slot.refs = Math.max(0, slot.refs - 1)
    if (slot.refs === 0) slot.stamp = ++this.clock
  }

  private paint(index: number, tile: SpriteTile): void {
    const s = this.scratchCtx!
    s.setTransform(1, 0, 0, 1, 0, 0)
    s.globalAlpha = 1
    s.clearRect(0, 0, this.tileW, this.tileH)
    tile.draw(s, this.tileW, this.tileH)
    s.setTransform(1, 0, 0, 1, 0, 0)
    const x = (index % this.cols) * this.tileW
    const y = Math.floor(index / this.cols) * this.tileH
    this.ctx!.clearRect(x, y, this.tileW, this.tileH)
    this.ctx!.drawImage(this.scratch!, x, y)
    this.pending.set(index, s.getImageData(0, 0, this.tileW, this.tileH))
    batchStats.tilesDrawn++
  }

  /** UV rectangle of a slot: [u, v, w, h], v running top-down. */
  rect(index: number, out: Float32Array, at: number): void {
    const inset = 0.5
    out[at] = ((index % this.cols) * this.tileW + inset) / this.width
    out[at + 1] = (Math.floor(index / this.cols) * this.tileH + inset) / this.height
    out[at + 2] = (this.tileW - inset * 2) / this.width
    out[at + 3] = (this.tileH - inset * 2) / this.height
  }

  /** Pushes freshly painted tiles to the GPU: a sub-image copy each. */
  sync(renderer: THREE.WebGLRenderer): void {
    const texture = this.texture
    if (!texture) return
    if (this.needsFullUpload) {
      this.needsFullUpload = false
      this.pending.clear()
      texture.needsUpdate = true
      batchStats.fullUploads++
      return
    }
    if (this.pending.size === 0) return
    for (const [index, data] of this.pending) {
      const x = (index % this.cols) * this.tileW
      const y = Math.floor(index / this.cols) * this.tileH
      const source = { isDataTexture: true, image: { data: data.data, width: this.tileW, height: this.tileH } }
      renderer.copyTextureToTexture(source as unknown as THREE.Texture, texture, null, new THREE.Vector2(x, y))
      batchStats.subUploads++
    }
    this.pending.clear()
  }
}

export interface SpriteSpec {
  tile: SpriteTile
  x: number
  y: number
  z: number
  /** Height in world units (width follows the atlas tile's aspect). */
  size: number
  /** Sideways shift in screen space, world units (keeps a badge beside its icon). */
  offsetX?: number
  /** Breathe and bob (threat markers); still under reduced motion. */
  pulse?: boolean
}

interface Entry extends SpriteSpec {
  slot: number
}

/** A set of batched sprites sharing one atlas and one draw call. */
export class SpriteBatchStore {
  readonly entries = new Map<number, Entry>()
  private nextId = 1
  version = 0
  pulses = 0

  constructor(readonly atlas: SpriteAtlas) {}

  add(spec: SpriteSpec): number {
    const id = this.nextId++
    this.entries.set(id, { ...spec, slot: this.atlas.acquire(spec.tile) })
    if (spec.pulse) this.pulses++
    this.version++
    return id
  }

  update(id: number, spec: SpriteSpec): void {
    const entry = this.entries.get(id)
    if (!entry) return
    if (entry.tile.key !== spec.tile.key) {
      const slot = this.atlas.acquire(spec.tile)
      this.atlas.release(entry.tile.key)
      entry.slot = slot
    }
    if (entry.pulse) this.pulses--
    if (spec.pulse) this.pulses++
    Object.assign(entry, spec)
    this.version++
  }

  remove(id: number): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.atlas.release(entry.tile.key)
    if (entry.pulse) this.pulses--
    this.entries.delete(id)
    this.version++
  }
}

/** Icons, labels and badges: 128² tiles. */
export const ICON_BATCH = new SpriteBatchStore(new SpriteAtlas(2048, 2048, 128, 128))
/** Glade name plates: 512×256 tiles. */
export const PLATE_BATCH = new SpriteBatchStore(new SpriteAtlas(2048, 2048, 512, 256))

/** Registers one sprite with a batch for as long as it is mounted. */
export function BatchSprite({
  batch = ICON_BATCH,
  tile,
  x,
  y,
  z,
  size,
  offsetX = 0,
  pulse = false,
}: SpriteSpec & { batch?: SpriteBatchStore }) {
  const id = useRef(0)
  const spec: SpriteSpec = { tile, x, y, z, size, offsetX, pulse }
  const latest = useRef(spec)
  latest.current = spec
  useLayoutEffect(() => {
    id.current = batch.add(latest.current)
    return () => {
      batch.remove(id.current)
      id.current = 0
    }
  }, [batch])
  useLayoutEffect(() => {
    if (id.current) batch.update(id.current, latest.current)
  }, [batch, tile.key, x, y, z, size, offsetX, pulse])
  return null
}

const VERTEX = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iUv;
attribute vec3 iSize;
uniform float uTime;
uniform float uAspect;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vec3 anchor = iPos;
  float size = iSize.x;
  if (iSize.z > 0.5) {
    size *= 1.0 + sin(uTime * 4.2) * 0.18;
    anchor.y += sin(uTime * 2.1) * 0.15;
  }
  vec4 mvPosition = modelViewMatrix * vec4(anchor, 1.0);
  mvPosition.x += position.x * size * uAspect + iSize.y;
  mvPosition.y += position.y * size;
  gl_Position = projectionMatrix * mvPosition;
  vUv = vec2(iUv.x + uv.x * iUv.z, iUv.y + (1.0 - uv.y) * iUv.w);
  #include <fog_vertex>
}
`

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  vec4 color = texture2D(map, vUv);
  if (color.a < 0.02) discard;
  gl_FragColor = color;
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

const CAPACITY_STEP = 64

/**
 * The draw call for one batch. Instances are re-sorted back to front only
 * when a sprite changes or the camera moves, so overlapping translucent
 * edges blend in the right order without a draw call per sprite.
 */
export function SpriteBatchMesh({ batch, renderOrder = 10 }: { batch: SpriteBatchStore; renderOrder?: number }) {
  const gl = useThree((s) => s.gl)
  const material = useMemo(() => {
    const atlas = batch.atlas
    return new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        map: { value: null },
        uTime: { value: 0 },
        uAspect: { value: atlas.tileW / atlas.tileH },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: true,
      toneMapped: false,
    })
  }, [batch])
  const state = useRef({
    capacity: 0,
    geometry: null as THREE.InstancedBufferGeometry | null,
    version: -1,
    camera: new THREE.Matrix4(),
    order: [] as Entry[],
  })
  const mesh = useRef<THREE.Mesh>(null)

  useEffect(() => {
    batch.atlas.needsFullUpload = true
    const s = state.current
    return () => {
      material.dispose()
      s.geometry?.dispose()
      s.geometry = null
      s.capacity = 0
      s.version = -1
      batch.atlas.texture?.dispose()
      batch.atlas.needsFullUpload = true
    }
  }, [batch, material])

  useFrame(({ camera, clock }) => {
    const m = mesh.current
    if (!m) return
    const s = state.current
    batch.atlas.sync(gl)
    if (batch.atlas.texture && material.uniforms.map.value !== batch.atlas.texture) {
      material.uniforms.map.value = batch.atlas.texture
    }
    if (batch.pulses > 0 && !REDUCED_MOTION) material.uniforms.uTime.value = clock.elapsedTime
    const cameraMoved = !s.camera.equals(camera.matrixWorld)
    if (!cameraMoved && s.version === batch.version) return
    s.camera.copy(camera.matrixWorld)
    s.version = batch.version

    const n = batch.entries.size
    if (!s.geometry || n > s.capacity) {
      s.geometry?.dispose()
      const capacity = Math.max(CAPACITY_STEP, Math.ceil(n / CAPACITY_STEP) * CAPACITY_STEP)
      const geometry = new THREE.InstancedBufferGeometry()
      const quad = new THREE.PlaneGeometry(1, 1)
      geometry.index = quad.index
      geometry.setAttribute('position', quad.getAttribute('position'))
      geometry.setAttribute('uv', quad.getAttribute('uv'))
      for (const [name, size] of [['iPos', 3], ['iUv', 4], ['iSize', 3]] as const) {
        const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size)
        attr.setUsage(THREE.DynamicDrawUsage)
        geometry.setAttribute(name, attr)
      }
      s.geometry = geometry
      s.capacity = capacity
      m.geometry = geometry
    }
    const geometry = s.geometry
    const pos = geometry.getAttribute('iPos') as THREE.InstancedBufferAttribute
    const uv = geometry.getAttribute('iUv') as THREE.InstancedBufferAttribute
    const size = geometry.getAttribute('iSize') as THREE.InstancedBufferAttribute
    const P = pos.array as Float32Array
    const U = uv.array as Float32Array
    const S = size.array as Float32Array

    // Back to front along the view direction.
    const e = camera.matrixWorld.elements
    const fx = -e[8]
    const fy = -e[9]
    const fz = -e[10]
    const order = s.order
    order.length = 0
    for (const entry of batch.entries.values()) if (entry.slot >= 0) order.push(entry)
    const depth = (a: Entry) => a.x * fx + a.y * fy + a.z * fz
    order.sort((a, b) => depth(b) - depth(a))
    for (let i = 0; i < order.length; i++) {
      const entry = order[i]
      P[i * 3] = entry.x
      P[i * 3 + 1] = entry.y
      P[i * 3 + 2] = entry.z
      batch.atlas.rect(entry.slot, U, i * 4)
      S[i * 3] = entry.size
      S[i * 3 + 1] = entry.offsetX ?? 0
      S[i * 3 + 2] = entry.pulse ? 1 : 0
    }
    geometry.instanceCount = order.length
    pos.needsUpdate = true
    uv.needsUpdate = true
    size.needsUpdate = true
    m.visible = order.length > 0
  })

  return (
    <mesh
      ref={mesh}
      material={material}
      frustumCulled={false}
      renderOrder={renderOrder}
      raycast={NO_RAYCAST}
      visible={false}
    />
  )
}
