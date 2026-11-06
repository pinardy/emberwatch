import { SPECIES } from './content/species'
import {
  RUN_KEY,
  loadRun,
  read,
  removeKey,
  writeChecked,
  type WriteFailure,
} from './persistence'
import type { RunPhase, RunState, Season, SpeciesId } from './types'

/*
 * Run save slots.
 *
 * Every run lives in exactly one slot, and the autosave (every few seconds,
 * on tab hide and on page hide) writes it back to that slot. The autosave
 * slot keeps the original single-save key, so a save from before slots is
 * already slot "auto" and nobody loses a run; new settlements go there when
 * it is free. The three manual slots hold further runs, or copies the player
 * saved on purpose.
 *
 * A small index beside the slots carries what the load screen shows (seed,
 * species, edict, year, the race), so listing slots never parses a 50 KB
 * save. The index is a cache: whenever it disagrees with the slots it is
 * rebuilt from them, which is also how an old single save gets indexed.
 */

export type SlotId = 'auto' | '1' | '2' | '3'

/** Load-screen order; also the order a new run looks for a free slot. */
export const SLOT_IDS: readonly SlotId[] = ['auto', '1', '2', '3']

export const SLOT_LABELS: Record<SlotId, string> = {
  auto: 'Autosave',
  '1': 'Slot 1',
  '2': 'Slot 2',
  '3': 'Slot 3',
}

export const SLOT_INDEX_KEY = 'emberwatch.slots.v1'

/** The localStorage key holding a slot's run. */
export function slotKey(id: SlotId): string {
  return id === 'auto' ? RUN_KEY : `emberwatch.run.slot${id}.v1`
}

/** What the load screen knows about a slot without opening it. */
export interface SlotMeta {
  seed: number
  species: SpeciesId[]
  edict: number
  year: number
  season: Season
  phase: RunPhase
  clock: number
  reputation: number
  maxReputation: number
  impatience: number
  maxImpatience: number
  runModifiers: string[]
  /** Epoch ms of the last save; 0 when unknown (indexed from an old save). */
  savedAt: number
}

interface SlotIndex {
  version: 1
  slots: Partial<Record<SlotId, SlotMeta>>
}

export function slotMeta(run: RunState, savedAt: number): SlotMeta {
  return {
    seed: run.seed,
    species: [...run.speciesPool],
    edict: run.edict ?? 0,
    year: run.season.year,
    season: run.season.season,
    phase: run.phase,
    clock: run.clock,
    reputation: run.reputation,
    maxReputation: run.maxReputation,
    impatience: run.impatience,
    maxImpatience: run.maxImpatience,
    runModifiers: [...(run.runModifiers ?? [])],
    savedAt,
  }
}

const SEASONS: readonly string[] = ['drizzle', 'clearance', 'storm']
const PHASES: readonly string[] = ['playing', 'won', 'lost']

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Index entries are checked like any other stored data: never trusted blind. */
function validMeta(value: unknown): value is SlotMeta {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  return (
    finite(m.seed) &&
    Array.isArray(m.species) &&
    m.species.every((s) => typeof s === 'string' && Object.hasOwn(SPECIES, s)) &&
    finite(m.edict) &&
    finite(m.year) &&
    SEASONS.includes(m.season as string) &&
    PHASES.includes(m.phase as string) &&
    finite(m.clock) &&
    finite(m.reputation) &&
    finite(m.maxReputation) &&
    finite(m.impatience) &&
    finite(m.maxImpatience) &&
    Array.isArray(m.runModifiers) &&
    m.runModifiers.every((s) => typeof s === 'string') &&
    finite(m.savedAt)
  )
}

function hasData(id: SlotId): boolean {
  try {
    return localStorage.getItem(slotKey(id)) !== null
  } catch {
    return false
  }
}

function writeIndex(index: SlotIndex): void {
  // The index is a cache. If it cannot be written, the next read rebuilds it.
  writeChecked(SLOT_INDEX_KEY, index)
}

/**
 * Reads the index, reconciled against what the slots actually hold: an entry
 * for an empty slot is dropped, and a slot with data but no entry (an old
 * single save, or a write that beat the index) is opened once and indexed.
 */
function loadIndex(): SlotIndex {
  const raw = read<{ slots?: Record<string, unknown> }>(SLOT_INDEX_KEY)
  const index: SlotIndex = { version: 1, slots: {} }
  let changed = !raw
  for (const id of SLOT_IDS) {
    const stored =
      raw?.slots && typeof raw.slots === 'object' && Object.hasOwn(raw.slots, id)
        ? raw.slots[id]
        : undefined
    const present = hasData(id)
    if (present && validMeta(stored)) {
      index.slots[id] = stored
      continue
    }
    if (stored !== undefined) changed = true
    if (!present) continue
    const run = loadRun(slotKey(id))
    if (run) {
      index.slots[id] = slotMeta(run, 0)
      changed = true
    }
  }
  if (changed) writeIndex(index)
  return index
}

export interface SlotSummary {
  id: SlotId
  label: string
  meta: SlotMeta | null
}

/** Every slot in load-screen order, with its metadata when it holds a run. */
export function listSlots(): SlotSummary[] {
  const index = loadIndex()
  return SLOT_IDS.map((id) => ({
    id,
    label: SLOT_LABELS[id],
    meta: index.slots[id] ?? null,
  }))
}

/** The most recently saved slot, for "Continue". */
export function latestSlot(): SlotId | null {
  let best: SlotSummary | null = null
  for (const slot of listSlots()) {
    if (!slot.meta) continue
    if (!best || slot.meta.savedAt > best.meta!.savedAt) best = slot
  }
  return best?.id ?? null
}

/** The first empty slot, autosave first; null when every slot holds a run. */
export function freeSlot(): SlotId | null {
  return listSlots().find((slot) => !slot.meta)?.id ?? null
}

export function loadSlot(id: SlotId): RunState | null {
  return loadRun(slotKey(id))
}

export type SaveResult =
  | { ok: true }
  | { ok: false; reason: WriteFailure; message: string }

const SAVE_MESSAGES: Record<WriteFailure, string> = {
  quota:
    'Could not save: browser storage is full. Delete a slot or export this run to a file to keep it safe.',
  unavailable:
    'Could not save: this browser is not letting the game store data (private mode?). Export the run to keep it.',
}

/**
 * Writes a run to a slot and updates its index entry. A save that does not fit
 * leaves the slot's previous contents exactly as they were.
 */
export function saveToSlot(id: SlotId, run: RunState, now = Date.now()): SaveResult {
  const failure = writeChecked(slotKey(id), run)
  if (failure) return { ok: false, reason: failure, message: SAVE_MESSAGES[failure] }
  const index = loadIndex()
  index.slots[id] = slotMeta(run, now)
  writeIndex(index)
  return { ok: true }
}

export function deleteSlot(id: SlotId): void {
  removeKey(slotKey(id))
  const index = loadIndex()
  delete index.slots[id]
  writeIndex(index)
}
