import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { BUILDINGS } from '../game/content/buildings'
import { isReachable } from '../game/engine/actions'
import { describeStakes, gladeStakesOf, type GladeStake } from '../game/engine/glades'
import type { BuildingStatus as EngineBuildingStatus } from '../game/engine/forecast'
import { dist } from '../game/engine/geometry'
import { TERRAIN_COLORS } from '../game/engine/mapgen'
import { isWarmAt, type WarmthSource } from '../game/engine/queries'
import { housingOf, isInsulated, isUpgrading, nextUpgrade, tierOf } from '../game/engine/upgrades'
import { useGameStore } from '../game/store'
import type {
  BuildingDef,
  BuildingInstance,
  DepositId,
  Glade,
  GladeKind,
  RunState,
  TerrainId,
  Vec2,
} from '../game/types'
import type { IconId } from '../art/icons'
import { STATUS_BADGE_ART } from '../game/content/artFamilies'

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
    label: 'Settlement',
    title: 'Settlement glade',
    edge: '#d9b46a',
    dash: null,
    fog: '#1a2219',
    canopy: '#2e4f36',
  },
  small: {
    label: 'Small',
    title: 'Small glade',
    edge: '#8fc488',
    dash: null,
    fog: '#14201a',
    canopy: '#2e4f36',
  },
  dangerous: {
    label: 'Dangerous',
    title: 'Dangerous glade',
    edge: '#e8a33c',
    dash: [0.7, 0.4],
    fog: '#231f12',
    canopy: '#4a4a2a',
  },
  forbidden: {
    label: 'Forbidden',
    title: 'Forbidden glade',
    edge: '#d4567f',
    dash: [0.22, 0.26],
    fog: '#22141f',
    canopy: '#3d2c40',
  },
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/** The build ghost's bubble: why it cannot go here, else what it would join. */
export function placementHint(reason: string | null, parts: readonly string[]): string | null {
  return reason ?? (parts.length > 0 ? parts.join(' · ') : null)
}

/** Ground fill of a glade that is not (yet) cleared ground. */
export const HIDDEN_FILL = '#0c1013'

/**
 * A glade left to the forest: a soft leaf-green border and a mossy wash, so it
 * reads at a glance as wild by choice rather than waiting for a crew. Its kind
 * still shows on the plate.
 */
export const SPARED_STYLE = {
  label: 'Left to the forest',
  edge: '#9fdcb4',
  /** Fogged ground tint (2D palette; the 3D scene brightens it). */
  fog: '#1c3a26',
  art: 'trees' as IconId,
} as const

/** Fill for a glade polygon in either renderer. */
export function gladeFill(glade: Glade, palette: MapPalette): string {
  const look = gladeLook(glade)
  if (look === 'visible') return terrainColor(glade.terrain, palette)
  const base =
    look === 'fogged'
      ? glade.spared
        ? SPARED_STYLE.fog
        : GLADE_KIND_STYLE[glade.kind].fog
      : HIDDEN_FILL
  return palette === '3d' ? shade(base, 1.25) : base
}

/**
 * How the player can act on a fogged glade: out of reach, ready to be
 * cleared, already being cleared by a crew, or left to the forest (no crew
 * may clear it while the truce stands).
 */
export type GladeAccess = 'locked' | 'reachable' | 'clearing' | 'spared'

export function gladeAccess(run: RunState, glade: Glade): GladeAccess {
  if (glade.spared && !glade.cleared) return 'spared'
  if (glade.clearers > 0) return 'clearing'
  return isReachable(run, glade.id) ? 'reachable' : 'locked'
}

/** Clearing progress of a glade, 0..1. */
export function gladeProgress(glade: Glade): number {
  return glade.clearWork > 0 ? Math.min(1, glade.clearProgress / glade.clearWork) : 0
}

export interface GladePlateInfo {
  access: GladeAccess
  /** Clearing progress, 0..1. */
  pct: number
  clearers: number
  /** What the glade's waiting event could lead to (empty: no event). */
  stakes: GladeStake[]
}

/**
 * Everything on a fogged glade's name plate. A glade left to the forest
 * keeps its plate uncluttered: what clearing it could bring is moot while the
 * truce stands, so its stakes stay in the Inspector.
 */
export function gladePlateInfo(run: RunState, glade: Glade): GladePlateInfo {
  const access = gladeAccess(run, glade)
  return {
    access,
    pct: gladeProgress(glade),
    clearers: glade.clearers,
    stakes: access === 'spared' ? [] : gladeStakesOf(glade),
  }
}

/**
 * What a glade's waiting event could lead to, drawn as small icons beside its
 * plate (lives, a threat, a lingering task, reputation, a pact), so clearing
 * order is a choice made before the crew goes in.
 */
export const GLADE_STAKE_ART: Record<GladeStake, IconId> = {
  lives: 'grave',
  threat: 'threat/wolf',
  condition: 'condition/writ',
  reputation: 'reputation',
  pact: 'pact/handshake',
}

/**
 * How each stake reads on the map: a one-word label, a colour of its own (so
 * the lingering task's writ and the pact's handshake are told apart at a
 * glance, not only by their small shapes) and what it means (`means`, and
 * `hint` for a tooltip), for the plates and the Inspector.
 */
export const GLADE_STAKE_STYLE: Record<
  GladeStake,
  { label: string; color: string; means: string; hint: string }
> = {
  lives: stakeStyle('Lives', 'Lives', '#e7796d', 'a choice here can cost villagers.'),
  threat: stakeStyle('Threat', 'Threat', '#e8a050', 'a choice here can set a threat on the settlement.'),
  condition: stakeStyle(
    'Task',
    'Lingering task',
    '#7db4e6',
    'a choice here leaves a task that stays until it is dealt with.',
  ),
  reputation: stakeStyle('Reputation', 'Reputation', '#ecc75f', 'a choice here can bring reputation.'),
  pact: stakeStyle('Pact', 'Pact', '#bd92ea', 'a choice here makes a pact with an effect that lasts the run.'),
}

function stakeStyle(label: string, name: string, color: string, means: string) {
  return { label, color, means, hint: `${name}: ${means}` }
}

/** "Could bring: a threat or reputation" — the plate's tooltip for its stakes. */
export function gladeStakesTitle(stakes: readonly GladeStake[]): string {
  return stakes.length > 0 ? `Clearing it could bring ${describeStakes([...stakes])}` : ''
}

/** One-line status under a glade's name; `pct` is clearing progress, 0..1. */
export function gladeAccessText(access: GladeAccess, pct: number, clearers: number): string {
  if (access === 'spared') return SPARED_STYLE.label
  if (access === 'clearing') return `⛏ ${clearers} clearing · ${Math.floor(pct * 100)}%`
  if (access === 'reachable') return pct > 0 ? `Reachable · ${Math.floor(pct * 100)}%` : 'Reachable'
  return `🔒 Out of reach`
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

/**
 * What kind of building it is, as both maps draw it: the 2D plate's shape
 * and tint (`map2dArt.ts`) and the 3D model (`modelParts.ts`).
 */
export type District =
  | 'hearth'
  | 'fire'
  | 'housing'
  | 'camp'
  | 'farm'
  | 'industry'
  | 'service'
  | 'storage'

/** Which district a building belongs to, from its data (never its id). */
export function districtOf(def: BuildingDef): District {
  if (def.category === 'hearth') return 'hearth'
  if (def.warmth) return 'fire'
  if (def.category === 'housing') return 'housing'
  if (def.tags.includes('farming')) return 'farm'
  if (def.category === 'gathering') return 'camp'
  if (def.category === 'production') return 'industry'
  if (def.category === 'service') return 'service'
  return 'storage'
}

/**
 * What a building is doing, as a badge-sized kind. The rules live in one
 * place — the engine's `forecast.buildingStatus`, which mirrors
 * `stepProduction` (and also feeds the Inspector's status line); the map
 * only picks an icon and colour for each kind.
 */
export type MapBuildingStatus = EngineBuildingStatus['kind']

export interface StatusBadge {
  icon: string
  /** The drawn glyph (a white `mono/` icon); `icon` is the emoji fallback. */
  art: IconId
  label: string
  color: string
  /** Problems are shown at every zoom; good news only up close. */
  problem: boolean
}

export const STATUS_BADGE: Record<Exclude<MapBuildingStatus, 'none'>, StatusBadge> = {
  construction: { icon: '🔨', art: STATUS_BADGE_ART.construction, label: 'Under construction', color: '#d9b46a', problem: false },
  paused: { icon: '⏸', art: STATUS_BADGE_ART.paused, label: 'Paused', color: '#8a949a', problem: true },
  noWorkers: { icon: '👤', art: STATUS_BADGE_ART.noWorkers, label: 'No workers', color: '#e8a33c', problem: true },
  noDeposit: { icon: '🚫', art: STATUS_BADGE_ART.noDeposit, label: 'No deposit in reach', color: '#d05050', problem: true },
  offSeason: { icon: '🌧', art: STATUS_BADGE_ART.offSeason, label: 'Idle this season', color: '#5f8fd4', problem: true },
  waitingInputs: { icon: '⏳', art: STATUS_BADGE_ART.waitingInputs, label: 'Waiting for inputs', color: '#e07a3c', problem: true },
  storageFull: { icon: '📦', art: STATUS_BADGE_ART.storageFull, label: 'Storage full', color: '#d05050', problem: true },
  working: { icon: '⚙', art: STATUS_BADGE_ART.working, label: 'Working', color: '#6fbf72', problem: false },
}

/** Storm chill: a home beyond every fire, or a fire gone out. Both maps draw it beside the status badge. */
export const COLD_BADGE = { icon: '❄', art: STATUS_BADGE_ART.cold, color: '#5f8fd4' } as const

/**
 * Storm chill: finished housing standing outside every live warmth source.
 * Pass `sources` (from `warmthSources`) when checking many buildings at once.
 */
export function isColdHousing(
  run: RunState,
  b: BuildingInstance,
  sources?: WarmthSource[],
): boolean {
  if (run.season.season !== 'storm' || !b.built) return false
  if (housingOf(b) <= 0 || isInsulated(b)) return false
  if (!sources) return !isWarmAt(run, b.pos)
  return !sources.some((w) => dist(w.pos, b.pos) <= w.radius)
}

/**
 * The tier mark both maps draw beside an upgraded building: "★", "★★".
 * Empty at tier 0, so a fresh building carries no mark.
 */
export function tierMark(b: BuildingInstance): string {
  return '★'.repeat(tierOf(b))
}

/** Progress 0..1 of an upgrade under way, or null when none is. */
export function upgradeFraction(b: BuildingInstance): number | null {
  if (!isUpgrading(b)) return null
  const next = nextUpgrade(b)
  if (!next) return null
  return Math.min(1, (b.upgradeProgress ?? 0) / Math.max(1, next.buildSeconds))
}

/** A built warmth source (brazier) whose fire has gone out. */
export function isUnlitWarmthSource(b: BuildingInstance): boolean {
  return b.built && !!BUILDINGS[b.defId]?.warmth && !!b.unlit
}

// ---------------------------------------------------------------------------
// Warmth overlay
// ---------------------------------------------------------------------------

interface MapOverlayState {
  /** Player toggle: show every warmth source's radius at all times. */
  showWarmth: boolean
  toggleWarmth: () => void
}

/** View-only overlay toggles, shared by both renderers (not saved). */
export const useMapOverlays = create<MapOverlayState>((set, get) => ({
  showWarmth: false,
  toggleWarmth: () => set({ showWarmth: !get().showWarmth }),
}))

/**
 * Every fire's reach (`warmthSources`) shows while toggled on (R / 🔥),
 * while placing housing or a brazier, or while inspecting a fire or a home.
 */
export function showsWarmthRing(opts: {
  toggled: boolean
  buildMode: string | null
  selectedDefId: string | null
}): boolean {
  if (opts.toggled) return true
  const build = opts.buildMode ? BUILDINGS[opts.buildMode] : undefined
  if (build && ((build.housing ?? 0) > 0 || !!build.warmth)) return true
  const selected = opts.selectedDefId ? BUILDINGS[opts.selectedDefId] : undefined
  return (
    selected?.category === 'hearth' || selected?.category === 'housing' || !!selected?.warmth
  )
}

/** Store-subscribed form of `showsWarmthRing` for either renderer. */
export function useWarmthRingVisible(): boolean {
  const toggled = useMapOverlays((s) => s.showWarmth)
  const buildMode = useGameStore((s) => s.buildMode)
  const selectedDefId = useGameStore((s) => {
    const id = s.selectedBuilding
    return (id && s.run?.buildings[id]?.defId) || null
  })
  return showsWarmthRing({ toggled, buildMode, selectedDefId })
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** True when a key event belongs to a form field or an OS/browser shortcut. */
export function isMapKeyIgnored(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag && ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return true
  // Like every other hotkey, map keys wait while a modal dialog holds focus.
  if (typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]')) return true
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

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/** The world is moving: unpaused, playing, and not waiting on a choice. */
export function isWorldRunning(speed: number, run: RunState | null): boolean {
  return speed > 0 && run?.phase === 'playing' && run.pendingChoices.length === 0
}

/**
 * A value a map layer derives from the run, on the HUD clock: `derive(run,
 * version)` runs again only when `hudVersion` moves (about 8 Hz while the sim
 * runs, at once after every command) or another run is loaded. While the
 * returned key holds, the same value comes back and the layer does not
 * re-render, so per-building work stays off the per-step path. Null without
 * a run.
 */
export function useHudValue<T>(
  derive: (run: RunState, version: number) => { key: string; value: T },
): T | null {
  const memo = useRef<{ hud: number; run: RunState | null; key: string; value: T | null }>({
    hud: -1,
    run: null,
    key: '',
    value: null,
  })
  return useGameStore((s) => {
    const m = memo.current
    if (s.hudVersion === m.hud && s.run === m.run) return m.value
    m.hud = s.hudVersion
    m.run = s.run
    if (!s.run) {
      m.key = ''
      m.value = null
    } else {
      const next = derive(s.run, s.version)
      if (m.value === null || next.key !== m.key) {
        m.key = next.key
        m.value = next.value
      }
    }
    return m.value
  })
}
