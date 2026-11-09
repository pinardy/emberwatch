import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BIOMES, LAYOUTS } from '../game/content/layouts'
import { META_UPGRADES } from '../game/content/meta'
import { RUN_MODIFIERS } from '../game/content/runModifiers'
import { SPECIES } from '../game/content/species'
import { commissionLand } from '../game/engine/citadel'
import { citadelLoadout, defaultMeta } from '../game/engine/meta'
import { landFor, mapgenHooksFor } from '../game/engine/runModifiers'
import { drawTerrainPlan, isUnusualPlan } from '../game/engine/terrainPlan'
import { saveMeta } from '../game/persistence'
import { useGameStore } from '../game/store'
import type { MetaState, RunState } from '../game/types'
import { SetupScreen } from './SetupScreen'

/**
 * The New settlement screen on its own: the footer below (never over) the
 * form, the species tiles and their details, and the ground preview, which
 * for a random seed too names the run the player will actually get.
 */

function currentRun(): RunState {
  const run = useGameStore.getState().run
  if (!run) throw new Error('expected a run')
  return run
}

function owning(...ids: string[]): MetaState {
  const out = new Set<string>()
  const visit = (id: string) => {
    for (const req of META_UPGRADES[id]?.requires ?? []) visit(req)
    out.add(id)
  }
  ids.forEach(visit)
  return { ...defaultMeta(), upgrades: [...out] }
}

function giveMeta(meta: MetaState) {
  saveMeta(meta)
  useGameStore.setState({ meta })
}

function resetStore() {
  localStorage.clear()
  useGameStore.setState({ screen: 'setup', run: null, meta: defaultMeta(), notice: null })
}

const seedField = () => screen.getByRole('textbox', { name: /Map seed/i }) as HTMLInputElement

/** The seed a blank field stands for, as its placeholder shows it. */
function drawnSeed(): number {
  const match = /^random · (\d+)$/.exec(seedField().placeholder)
  if (!match) throw new Error(`no drawn seed in "${seedField().placeholder}"`)
  return Number(match[1])
}

/** The ground line: "The ground: <layout> · <biome>", and the ids it names. */
function groundLine() {
  const line = screen.getByText(/^The ground:/).closest('p')!
  return {
    text: line.textContent!.replace(/\s+/g, ' ').trim(),
    layout: line.getAttribute('data-layout'),
    biome: line.getAttribute('data-biome'),
  }
}

const setOut = () => fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))

beforeEach(resetStore)
afterEach(cleanup)

describe('the setup footer', () => {
  it('sits below the scrolling form, never over it', () => {
    render(<SetupScreen />)
    const card = document.querySelector('.menu-card.setup-card')!
    const body = card.querySelector(':scope > .setup-body')!
    const foot = card.querySelector<HTMLElement>(':scope > footer.setup-foot')!
    expect(body).toBeTruthy()
    expect(foot).toBeTruthy()
    // The card is exactly the scrolling body, then the footer after it.
    expect([...card.children]).toEqual([body, foot])
    expect(body.contains(foot)).toBe(false)
    expect(foot.classList.contains('modal-foot')).toBe(true)
    // Every section scrolls in the body, the save slot last of all.
    const sections = [...document.querySelectorAll('.setup-section')]
    expect(sections.length).toBeGreaterThanOrEqual(5)
    for (const s of sections) expect(body.contains(s)).toBe(true)
    expect(body.lastElementChild).toBe(document.querySelector('.slot-section'))
    expect(within(foot).getByRole('button', { name: /Set out with/i })).toBeTruthy()
    expect(within(foot).getByRole('button', { name: /^Back$/ })).toBeTruthy()
  })
})

describe('species tiles', () => {
  it('names each tile with its chosen or locked state, and picks in one tap', () => {
    render(<SetupScreen />)
    const humans = screen.getByRole('button', { name: /^Humans ✓ Chosen/ })
    expect(humans.getAttribute('aria-pressed')).toBe('true')
    const harpies = screen.getByRole('button', { name: /^Harpies Locked/ })
    expect((harpies as HTMLButtonElement).disabled).toBe(true)
    expect(harpies.getAttribute('aria-pressed')).toBeNull()
    // The need names stay in the tile's name (the phone tile shows icons).
    expect(humans.querySelectorAll('.need-name')).toHaveLength(2)
    expect(humans.textContent).toMatch(/Religion.*Luxury/)
    expect(screen.getByText('3/3 chosen')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^Lizards ✓ Chosen/ }))
    expect(screen.getByText('2/3 chosen')).toBeTruthy()
    const lizards = screen.getByRole('button', { name: /^Lizards/ })
    expect(lizards.getAttribute('aria-pressed')).toBe('false')
    expect(lizards.textContent).not.toMatch(/Chosen/)
    fireEvent.click(lizards)
    expect(screen.getByText('3/3 chosen')).toBeTruthy()
    expect(lizards.getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps the three-species limit and the last-pick rule', () => {
    giveMeta({ ...defaultMeta(), unlockedSpecies: ['harpy'] })
    render(<SetupScreen />)
    const harpies = screen.getByRole('button', { name: /^Harpies/ })
    expect((harpies as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(harpies)
    expect(screen.getByText('3/3 chosen')).toBeTruthy()
    expect(harpies.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('status').textContent).toMatch(/You can bring 3 species/)
    for (const name of ['Beavers', 'Lizards']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name} ✓ Chosen`) }))
    }
    expect(screen.getByText('1/3 chosen')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Humans ✓ Chosen/ }))
    expect(screen.getByText('1/3 chosen')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toMatch(/At least one species/)
  })

  it('shows a species’ description, bonuses and lock reason on its toggle', () => {
    render(<SetupScreen />)
    const toggle = screen.getByRole('button', { name: 'About Harpies' })
    // A locked tile cannot be picked, but its details are a real, focusable control.
    expect((toggle as HTMLButtonElement).disabled).toBe(false)
    toggle.focus()
    expect(document.activeElement).toBe(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const detail = document.getElementById(toggle.getAttribute('aria-controls')!)!
    expect(detail.hidden).toBe(true)

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(detail.hidden).toBe(false)
    expect(screen.getByRole('group', { name: 'About Harpies' })).toBe(detail)
    expect(detail.textContent).toContain(SPECIES.harpy.blurb)
    expect(detail.textContent).toMatch(/Needs:.*Education.*Rest/)
    expect(detail.textContent).toContain('Scholarship +40%')
    expect(detail.textContent).toMatch(/Locked — buy the Harpy Charter in the Citadel/)
    // Opening the details picks nothing.
    expect(screen.getByText('3/3 chosen')).toBeTruthy()

    // One open at a time; the toggle closes it again.
    const humans = screen.getByRole('button', { name: 'About Humans' })
    fireEvent.click(humans)
    expect(detail.hidden).toBe(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const humanDetail = document.getElementById(humans.getAttribute('aria-controls')!)!
    expect(humanDetail.hidden).toBe(false)
    expect(humanDetail.textContent).not.toMatch(/Locked/)
    fireEvent.click(humans)
    expect(humanDetail.hidden).toBe(true)
    // Selecting a tile leaves the details as they were.
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: /^Beavers ✓ Chosen/ }))
    expect(detail.hidden).toBe(false)
    expect(screen.getByText('2/3 chosen')).toBeTruthy()
  })
})

describe('the ground preview', () => {
  it('names the ground for the random seed, and sets out on exactly that run', () => {
    render(<SetupScreen />)
    expect(seedField().value).toBe('')
    const seed = drawnSeed()
    const plan = drawTerrainPlan(seed, mapgenHooksFor(landFor(seed, citadelLoadout([]))))
    const shown = groundLine()
    expect(shown.text).toBe(`The ground: ${LAYOUTS[plan.layout].name} · ${BIOMES[plan.biome].name}`)
    expect([shown.layout, shown.biome]).toEqual([plan.layout, plan.biome])
    const land = within(screen.getByRole('list', { name: /Lay of the land/i }))
    for (const id of landFor(seed, citadelLoadout([]))) expect(land.getByText(RUN_MODIFIERS[id].name)).toBeTruthy()

    setOut()
    const run = currentRun()
    expect(run.seed).toBe(seed)
    expect(run.world.layout).toBe(shown.layout)
    expect(run.world.biome).toBe(shown.biome)
    expect(run.runModifiers).toEqual(landFor(seed, citadelLoadout([])))
  })

  it('matches the created run on a chosen land and a commission, seed after seed', () => {
    const meta = owning('chosenGround')
    let unusual = 0
    for (let i = 0; i < 6; i++) {
      cleanup()
      resetStore()
      giveMeta(meta)
      render(<SetupScreen />)
      // Ruins underfoot lean the layout; Storm Watch promises Long Storms.
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ancientRuins' } })
      fireEvent.click(screen.getByRole('radio', { name: /Storm Watch/i }))
      const shown = groundLine()
      if (isUnusualPlan({ layout: shown.layout as never, biome: shown.biome as never })) unusual++
      setOut()
      const run = currentRun()
      expect(run.commission).toBe('stormWatch')
      expect(run.runModifiers).toContain('longStorms')
      expect(run.world.layout).toBe(shown.layout)
      expect(run.world.biome).toBe(shown.biome)
      expect(shown.text).toBe(
        `The ground: ${LAYOUTS[run.world.layout!].name} · ${BIOMES[run.world.biome!].name}`,
      )
      // …and it is what the land and commission draw on that seed.
      const lands = commissionLand(landFor(run.seed, citadelLoadout(meta.upgrades), { chosen: 'ancientRuins' }), 'stormWatch')
      expect(drawTerrainPlan(run.seed, mapgenHooksFor(lands))).toEqual({
        layout: shown.layout,
        biome: shown.biome,
      })
    }
    // The runs covered more than the plain rings in the old forest.
    expect(unusual).toBeGreaterThan(0)
  })

  it('rerolls to a new random seed and updates the preview', () => {
    render(<SetupScreen />)
    const reroll = screen.getByRole('button', { name: /Reroll the map/i })
    const seen = new Set<number>([drawnSeed()])
    const grounds = new Set<string>([groundLine().text])
    for (let i = 0; i < 8; i++) {
      fireEvent.click(reroll)
      const seed = drawnSeed()
      seen.add(seed)
      const plan = drawTerrainPlan(seed, mapgenHooksFor(landFor(seed, citadelLoadout([]))))
      expect([groundLine().layout, groundLine().biome]).toEqual([plan.layout, plan.biome])
      grounds.add(groundLine().text)
    }
    expect(seen.size).toBe(9)
    expect(grounds.size).toBeGreaterThan(1)
    // A typed seed is cleared by a reroll, and the run takes the new draw.
    fireEvent.change(seedField(), { target: { value: 'my map' } })
    fireEvent.click(reroll)
    expect(seedField().value).toBe('')
    const seed = drawnSeed()
    setOut()
    expect(currentRun().seed).toBe(seed)
  })

  it('previews and sets out on a typed seed as before', () => {
    render(<SetupScreen />)
    fireEvent.change(seedField(), { target: { value: '4242' } })
    const plan = drawTerrainPlan(4242, mapgenHooksFor(landFor(4242, citadelLoadout([]))))
    expect(groundLine().text).toBe(`The ground: ${LAYOUTS[plan.layout].name} · ${BIOMES[plan.biome].name}`)
    setOut()
    expect(currentRun().seed).toBe(4242)
    expect([currentRun().world.layout, currentRun().world.biome]).toEqual([plan.layout, plan.biome])
  })
})

describe("the Queen's Edict", () => {
  it('starts on No edict, even with harsher rungs earned, and says so', () => {
    giveMeta({ ...defaultMeta(), edictUnlocked: 3 })
    render(<SetupScreen />)
    const section = document.querySelector<HTMLElement>('.edict-section')!
    const picked = within(section).getByRole('radio', { checked: true })
    expect(picked.textContent).toMatch(/No edict/)
    // The choice is named in the heading and on the Set out button.
    expect(within(section).getByRole('heading').textContent).toMatch(/Queen's Edict · No edict/)
    expect(screen.getByRole('button', { name: /Set out with/i }).textContent).not.toMatch(/Edict/)
    setOut()
    expect(currentRun().edict).toBe(0)
  })

  it('sets out under the edict picked, named where the player commits to it', () => {
    giveMeta({ ...defaultMeta(), edictUnlocked: 3 })
    render(<SetupScreen />)
    const section = document.querySelector<HTMLElement>('.edict-section')!
    fireEvent.click(within(section).getByRole('radio', { name: /Edict II.*Lean Provisions/ }))
    expect(within(section).getByRole('radio', { checked: true }).textContent).toMatch(/Edict II.*Lean Provisions/)
    expect(within(section).getByRole('heading').textContent).toMatch(/· Edict II$/)
    const button = screen.getByRole('button', { name: /Set out with.*Edict II/i })
    expect(button.textContent).toMatch(/· Edict II/)
    setOut()
    expect(currentRun().edict).toBe(2)
  })
})
