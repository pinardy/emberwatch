import { TICK_SECONDS } from './engine/balance'
import { tick } from './engine/tick'
import { migrateRun } from './persistence'
import { isRec, runProblem } from './runCheck'
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

export { runProblem }

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
