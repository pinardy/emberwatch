import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ACHIEVEMENT_LIST } from '../game/content/achievements'
import { BUILDINGS } from '../game/content/buildings'
import { META_UPGRADES } from '../game/content/meta'
import { createRun } from '../game/engine/createRun'
import { defaultMeta } from '../game/engine/meta'
import { useGameStore } from '../game/store'
import type { MetaState, RunState } from '../game/types'
import { AchievementsScreen } from './AchievementsScreen'
import { CitadelScreen } from './CitadelScreen'
import { VillagerPanel } from './VillagerPanel'

/** Second-tier needs in the People panel; style achievements and their Citadel unlocks. */

function settlement(year: number, temple = false): RunState {
  const s = createRun({ seed: 4711, species: ['human', 'beaver', 'lizard'], modifiers: [] })
  s.pendingChoices = []
  s.season.year = year
  const worker = Object.keys(s.villagers)[0]
  s.buildings.t_tavern = {
    id: 't_tavern',
    defId: 'tavern',
    pos: { x: 40, y: 40 },
    gladeId: 'glade0',
    built: true,
    buildProgress: 0,
    workers: [worker],
    activeRecipeId: BUILDINGS.tavern.recipes[0].id,
    recipeProgress: 0,
    tier: 0,
    paused: false,
    depositsInRange: {},
  }
  s.stock.ale = 20
  if (temple) {
    // Humans' other base need, so the refined one can pay.
    s.buildings.t_temple = { ...s.buildings.t_tavern, id: 't_temple', defId: 'temple', pos: { x: 42, y: 40 }, activeRecipeId: BUILDINGS.temple.recipes[0].id }
    s.stock.incense = 20
  }
  return s
}

function humanCard(): HTMLElement {
  const card = screen.getByText('Humans', { exact: false }).closest('.species-card')
  if (!card) throw new Error('no human card')
  return card as HTMLElement
}

beforeEach(() => {
  localStorage.clear()
  useGameStore.setState({ screen: 'game', run: null, meta: defaultMeta(), speed: 0 })
})

afterEach(() => cleanup())

describe('People panel: refined needs', () => {
  it('shows a refined need as not yet wanted before Year 3, with when it wakes', () => {
    useGameStore.setState({ run: settlement(1) })
    render(<VillagerPanel />)
    const chip = humanCard().querySelector('.need-refined')!
    expect(chip.className).toContain('is-dormant')
    expect(chip.textContent).toMatch(/not wanted yet \(from Year 3 or 20 villagers\)/)
    expect(within(humanCard()).getByText(/Luxury ✓ · refined: spiced ale \(not yet wanted\)/)).toBeTruthy()
  })

  it('marks it missing (never a penalty) once wanted, and met with spiced ale in the tavern', () => {
    const run = settlement(3, true)
    useGameStore.setState({ run })
    const { unmount } = render(<VillagerPanel />)
    let chip = humanCard().querySelector('.need-refined')!
    expect(chip.className).toContain('is-unmet')
    expect(chip.getAttribute('title')).toMatch(/Missing it costs nothing/)
    expect(within(humanCard()).getByText('Luxury ✓ · refined: spiced ale ✗')).toBeTruthy()
    // No refined term in the breakdown while it pays nothing.
    expect(within(humanCard()).queryByText(/Refined need:/)).toBeNull()
    unmount()

    run.stock.spicedAle = 10
    useGameStore.setState({ run: { ...run } })
    render(<VillagerPanel />)
    chip = humanCard().querySelector('.need-refined')!
    expect(chip.className).toContain('is-met')
    expect(within(humanCard()).getByText('Luxury ✓ · refined: spiced ale ✓')).toBeTruthy()
    const term = within(humanCard()).getByText('Refined need: spiced ale').closest('li')!
    expect(term.querySelector('strong')?.textContent).toMatch(/^\+\d/)
  })

  it('says a refined need on hand waits for the base needs, and pays nothing yet', () => {
    const run = settlement(3)
    run.stock.spicedAle = 10
    useGameStore.setState({ run })
    render(<VillagerPanel />)
    const chip = humanCard().querySelector('.need-refined')!
    expect(chip.className).toContain('is-partial')
    expect(chip.textContent).toMatch(/waiting for every base need/)
    expect(within(humanCard()).getByText(/refined: spiced ale ◐ \(waits on the base needs\)/)).toBeTruthy()
    expect(within(humanCard()).queryByText(/Refined need:/)).toBeNull()
  })
})

describe('style achievements and the Citadel', () => {
  const earned = (...ids: string[]): MetaState => ({
    ...defaultMeta(),
    citadelSupplies: 40,
    achievements: { unlocked: Object.fromEntries(ids.map((id) => [id, 0])), progress: {} },
  })

  it('lists the styles of rule with what each opens in the Citadel', () => {
    useGameStore.setState({ screen: 'achievements', meta: earned('ownCounsel') })
    render(<AchievementsScreen />)
    const section = screen.getByRole('region', { name: 'Styles of rule' })
    const styles = ACHIEVEMENT_LIST.filter((d) => d.tier === 'style')
    expect(within(section).getByText(`1/${styles.length}`)).toBeTruthy()
    for (const def of styles) expect(within(section).getByText(def.name)).toBeTruthy()
    expect(within(section).getAllByText(/Citadel:/)).toHaveLength(styles.length)
    expect(within(section).getByText(/Tended Grounds joins your cornerstone drafts/)).toBeTruthy()
    expect(within(section).getByText(/Masons’ Archive can be bought early|Masons' Archive can be bought early/)).toBeTruthy()
    expect(within(section).getByText(/Royal Works commission goes on the board early/)).toBeTruthy()
  })

  it('shows earned unlocks in the Citadel and lets an opened upgrade be bought early', () => {
    useGameStore.setState({ screen: 'citadel', meta: earned('ownCounsel') })
    render(<CitadelScreen />)
    const field = screen.getByRole('region', { name: 'Earned in the field' })
    const rows = within(field).getAllByRole('listitem')
    expect(rows).toHaveLength(7)
    expect(rows.filter((r) => r.className.includes('is-earned'))).toHaveLength(1)
    expect(within(field).getByText(/✓ .*Masons. Archive can be bought early/)).toBeTruthy()

    const name = META_UPGRADES.masonsArchive.name
    const card = screen.getByText(name, { selector: 'strong' }).closest('button')!
    expect(card.textContent).toMatch(/Opened early by .*Own Counsel/)
    expect((card as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(card)
    expect(useGameStore.getState().meta.upgrades).toContain('masonsArchive')
  })

  it('names the achievement that would open a locked upgrade early', () => {
    useGameStore.setState({ screen: 'citadel', meta: earned() })
    render(<CitadelScreen />)
    const card = screen.getByText(META_UPGRADES.queensEar.name, { selector: 'strong' }).closest('button')!
    expect(card.textContent).toMatch(/Earn .*True to Your Word.* to open it early/)
    expect((card as HTMLButtonElement).disabled).toBe(true)
  })
})
