import { create } from 'zustand'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import {
  autoPauseHits,
  autoPauseNotice,
  watchRun,
  type AutoPauseHit,
  type RunWatch,
} from './autoPause'
import { earnedTitles } from './content/achievements'
import { dailyExpedition, utcDateKey } from './content/daily'
import { commissionOffer } from './content/commissions'
import { META_UPGRADES, defaultMeta, purchaseUpgrade } from './content/meta'
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
import { ROAD_MIN_LENGTH, SPEED_OPTIONS, TICK_SECONDS, type GameSpeed } from './engine/balance'
import {
  appeaseThreat,
  redrawToward,
  rerollChoice,
  resolveGladeEvent,
  takeChoice,
} from './engine/events'
import { buyArchitectPlans, grandPetition, retreatToCitadel } from './engine/levers'
import { takeOrderOffer } from './engine/orders'
import { randomSeed } from './engine/rng'
import { ROAD_TOOL, canStartRoad, placeRoad, removeRoad, roadAt, snapRoadPoint } from './engine/roads'
import type { LandChoice } from './engine/runModifiers'
import { unassign } from './engine/society'
import { tick } from './engine/tick'
import { buyOffer, buyRare, commissionShipment, sellResource, signAgreement } from './engine/trade'
import {
  loadMeta,
  loadSettings,
  saveMeta,
  saveSettings,
  type Settings,
} from './persistence'
import {
  SLOT_LABELS,
  deleteSlot,
  freeSlot,
  latestSlot,
  loadSlot,
  saveToSlot,
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

/** Fewest simulated seconds a single frame may consume, at any speed. */
const MAX_FRAME_BUDGET = 2
const MAX_STEPS_PER_FRAME = 64
/**
 * Longest real frame the loop feeds the sim; mirrors the clamp in
 * `useGameLoop`, so anything longer is a backgrounded or frozen tab.
 */
export const MAX_FRAME_REAL_SECONDS = 0.5

/**
 * Most simulated seconds one frame may owe. It scales with speed so a slow
 * device at 5× (a frame of up to half a second) still gets all its time,
 * with one tick of headroom for the carry, while a tab returning from the
 * background still cannot fast-forward more than one long frame's worth.
 */
export function frameBudget(speed: number): number {
  return Math.max(MAX_FRAME_BUDGET, speed * MAX_FRAME_REAL_SECONDS + TICK_SECONDS)
}

// The step cap must never be what slows the top speed down.
if (MAX_STEPS_PER_FRAME * TICK_SECONDS < frameBudget(Math.max(...SPEED_OPTIONS))) {
  throw new Error('MAX_STEPS_PER_FRAME cannot cover a full frame at top speed')
}

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

/**
 * Whether the last save failed, so a full disk is reported once rather than
 * every autosave, and again only after a save has worked in between.
 */
let saveFailing = false

/**
 * Real milliseconds between HUD refreshes while the game loop runs: the HUD
 * clock (`hudVersion`) ticks at about 8 Hz however fast the sim steps.
 */
export const HUD_INTERVAL_MS = 125

/** Longest an idle-time autosave may wait for the browser to be idle. */
export const IDLE_SAVE_TIMEOUT_MS = 2000

/** Cancels the pending idle-time autosave, if one is waiting. */
let cancelIdleSave: (() => void) | null = null

/** `performance.now()` of the game loop's last HUD refresh. */
let lastHudFrame = Number.NEGATIVE_INFINITY

/** True while `advance` publishes a sim step that leaves the HUD clock alone. */
let quietStep = false

/**
 * The things that refresh the HUD at once when a sim step changes them,
 * rather than at the next HUD tick: a season turning, the run ending, a
 * choice or a threat appearing, a building finishing, a new log line.
 */
function hudMark(run: RunState): string {
  return `${run.season.season}|${run.season.year}|${run.phase}|${run.pendingChoices.length}|${run.threats.length}|${run.stats.buildingsBuilt}|${run.log[0]?.id ?? -1}`
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
  saveFailing = false
  const saved = saveToSlot(target, run)
  if (!saved.ok) saveFailing = true
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

  startRun: (seed, species, edict, land, slot, commission) =>
    withRunFactory(set, get, ({ createRun }) => {
      const meta = get().meta
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
    const run = id ? loadSlot(id) : null
    if (!id || !run) {
      set({ notice: 'No saved settlement found.' })
      return
    }
    // The run being left behind is saved to its own slot first.
    get().saveNow()
    saveFailing = false
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
    })
  },

  deleteSave: (slot) => {
    deleteSlot(slot)
    if (slot === get().activeSlot) {
      set({ run: null, activeSlot: null, speed: 0, ...bump(get) })
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
      set({ run: null, activeSlot: null, speed: 0 })
    }
    set({ ...bump(get), notice: `Imported into ${SLOT_LABELS[slot]}.` })
    return null
  },

  abandonRun: () => {
    const slot = get().activeSlot
    if (slot) deleteSlot(slot)
    set({ run: null, activeSlot: null, screen: 'menu', speed: 0, ...bump(get) })
  },

  /**
   * Banks a finished run (supplies, the ledger, a daily's result and any
   * achievements) and returns to the Citadel, or to the daily page.
   */
  finishRun: () => {
    const { run, meta } = get()
    if (!run || run.phase === 'playing') return
    const settled = settleRun(meta, run)
    const next = settled.meta
    const unlockedEdict = next.edictUnlocked > meta.edictUnlocked
    saveMeta(next)
    // The banked run is over: its slot is free for the next settlement.
    const slot = get().activeSlot
    if (slot) deleteSlot(slot)
    set({
      meta: next,
      run: null,
      activeSlot: null,
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
    const { run, speed, settings } = get()
    const watching = Object.values(settings.autoPause).some(Boolean)
    const autoPause = (hits: AutoPauseHit[]) => {
      simCarry = 0
      set({ speed: 0, notice: autoPauseNotice(hits), ...bump(get) })
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
     * fast-forwarding on return; it grows with speed (see `frameBudget`) so a
     * low frame rate at 4× or 5× is not silently slowed to the 1× budget.
     */
    simCarry = Math.min(simCarry + realSeconds * speed, frameBudget(speed))
    const mark = simCarry >= TICK_SECONDS ? hudMark(run) : ''
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
    if (now === undefined || now - lastHudFrame >= HUD_INTERVAL_MS || hudMark(run) !== mark) {
      if (now !== undefined) lastHudFrame = now
      set(bump(get))
    } else {
      quietStep = true
      try {
        set({ version: get().version + 1 })
      } finally {
        quietStep = false
      }
    }
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
    const result = purchaseUpgrade(get().meta, id)
    if (!result.meta) {
      set({ notice: result.error })
      return
    }
    saveMeta(result.meta)
    set({ meta: result.meta, notice: `${def.name} unlocked.` })
  },

  setTitle: (title) => {
    const meta = get().meta
    if (title !== null && !earnedTitles(meta.achievements).includes(title)) return
    const next = { ...meta, title }
    saveMeta(next)
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
    const run = get().run
    if (!run) return
    let slot = get().activeSlot
    if (!slot) {
      // A run that never had a slot (set up directly) claims a free one.
      slot = freeSlot()
      if (!slot) return
      set({ activeSlot: slot })
    }
    const saved = saveToSlot(slot, run)
    if (saved.ok) {
      saveFailing = false
    } else if (!saveFailing) {
      saveFailing = true
      set({ notice: saved.message })
    }
  },

  saveSoon: () => {
    if (cancelIdleSave || !get().run) return
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
  if (!quietStep && s.version !== prev.version && s.hudVersion === prev.hudVersion) {
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
    if (s.run && (s.hudVersion !== prev.hudVersion || s.run !== prev.run)) fn(s.run)
  })
}

/** Calls `fn(run)` after every sim step or command (and when a run is loaded). */
export function subscribeSteps(fn: (run: RunState) => void): () => void {
  return useGameStore.subscribe((s, prev) => {
    if (s.run && (s.version !== prev.version || s.run !== prev.run)) fn(s.run)
  })
}
