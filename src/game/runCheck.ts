import { BUILDINGS } from './content/buildings'
import { CHARTERS } from './content/charters'
import { CORNERSTONES } from './content/cornerstones'
import { DECREES } from './content/decrees'
import { GLADE_EVENTS } from './content/gladeEvents'
import { ORDERS } from './content/orders'
import { RESOURCES } from './content/resources'
import { SPECIES } from './content/species'
import { TERRAIN } from './content/terrain'

/*
 * The shape check every stored run passes before the game sees it: an
 * imported file (`saveFile.ts`) and a run loaded from a local slot
 * (`persistence.ts`) alike, so a damaged save is refused with a reason
 * rather than crashing the simulation or a screen that reads it.
 */

type Rec = Record<string, unknown>

export function isRec(value: unknown): value is Rec {
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

const CHOICE_KINDS = ['cornerstone', 'blueprint', 'gladeEvent', 'charter', 'order', 'decree']

/** An order (or decree) instance: its id, a known def and readable progress. */
function validOrder(value: unknown, table: object, decree = false): boolean {
  if (!isRec(value)) return false
  if (typeof value.id !== 'string' || !known(table, value.defId)) return false
  if (!finite(value.progress) || typeof value.complete !== 'boolean') return false
  if (value.goal !== undefined && !(isRec(value.goal) && typeof value.goal.kind === 'string')) return false
  if (value.baseline !== undefined && !finite(value.baseline)) return false
  if (decree && !(finite(value.timeLeft) && finite(value.timeLimit))) return false
  return true
}

/**
 * A waiting choice the modal, the Founding panel or the Orders panel can show
 * and answer: a known kind, a list of option ids with at least one that
 * exists for that kind (a card for content since removed is simply not
 * drawn, but a choice with nothing to pick would halt the run for good), and
 * well-formed candidates for order and decree choices.
 */
function validChoice(value: unknown): boolean {
  if (!isRec(value) || !CHOICE_KINDS.includes(value.kind as string)) return false
  const options = value.options
  if (!strings(options) || options.length === 0) return false
  if (value.gladeId !== undefined && typeof value.gladeId !== 'string') return false
  if (value.blueprintId !== undefined && !known(BUILDINGS, value.blueprintId)) return false
  switch (value.kind) {
    case 'cornerstone':
      return options.some((id) => known(CORNERSTONES, id))
    case 'blueprint':
      return options.some((id) => known(BUILDINGS, id) || known(CORNERSTONES, id))
    case 'gladeEvent':
      return known(GLADE_EVENTS, options[0])
    case 'charter':
      return options.some((id) => known(CHARTERS, id))
    case 'order':
      return value.orders === undefined || (Array.isArray(value.orders) && value.orders.every((o) => validOrder(o, ORDERS)))
    case 'decree':
      return value.decrees === undefined || (Array.isArray(value.decrees) && value.decrees.every((d) => validOrder(d, DECREES, true)))
  }
  return false
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
  // Roads are optional (saves from before them have none).
  if (
    run.roads !== undefined &&
    (!Array.isArray(run.roads) ||
      !run.roads.every((r) => isRec(r) && typeof r.id === 'string' && isVec(r.a) && isVec(r.b)))
  ) {
    return 'its roads are damaged'
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
  if (!Array.isArray(run.log) || !run.log.every((l) => isRec(l) && typeof l.text === 'string'))
    return 'its log is damaged'
  if (!Array.isArray(run.orders) || !run.orders.every((o) => validOrder(o, ORDERS)))
    return 'its orders are damaged'
  if (run.decree !== undefined && run.decree !== null && !validOrder(run.decree, DECREES, true))
    return 'its royal decree is damaged'
  if (!Array.isArray(run.pendingChoices) || !run.pendingChoices.every(validChoice))
    return 'a choice it was waiting on is damaged'
  if (
    run.orderOffers !== undefined &&
    (!Array.isArray(run.orderOffers) || !run.orderOffers.every((c) => validChoice(c) && isRec(c) && c.kind === 'order'))
  )
    return 'its order offers are damaged'
  if (!strings(run.cornerstones)) return 'its cornerstones are damaged'
  if (!isRec(run.stats)) return 'its stats are missing'
  return null
}

