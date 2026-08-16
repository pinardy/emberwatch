import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { MapControls as MapControlsImpl } from 'three-stdlib'
import type { WorldInfo } from '../../game/types'
import { usePanKeys } from '../usePanKeys'

/**
 * Desktop camera controls layered on top of MapControls:
 *  - WASD / arrows pan (camera-relative, zoom-scaled, clamped to the world)
 *  - Q / E orbit around the focus point
 *  - H jumps home to the hearth
 *  - the mouse pushing against the canvas edge pans (never mid-drag)
 *  - the wheel zooms toward the cursor instead of the view centre
 */

const EDGE_PX = 26
const PAN_RATE = 0.45
const ROTATE_RATE = 1.6

// Scratch objects so per-frame work allocates nothing.
const FORWARD = new THREE.Vector3()
const RIGHT = new THREE.Vector3()
const BEFORE = new THREE.Vector3()
const OFFSET = new THREE.Vector3()
const HIT = new THREE.Vector3()
const NDC = new THREE.Vector2()
const WORLD_UP = new THREE.Vector3(0, 1, 0)
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const RAYCASTER = new THREE.Raycaster()

interface CameraRigProps {
  controls: React.MutableRefObject<MapControlsImpl | null>
  world: WorldInfo
  minDistance: number
  maxDistance: number
  /** Recentre on the hearth (shared with the ⌖ button). */
  home: () => void
}

export function CameraRig({ controls, world, minDistance, maxDistance, home }: CameraRigProps) {
  const held = usePanKeys()
  const gl = useThree((s) => s.gl)
  const mouse = useRef<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)

  // H → home. Same input guards as the pan keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag && ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.code === 'KeyH') home()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [home])

  // Track the mouse for edge scrolling; suspend it while any drag is down.
  useEffect(() => {
    const el = gl.domElement
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      mouse.current = { x: e.clientX, y: e.clientY }
    }
    const onLeave = () => {
      mouse.current = null
    }
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') dragging.current = true
    }
    const onUp = () => {
      dragging.current = false
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
    }
  }, [gl])

  /*
   * Zoom toward the cursor. Registered in the capture phase on the canvas's
   * wrapper so it runs before MapControls' own wheel handler and can swallow
   * the event — touch pinch still dollies through MapControls untouched.
   */
  useEffect(() => {
    const el = gl.domElement.parentElement ?? gl.domElement
    const onWheel = (e: WheelEvent) => {
      const c = controls.current
      if (!c) return
      e.preventDefault()
      e.stopPropagation()
      const rect = gl.domElement.getBoundingClientRect()
      NDC.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      RAYCASTER.setFromCamera(NDC, c.object)
      if (!RAYCASTER.ray.intersectPlane(GROUND, HIT)) return

      const camera = c.object
      // Velocity-scaled: a trackpad flick zooms further than a single notch,
      // clamped per event so nothing teleports.
      let factor = THREE.MathUtils.clamp(Math.exp(e.deltaY * 0.0012), 0.6, 1.7)
      const current = camera.position.distanceTo(c.target)
      const desired = THREE.MathUtils.clamp(current * factor, minDistance, maxDistance)
      factor = desired / current
      if (Math.abs(factor - 1) < 1e-4) return
      // Shrink (or grow) both the camera and the focus point about the hit,
      // so whatever is under the cursor stays under the cursor.
      BEFORE.copy(camera.position).sub(HIT).multiplyScalar(factor).add(HIT)
      OFFSET.copy(c.target).sub(HIT).multiplyScalar(factor).add(HIT)
      camera.position.copy(BEFORE)
      c.target.copy(OFFSET)
      c.update()
    }
    el.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => el.removeEventListener('wheel', onWheel, true)
  }, [gl, controls, minDistance, maxDistance])

  useFrame((_, rawDelta) => {
    const c = controls.current
    if (!c) return
    const delta = Math.min(rawDelta, 0.1)
    const keys = held.current

    let x = 0
    let z = 0
    let spin = 0
    if (keys.has('up')) z += 1
    if (keys.has('down')) z -= 1
    if (keys.has('left')) x -= 1
    if (keys.has('right')) x += 1
    if (keys.has('rotateLeft')) spin += 1
    if (keys.has('rotateRight')) spin -= 1

    // Mouse against the canvas edge pans too, unless a drag is in progress.
    if (!dragging.current && mouse.current) {
      const rect = gl.domElement.getBoundingClientRect()
      const mx = mouse.current.x
      const my = mouse.current.y
      if (mx >= rect.left && mx <= rect.right && my >= rect.top && my <= rect.bottom) {
        if (mx - rect.left < EDGE_PX) x -= 1
        if (rect.right - mx < EDGE_PX) x += 1
        if (my - rect.top < EDGE_PX) z += 1
        if (rect.bottom - my < EDGE_PX) z -= 1
      }
    }

    if (x === 0 && z === 0 && spin === 0) return
    const camera = c.object

    if (spin !== 0) {
      OFFSET.copy(camera.position).sub(c.target)
      OFFSET.applyAxisAngle(WORLD_UP, spin * ROTATE_RATE * delta)
      camera.position.copy(c.target).add(OFFSET)
    }

    if (x !== 0 || z !== 0) {
      // Diagonals must not be √2 faster.
      const norm = Math.hypot(x, z)
      x /= norm
      z /= norm

      FORWARD.subVectors(c.target, camera.position)
      FORWARD.y = 0
      if (FORWARD.lengthSq() < 1e-6) FORWARD.set(0, 0, -1)
      FORWARD.normalize()
      RIGHT.crossVectors(FORWARD, WORLD_UP)

      const speed = Math.max(4, camera.position.distanceTo(c.target)) * PAN_RATE * delta
      BEFORE.copy(c.target)
      c.target.addScaledVector(FORWARD, z * speed).addScaledVector(RIGHT, x * speed)
      // Keep the focus on (or just beyond) the world.
      c.target.x = THREE.MathUtils.clamp(c.target.x, -(world.width / 2 + 2), world.width / 2 + 2)
      c.target.z = THREE.MathUtils.clamp(c.target.z, -(world.height / 2 + 2), world.height / 2 + 2)
      camera.position.add(c.target).sub(BEFORE)
    }

    c.update()
  })

  return null
}
