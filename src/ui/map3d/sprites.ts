import * as THREE from 'three'
import { ICONS, toneColor, type IconId } from '../../art/icons'

/**
 * Canvas-baked textures for the 3D map. Drawn icons, emoji and short strings (worker
 * counts, deposit amounts) are drawn once per distinct value and cached, so
 * sprites cost a texture lookup instead of a DOM node each.
 */

const cache = new Map<string, THREE.CanvasTexture>()

/** Textures baked so far — tests read this to prove nothing re-bakes per tick. */
export const textureStats = { created: 0 }

function bake(key: string, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const hit = cache.get(key)
  if (hit) return hit
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  draw(ctx, size)
  textureStats.created++
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  cache.set(key, texture)
  return texture
}

export function emojiTexture(emoji: string): THREE.CanvasTexture {
  return bake(`e:${emoji}`, (ctx, size) => {
    ctx.font = `${Math.floor(size * 0.72)}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // A soft dark halo keeps pale glyphs readable against bright tiles.
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
    ctx.shadowBlur = size * 0.09
    ctx.fillText(emoji, size / 2, size / 2 + size * 0.04)
  })
}

/** Light ink for the `currentColor` tone, which has no text to inherit here. */
const SPRITE_CURRENT = '#dfe6e3'

/**
 * A drawn icon rasterised once: the registry's path data is replayed onto a
 * canvas through `Path2D` (the same strings the SVG renders), then stamped
 * onto the texture with the soft dark halo the emoji sprites always had.
 */
export function iconTexture(id: IconId): THREE.CanvasTexture {
  return bake(`i:${id}`, (ctx, size) => {
    const art = document.createElement('canvas')
    art.width = size
    art.height = size
    const g = art.getContext('2d')!
    const scale = (size * 0.72) / 24 // the footprint the emoji glyphs had
    const offset = (size - 24 * scale) / 2
    g.lineCap = 'round'
    g.lineJoin = 'round'
    for (const shape of ICONS[id]) {
      g.setTransform(scale, 0, 0, scale, offset, offset)
      if (shape.m) g.transform(...shape.m)
      g.globalAlpha = shape.o ?? 1
      const path = new Path2D(shape.d)
      if (shape.fill) {
        g.fillStyle = toneColor(shape.fill, SPRITE_CURRENT)
        g.fill(path)
      }
      if (shape.stroke) {
        g.strokeStyle = toneColor(shape.stroke, SPRITE_CURRENT)
        g.lineWidth = shape.w ?? 1.3
        g.stroke(path)
      }
    }
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
    ctx.shadowBlur = size * 0.07
    ctx.drawImage(art, 0, 0)
  })
}

export function labelTexture(text: string): THREE.CanvasTexture {
  return bake(`t:${text}`, (ctx, size) => {
    ctx.font = `600 ${Math.floor(size * 0.34)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const w = ctx.measureText(text).width + size * 0.22
    const h = size * 0.46
    const x = (size - w) / 2
    const y = (size - h) / 2
    ctx.fillStyle = 'rgba(9, 13, 16, 0.72)'
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, h / 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
    ctx.fillText(text, size / 2, size / 2 + size * 0.01)
  })
}

/** A round status badge: a coloured disc with a dark rim and a glyph. */
export function badgeTexture(icon: string, color: string): THREE.CanvasTexture {
  return bake(`b:${icon}:${color}`, (ctx, size) => {
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size * 0.44, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.lineWidth = size * 0.07
    ctx.strokeStyle = 'rgba(9, 13, 16, 0.9)'
    ctx.stroke()
    ctx.font = `${Math.floor(size * 0.5)}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(icon, size / 2, size / 2 + size * 0.03)
  })
}
