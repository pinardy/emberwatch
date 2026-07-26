/**
 * Generates the PWA icon set as real PNGs — no binary assets in the repo and no
 * image dependencies. Draws a dark rounded tile with a warm ember glow, which
 * reads clearly at 48px on a home screen.
 *
 * Run with: npm run icons
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../public/icons')

const BG = [13, 18, 22]
const BG_EDGE = [8, 12, 15]
const EMBER_CORE = [255, 232, 176]
const EMBER_MID = [223, 154, 62]
const EMBER_EDGE = [140, 56, 30]

function lerp(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t))
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Half-width of the flame at normalised height `ny` (−1 tip, +1 base).
 * Returns 0 outside the shape.
 */
function flameHalfWidth(ny) {
  const BASE_Y = 0.34
  const BASE_W = 0.56
  if (ny > BASE_Y) {
    // Circular bottom.
    const t = (ny - BASE_Y) / (1 - BASE_Y)
    return t >= 1 ? 0 : BASE_W * Math.sqrt(1 - t * t)
  }
  // Tapering body up to a point at ny = -1.
  const t = (BASE_Y - ny) / (BASE_Y + 1)
  return BASE_W * Math.pow(1 - t, 0.62)
}

/**
 * @param {number} size
 * @param {boolean} maskable Maskable icons need 20% safe padding all round.
 */
function drawIcon(size, maskable) {
  const pixels = Buffer.alloc(size * size * 4)
  const center = size / 2
  // Maskable variants shrink the artwork so nothing is lost to a circle mask.
  const artScale = maskable ? 0.62 : 0.86
  const radius = (size / 2) * artScale
  const cornerRadius = size * (maskable ? 0.0 : 0.18)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const dx = x - center + 0.5
      const dy = y - center + 0.5
      const dist = Math.hypot(dx, dy)

      // Background: subtle vignette from centre to corner.
      let colour = lerp(BG, BG_EDGE, Math.min(1, dist / (size * 0.72)))
      let alpha = 255

      if (!maskable) {
        // Rounded-rect mask for the standalone icon.
        const inset = size * 0.04
        const rx = Math.abs(dx) - (size / 2 - inset - cornerRadius)
        const ry = Math.abs(dy) - (size / 2 - inset - cornerRadius)
        const corner = Math.hypot(Math.max(rx, 0), Math.max(ry, 0)) - cornerRadius
        alpha = Math.round(255 * (1 - smoothstep(-1, 1, corner)))
      }

      // Flame silhouette: circular base below, tapering to a point above.
      const ny = dy / radius
      const nx = Math.abs(dx) / radius
      const halfWidth = flameHalfWidth(ny)
      // Distance from the silhouette edge, in normalised units.
      const edge = halfWidth > 0 ? nx - halfWidth : 1
      const aa = 1.6 / radius

      if (edge < aa) {
        // Heat falls off from a hot spot low in the flame.
        const heat =
          1 - Math.min(1, Math.hypot(nx / 0.62, (ny - 0.42) / 0.95))
        const ember =
          heat > 0.55
            ? lerp(EMBER_MID, EMBER_CORE, smoothstep(0.55, 1, heat))
            : lerp(EMBER_EDGE, EMBER_MID, smoothstep(0, 0.55, heat))
        colour = lerp(colour, ember, 1 - smoothstep(-aa, aa, edge))
      } else if (edge < 0.16) {
        // Tight halo so the flame sits in the tile rather than on it.
        colour = lerp(colour, EMBER_EDGE, (1 - edge / 0.16) * 0.32)
      }

      pixels[i] = colour[0]
      pixels[i + 1] = colour[1]
      pixels[i + 2] = colour[2]
      pixels[i + 3] = alpha
    }
  }
  return pixels
}

// --- minimal PNG encoder ---------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([length, typeBuf, data, crc])
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // One filter byte (0 = none) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(outDir, { recursive: true })

const targets = [
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-512-maskable.png', size: 512, maskable: true },
  { name: 'apple-touch-icon.png', size: 180, maskable: false },
]

for (const target of targets) {
  const png = encodePng(target.size, drawIcon(target.size, target.maskable))
  writeFileSync(resolve(outDir, target.name), png)
  console.log(`wrote icons/${target.name} (${png.length} bytes)`)
}
