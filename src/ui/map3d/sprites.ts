import * as THREE from 'three'

/**
 * Canvas-baked textures for the 3D map. Emoji and short strings (worker
 * counts, deposit amounts) are drawn once per distinct value and cached, so
 * sprites cost a texture lookup instead of a DOM node each.
 */

const cache = new Map<string, THREE.CanvasTexture>()

function bake(key: string, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const hit = cache.get(key)
  if (hit) return hit
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  draw(ctx, size)
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
