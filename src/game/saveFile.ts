import { BUILDINGS } from './content/buildings'
import { RESOURCES } from './content/resources'
import { SPECIES } from './content/species'
import { TERRAIN } from './content/terrain'
import { TICK_SECONDS } from './engine/balance'
import { tick } from './engine/tick'
import { migrateRun } from './persistence'
import { slotMeta, type SlotMeta } from './saveSlots'
import type { RunState } from './types'

/*
 * Save files: a run exported as JSON, and the checks an import must pass.
 *
 * An imported file is untrusted input. It is parsed with `JSON.parse` only
 * (never evaluated), keys that could reach a prototype are stripped while
 * parsing, the run's shape is checked field by field before the game sees it,
 * it then goes through the same `migrateRun` defaults as a local save, and
 * finally a copy is ticked once so a file that would throw in the simulation
 * is refused instead of crashing the game.
 */

export const SAVE_FILE_FORMAT = 'emberwatch-run'
/** Bumped when the envelope or the run changes in a way `migrateRun` cannot absorb. */
export const SAVE_FILE_VERSION = 1
/** Real saves are 30–60 KB; anything this large is not one. */
export const MAX_SAVE_FILE_BYTES = 2 * 1024 * 1024

export interface SaveFile {
  format: typeof SAVE_FILE_FORMAT
  version: number
  exportedAt: string
  meta: SlotMeta
  run: RunState
}

export function buildSaveFile(run: RunState, now = new Date()): SaveFile {
  return {
    format: SAVE_FILE_FORMAT,
    version: SAVE_FILE_VERSION,
    exportedAt: now.toISOString(),
    meta: slotMeta(run, now.getTime()),
    run,
  }
}

export function saveFileText(run: RunState, now = new Date()): string {
  return JSON.stringify(buildSaveFile(run, now))
}

/** e.g. `emberwatch-y3-storm-1234567.json` */
export function saveFileName(run: RunState): string {
  return `emberwatch-y${run.season.year}-${run.season.season}-${run.seed}.json`
}

export type ImportResult = { ok: true; run: RunState } | { ok: false; error: string }

/** Keys that could reach `Object.prototype` if the data were ever merged. */
const HOSTILE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * `JSON.parse` that drops prototype-reaching keys wherever they appear. The
 * reviver runs bottom-up and returning undefined deletes the property, so the
 * parsed tree never carries them into later spreads or `Object.assign`.
 */
export function parseUntrustedJson(text: string): unknown {
  return JSON.parse(text, (key, value) => (HOSTILE_KEYS.has(key) ? undefined : value))
}

type Rec = Record<string, unknown>

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
function isVec(value: unknown): boolean {
  return isRec(value) && finite(value.x) && finite(value.y)
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}
function known(table: object, id: unknown): boolean {
  return typeof id === 'string' && Object.hasOwn(table, id)
}

/** Every value of a record passes `check`; the first failure's name or null. */
function badEntry(value: unknown, check: (entry: Rec) => boolean): string | null {
  if (!isRec(value)) return 'is missing'
  for (const [id, entry] of Object.entries(value)) {
    if (!isRec(entry) || !check(entry)) return `has a damaged entry (${id.slice(0, 40)})`
  }
  return null
}

/**
 * Checks the parts of a run the simulation and both maps read without
 * further checks. Fields a newer build added are left to `migrateRun`.
 * Returns what is wrong, or null.
 */
export function runProblem(run: unknown): string | null {
  if (!isRec(run)) return 'it holds no run'
  for (const field of [
    'seed',
    'rngCursor',
    'clock',
    'reputation',
    'maxReputation',
    'impatience',
    'maxImpatience',
    'hostility',
  ]) {
    if (!finite(run[field])) return `its ${field} is not a number`
  }
  if (!['playing', 'won', 'lost'].includes(run.phase as string))
    return 'its phase is unknown'
  const season = run.season
  if (
    !isRec(season) ||
    !finite(season.year) ||
    !finite(season.elapsed) ||
    !['drizzle', 'clearance', 'storm'].includes(season.season as string)
  ) {
    return 'its season is damaged'
  }
  if (!isRec(run.world) || !finite(run.world.width) || !finite(run.world.height)) {
    return 'its world is damaged'
  }
  const checks: [string, unknown, (e: Rec) => boolean][] = [
    [
      'glades',
      run.glades,
      (g) =>
        typeof g.id === 'string' &&
        Array.isArray(g.polygon) &&
        g.polygon.length >= 3 &&
        g.polygon.every(isVec) &&
        isVec(g.center) &&
        known(TERRAIN, g.terrain) &&
        strings(g.neighbors),
    ],
    [
      'deposits',
      run.deposits,
      (d) => typeof d.id === 'string' && isVec(d.pos) && finite(d.radius),
    ],
    [
      'buildings',
      run.buildings,
      (b) =>
        typeof b.id === 'string' &&
        known(BUILDINGS, b.defId) &&
        isVec(b.pos) &&
        strings(b.workers) &&
        typeof b.activeRecipeId === 'string',
    ],
    [
      'villagers',
      run.villagers,
      (v) =>
        typeof v.id === 'string' &&
        known(SPECIES, v.species) &&
        (v.assignment === null || typeof v.assignment === 'string'),
    ],
  ]
  for (const [name, value, check] of checks) {
    const problem = badEntry(value, check)
    if (problem) return `its ${name} ${problem}`
  }
  if (Object.keys(run.glades as Rec).length === 0) return 'its map has no glades'
  if (!isRec(run.stock)) return 'its stockpile is missing'
  for (const [id, amount] of Object.entries(run.stock)) {
    if (!known(RESOURCES, id) || !finite(amount)) return 'its stockpile is damaged'
  }
  if (
    !Array.isArray(run.obstacles) ||
    !run.obstacles.every((o) => isRec(o) && isVec(o.pos))
  ) {
    return 'its obstacles are damaged'
  }
  if (
    !Array.isArray(run.speciesPool) ||
    run.speciesPool.length === 0 ||
    !run.speciesPool.every((s) => known(SPECIES, s))
  ) {
    return 'its species are unknown'
  }
  if (
    !strings(run.unlockedBuildings) ||
    !run.unlockedBuildings.every((b) => known(BUILDINGS, b))
  ) {
    return 'its blueprints are unknown'
  }
  for (const field of ['resolve', 'despair']) {
    const table = run[field]
    if (!isRec(table) || !Object.values(table).every(finite))
      return `its ${field} is damaged`
  }
  for (const field of ['orders', 'pendingChoices', 'log']) {
    if (!Array.isArray(run[field]) || !run[field].every(isRec))
      return `its ${field} are damaged`
  }
  if (!strings(run.cornerstones)) return 'its cornerstones are damaged'
  if (!isRec(run.stats)) return 'its stats are missing'
  return null
}

/** Shown for every refusal, after the specific reason. */
const KEEP_SAFE = 'Nothing was changed.'

/**
 * Turns the text of a save file into a run ready to play, or a reason it
 * cannot be. Never throws, whatever the input.
 */
export function parseSaveFile(text: string): ImportResult {
  const fail = (why: string): ImportResult => ({
    ok: false,
    error: `${why} ${KEEP_SAFE}`,
  })
  if (typeof text !== 'string') return fail('The file is empty.')
  if (text.length > MAX_SAVE_FILE_BYTES)
    return fail('The file is far too large to be a save.')
  if (text.trim() === '') return fail('The file is empty.')

  let data: unknown
  try {
    data = parseUntrustedJson(text)
  } catch {
    return fail('This is not an Emberwatch save: the file is not valid JSON.')
  }
  if (!isRec(data) || data.format !== SAVE_FILE_FORMAT) {
    return fail('This is not an Emberwatch save file.')
  }
  if (!Number.isInteger(data.version) || (data.version as number) < 1) {
    return fail('The save file has no valid version stamp.')
  }
  if ((data.version as number) > SAVE_FILE_VERSION) {
    return fail(
      `This save comes from a newer version of Emberwatch (format ${data.version}); update the game to load it.`,
    )
  }

  const problem = runProblem(data.run)
  if (problem) return fail(`The save is damaged: ${problem}.`)

  let run: RunState | null
  try {
    run = migrateRun(data.run)
  } catch {
    run = null
  }
  if (!run) return fail('The save is damaged and could not be read.')

  // One simulated step on a copy: a file that would crash the game is refused here.
  try {
    tick(JSON.parse(JSON.stringify(run)) as RunState, TICK_SECONDS)
  } catch {
    return fail('The save is damaged: the settlement could not be simulated.')
  }
  return { ok: true, run }
}

/** Reads a picked file's text; rejects oversize files before reading them. */
export async function readSaveFile(file: Blob): Promise<ImportResult> {
  if (file.size > MAX_SAVE_FILE_BYTES) {
    return { ok: false, error: `The file is far too large to be a save. ${KEEP_SAFE}` }
  }
  try {
    return parseSaveFile(await file.text())
  } catch {
    return { ok: false, error: `The file could not be read. ${KEEP_SAFE}` }
  }
}

/** Starts a browser download of a run as a save file. */
export function downloadSaveFile(run: RunState): void {
  const blob = new Blob([saveFileText(run)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = saveFileName(run)
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke after the click has had a chance to start the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
