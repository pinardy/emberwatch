import { useMemo } from 'react'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { IconId } from '../../art/icons'
import { artTexture } from './sprites'

/**
 * Small shared pieces of the 3D scene. Building, deposit and obstacle models
 * are instanced parts (`modelParts.ts` + `parts.tsx`); the hearth has its own
 * animated model (`Hearth.tsx`).
 */

/** Decorative meshes opt out of raycasting so clicks fall through to the ground. */
export const NO_RAYCAST = () => null

export const GOLD = '#d9b46a'

export const GHOST_OK_MAT = new THREE.MeshStandardMaterial({
  color: '#6fbf72',
  transparent: true,
  opacity: 0.5,
  roughness: 1,
  depthWrite: false,
})
export const GHOST_BAD_MAT = new THREE.MeshStandardMaterial({
  color: '#c05050',
  transparent: true,
  opacity: 0.5,
  roughness: 1,
  depthWrite: false,
})

/** Deterministic per-id jitter so prop layouts survive re-renders. */
export function hash01(key: string, salt: number): number {
  let h = 2166136261 ^ (salt * 2654435761)
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

/**
 * A loose floating icon (the build ghost's): the drawn `art` when there is
 * one, else the emoji `icon`. Map sprites go through the batched atlas
 * (`BatchSprite`) instead; this one follows the cursor at pointer rate.
 */
export function IconSprite({
  icon,
  art,
  y,
  size,
}: {
  icon: string
  art?: IconId
  y: number
  size: number
}) {
  const map = useMemo(() => artTexture(icon, art), [art, icon])
  return (
    <sprite position={[0, y, 0]} scale={[size, size, 1]} raycast={NO_RAYCAST}>
      <spriteMaterial map={map} transparent depthWrite={false} />
    </sprite>
  )
}

/** The verdict bubble over a 3D build ghost (a building or a road stretch). */
export function GhostHint3D({ y, ok, hint }: { y: number; ok: boolean; hint: string }) {
  return (
    <Html position={[0, y, 0]} center distanceFactor={12} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`ghost-hint ${ok ? 'is-ok' : 'is-bad'}`}>{hint}</div>
    </Html>
  )
}

/** Touch: the ✓ / ✕ over a ghost aimed by a tap, to place it or let it go. */
export function GhostConfirm3D({
  y,
  ok,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  y: number
  ok: boolean
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Html position={[0, y, 0]} center distanceFactor={12} zIndexRange={[25, 0]}>
      <div className="ghost-confirm">
        <button type="button" className="ok" disabled={!ok} onClick={onConfirm} aria-label={confirmLabel}>
          ✓
        </button>
        <button type="button" className="no" onClick={onCancel} aria-label={cancelLabel}>
          ✕
        </button>
      </div>
    </Html>
  )
}
