import * as THREE from 'three'
import { iconShapes, toneColor, type IconId } from '../../art/icons'

/**
 * Canvas-drawn tiles for the 3D map. Drawn icons, emoji and short strings
 * (worker counts, deposit amounts) are painted once per distinct value: into
 * the shared sprite atlas (`spriteBatch.tsx`) for everything on the map, or
 * into a cached standalone texture for the few loose sprites (the build ghost).
 */

/** A tile the 3D map can draw: a stable cache key and how to paint it. */
export interface SpriteTile {
  key: string
  /** Paints the tile into a `w`×`h` area at the context's origin. */
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
}

const cache = new Map<string, THREE.CanvasTexture>()

/** Textures baked so far — tests read this to prove nothing re-bakes per tick. */
export const textureStats = { created: 0 }

function bake(tile: SpriteTile): THREE.CanvasTexture {
  const hit = cache.get(tile.key)
  if (hit) return hit
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  tile.draw(ctx, size, size)
  textureStats.created++
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  cache.set(tile.key, texture)
  return texture
}

export function emojiTile(emoji: string): SpriteTile {
  return {
    key: `e:${emoji}`,
    draw: (ctx, size) => {
      ctx.font = `${Math.floor(size * 0.72)}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      // A soft dark halo keeps pale glyphs readable against bright tiles.
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
      ctx.shadowBlur = size * 0.09
      ctx.fillText(emoji, size / 2, size / 2 + size * 0.04)
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
    },
  }
}

/** Light ink for the `currentColor` tone, which has no text to inherit here. */
const SPRITE_CURRENT = '#dfe6e3'

/**
 * A drawn icon rasterised once: the registry's path data is replayed onto the
 * canvas through `Path2D` (the same strings the SVG renders). A first pass
 * lays a soft dark rim under every shape — the halo the emoji sprites had,
 * without a blur filter or a second canvas, both of which are slow under
 * software WebGL.
 */
export function iconTile(id: IconId): SpriteTile {
  return {
    key: `i:${id}`,
    draw: (ctx, size) => {
      const scale = (size * 0.72) / 24 // the footprint the emoji glyphs had
      drawIcon(ctx, id, scale, (size - 24 * scale) / 2, true)
    },
  }
}

/** The drawn `art` when there is one, else the emoji. */
export function artTile(icon: string, art?: IconId): SpriteTile {
  return art ? iconTile(art) : emojiTile(icon)
}

/** `artTile` as a cached standalone texture, for the few loose sprites. */
export function artTexture(icon: string, art?: IconId): THREE.CanvasTexture {
  return bake(artTile(icon, art))
}

/** Replays an icon's paths at `scale`, offset by `offset` (both axes, or [x, y]). */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  id: IconId,
  scale: number,
  offset: number | [number, number],
  halo: boolean,
) {
  const [ox, oy] = typeof offset === 'number' ? [offset, offset] : offset
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const shapes = iconShapes(id).map((shape) => ({ shape, path: new Path2D(shape.d) }))
  const place = (m?: readonly number[]) => {
    ctx.setTransform(scale, 0, 0, scale, ox, oy)
    if (m) ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5])
  }
  if (halo) {
    // Halo: each shape's silhouette, widened, in translucent ink.
    ctx.globalAlpha = 0.45
    ctx.fillStyle = ctx.strokeStyle = 'rgb(0, 0, 0)'
    for (const { shape, path } of shapes) {
      place(shape.m)
      ctx.lineWidth = (shape.w ?? 1.3) + 2.2
      if (shape.fill) ctx.fill(path)
      ctx.stroke(path)
    }
  }
  for (const { shape, path } of shapes) {
    place(shape.m)
    ctx.globalAlpha = shape.o ?? 1
    if (shape.fill) {
      ctx.fillStyle = toneColor(shape.fill, SPRITE_CURRENT)
      ctx.fill(path)
    }
    if (shape.stroke) {
      ctx.strokeStyle = toneColor(shape.stroke, SPRITE_CURRENT)
      ctx.lineWidth = shape.w ?? 1.3
      ctx.stroke(path)
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
}

export function labelTile(text: string): SpriteTile {
  return {
    key: `t:${text}`,
    draw: (ctx, size) => {
      ctx.font = `600 ${Math.floor(size * 0.34)}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const w = Math.min(size * 0.98, ctx.measureText(text).width + size * 0.22)
      const h = size * 0.46
      const x = (size - w) / 2
      const y = (size - h) / 2
      ctx.fillStyle = 'rgba(9, 13, 16, 0.72)'
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, h / 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
      ctx.fillText(text, size / 2, size / 2 + size * 0.01, size * 0.9)
    },
  }
}

/**
 * A round status badge: a coloured disc with a dark rim and a glyph — the
 * drawn `art` (a white `mono/` icon) when given, else the emoji.
 */
export function badgeTile(icon: string, color: string, art?: IconId): SpriteTile {
  return {
    key: `b:${art ?? icon}:${color}`,
    draw: (ctx, size) => {
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, size * 0.44, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      ctx.lineWidth = size * 0.07
      ctx.strokeStyle = 'rgba(9, 13, 16, 0.9)'
      ctx.stroke()
      if (art) {
        const scale = (size * 0.56) / 24
        drawIcon(ctx, art, scale, (size - 24 * scale) / 2, false)
        return
      }
      ctx.font = `${Math.floor(size * 0.5)}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#ffffff'
      ctx.fillText(icon, size / 2, size / 2 + size * 0.03)
    },
  }
}
