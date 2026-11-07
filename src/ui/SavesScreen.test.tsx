import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { defaultMeta } from '../game/engine/meta'
import { createRun } from '../game/engine/createRun'
import { saveFileText } from '../game/saveFile'
import { SLOT_IDS, listSlots, loadSlot, saveToSlot } from '../game/saveSlots'
import { useGameStore } from '../game/store'

function seedSlot(id: (typeof SLOT_IDS)[number], seed: number, savedAt: number) {
  const run = createRun({ seed, meta: defaultMeta() })
  run.season.year = (seed % 5) + 1
  expect(saveToSlot(id, run, savedAt).ok).toBe(true)
  return run
}

function answerDrafts() {
  for (let guard = 0; guard < 10; guard++) {
    const run = useGameStore.getState().run
    if (!run || run.pendingChoices.length === 0) return
    fireEvent.click(document.querySelector('button.option') as HTMLElement)
  }
}

beforeEach(() => {
  localStorage.clear()
  useGameStore.setState({
    screen: 'menu',
    run: null,
    activeSlot: null,
    speed: 0,
    notice: null,
    meta: defaultMeta(),
  })
})

afterEach(cleanup)

describe('menu', () => {
  it('continues the most recently played slot and says what it holds', () => {
    seedSlot('auto', 11, 100)
    seedSlot('2', 22, 500)
    render(<App />)
    const button = screen.getByRole('button', { name: /Continue/ })
    expect(button.textContent).toMatch(/Slot 2/)
    expect(button.textContent).toMatch(/Year 3/)
    fireEvent.click(button)
    expect(useGameStore.getState().run!.seed).toBe(22)
    expect(useGameStore.getState().activeSlot).toBe('2')
    expect(useGameStore.getState().screen).toBe('game')
  })

  it('offers no Continue with nothing saved', () => {
    render(<App />)
    expect(screen.queryByRole('button', { name: /Continue/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Saved settlements/ })).toBeTruthy()
  })
})

describe('new settlement', () => {
  it('puts a second settlement in a free slot and keeps the first', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    answerDrafts()
    const first = useGameStore.getState().run!
    expect(useGameStore.getState().activeSlot).toBe('auto')

    act(() => useGameStore.getState().goToScreen('menu'))
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    const picker = screen.getByRole('radiogroup', { name: 'Save slot' })
    // The run in progress is shown in its slot, and a free one is preselected.
    expect(
      within(picker)
        .getByLabelText(/Autosave/)
        .closest('label')!.textContent,
    ).toMatch(/Playing now/)
    expect((within(picker).getByLabelText(/Slot 1/) as HTMLInputElement).checked).toBe(
      true,
    )
    fireEvent.click(screen.getByRole('button', { name: /Set out with/i }))
    expect(useGameStore.getState().activeSlot).toBe('1')
    expect(loadSlot('auto')!.seed).toBe(first.seed)
  })

  it('asks before replacing when every slot is full', () => {
    for (const [i, id] of SLOT_IDS.entries()) seedSlot(id, 100 + i, i + 1)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /New settlement/i }))
    expect(screen.getByText(/Every slot holds a settlement/)).toBeTruthy()
    const blocked = screen.getByRole('button', {
      name: /Choose a save slot/,
    }) as HTMLButtonElement
    expect(blocked.disabled).toBe(true)

    fireEvent.click(screen.getByLabelText(/Slot 2/))
    const go = screen.getByRole('button', { name: /Set out with/i })
    expect(go.textContent).toMatch(/replaces Slot 2/)
    // The first press only arms it: nothing is overwritten yet.
    fireEvent.click(go)
    expect(useGameStore.getState().run).toBeNull()
    expect(loadSlot('2')!.seed).toBe(102)
    fireEvent.click(screen.getByRole('button', { name: /Replace Slot 2\? Click again/ }))
    expect(useGameStore.getState().activeSlot).toBe('2')
    expect(useGameStore.getState().run!.seed).not.toBe(102)
    expect(SLOT_IDS.map((id) => loadSlot(id)!.seed)).toEqual([
      100,
      101,
      useGameStore.getState().run!.seed,
      103,
    ])
  })
})

describe('load screen', () => {
  function openSaves() {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Saved settlements/ }))
    return screen.getByRole('list', { name: 'Save slots' })
  }

  it('lists every slot with its metadata, and loads one', () => {
    seedSlot('1', 7, Date.now())
    const list = openSaves()
    const cards = within(list).getAllByRole('listitem')
    expect(cards).toHaveLength(4)
    expect(cards[0].textContent).toMatch(/Autosave.*Empty slot/)
    expect(cards[1].textContent).toMatch(/Slot 1/)
    expect(cards[1].textContent).toMatch(/Year 3/)
    expect(cards[1].textContent).toMatch(/Seed 7/)
    expect(cards[1].textContent).toMatch(/Played just now/)
    fireEvent.click(within(cards[1]).getByRole('button', { name: /Load Slot 1/ }))
    expect(useGameStore.getState().run!.seed).toBe(7)
  })

  it('deletes only after a second press', () => {
    seedSlot('3', 9, 1)
    const list = openSaves()
    const card = within(list).getAllByRole('listitem')[3]
    fireEvent.click(within(card).getByRole('button', { name: /Delete Slot 3/ }))
    expect(loadSlot('3')).not.toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: /Click again/ }))
    expect(loadSlot('3')).toBeNull()
    expect(within(list).getAllByRole('listitem')[3].textContent).toMatch(/Empty slot/)
  })

  it('shows a slot as text to copy on a phone', () => {
    seedSlot('auto', 5, 1)
    const list = openSaves()
    fireEvent.click(within(list).getByRole('button', { name: /Copy text of Autosave/ }))
    const text = (screen.getByLabelText('Save text') as HTMLTextAreaElement).value
    expect(JSON.parse(text).format).toBe('emberwatch-run')
    expect(JSON.parse(text).run.seed).toBe(5)
  })

  it('imports pasted text after checking it, and rejects junk clearly', () => {
    seedSlot('auto', 5, 1)
    openSaves()
    fireEvent.click(screen.getByRole('button', { name: /Paste save text/ }))
    const box = screen.getByLabelText('Save text to import')

    fireEvent.change(box, { target: { value: '{"__proto__":{"polluted":1}}' } })
    fireEvent.click(screen.getByRole('button', { name: /Check this save/ }))
    expect(screen.getByRole('alert').textContent).toMatch(/not an Emberwatch save/)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()

    const run = createRun({ seed: 64, meta: defaultMeta() })
    fireEvent.change(box, { target: { value: saveFileText(run) } })
    fireEvent.click(screen.getByRole('button', { name: /Check this save/ }))
    expect(screen.queryByRole('alert')).toBeNull()
    // A free slot is preselected; the occupied autosave is never the default.
    fireEvent.click(screen.getByRole('button', { name: 'Import into Slot 1' }))
    expect(loadSlot('1')!.seed).toBe(64)
    expect(loadSlot('auto')!.seed).toBe(5)
    expect(screen.getByText('Imported into Slot 1.')).toBeTruthy()
    expect(listSlots()[1].meta!.seed).toBe(64)
  })

  it('imports a file over an occupied slot only after confirming', async () => {
    seedSlot('auto', 5, 1)
    openSaves()
    const run = createRun({ seed: 65, meta: defaultMeta() })
    const file = new File([saveFileText(run)], 'run.json', { type: 'application/json' })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Save file to import'), {
        target: { files: [file] },
      })
    })
    const picker = await screen.findByRole('radiogroup', { name: 'Import into' })
    fireEvent.click(within(picker).getByLabelText(/Autosave/))
    fireEvent.click(screen.getByRole('button', { name: /Import, replacing Autosave/ }))
    expect(loadSlot('auto')!.seed).toBe(5)
    fireEvent.click(screen.getByRole('button', { name: /Replace Autosave\? Click again/ }))
    expect(loadSlot('auto')!.seed).toBe(65)
  })
})
