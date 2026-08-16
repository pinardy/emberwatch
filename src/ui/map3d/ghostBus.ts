import type { Vec2 } from '../../game/types'

/**
 * Tiny relay so taps on deposits/buildings during touch build-mode can aim
 * the ghost cursor, whose state lives inside `GroundPlane`. One listener,
 * registered while the ground plane is mounted.
 */

type Listener = (pos: Vec2) => void

let listener: Listener | null = null

export function onGhostRequest(fn: Listener): () => void {
  listener = fn
  return () => {
    if (listener === fn) listener = null
  }
}

export function requestGhost(pos: Vec2): void {
  listener?.(pos)
}
