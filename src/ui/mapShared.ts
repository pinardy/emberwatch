import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { BUILDINGS } from '../game/content/buildings'
import { isReachable } from '../game/engine/actions'
import { HEARTH_WARMTH_RADIUS } from '../game/engine/balance'
import { TERRAIN_COLORS } from '../game/engine/mapgen'
import { computeModifiers, type Modifiers } from '../game/engine/modifiers'
import { seasonMultiplier } from '../game/engine/production'
import { activeRecipe, canAfford, storageUsed } from '../game/engine/queries'
import { useGameStore } from '../game/store'
import type {
  BuildingInstance,
  DepositId,
  Glade,
  GladeKind,
  RunState,
  TerrainId,
  Vec2,
} from '../game/types'

/**
 * Pure helpers and tiny hooks shared by both map renderers (3D scene and the
 * 2D SVG fallback), so a glade, deposit or building reads the same way in
 * either — and the Inspector names glades with the same words.
 */

// ---------------------------------------------------------------------------
// Colour utilities
// ---------------------------------------------------------------------------

/** Scales an `#rrggbb` colour's channels by `factor`, clamped to white. */
export function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16)
  const channel = (shift: number) =>
    Math.min(255, Math.round(((n >> shift) & 0xff) * factor))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(16)}${channel(8)}${channel(0)}`
}

export type MapPalette = '2d' | '3d'

/**
 * Cleared ground. The 3D scene is lit, so it reads the shared palette a touch
 * brighter than the flat SVG fill.
 */
export function terrainColor(terrain: TerrainId, palette: MapPalette): string {
  const base = TERRAIN_COLORS[terrain]
  return palette === '3d' ? shade(base, 1.3) : base
}

// ---------------------------------------------------------------------------
// Glades
// ---------------------------------------------------------------------------

export type GladeLook = 'hidden' | 'fogged' | 'visible'

export function gladeLook(glade: Glade): GladeLook {
  if (glade.cleared) return 'visible'
  if (glade.discovered) return 'fogged'
  return 'hidden'
}

export interface GladeKindStyle {
  icon: string
  /** Short plate label, e.g. "Dangerous". */
  label: string
  /** Long form, e.g. "Dangerous glade". */
  title: string
  /** Border colour of a fogged glade and accent of its plate. */
  edge: string
  /**
   * Border pattern as dash/gap lengths in world units; `null` is solid.
   * Small glades are a calm solid line, dangerous ones a long dash,
   * forbidden ones a tight dotted warning.
   */
  dash: [number, number] | null
  /** Fogged ground tint (2D palette; the 3D scene brightens it). */
  fog: string
  /** Forest canopy tint over the discovered glade (3D). */
  canopy: string
}

export const GLADE_KIND_STYLE: Record<GladeKind, GladeKindStyle> = {
  settlement: {
    icon: '🔥',
    label: 'Settlement',
    title: 'Settlement glade',
    edge: '#d9b46a',
    dash: null,
    fog: '#1a2219',
    canopy: '#2e4f36',
  },
  small: {
    icon: '🌿',
    label: 'Small',
    title: 'Small glade',
    edge: '#8fc488',
    dash: null,
    fog: '#14201a',
    canopy: '#2e4f36',
  },
  dangerous: {
    icon: '⚠️',
    label: 'Dangerous',
    title: 'Dangerous glade',
    edge: '#e8a33c',
    dash: [0.7, 0.4],
    fog: '#231f12',
    canopy: '#4a4a2a',
  },
  forbidden: {
    icon: '☠️',
    label: 'Forbidden',
    title: 'Forbidden glade',
    edge: '#d4567f',
    dash: [0.22, 0.26],
    fog: '#22141f',
    canopy: '#3d2c40',
  },
}

/** "🌿 Small", "⚠️ Dangerous", "☠️ Forbidden" — the plate's kind line. */
export function gladeKindLabel(kind: GladeKind): string {
  const style = GLADE_KIND_STYLE[kind]
  return `${style.icon} ${style.label}`
}

/** Ground fill of a glade that is not (yet) cleared ground. */
export const HIDDEN_FILL = '#0c1013'

/** Fill for a glade polygon in either renderer. */
export function gladeFill(glade: Glade, palette: MapPalette): string {
  const look = gladeLook(glade)
  if (look === 'visible') return terrainColor(glade.terrain, palette)
  const base = look === 'fogged' ? GLADE_KIND_STYLE[glade.kind].fog : HIDDEN_FILL
  return palette === '3d' ? shade(base, 1.25) : base
}

/**
 * How the player can act on a fogged glade: out of reach, ready to be
 * cleared, or already being cleared by a crew.
 */
export type GladeAccess = 'locked' | 'reachable' | 'clearing'

export interface GladePlateInfo {
  access: GladeAccess
  reachable: boolean
  /** Clearing progress, 0..1. */
  pct: number
  clearers: number
}

export function gladePlateInfo(run: RunState, glade: Glade): GladePlateInfo {
  const reachable = isReachable(run, glade.id)
  const pct = glade.clearWork > 0 ? Math.min(1, glade.clearProgress / glade.clearWork) : 0
  const access: GladeAccess = glade.clearers > 0 ? 'clearing' : reachable ? 'reachable' : 'locked'
  return { access, reachable, pct, clearers: glade.clearers }
}

/** One-line status under a glade's name. */
export function gladeAccessText(info: GladePlateInfo): string {
  if (info.access === 'clearing') return `⛏ ${info.clearers} clearing · ${Math.floor(info.pct * 100)}%`
  if (info.access === 'reachable') return info.pct > 0 ? `Reachable · ${Math.floor(info.pct * 100)}%` : 'Reachable'
  return '🔒 Out of reach'
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

/**
 * Ground tint under each deposit kind, so features stay tellable apart even
 * when their props shrink to a few pixels at far zoom.
 */
export const DEPOSIT_TINT: Record<DepositId, string> = {
  trees: '#3f8a4a',
  stoneVein: '#a3a8ad',
  clayPatch: '#b0703f',
  orePatch: '#e08a3a',
  vegetation: '#9ccf5a',
  game: '#8a5a3a',
  fertileSoil: '#d9c25a',
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export type BuildingStatus =
  | 'construction'
  | 'paused'
  | 'unstaffed'
  | 'noDeposit'
  | 'seasonIdle'
  | 'noInputs'
  | 'storageFull'
  | 'working'
  /** Housing, storage, the hearth — nothing to report. */
  | 'none'

export interface StatusBadge {
  icon: string
  label: string
  color: string
  /** Problems are shown at every zoom; good news only up close. */
  problem: boolean
}

export const STATUS_BADGE: Record<Exclude<BuildingStatus, 'none'>, StatusBadge> = {
  construction: { icon: '🔨', label: 'Under construction', color: '#d9b46a', problem: false },
  paused: { icon: '⏸', label: 'Paused', color: '#8a949a', problem: true },
  unstaffed: { icon: '👤', label: 'No workers', color: '#e8a33c', problem: true },
  noDeposit: { icon: '🚫', label: 'No deposit in reach', color: '#d05050', problem: true },
  seasonIdle: { icon: '🌧', label: 'Idle this season', color: '#5f8fd4', problem: true },
  noInputs: { icon: '⏳', label: 'Waiting for inputs', color: '#e07a3c', problem: true },
  storageFull: { icon: '📦', label: 'Storage full', color: '#d05050', problem: true },
  working: { icon: '⚙', label: 'Working', color: '#6fbf72', problem: false },
}

/** Lazily computed per-call context so a batch of buildings shares the work. */
export interface StatusContext {
  used?: number
  mods?: Modifiers
}

/**
 * What a building is doing right now, mirroring the gates in
 * `stepProduction`: construction, pause, staff, deposit, season, inputs and
 * finally storage room for the output.
 */
export function buildingStatus(
  run: RunState,
  b: BuildingInstance,
  ctx: StatusContext = {},
): BuildingStatus {
  const def = BUILDINGS[b.defId]
  if (!def) return 'none'
  if (!b.built) return 'construction'
  if (def.recipes.length === 0 || def.workerSlots === 0) return 'none'
  if (b.paused) return 'paused'
  if (b.workers.length === 0) return 'unstaffed'
  const recipe = activeRecipe(b)
  if (!recipe) return 'none'
  if (recipe.requiresDeposit) {
    const live = (b.depositsInRange[recipe.requiresDeposit] ?? []).some((id) => {
      const deposit = run.deposits[id]
      return deposit && (deposit.amount === null || deposit.amount > 0)
    })
    if (!live) return 'noDeposit'
  }
  if (def.tags.includes('farming') && run.season.season === 'storm') {
    ctx.mods ??= computeModifiers(run)
    if (seasonMultiplier(b.defId, run.season.season, ctx.mods) <= 0) return 'seasonIdle'
  }
  if (!canAfford(run.stock, recipe.inputs)) return 'noInputs'
  // A finished cycle held at the brim with its inputs on hand is waiting
  // for room in the stockpile.
  if (b.recipeProgress >= recipe.seconds) {
    let outputs = 0
    for (const [id, amount] of Object.entries(recipe.outputs)) {
      if (id !== 'amber') outputs += amount ?? 0
    }
    ctx.used ??= storageUsed(run)
    if (outputs > 0 && ctx.used + outputs > run.storageCap) return 'storageFull'
  }
  return 'working'
}

/** Storm chill: finished housing standing beyond the hearth's warmth. */
export function isColdHousing(run: RunState, b: BuildingInstance): boolean {
  return (
    run.season.season === 'storm' &&
    b.built &&
    (BUILDINGS[b.defId]?.housing ?? 0) > 0 &&
    Math.hypot(b.pos.x, b.pos.y) > HEARTH_WARMTH_RADIUS
  )
}

// ---------------------------------------------------------------------------
// Warmth overlay
// ---------------------------------------------------------------------------

interface MapOverlayState {
  /** Player toggle: show the hearth's warmth radius at all times. */
  showWarmth: boolean
  toggleWarmth: () => void
}

/** View-only overlay toggles, shared by both renderers (not saved). */
export const useMapOverlays = create<MapOverlayState>((set, get) => ({
  showWarmth: false,
  toggleWarmth: () => set({ showWarmth: !get().showWarmth }),
}))

/** The warmth ring shows while toggled on, placing housing, or inspecting the hearth. */
export function showsWarmthRing(opts: {
  toggled: boolean
  buildMode: string | null
  hearthSelected: boolean
}): boolean {
  if (opts.toggled || opts.hearthSelected) return true
  return !!opts.buildMode && (BUILDINGS[opts.buildMode]?.housing ?? 0) > 0
}

/** Store-subscribed form of `showsWarmthRing` for either renderer. */
export function useWarmthRingVisible(): boolean {
  const toggled = useMapOverlays((s) => s.showWarmth)
  const buildMode = useGameStore((s) => s.buildMode)
  const hearthSelected = useGameStore((s) => {
    const id = s.selectedBuilding
    return !!id && s.run?.buildings[id]?.defId === 'ancientHearth'
  })
  return showsWarmthRing({ toggled, buildMode, hearthSelected })
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** True when a key event belongs to a form field or an OS/browser shortcut. */
export function isMapKeyIgnored(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag && ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return true
  return e.ctrlKey || e.metaKey || e.altKey
}

/** Map hotkeys shared by both renderers. */
export const MAP_KEYS = {
  /** Jump the camera home to the hearth. */
  home: 'KeyH',
  /** Toggle the hearth warmth radius overlay. (W is taken by WASD panning.) */
  warmth: 'KeyR',
} as const

/** Runs `handler` when the key with `code` is pressed over the map. */
export function useMapKey(code: string, handler: () => void): void {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== code || e.repeat || isMapKeyIgnored(e)) return
      latest.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [code])
}

/**
 * One-shot fly-to requests from elsewhere in the UI (threat cards, the
 * minimap): hands the point to the renderer's camera, then clears it.
 */
export function useCameraFocus(onFocus: (p: Vec2) => void): void {
  const cameraFocus = useGameStore((s) => s.cameraFocus)
  const latest = useRef(onFocus)
  latest.current = onFocus
  useEffect(() => {
    if (!cameraFocus) return
    latest.current(cameraFocus)
    useGameStore.setState({ cameraFocus: null })
  }, [cameraFocus])
}
