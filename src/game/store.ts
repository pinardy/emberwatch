import { create } from 'zustand'
import { META_UPGRADES, defaultMeta, supplyReward } from './content/meta'
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
} from './engine/actions'
import { TICK_SECONDS, type GameSpeed } from './engine/balance'
import { createRun } from './engine/createRun'
import {
  appeaseThreat,
  rerollChoice,
  resolveGladeEvent,
  takeChoice,
} from './engine/events'
import { randomSeed } from './engine/rng'
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

  // --- lifecycle -----------------------------------------------------------
  boot: () => void
  startRun: (seed?: number, species?: SpeciesId[]) => void
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
  selectBuilding: (buildingId: string | null) => void
  selectDeposit: (depositId: string | null) => void
  selectGlade: (gladeId: string | null) => void
  clearSelection: () => void
  setPanel: (panel: SidePanel) => void
  place: (pos: Vec2) => void
  demolish: (buildingId: string) => void
  hire: (buildingId: string, villagerId?: string) => void
  fire: (buildingId: string, villagerId?: string) => void
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

  boot: () => {
    set({ meta: loadMeta(), settings: loadSettings() })
  },

  startRun: (seed, species) => {
    const run = createRun({ seed: seed ?? randomSeed(), meta: get().meta, species })
    saveRun(run)
    set({
      run,
      screen: 'game',
      version: get().version + 1,
      speed: 1,
      buildMode: null,
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
    const next: MetaState = {
      ...meta,
      citadelSupplies: meta.citadelSupplies + reward,
      runsWon: meta.runsWon + (run.phase === 'won' ? 1 : 0),
      runsLost: meta.runsLost + (run.phase === 'lost' ? 1 : 0),
      history: [
        {
          seed: run.seed,
          won: run.phase === 'won',
          years: run.season.year,
          reputation: run.reputation,
          at: Date.now(),
        },
        ...meta.history,
      ].slice(0, 20),
    }
    saveMeta(next)
    saveRun(null)
    set({
      meta: next,
      run: null,
      screen: 'citadel',
      speed: 0,
      version: get().version + 1,
      notice: `Run banked: +${reward} Citadel supplies.`,
    })
  },

  goToScreen: (screen) => set({ screen, notice: null }),

  // -------------------------------------------------------------------------
  // Simulation loop
  // -------------------------------------------------------------------------
  advance: (realSeconds) => {
    const { run, speed } = get()
    if (!run || speed === 0 || run.phase !== 'playing') return
    if (run.pendingChoices.length > 0) return

    // Clamp so a backgrounded tab does not fast-forward hours on return.
    const budget = Math.min(realSeconds * speed, 2)
    let remaining = budget
    let steps = 0
    while (remaining >= TICK_SECONDS && steps < 64) {
      tick(run, TICK_SECONDS)
      remaining -= TICK_SECONDS
      steps++
      if (run.phase !== 'playing' || run.pendingChoices.length > 0) break
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
    set({ buildMode: defId, selectedBuilding: null, selectedDeposit: null, notice: null }),

  selectBuilding: (buildingId) =>
    set({ selectedBuilding: buildingId, selectedDeposit: null, selectedGlade: null }),
  selectDeposit: (depositId) =>
    set({ selectedDeposit: depositId, selectedBuilding: null, selectedGlade: null }),
  selectGlade: (gladeId) =>
    set({ selectedGlade: gladeId, selectedBuilding: null, selectedDeposit: null }),
  clearSelection: () =>
    set({ selectedBuilding: null, selectedDeposit: null, selectedGlade: null }),
  setPanel: (panel) => set({ panel }),

  // Build mode stays active after a successful placement, so camps and
  // shelters can be laid down in quick succession, RTS-style.
  place: (pos) => {
    const defId = get().buildMode
    if (!defId) return
    runCommand(set, get, (run) => placeBuilding(run, defId, pos))
  },

  demolish: (buildingId) =>
    runCommand(set, get, (run) => demolishBuilding(run, buildingId)),
  hire: (buildingId, villagerId) =>
    runCommand(set, get, (run) => assignWorker(run, buildingId, villagerId)),
  fire: (buildingId, villagerId) =>
    runCommand(set, get, (run) => removeWorker(run, buildingId, villagerId)),
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
  soothe: () => runCommand(set, get, (run) => sootheQueen(run)),
  recallAll: () =>
    runCommand(set, get, (run) => {
      recallEveryone(run)
      return null
    }),

  dismissNotice: () => set({ notice: null }),

  buyUpgrade: (id) => {
    const { meta } = get()
    const def = META_UPGRADES[id]
    if (!def) return
    if (meta.upgrades.includes(id)) {
      set({ notice: 'Already unlocked.' })
      return
    }
    if (meta.citadelSupplies < def.cost) {
      set({ notice: 'Not enough Citadel supplies.' })
      return
    }
    const next: MetaState = {
      ...meta,
      citadelSupplies: meta.citadelSupplies - def.cost,
      upgrades: [...meta.upgrades, id],
      unlockedSpecies: def.unlocksSpecies
        ? [...new Set([...meta.unlockedSpecies, def.unlocksSpecies])]
        : meta.unlockedSpecies,
    }
    saveMeta(next)
    set({ meta: next, notice: `${def.name} unlocked.` })
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
