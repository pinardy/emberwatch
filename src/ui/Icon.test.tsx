import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { IconId } from '../art/icons'
import { RESOURCES } from '../game/content/resources'
import { Icon, IconSymbols, IconUse } from './Icon'
import { IconText, tokenizeIconText } from './IconText'
import { MenuScreen } from './MenuScreen'
import { CORE_ICONS } from '../art/core'
import { useGameStore } from '../game/store'

afterEach(cleanup)

describe('Icon', () => {
  it('is decorative by default: hidden from assistive tech, no name', () => {
    const { container } = render(<Icon id="wood" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('role')).toBeNull()
    expect(svg.getAttribute('aria-label')).toBeNull()
    expect(svg.getAttribute('focusable')).toBe('false')
    expect(svg.getAttribute('data-icon')).toBe('wood')
    expect(svg.querySelectorAll('path').length).toBeGreaterThan(0)
  })

  it('is announced as an image when given a label', () => {
    render(<Icon id="amber" label="amber" />)
    const img = screen.getByRole('img', { name: 'amber' })
    expect(img.tagName.toLowerCase()).toBe('svg')
    expect(img.getAttribute('aria-hidden')).toBeNull()
  })

  it('names a button through its label when it stands for a word', () => {
    render(
      <button type="button">
        Rush for 3 <Icon of={RESOURCES.amber} label="amber" />
      </button>,
    )
    expect(screen.getByRole('button', { name: 'Rush for 3 amber' })).toBeTruthy()
  })

  it('draws content through `of`, using its art', () => {
    const { container } = render(<Icon of={RESOURCES.plank} />)
    expect(container.querySelector('svg')?.getAttribute('data-icon')).toBe('plank')
  })

  it('falls back to the emoji for content without art, or an unknown id', () => {
    const { container, rerender } = render(<Icon of={{ icon: '🐺' }} />)
    let span = container.querySelector('.icon-emoji')!
    expect(span.textContent).toBe('🐺')
    expect(span.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('svg')).toBeNull()

    // An id from somewhere untyped (an old save, say) that is not drawn.
    rerender(<Icon id={'unicorn' as IconId} emoji="🦄" label="unicorn" />)
    span = container.querySelector('.icon-emoji')!
    expect(span.textContent).toBe('🦄')
    expect(screen.getByRole('img', { name: 'unicorn' })).toBe(span)

    rerender(<Icon id={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('stamps symbols once and references them with <use>', () => {
    const { container } = render(
      <svg>
        <IconSymbols ids={['trees', 'shelter']} />
        <IconUse id="trees" x={10} y={20} size={22} />
      </svg>,
    )
    expect(container.querySelectorAll('symbol').length).toBe(2)
    const use = container.querySelector('use')!
    expect(use.getAttribute('href')).toBe('#art-trees')
    expect(container.querySelector('#art-trees')).not.toBeNull()
    expect(use.getAttribute('x')).toBe('-1')
    expect(use.getAttribute('width')).toBe('22')
  })
})

describe('IconText', () => {
  it('swaps a glyph only when its name follows or it heads the line', () => {
    expect(tokenizeIconText('steals 6 🫐Berries, 2 🪵 Wood')).toEqual([
      'steals 6 ',
      { art: 'berry', glyph: '🫐' },
      'Berries, 2 ',
      { art: 'wood', glyph: '🪵' },
      ' Wood',
    ])
    expect(tokenizeIconText('🔥 Hearth wood runs out in 1:00.')[0]).toEqual({
      art: 'ancientHearth',
      glyph: '🔥',
    })
    // A wood glyph standing for something else, mid-line, stays an emoji.
    expect(tokenizeIconText('Lay of the land: 🪵 Old Growth')).toEqual([
      'Lay of the land: 🪵 Old Growth',
    ])
    // A glyph written with its variation selector is still matched.
    expect(tokenizeIconText('🕯️ Your Religion service has no worker.')[0]).toEqual({
      art: 'religion',
      glyph: '🕯️',
    })
  })

  it('renders the text unchanged when nothing is drawn', () => {
    const { container } = render(
      <p>
        <IconText text="🐺 Wolves circle the camp." />
      </p>,
    )
    expect(container.textContent).toBe('🐺 Wolves circle the camp.')
    expect(container.querySelector('svg')).toBeNull()
  })

  it('keeps the words when it draws the icons', () => {
    const { container } = render(
      <p>
        <IconText text="⏳ Waiting for 2 🪵 Wood." />
      </p>,
    )
    expect(container.textContent).toBe(' Waiting for 2  Wood.')
    expect([...container.querySelectorAll('svg')].map((s) => s.getAttribute('data-icon'))).toEqual([
      'impatience',
      'wood',
    ])
  })
})

describe('the menu draws from the eager core', () => {
  it('needs nothing from the lazy registry, so its first frame shows no emoji', () => {
    // A run in progress puts the Continue line on the menu too.
    localStorage.clear()
    useGameStore.getState().startRun(77)
    useGameStore.getState().goToScreen('menu')
    const { container } = render(<MenuScreen />)
    const drawn = [...container.querySelectorAll('svg[data-icon]')].map((s) => s.getAttribute('data-icon'))
    expect(drawn).toEqual(expect.arrayContaining(['small', 'folder', 'guildHouse', 'medal', 'calendar']))
    // Every icon the menu shows ships in the startup chunk…
    for (const id of drawn) expect(Object.keys(CORE_ICONS), String(id)).toContain(id)
    // …and nothing falls back to its emoji.
    expect(container.querySelectorAll('.icon-emoji')).toHaveLength(0)
  })
})
