import { create } from 'zustand'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { autoPauseNotice } from './autoPause'
import { earnedTitles } from './content/achievements'
import { dailyExpedition, utcDateKey } from './content/daily'
import { commissionOffer } from './content/commissions'
import { META_UPGRADES } from './content/meta'
import { defaultMeta, purchaseUpgrade } from './engine/meta'
import { settleRun, type RunSettlement } from './progression'
import {
  addClearer,
  assignWorker,
  demolishBuilding,
  placeBuilding,
  recallEveryone,
  reclaimGlade,
  removeClearer,
  removeWorker,
  rushConstruction,
  setRecipe,
  spareGlade,
  sootheQueen,
  dumpStock,
  togglePause,
  upgradeBuilding,
} from './engine/actions'
import { ROAD_MIN_LENGTH, type GameSpeed } from './engine/balance'
import { appeaseThreat } from './engine/threats'
import { redrawToward, rerollChoice, takeChoice } from './engine/drafts'
import { resolveGladeEvent } from './engine/glades'
import { buyArchitectPlans, grandPetition, retreatToCitadel } from './engine/levers'
import { takeOrderOffer } from './engine/orders'
import { randomSeed } from './engine/rng'
import { ROAD_TOOL, canStartRoad, placeRoad, removeRoad, roadAt, snapRoadPoint } from './engine/roads'
import type { LandChoice } from './engine/runModifiers'
import { unassign } from './engine/society'
import { buyOffer, buyRare, commissionShipment, sellResource, signAgreement } from './engine/trade'
import { advanceLoop, dropCarry, forgetRun, isQuietStep, resetLoopState } from './loop'
import {
  META_KEY,
  loadMeta,
  loadSettings,
  parseMeta,
  readRaw,
  saveMeta,
  saveSettings,
  type Settings,
  type WriteFailure,
} from './persistence'
import {
  SLOT_LABELS,
  deleteSlot,
  freeSlot,
  latestSlot,
  loadSlotChecked,
  saveToSlot,
  slotSavedAt,
  type SlotId,
} from './saveSlots'
import type { MetaState, ResourceId, RunState, ServiceNeed, SpeciesId, TradeAgreementId, Vec2 } from './types'

/**
 * The run factory and the map generator (with the Delaunay library) are only
 * needed to create a new run, so they are a chunk of their own, fetched the
 * first time a run is started or by `loadRunFactory` (the menu preloads it
 * in idle time). Once loaded, starting a run is synchronous again.
 */
type RunFactory = typeof import('./engine/createRun')
let runFactory: RunFactory | null = null
let runFactoryLoad: Promise<RunFactory> | null = null

/** Fetches the run factory; safe to call any number of times, retried after a failure. */
export function loadRunFactory(): Promise<RunFactory> {
  runFactoryLoad ??= import('./engine/createRun').then(
    (factory) => (runFactory = factory),
    (error: unknown) => {
      runFactoryLoad = null
      throw error
    },
  )
  return runFactoryLoad
}

/** Shown when the run factory cannot be fetched (offline before it was cached). */
export const RUN_FACTORY_FAILED_NOTICE =
  'Could not load the map generator. Check your connection and try again.'

// The game loop's clock (frame budget, carry, auto-pause watch, HUD
// throttle) lives in loop.ts; these stay part of the store's API.
export { HUD_INTERVAL_MS, MAX_FRAME_REAL_SECONDS, frameBudget } from './loop'

/**
 * When this tab last wrote the active slot (the slot index's `savedAt`), or
 * when the slot was loaded. A different stamp in the index means another tab
 * saved the same settlement since, and this one must not overwrite it.
 */
let slotStamp: { slot: SlotId; savedAt: number } | null = null

/** Remembers the active slot's stamp after this tab loads or writes it. */
function stampSlot(slot: SlotId | null): void {
  slotStamp = slot ? { slot, savedAt: slotSavedAt(slot) ?? 0 } : null
}

/** Shown (and kept up in the top bar) when another tab has saved this slot. */
export const SLOT_CONFLICT_MESSAGE =
  'Not saving: this settlement was saved from another tab since. Saving here would overwrite that progress.'

/** Longest an idle-time autosave may wait for the browser to be idle. */
export const IDLE_SAVE_TIMEOUT_MS = 2000

/** Cancels the pending idle-time autosave, if one is waiting. */
let cancelIdleSave: (() => void) | null = null

/**
 * Clears the loop's module-level state (carry, auto-pause snapshot, HUD
 * throttle, a pending idle save, the active slot's stamp), so one UI test's frames cannot leak into the
 * next. Tests only: `src/test/setup-ui.ts` calls it after each test.
 */
export function resetLoopStateForTests(): void {
  cancelIdleSave?.()
  cancelIdleSave = null
  slotStamp = null
  resetLoopState()
}

export type Screen =
  | 'menu'
  | 'setup'
  | 'game'
  | 'citadel'
  | 'saves'
  | 'achievements'
  | 'daily'
export type SidePanel = 'build' | 'villagers' | 'orders' | 'log' | 'trade' | null

interface GameStore {
  screen: Screen
  run: RunState | null
  /** The save slot the current run autosaves to. */
  activeSlot: SlotId | null
  meta: MetaState
  settings: Settings

  /** Bumped on every mutation so React re-renders against the mutable run. */
  version: number
  /**
   * The HUD clock: bumped with `version` by every command, but by the game
   * loop's sim steps at most every `HUD_INTERVAL_MS` (and at once on the
   * changes in `hudMark`). Components that show many live numbers render on
   * this rather than on every step.
   */
  hudVersion: number
  speed: GameSpeed
  /** Toast-style message for rejected actions. */
  notice: string | null
  /** True while a new run waits for the run factory's code to arrive. */
  creatingRun: boolean
  /**
   * Why the run is not being saved, while it is not: storage is full or
   * unavailable, or another tab saved the same slot. The top bar keeps it in
   * view until a save lands again. Null while saves are landing.
   */
  saveError: { message: string; reason: WriteFailure | 'conflict' } | null
  /**
   * Set when the game loop or a screen threw: the loop and the autosave stop,
   * so a half-ticked run is never written, and the recovery overlay offers a
   * way back. Null while all is well.
   */
  crash: string | null
  /** Bumped by each recovery, so the error boundary renders afresh. */
  recoveryEpoch: number

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
  /**
   * `edict` is clamped to the highest Queen's Edict the Citadel has earned.
   * Without a `slot` the run takes the first free one; with every slot full
   * it refuses rather than overwrite a run (the setup screen asks which).
   * Resolves once the run has started: at once when the run factory is
   * loaded, else after fetching it (`creatingRun` is true meanwhile).
   */
  startRun: (
    seed?: number,
    species?: SpeciesId[],
    edict?: number,
    land?: LandChoice,
    slot?: SlotId,
    /** A Citadel commission; ignored unless it is on the Citadel's current offer. */
    commission?: string,
  ) => Promise<void>
  /**
   * Sets out on today's (UTC) daily expedition: fixed map, trio and edict, no
   * Citadel upgrades. Takes a save slot the same way `startRun` does.
   */
  startDaily: (now?: number, slot?: SlotId) => Promise<void>
  abandonRun: () => void
  finishRun: () => void
  goToScreen: (screen: Screen) => void
  /** Loads a slot (the most recently played one by default) and plays it. */
  resumeSaved: (slot?: SlotId) => void
  /** Deletes a slot; deleting the slot being played drops that run too. */
  deleteSave: (slot: SlotId) => void
  /** Copies the current run into another slot; play continues in its own. */
  saveCopy: (slot: SlotId) => void
  /** Writes an already-validated imported run into a slot. Returns an error or null. */
  importRun: (run: RunState, slot: SlotId) => string | null

  // --- loop ----------------------------------------------------------------
  /**
   * Feeds `realSeconds` of real time to the sim. The game loop passes its
   * frame time as `now`, which throttles the HUD clock; without it (tests,
   * scripts) every step refreshes the HUD.
   */
  advance: (realSeconds: number, now?: number) => void
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
  /** Leaves an uncleared glade to the forest (it calms hostility while it stands). */
  spareGlade: (gladeId: string) => void
  /** Breaks the truce on a spared glade so it can be cleared (costs hostility). */
  reclaimGlade: (gladeId: string) => void
  /** Takes an option of the front choice, or of the queued choice at `index` (a founding pick). */
  chooseOption: (optionId: string, index?: number) => void
  chooseEventOption: (index: number) => void
  /** Redraws the front choice, or the queued choice at `index`. */
  reroll: (index?: number) => void
  /** Takes an order (or asks for a different pair) from the offer waiting in the Orders panel. */
  chooseOrder: (offerIndex: number, optionId: string) => void
  buyLot: (index: number) => void
  sell: (resource: ResourceId) => void
  /** Buys the caravan's rare blueprint or cornerstone. */
  buyRare: () => void
  /** Pays now for a lot of a good, delivered with the next caravan. */
  commissionShipment: (resource: ResourceId) => void
  /** Signs the run's one trade agreement. */
  signAgreement: (id: TradeAgreementId) => void
  /** Throws a lot of a good out of a full stockpile. */
  dump: (resource: ResourceId) => void
  appease: (threatId: string) => void
  rush: (buildingId: string) => void
  /** Starts raising a building to its next upgrade tier. */
  upgrade: (buildingId: string) => void
  soothe: () => void
  /** Buys the Queen's Architect's plans for a service (at the hearth). */
  buyPlans: (need: ServiceNeed) => void
  /** Redraws the open blueprint draft around a piece of `need`'s chain. */
  redrawToward: (need: ServiceNeed, index?: number) => void
  /** Makes the run's one Grand Petition. */
  petition: () => void
  /** Ends a lost run now with a Retreat to the Citadel. */
  retreat: () => void
  recallAll: () => void
  dismissNotice: () => void
  buyUpgrade: (id: string) => void
  /** Wears an earned achievement title on the menu, or none. */
  setTitle: (title: string | null) => void
  updateSettings: (patch: Partial<Settings>) => void
  /** Saves the run to its slot right away (choices, leaving the page). */
  saveNow: () => void
  /**
   * The autosave: saves when the browser is next idle (within
   * `IDLE_SAVE_TIMEOUT_MS`), so the storage write never lands inside a frame.
   */
  saveSoon: () => void
  /** Saves over a slot another tab wrote since, after the player says so. */
  saveOverConflict: () => void
  /** Re-reads the Citadel from storage (another tab may have changed it). */
  refreshMeta: () => MetaState
  /** Stops the loop and the autosave after an exception, and shows recovery. */
  reportCrash: (error: unknown) => void
  /** Leaves the crash: reloads the active slot's last good save, or goes to the menu. */
  recover: (how: 'reload' | 'menu') => void
}

/** The notice shown once a run is banked. */
function settlementNotice(settled: RunSettlement, unlockedEdict: boolean): string {
  const parts = [`Run banked: +${settled.runSupplies} Citadel supplies.`]
  if (unlockedEdict) parts.push("A harsher Queen's Edict is unlocked.")
  if (settled.achievements.length > 0) {
    const names = settled.achievements.map((a) => `${a.icon} ${a.name}`).join(', ')
    const bonus =
      settled.achievementSupplies > 0 ? ` (+${settled.achievementSupplies} supplies)` : ''
    parts.push(`Achievement${settled.achievements.length > 1 ? 's' : ''}: ${names}${bonus}.`)
  }
  return parts.join(' ')
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
  set({ ...bump(get), notice: error })
}

/** The counters a command bumps: the run changed and the HUD should say so now. */
function bump(get: () => GameStore): Pick<GameStore, 'version' | 'hudVersion'> {
  const { version, hudVersion } = get()
  return { version: version + 1, hudVersion: hudVersion + 1 }
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

/**
 * Runs `start` with the run factory: right away when it is loaded, else once
 * it arrives. A second start while one is waiting is ignored.
 */
function withRunFactory(
  set: (partial: Partial<GameStore>) => void,
  get: () => GameStore,
  start: (factory: RunFactory) => void,
): Promise<void> {
  if (runFactory) {
    start(runFactory)
    return Promise.resolve()
  }
  const waiting = get().creatingRun
  const load = loadRunFactory()
  if (waiting) return load.then(() => undefined)
  set({ creatingRun: true })
  return load.then(
    (factory) => {
      set({ creatingRun: false })
      start(factory)
    },
    () => set({ creatingRun: false, notice: RUN_FACTORY_FAILED_NOTICE }),
  )
}

/** Shown when a new run is refused because every save slot holds one. */
export const SLOTS_FULL_NOTICE =
  'Every save slot holds a settlement. Choose one to replace, or delete one first.'

/**
 * Starts a freshly created run in a save slot: the run being left is saved to
 * its own slot first, the run takes `slot` or the first free one, and with
 * every slot full nothing is overwritten (the player is sent to `fullScreen`
 * with a notice instead). Shared by a normal settlement and the daily.
 */
function beginRun(
  set: (partial: Partial<GameStore>) => void,
  get: () => GameStore,
  slot: SlotId | undefined,
  fullScreen: Screen,
  create: () => RunState,
): void {
  get().saveNow()
  const target = slot ?? freeSlot()
  if (!target) {
    set({
      screen: fullScreen,
      notice: SLOTS_FULL_NOTICE,
    })
    return
  }
  const run = create()
  const saved = saveToSlot(target, run)
  stampSlot(saved.ok ? target : null)
  set({
    run,
    activeSlot: target,
    screen: 'game',
    ...bump(get),
    speed: 1,
    buildMode: null,
    roadAnchor: null,
    roadErase: false,
    selectedBuilding: null,
    selectedDeposit: null,
    selectedGlade: null,
    panel: 'build',
    notice: saved.ok ? null : saved.message,
    saveError: saved.ok ? null : { message: saved.message, reason: saved.reason },
  })
}

/**
 * True while a dialog that takes the whole screen is up: a choice the player
 * must answer (the founding's picks are in a side panel, not a dialog), the
 * end-of-run summary, or the recovery overlay after a crash.
 */
export function blockingDialogOpen(state: Pick<GameStore, 'run' | 'crash' | 'screen'>): boolean {
  if (state.crash) return true
  const run = state.run
  if (!run || state.screen !== 'game') return false
  if (run.phase !== 'playing') return true
  const choice = run.pendingChoices[0]
  return Boolean(choice && !choice.founding)
}

/**
 * Writes the run to its slot and keeps `saveError` in step: the first failure
 * also shows a notice, and the top bar holds the reason until a save lands.
 */
function writeActiveSlot(
  set: (partial: Partial<GameStore>) => void,
  get: () => GameStore,
  slot: SlotId,
  run: RunState,
): void {
  const saved = saveToSlot(slot, run)
  const failing = get().saveError
  if (saved.ok) {
    stampSlot(slot)
    if (failing) set({ saveError: null })
  } else if (!failing || failing.reason === 'conflict') {
    set({ notice: saved.message, saveError: { message: saved.message, reason: saved.reason } })
  }
}

/**
 * The Citadel as this tab last read or wrote it in storage. Another tab's
 * write shows up as different text, and is taken up before this tab writes.
 */
let metaRaw: string | null = null

/** Writes the Citadel, remembering what storage now holds. */
function writeMeta(meta: MetaState): void {
  if (saveMeta(meta) === null) metaRaw = JSON.stringify(meta)
}

let watchingTabs = false

/**
 * Other tabs share this storage: when one changes the Citadel, this tab picks
 * the new state up at once rather than writing a stale copy over it later.
 */
function watchOtherTabs(): void {
  if (watchingTabs || typeof window === 'undefined') return
  watchingTabs = true
  window.addEventListener('storage', (e) => {
    if (e.key === META_KEY || e.key === null) useGameStore.getState().refreshMeta()
  })
}

export const useGameStore = create<GameStore>((set, get) => ({
  screen: 'menu',
  run: null,
  activeSlot: null,
  meta: defaultMeta(),
  settings: loadSettings(),
  version: 0,
  hudVersion: 0,
  speed: 1,
  notice: null,
  creatingRun: false,
  saveError: null,
  crash: null,
  recoveryEpoch: 0,
  buildMode: null,
  selectedBuilding: null,
  selectedDeposit: null,
  selectedGlade: null,
  panel: 'build',
  cameraFocus: null,
  roadAnchor: null,
  roadErase: false,

  boot: () => {
    metaRaw = readRaw(META_KEY)
    set({ meta: loadMeta(), settings: loadSettings() })
    watchOtherTabs()
  },

  startRun: (seed, species, edict, land, slot, commission) =>
    withRunFactory(set, get, ({ createRun }) => {
      const meta = get().refreshMeta()
      const offered = commission && commissionOffer(meta).includes(commission)
      beginRun(set, get, slot, 'setup', () =>
        createRun({
          seed: seed ?? randomSeed(),
          meta,
          species,
          edict: Math.min(edict ?? 0, meta.edictUnlocked),
          land,
          commission: offered ? commission : undefined,
        }),
      )
    }),

  startDaily: (now, slot) => {
    const day = dailyExpedition(utcDateKey(now ?? Date.now()))
    // No `meta`: the daily is the same fair challenge for every Citadel.
    return withRunFactory(set, get, ({ createRun }) =>
      beginRun(set, get, slot, 'daily', () =>
        createRun({
          seed: day.seed,
          species: day.species,
          edict: day.edict,
          daily: day.date,
        }),
      ),
    )
  },

  resumeSaved: (slot) => {
    const id = slot ?? latestSlot()
    if (id && id === get().activeSlot && get().run) {
      set({ screen: 'game', notice: null })
      return
    }
    const loaded = id ? loadSlotChecked(id) : null
    if (!id || !loaded || !loaded.ok) {
      set({
        notice:
          !id || !loaded || loaded.ok || loaded.missing
            ? 'No saved settlement found.'
            : `${SLOT_LABELS[id]} could not be loaded. ${loaded.error} Export it from Saved settlements, or delete it.`,
      })
      return
    }
    const run = loaded.run
    // The run being left behind is saved to its own slot first.
    get().saveNow()
    stampSlot(id)
    set({
      run,
      activeSlot: id,
      screen: 'game',
      ...bump(get),
      speed: 0,
      panel: 'build',
      buildMode: null,
      selectedBuilding: null,
      selectedDeposit: null,
      selectedGlade: null,
      notice: null,
      saveError: null,
    })
  },

  deleteSave: (slot) => {
    deleteSlot(slot)
    if (slot === get().activeSlot) {
      set({ run: null, activeSlot: null, speed: 0, saveError: null, ...bump(get) })
    }
    set({ ...bump(get), notice: `${SLOT_LABELS[slot]} deleted.` })
  },

  saveCopy: (slot) => {
    const { run, activeSlot } = get()
    if (!run || slot === activeSlot) return
    const saved = saveToSlot(slot, run)
    set({
      ...bump(get),
      notice: saved.ok ? `Copy saved to ${SLOT_LABELS[slot]}.` : saved.message,
    })
  },

  importRun: (run, slot) => {
    const saved = saveToSlot(slot, run)
    if (!saved.ok) {
      set({ notice: saved.message })
      return saved.message
    }
    // Importing over the slot being played replaces that run outright.
    if (slot === get().activeSlot) {
      set({ run: null, activeSlot: null, speed: 0, saveError: null })
    }
    set({ ...bump(get), notice: `Imported into ${SLOT_LABELS[slot]}.` })
    return null
  },

  abandonRun: () => {
    const slot = get().activeSlot
    if (slot) deleteSlot(slot)
    set({ run: null, activeSlot: null, screen: 'menu', speed: 0, saveError: null, ...bump(get) })
  },

  /**
   * Banks a finished run (supplies, the ledger, a daily's result and any
   * achievements) and returns to the Citadel, or to the daily page.
   */
  finishRun: () => {
    const run = get().run
    if (!run || run.phase === 'playing') return
    // Banked on top of the Citadel as storage holds it now, so progress made
    // in another tab since this one loaded is kept, not overwritten.
    const meta = get().refreshMeta()
    const settled = settleRun(meta, run)
    const next = settled.meta
    const unlockedEdict = next.edictUnlocked > meta.edictUnlocked
    writeMeta(next)
    // The banked run is over: its slot is free for the next settlement.
    const slot = get().activeSlot
    if (slot) deleteSlot(slot)
    set({
      meta: next,
      run: null,
      activeSlot: null,
      saveError: null,
      // A daily returns to its own page, where the result can be shared.
      screen: run.daily ? 'daily' : 'citadel',
      speed: 0,
      ...bump(get),
      notice: settlementNotice(settled, unlockedEdict),
    })
  },

  goToScreen: (screen) => set({ screen, notice: null }),

  // -------------------------------------------------------------------------
  // Simulation loop
  // -------------------------------------------------------------------------
  advance: (realSeconds, now) => {
    const { run, speed, settings, crash } = get()
    if (crash) return
    advanceLoop(run, speed, settings.autoPause, realSeconds, now, {
      pause: (hits) => set({ speed: 0, notice: autoPauseNotice(hits), ...bump(get) }),
      publish: (hud) => set(hud ? bump(get) : { version: get().version + 1 }),
    })
  },

  // Pausing or changing speed refreshes the HUD, so a paused game shows
  // exactly where it stopped.
  setSpeed: (speed) => set({ speed, hudVersion: get().hudVersion + 1 }),
  togglePlay: () => set({ speed: get().speed === 0 ? 1 : 0, hudVersion: get().hudVersion + 1 }),

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
  spareGlade: (gladeId) => runCommand(set, get, (run) => spareGlade(run, gladeId)),
  reclaimGlade: (gladeId) => runCommand(set, get, (run) => reclaimGlade(run, gladeId)),
  chooseOption: (optionId, index = 0) =>
    runCommand(set, get, (run) => {
      takeChoice(run, optionId, index)
      get().saveNow()
      return null
    }),
  chooseOrder: (offerIndex, optionId) =>
    runCommand(set, get, (run) => {
      takeOrderOffer(run, offerIndex, optionId)
      get().saveNow()
      return null
    }),
  chooseEventOption: (index) =>
    runCommand(set, get, (run) => {
      resolveGladeEvent(run, index)
      get().saveNow()
      return null
    }),
  reroll: (index = 0) => runCommand(set, get, (run) => rerollChoice(run, index)),
  buyLot: (index) => runCommand(set, get, (run) => buyOffer(run, index)),
  sell: (resource) => runCommand(set, get, (run) => sellResource(run, resource)),
  buyRare: () => runCommand(set, get, (run) => buyRare(run)),
  commissionShipment: (resource) => runCommand(set, get, (run) => commissionShipment(run, resource)),
  signAgreement: (id) => runCommand(set, get, (run) => signAgreement(run, id)),
  dump: (resource) => runCommand(set, get, (run) => dumpStock(run, resource)),
  appease: (threatId) => runCommand(set, get, (run) => appeaseThreat(run, threatId)),
  rush: (buildingId) => runCommand(set, get, (run) => rushConstruction(run, buildingId)),
  upgrade: (buildingId) => runCommand(set, get, (run) => upgradeBuilding(run, buildingId)),
  soothe: () => runCommand(set, get, (run) => sootheQueen(run)),
  buyPlans: (need) => runCommand(set, get, (run) => buyArchitectPlans(run, need)),
  redrawToward: (need, index = 0) => runCommand(set, get, (run) => redrawToward(run, need, index)),
  petition: () => runCommand(set, get, (run) => grandPetition(run)),
  retreat: () =>
    runCommand(set, get, (run) => {
      const error = retreatToCitadel(run)
      if (!error) get().saveNow()
      return error
    }),
  recallAll: () =>
    runCommand(set, get, (run) => {
      recallEveryone(run)
      return null
    }),

  dismissNotice: () => set({ notice: null }),

  buyUpgrade: (id) => {
    const def = META_UPGRADES[id]
    if (!def) return
    const result = purchaseUpgrade(get().refreshMeta(), id)
    if (!result.meta) {
      set({ notice: result.error })
      return
    }
    writeMeta(result.meta)
    set({ meta: result.meta, notice: `${def.name} unlocked.` })
  },

  setTitle: (title) => {
    const meta = get().refreshMeta()
    if (title !== null && !earnedTitles(meta.achievements).includes(title)) return
    const next = { ...meta, title }
    writeMeta(next)
    set({ meta: next })
  },

  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch }
    saveSettings(settings)
    set({ settings })
  },

  saveNow: () => {
    // Anything waiting for idle time is covered by this save.
    cancelIdleSave?.()
    cancelIdleSave = null
    const { run, crash, saveError } = get()
    // After a crash the run may be half-ticked: the last good save stays.
    if (!run || crash) return
    // Another tab saved this settlement: stay out of its way until told.
    if (saveError?.reason === 'conflict') return
    let slot = get().activeSlot
    if (!slot) {
      // A run that never had a slot (set up directly) claims a free one.
      slot = freeSlot()
      if (!slot) return
      set({ activeSlot: slot })
      stampSlot(null)
    }
    if (slotStamp?.slot === slot && slotStamp.savedAt !== (slotSavedAt(slot) ?? 0)) {
      set({ saveError: { message: SLOT_CONFLICT_MESSAGE, reason: 'conflict' }, notice: SLOT_CONFLICT_MESSAGE })
      return
    }
    writeActiveSlot(set, get, slot, run)
  },

  saveOverConflict: () => {
    const { run, activeSlot } = get()
    if (!run || !activeSlot || get().crash) return
    writeActiveSlot(set, get, activeSlot, run)
  },

  refreshMeta: () => {
    const raw = readRaw(META_KEY)
    // Unchanged since this tab last read or wrote it: what is in memory is
    // current (and may hold progress a full disk refused to store).
    if (raw === null || raw === metaRaw) return get().meta
    metaRaw = raw
    const meta = parseMeta(raw)
    set({ meta })
    return meta
  },

  reportCrash: (error) => {
    if (get().crash) return
    console.error('Emberwatch stopped after an error:', error)
    cancelIdleSave?.()
    cancelIdleSave = null
    dropCarry()
    const message = error instanceof Error ? error.message : String(error)
    set({ crash: message || 'Unknown error', speed: 0 })
  },

  recover: (how) => {
    const { activeSlot, recoveryEpoch } = get()
    const cleared = {
      crash: null,
      recoveryEpoch: recoveryEpoch + 1,
      speed: 0 as GameSpeed,
      buildMode: null,
      roadAnchor: null,
      selectedBuilding: null,
      selectedDeposit: null,
      selectedGlade: null,
      saveError: null,
    }
    forgetRun()
    const loaded = how === 'reload' && activeSlot ? loadSlotChecked(activeSlot) : null
    if (loaded?.ok) {
      stampSlot(activeSlot)
      set({ ...cleared, run: loaded.run, screen: 'game', ...bump(get), notice: 'Reloaded the last good save.' })
      return
    }
    // The slot keeps its last good save; this tab just stops playing it.
    stampSlot(null)
    set({
      ...cleared,
      run: null,
      activeSlot: null,
      screen: 'menu',
      ...bump(get),
      notice: how === 'reload' ? 'There was no good save to reload.' : null,
    })
  },

  saveSoon: () => {
    if (cancelIdleSave || !get().run || get().crash) return
    const save = () => {
      cancelIdleSave = null
      get().saveNow()
    }
    if (typeof requestIdleCallback === 'function') {
      const handle = requestIdleCallback(save, { timeout: IDLE_SAVE_TIMEOUT_MS })
      cancelIdleSave = () => cancelIdleCallback(handle)
    } else {
      const handle = setTimeout(save, 0)
      cancelIdleSave = () => clearTimeout(handle)
    }
  },
}))

/*
 * Every other `version` bump ticks the HUD clock too, so code (and tests) that
 * change the run and bump only `version` still refresh the whole HUD.
 */
useGameStore.subscribe((s, prev) => {
  if (!isQuietStep() && s.version !== prev.version && s.hudVersion === prev.hudVersion) {
    useGameStore.setState({ hudVersion: s.hudVersion + 1 })
  }
})

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------
/*
 * The run is one mutable object; `version` says it moved on (every sim step,
 * up to 64 a frame at 5x) and `hudVersion` is the same news at about 8 Hz.
 * Pick the narrowest subscription that shows what a component shows:
 *
 * - `useRunSelector(select, equal?)`: re-renders only when `select(run)`
 *   changes (`Object.is`, or pass `shallowEqual` for arrays and flat
 *   objects). The selector runs on every store change, so keep it cheap and
 *   return primitives or stable values (a key string, a count, a flag).
 * - `useHudRun()`: the run, re-rendering on the HUD clock. For panels full of
 *   live numbers (the top bar, the stockpile, the inspector).
 * - `useFrameDerived()` (in `frameDerived.ts`, which the startup bundle does
 *   not need): the shared per-step derivations (modifiers, storage use and
 *   blocked producers, the food forecast, the warnings, the top bar's
 *   meters, building statuses), on the HUD clock. Use `frameDerived(run,
 *   version)` or `currentFrameDerived()` outside React; one computation per
 *   version is shared by every caller.
 * - `useRunRef()`: the run object only; re-renders when a run starts, ends or
 *   is loaded. Pair it with a selector or read the run in handlers.
 * - `subscribeHud(fn)` / `subscribeSteps(fn)`: call `fn(run)` outside React
 *   on each HUD tick / each sim step (toasts, sound cues, imperative
 *   drawing). Returns the unsubscribe function.
 */

/** The current run object; re-renders only when a different run is loaded. */
export function useRunRef(): RunState | null {
  return useGameStore((s) => s.run)
}

/** The HUD clock (see `hudVersion`). */
export function useHudVersion(): number {
  return useGameStore((s) => s.hudVersion)
}

/** The run, re-rendering on the HUD clock rather than every sim step. */
export function useHudRun(): RunState | null {
  useGameStore((s) => s.hudVersion)
  return useGameStore((s) => s.run)
}

/** Equality for arrays and flat objects (same length/keys, `Object.is` values). */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false
    }
  }
  return true
}

/**
 * `select(run)`, re-rendering only when it changes by `equal`. Undefined while
 * no run is loaded.
 */
export function useRunSelector<T>(
  select: (run: RunState) => T,
  equal: (a: T | undefined, b: T | undefined) => boolean = Object.is,
): T | undefined {
  return useStoreWithEqualityFn(
    useGameStore,
    (s) => (s.run ? select(s.run) : undefined),
    equal,
  )
}

/** Calls `fn(run)` on every HUD tick (and when a run is loaded). */
export function subscribeHud(fn: (run: RunState) => void): () => void {
  return useGameStore.subscribe((s, prev) => {
    if (s.run && (s.hudVersion !== prev.hudVersion || s.run !== prev.run)) callSafely(fn, s.run)
  })
}

/**
 * Listeners run inside the store's `set`, so one that throws (a sound that
 * cannot play, a toast) would abort the command or sim step that published
 * the change. They are presentation only: log the failure and carry on.
 */
function callSafely(fn: (run: RunState) => void, run: RunState): void {
  try {
    fn(run)
  } catch (error) {
    console.error('A HUD listener failed:', error)
  }
}

/** Calls `fn(run)` after every sim step or command (and when a run is loaded). */
export function subscribeSteps(fn: (run: RunState) => void): () => void {
  return useGameStore.subscribe((s, prev) => {
    if (s.run && (s.version !== prev.version || s.run !== prev.run)) callSafely(fn, s.run)
  })
}
