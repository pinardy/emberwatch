import { create } from 'zustand'
import {
  autoPauseHits,
  autoPauseNotice,
  watchRun,
  type AutoPauseHit,
  type RunWatch,
} from './autoPause'
import {
  META_UPGRADES,
  bankRun,
  defaultMeta,
  purchaseUpgrade,
  supplyReward,
} from './content/meta'
import {
  addClearer,
  assignWorker,
  demolishBuilding,
  placeBuilding,
  recallEveryone,
  removeClearer,
  removeWorker,
  rushConstruction,
  setRecipe,
  sootheQueen,
  togglePause,
  upgradeBuilding,
} from './engine/actions'
import { ROAD_MIN_LENGTH, TICK_SECONDS, type GameSpeed } from './engine/balance'
import { createRun } from './engine/createRun'
import {
  appeaseThreat,
  rerollChoice,
  resolveGladeEvent,
  takeChoice,
} from './engine/events'
import { randomSeed } from './engine/rng'
import { ROAD_TOOL, canStartRoad, placeRoad, removeRoad, roadAt, snapRoadPoint } from './engine/roads'
import { unassign } from './engine/society'
import { tick } from './engine/tick'
import { buyOffer, sellResource } from './engine/trade'
import {
  loadMeta,
  loadRun,
  loadSettings,
  saveMeta,
  saveRun,
  saveSettings,
  type Settings,
} from './persistence'
import type { MetaState, ResourceId, RunState, SpeciesId, Vec2 } from './types'

/** Most simulated seconds a single frame may consume. */
const MAX_FRAME_BUDGET = 2
const MAX_STEPS_PER_FRAME = 64

/**
 * Simulated seconds owed to the world but not yet ticked. Lives outside the
 * store because it changes every frame and nothing renders from it.
 */
let simCarry = 0

/**
 * What the auto-pause triggers last saw of the run, to compare against after
 * the next step. Keyed by the run object, so a new or resumed run starts fresh.
 */
let watched: { run: RunState; snapshot: RunWatch } | null = null

export type Screen = 'menu' | 'setup' | 'game' | 'citadel'
export type SidePanel = 'build' | 'villagers' | 'orders' | 'log' | 'trade' | null

interface GameStore {
  screen: Screen
  run: RunState | null
  meta: MetaState
  settings: Settings

  /** Bumped on every mutation so React re-renders against the mutable run. */
  version: number
  speed: GameSpeed
  /** Toast-style message for rejected actions. */
  notice: string | null

  // --- UI selection --------------------------------------------------------
  buildMode: string | null
  selectedBuilding: string | null
  selectedDeposit: string | null
  selectedGlade: string | null
  panel: SidePanel
  /** One-shot request for the map to fly its camera here; the view clears it. */
  cameraFocus: Vec2 | null
  /**
   * Road tool (`buildMode === ROAD_TOOL`): the last point of the road being
   * laid, so the next click lays a stretch from here. Null before the first.
   */
  roadAnchor: Vec2 | null
  /** Road tool: clicks lift roads instead of laying them. */
  roadErase: boolean

  // --- lifecycle -----------------------------------------------------------
  boot: () => void
  /** `edict` is clamped to the highest Queen's Edict the Citadel has earned. */
  startRun: (seed?: number, species?: SpeciesId[], edict?: number) => void
  abandonRun: () => void
  finishRun: () => void
  goToScreen: (screen: Screen) => void
  resumeSaved: () => void

  // --- loop ----------------------------------------------------------------
  advance: (realSeconds: number) => void
  setSpeed: (speed: GameSpeed) => void
  togglePlay: () => void

  // --- commands ------------------------------------------------------------
  setBuildMode: (defId: string | null) => void
  /** Road tool: switch between laying and lifting roads. */
  setRoadErase: (erase: boolean) => void
  /** Road tool: finish the road being laid; the next click starts a new one. */
  endRoad: () => void
  /**
   * Esc / right-click while building: ends the road being laid if there is
   * one, otherwise puts the blueprint (or the road tool) away.
   */
  cancelBuildStep: () => void
  selectBuilding: (buildingId: string | null) => void
  selectDeposit: (depositId: string | null) => void
  selectGlade: (gladeId: string | null) => void
  clearSelection: () => void
  focusCamera: (pos: Vec2) => void
  setPanel: (panel: SidePanel) => void
  place: (pos: Vec2) => void
  demolish: (buildingId: string) => void
  hire: (buildingId: string, villagerId?: string) => void
  fire: (buildingId: string, villagerId?: string) => void
  /** Sends one specific villager back to idle, whatever they were doing. */
  release: (villagerId: string) => void
  chooseRecipe: (buildingId: string, recipeId: string) => void
  pauseBuilding: (buildingId: string) => void
  clearGladeAdd: (gladeId: string) => void
  clearGladeRemove: (gladeId: string) => void
  chooseOption: (optionId: string) => void
  chooseEventOption: (index: number) => void
  reroll: () => void
  buyLot: (index: number) => void
  sell: (resource: ResourceId) => void
  appease: (threatId: string) => void
  rush: (buildingId: string) => void
  /** Starts raising a building to its next upgrade tier. */
  upgrade: (buildingId: string) => void
  soothe: () => void
  recallAll: () => void
  dismissNotice: () => void
  buyUpgrade: (id: string) => void
  updateSettings: (patch: Partial<Settings>) => void
  saveNow: () => void
}

/** Wraps a command that returns an error string, surfacing it as a notice. */
function runCommand(
  set: (partial: Partial<GameStore>) => void,
  get: () => GameStore,
  fn: (run: RunState) => string | null | void,
): void {
  const run = get().run
  if (!run) return
  const error = fn(run) ?? null
  set({ version: get().version + 1, notice: error })
}

/**
 * One click of the road tool: lift the road under it (erase mode), start a
 * road, or lay the stretch from the last point to this one and carry on from
 * here. Clicks snap onto road ends, buildings and roadsides so roads join.
 */
function layRoadPoint(
  set: (partial: Partial<GameStore>) => void,
  get: () => GameStore,
  pos: Vec2,
): void {
  const { run, roadAnchor, roadErase } = get()
  if (!run) return
  if (roadErase) {
    const road = roadAt(run, pos)
    runCommand(set, get, (r) => (road ? removeRoad(r, road.id) : 'No road there.'))
    return
  }
  const snap = snapRoadPoint(run, pos).pos
  // Clicking the last point again finishes the road, like a double-click.
  if (roadAnchor && Math.hypot(snap.x - roadAnchor.x, snap.y - roadAnchor.y) < ROAD_MIN_LENGTH) {
    set({ roadAnchor: null, notice: null })
    return
  }
  if (!roadAnchor) {
    const error = canStartRoad(run, snap)
    set({ notice: error, roadAnchor: error ? null : snap })
    return
  }
  let laid = false
  runCommand(set, get, (r) => {
    const error = placeRoad(r, roadAnchor, snap)
    laid = error === null
    return error
  })
  if (laid) set({ roadAnchor: snap })
}

export const useGameStore = create<GameStore>((set, get) => ({
  screen: 'menu',
  run: null,
  meta: defaultMeta(),
  settings: loadSettings(),
  version: 0,
  speed: 1,
  notice: null,
  buildMode: null,
  selectedBuilding: null,
  selectedDeposit: null,
  selectedGlade: null,
  panel: 'build',
  cameraFocus: null,
  roadAnchor: null,
  roadErase: false,

  boot: () => {
    set({ meta: loadMeta(), settings: loadSettings() })
  },

  startRun: (seed, species, edict) => {
    const meta = get().meta
    const run = createRun({
      seed: seed ?? randomSeed(),
      meta,
      species,
      edict: Math.min(edict ?? 0, meta.edictUnlocked),
    })
    saveRun(run)
    set({
      run,
      screen: 'game',
      version: get().version + 1,
      speed: 1,
      buildMode: null,
      roadAnchor: null,
      roadErase: false,
      selectedBuilding: null,
      selectedDeposit: null,
      selectedGlade: null,
      panel: 'build',
      notice: null,
    })
  },

  resumeSaved: () => {
    const run = loadRun()
    if (!run) {
      set({ notice: 'No saved settlement found.' })
      return
    }
    set({ run, screen: 'game', version: get().version + 1, speed: 0, panel: 'build' })
  },

  abandonRun: () => {
    saveRun(null)
    set({ run: null, screen: 'menu', speed: 0, version: get().version + 1 })
  },

  /** Banks the reward for a finished run and returns to the Citadel. */
  finishRun: () => {
    const { run, meta } = get()
    if (!run || run.phase === 'playing') return
    const reward = supplyReward(run)
    const next = bankRun(meta, run)
    const unlockedEdict = next.edictUnlocked > meta.edictUnlocked
    saveMeta(next)
    saveRun(null)
    set({
      meta: next,
      run: null,
      screen: 'citadel',
      speed: 0,
      version: get().version + 1,
      notice: unlockedEdict
        ? `Run banked: +${reward} Citadel supplies. A harsher Queen's Edict is unlocked.`
        : `Run banked: +${reward} Citadel supplies.`,
    })
  },

  goToScreen: (screen) => set({ screen, notice: null }),

  // -------------------------------------------------------------------------
  // Simulation loop
  // -------------------------------------------------------------------------
  advance: (realSeconds) => {
    const { run, speed, settings } = get()
    const watching = Object.values(settings.autoPause).some(Boolean)
    const autoPause = (hits: AutoPauseHit[]) => {
      simCarry = 0
      set({ speed: 0, notice: autoPauseNotice(hits), version: get().version + 1 })
    }
    if (!run || speed === 0 || run.phase !== 'playing' || run.pendingChoices.length > 0) {
      // Nothing is running, so nothing may carry into the next frame.
      simCarry = 0
      // Whatever happens while the player has paused (a choice answered, a
      // trigger switched on) is not news when they resume. A choice that
      // halts a running game is different: if answering it unleashes a
      // threat, that should still pause once the world moves again.
      if (run && watching && (speed === 0 || run.phase !== 'playing')) {
        watched = { run, snapshot: watchRun(run) }
      }
      return
    }

    let before: RunWatch | null = null
    if (watching) {
      before = watched?.run === run ? watched.snapshot : watchRun(run)
      // Transitions since the last frame — e.g. a threat from a choice.
      const now = watchRun(run)
      const hits = autoPauseHits(before, now, run, settings.autoPause)
      watched = { run, snapshot: now }
      if (hits.length > 0) {
        autoPause(hits)
        return
      }
      before = now
    } else {
      watched = null
    }

    /*
     * A frame at 60 Hz is ~0.017 s, far shorter than one fixed tick, so the
     * unspent remainder carries into the next frame. Without the carry no
     * frame ever reaches a whole tick and the world stands still on any
     * display faster than 8 fps. The clamp stops a backgrounded tab from
     * fast-forwarding on return.
     */
    simCarry = Math.min(simCarry + realSeconds * speed, MAX_FRAME_BUDGET)
    let steps = 0
    while (simCarry >= TICK_SECONDS && steps < MAX_STEPS_PER_FRAME) {
      tick(run, TICK_SECONDS)
      simCarry -= TICK_SECONDS
      steps++
      if (before) {
        // Checked every tick, so a pause lands on the moment, not a frame late.
        const now = watchRun(run)
        const hits = autoPauseHits(before, now, run, settings.autoPause)
        before = now
        watched = { run, snapshot: now }
        if (hits.length > 0) {
          autoPause(hits)
          return
        }
      }
      if (run.phase !== 'playing' || run.pendingChoices.length > 0) {
        simCarry = 0
        break
      }
    }
    if (steps === 0) return
    set({ version: get().version + 1 })
  },

  setSpeed: (speed) => set({ speed }),
  togglePlay: () => set({ speed: get().speed === 0 ? 1 : 0 }),

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------
  setBuildMode: (defId) =>
    set({
      buildMode: defId,
      selectedBuilding: null,
      selectedDeposit: null,
      notice: null,
      roadAnchor: null,
      roadErase: false,
    }),
  setRoadErase: (erase) => set({ roadErase: erase, roadAnchor: null, notice: null }),
  endRoad: () => set({ roadAnchor: null }),
  cancelBuildStep: () => {
    const { buildMode, roadAnchor } = get()
    if (buildMode === ROAD_TOOL && roadAnchor) set({ roadAnchor: null })
    else get().setBuildMode(null)
  },

  selectBuilding: (buildingId) =>
    set({ selectedBuilding: buildingId, selectedDeposit: null, selectedGlade: null }),
  selectDeposit: (depositId) =>
    set({ selectedDeposit: depositId, selectedBuilding: null, selectedGlade: null }),
  selectGlade: (gladeId) =>
    set({ selectedGlade: gladeId, selectedBuilding: null, selectedDeposit: null }),
  clearSelection: () =>
    set({ selectedBuilding: null, selectedDeposit: null, selectedGlade: null }),
  focusCamera: (pos) => set({ cameraFocus: { x: pos.x, y: pos.y } }),
  setPanel: (panel) => set({ panel }),

  // Build mode stays active after a successful placement, so camps and
  // shelters can be laid down in quick succession, RTS-style.
  place: (pos) => {
    const defId = get().buildMode
    if (!defId) return
    if (defId === ROAD_TOOL) {
      layRoadPoint(set, get, pos)
      return
    }
    runCommand(set, get, (run) => placeBuilding(run, defId, pos))
  },

  demolish: (buildingId) =>
    runCommand(set, get, (run) => demolishBuilding(run, buildingId)),
  hire: (buildingId, villagerId) =>
    runCommand(set, get, (run) => assignWorker(run, buildingId, villagerId)),
  fire: (buildingId, villagerId) =>
    runCommand(set, get, (run) => removeWorker(run, buildingId, villagerId)),
  release: (villagerId) =>
    runCommand(set, get, (run) => {
      if (!run.villagers[villagerId]) return 'No such villager.'
      unassign(run, villagerId)
      return null
    }),
  chooseRecipe: (buildingId, recipeId) =>
    runCommand(set, get, (run) => setRecipe(run, buildingId, recipeId)),
  pauseBuilding: (buildingId) =>
    runCommand(set, get, (run) => togglePause(run, buildingId)),
  clearGladeAdd: (gladeId) => runCommand(set, get, (run) => addClearer(run, gladeId)),
  clearGladeRemove: (gladeId) =>
    runCommand(set, get, (run) => removeClearer(run, gladeId)),
  chooseOption: (optionId) =>
    runCommand(set, get, (run) => {
      takeChoice(run, optionId)
      saveRun(run)
      return null
    }),
  chooseEventOption: (index) =>
    runCommand(set, get, (run) => {
      resolveGladeEvent(run, index)
      saveRun(run)
      return null
    }),
  reroll: () => runCommand(set, get, (run) => rerollChoice(run)),
  buyLot: (index) => runCommand(set, get, (run) => buyOffer(run, index)),
  sell: (resource) => runCommand(set, get, (run) => sellResource(run, resource)),
  appease: (threatId) => runCommand(set, get, (run) => appeaseThreat(run, threatId)),
  rush: (buildingId) => runCommand(set, get, (run) => rushConstruction(run, buildingId)),
  upgrade: (buildingId) => runCommand(set, get, (run) => upgradeBuilding(run, buildingId)),
  soothe: () => runCommand(set, get, (run) => sootheQueen(run)),
  recallAll: () =>
    runCommand(set, get, (run) => {
      recallEveryone(run)
      return null
    }),

  dismissNotice: () => set({ notice: null }),

  buyUpgrade: (id) => {
    const def = META_UPGRADES[id]
    if (!def) return
    const result = purchaseUpgrade(get().meta, id)
    if (!result.meta) {
      set({ notice: result.error })
      return
    }
    saveMeta(result.meta)
    set({ meta: result.meta, notice: `${def.name} unlocked.` })
  },

  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch }
    saveSettings(settings)
    set({ settings })
  },

  saveNow: () => {
    const run = get().run
    if (run) saveRun(run)
  },
}))

/**
 * Subscribes to the mutation counter and returns the (stable) run object.
 * Components can then read the run directly and derive whatever they need.
 */
export function useRun(): RunState | null {
  useGameStore((s) => s.version)
  return useGameStore((s) => s.run)
}
