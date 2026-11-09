import { describe, expect, it } from 'vitest'
import { LAYOUTS } from '../content/layouts'
import type { LayoutId, RunState } from '../types'
import { migrateRun } from '../persistence'
import { canPlaceBuilding, findPlacement, placeBuilding } from './actions'
import { campPlotKept } from './campPlot'
import { createRun } from './createRun'
import { collectWarnings } from './diagnostics'
import { takeChoice } from './drafts'
import { dist } from './geometry'
import { gladeAt } from './mapgen'
import { defaultMeta } from './meta'
import { ALL_SEEDS } from './bot/harness'

/**
 * The hearth glade's camp plot: a spot by its trees is kept for the first
 * Woodcutters' Camp, so a cramped start cannot build itself out of wood —
 * and when a settlement does end up with no camp and no way to pay for one,
 * the warning strip says what to pull down or clear.
 */

function founded(run: RunState): RunState {
  for (let guard = 0; run.pendingChoices.length > 0 && guard < 20; guard++) {
    takeChoice(run, run.pendingChoices[0].options[0])
  }
  return run
}

/** The playtest's dead start: seed 41 on the Long Ridge in the Cinderwood, one stand of trees. */
function crampedRidge(): RunState {
  return founded(
    createRun({
      seed: 41,
      species: ['human', 'fox', 'harpy'],
      meta: defaultMeta(),
      modifiers: ['petrifiedWoods', 'ancientRuins'],
      layout: 'ridge',
      biome: 'cinderwood',
    }),
  )
}

const woodWarning = (s: RunState) => collectWarnings(s).find((w) => w.id === 'no-woodcutter')

describe("the hearth glade's camp plot", () => {
  it('every start keeps a spot by the trees where a camp can stand, on every layout', () => {
    for (const layout of Object.keys(LAYOUTS) as LayoutId[]) {
      for (const seed of ALL_SEEDS.slice(0, 8)) {
        const s = founded(createRun({ seed, species: ['human', 'beaver', 'lizard'], modifiers: [], layout }))
        expect(s.campPlot, `${layout} seed ${seed}`).toBeDefined()
        expect(gladeAt(s.glades, s.campPlot!)?.id).toBe('glade0')
        expect(canPlaceBuilding(s, 'woodcuttersCamp', s.campPlot!)).toBeNull()
      }
    }
  })

  it('nothing else may be built on it until a camp stands, and then it is free', () => {
    const s = crampedRidge()
    const plot = s.campPlot!
    s.stock.wood = 200
    s.stock.plank = 50
    expect(canPlaceBuilding(s, 'shelter', plot)).toMatch(/kept for your first Woodcutters' Camp/)
    // A spot found for anything else steers clear of it.
    const home = findPlacement(s, 'shelter')!
    expect(dist(home, plot)).toBeGreaterThan(0.6)
    // The first camp, anywhere, frees it.
    expect(placeBuilding(s, 'woodcuttersCamp', plot)).toBeNull()
    expect(campPlotKept(s)).toBe(false)
  })

  it('the playtest’s dead start: the first Shelter can no longer take the only camp spot', () => {
    const s = crampedRidge()
    s.stock.wood = 200
    // Homes and a warehouse packed in by the hearth first, as the playtest did.
    for (const id of ['shelter', 'shelter', 'warehouse', 'foragersCamp']) {
      const pos = findPlacement(s, id)
      if (pos) placeBuilding(s, id, pos)
    }
    expect(findPlacement(s, 'woodcuttersCamp')).not.toBeNull()
  })

  it('older saves keep nothing; a mangled plot reads as none', () => {
    const s = crampedRidge()
    const raw = JSON.parse(JSON.stringify(s)) as RunState
    delete raw.campPlot
    expect(migrateRun(raw)!.campPlot).toBeUndefined()
    const bad = JSON.parse(JSON.stringify(s)) as RunState
    ;(bad as unknown as { campPlot: unknown }).campPlot = { x: 'here' }
    expect(migrateRun(bad)!.campPlot).toBeUndefined()
    expect(migrateRun(JSON.parse(JSON.stringify(s)))!.campPlot).toEqual(s.campPlot)
  })
})

describe('no Woodcutters’ Camp and no way to raise one', () => {
  it('no wood to pay for it: names the building to pull down for its wood, and a glade to clear', () => {
    const s = crampedRidge()
    s.stock.wood = 30
    const shelter = findPlacement(s, 'shelter')!
    expect(placeBuilding(s, 'shelter', shelter)).toBeNull()
    Object.values(s.buildings).forEach((b) => (b.built = true))
    expect(woodWarning(s)).toBeUndefined()
    s.stock.wood = 2
    const w = woodWarning(s)!
    expect(w.severity).toBe('danger')
    expect(w.text).toMatch(/^🪓 No Woodcutters' Camp and no wood to build one \(it takes 6\)\. Demolish the Shelter for its wood, or clear /)
    // With a camp at work there is nothing to say.
    s.stock.wood = 6
    expect(placeBuilding(s, 'woodcuttersCamp', s.campPlot!)).toBeNull()
    s.stock.wood = 0
    expect(woodWarning(s)).toBeUndefined()
  })

  it('wood in hand but no room by any trees: names the building by the trees', () => {
    const s = crampedRidge()
    s.stock.wood = 500
    s.stock.plank = 100
    // An old save with no plot, packed full around its only trees.
    delete s.campPlot
    for (let i = 0; i < 40; i++) {
      const pos = findPlacement(s, 'shelter')
      if (!pos || placeBuilding(s, 'shelter', pos) !== null) break
    }
    expect(findPlacement(s, 'woodcuttersCamp')).toBeNull()
    const w = woodWarning(s)!
    expect(w.text).toMatch(/^🪓 No Woodcutters' Camp, and no room for one by any trees you hold\. Demolish the Shelter by the trees, or clear /)
  })
})
