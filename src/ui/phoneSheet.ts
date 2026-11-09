import {
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { create } from 'zustand'
import { useGameStore, type SidePanel } from '../game/store'
import { useNarrowScreen } from './useNarrowScreen'

/*
 * The side panel's bottom sheet on phones (860px and narrower): folded to its tabs,
 * a short "peek" (the tabs and a few lines, the default, so the map has most
 * of the screen) or tall. The handle steps folded → peek → tall → folded, the
 * tab row can be dragged between the three, and the last choice is
 * remembered in this browser. Desktop keeps its side rail and never reads it.
 *
 * Folded is the store's `panel === null`, as it always was; the size here is
 * the height an open sheet takes.
 */

export type SheetSize = 'peek' | 'full'
export type SheetMode = 'folded' | SheetSize

export const SHEET_KEY = 'emberwatch.sheet.v1'

/**
 * The open heights, as shares of the window's height. styles.css carries the
 * same numbers (`.sidebar.sheet-peek` / `.sheet-full`); the drag snaps by them.
 */
export const SHEET_PEEK_VH = 22
export const SHEET_FULL_VH = 60

function loadMode(): SheetMode {
  try {
    const value = localStorage.getItem(SHEET_KEY)
    return value === 'folded' || value === 'full' ? value : 'peek'
  } catch {
    return 'peek'
  }
}

function saveMode(mode: SheetMode): void {
  try {
    localStorage.setItem(SHEET_KEY, mode)
  } catch {
    /* private mode: the sheet just opens at its default next time */
  }
}

interface PhoneSheetState {
  /** The height an open sheet takes. */
  size: SheetSize
  setSize: (size: SheetSize) => void
  /** Records the player's choice for next time. */
  remember: (mode: SheetMode) => void
  /** Where coach tips go on phones: a slot at the top of the open sheet. */
  tipSlot: HTMLElement | null
  setTipSlot: (el: HTMLElement | null) => void
}

const initial = loadMode()

export const usePhoneSheet = create<PhoneSheetState>((set) => ({
  size: initial === 'full' ? 'full' : 'peek',
  setSize: (size) => set({ size }),
  remember: (mode) => saveMode(mode),
  tipSlot: null,
  setTipSlot: (tipSlot) => set({ tipSlot }),
}))

/** The mode remembered from an earlier visit (read fresh, for a run being shown). */
export function rememberedSheetMode(): SheetMode {
  return loadMode()
}

/** Tests: start from a clean sheet. */
export function resetPhoneSheetForTests(): void {
  usePhoneSheet.setState({ size: loadMode() === 'full' ? 'full' : 'peek' })
}

/** What the handle does next from where the sheet stands. */
export function nextSheetMode(open: boolean, size: SheetSize): SheetMode {
  if (!open) return size
  return size === 'peek' ? 'full' : 'folded'
}

/** The handle's words for that next step. */
export function sheetHandleLabel(open: boolean, size: SheetSize): string {
  const next = nextSheetMode(open, size)
  if (next === 'folded') return 'Fold the panel away'
  return open ? 'Expand the panel' : 'Open the panel'
}

/** Where a dragged sheet settles: the nearest of folded, peek and tall. */
export function snapSheet(height: number, tabsHeight: number, viewportHeight: number): SheetMode {
  const peek = Math.max(150, (viewportHeight * SHEET_PEEK_VH) / 100)
  const full = (viewportHeight * SHEET_FULL_VH) / 100
  if (height < (tabsHeight + peek) / 2) return 'folded'
  if (height < (peek + full) / 2) return 'peek'
  return 'full'
}

const DRAG_START = 8

/**
 * Dragging the sheet by its tab row: the sheet follows the finger and, on
 * release, settles on the nearest height. A drag never also counts as a tap
 * on the tab it began on.
 */
export function useSheetDrag(enabled: boolean, onSettle: (mode: SheetMode) => void) {
  const drag = useRef<{
    id: number
    startY: number
    startHeight: number
    el: HTMLElement
    moving: boolean
  } | null>(null)
  const swallowClick = useRef(false)

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
    // Only the tab row and the handle drag: the panel's own content scrolls.
    if (!(e.target as Element | null)?.closest?.('.tabs, .sheet-handle')) return
    const el = e.currentTarget
    drag.current = {
      id: e.pointerId,
      startY: e.clientY,
      startHeight: el.getBoundingClientRect().height,
      el,
      moving: false,
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    const dy = d.startY - e.clientY
    if (!d.moving) {
      if (Math.abs(dy) < DRAG_START) return
      d.moving = true
      d.el.setPointerCapture?.(e.pointerId)
      d.el.classList.add('is-dragging')
    }
    const max = window.innerHeight * 0.75
    const height = Math.min(max, Math.max(0, d.startHeight + dy))
    d.el.style.maxHeight = 'none'
    d.el.style.height = `${Math.round(height)}px`
  }

  const finish = (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    drag.current = null
    if (!d.moving) return
    const height = d.el.getBoundingClientRect().height
    d.el.style.maxHeight = ''
    d.el.style.height = ''
    d.el.classList.remove('is-dragging')
    d.el.releasePointerCapture?.(e.pointerId)
    swallowClick.current = true
    window.setTimeout(() => {
      swallowClick.current = false
    }, 0)
    if (cancelled) return
    const tabs = d.el.querySelector<HTMLElement>('.tabs')
    onSettle(snapSheet(height, tabs?.offsetHeight ?? 56, window.innerHeight))
  }

  const onClickCapture = (e: ReactMouseEvent<HTMLElement>) => {
    if (!swallowClick.current) return
    swallowClick.current = false
    e.preventDefault()
    e.stopPropagation()
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => finish(e, false),
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => finish(e, true),
    onClickCapture,
  }
}

/**
 * Everything GameScreen's side panel needs for the sheet: the handle's step,
 * label and arrow, tab presses that remember a fold, the drag, the size class
 * and the slot coach tips go into. On desktop the handle folds and opens the
 * panel exactly as before, and nothing else applies.
 */
export function usePhoneSheetControls() {
  const narrow = useNarrowScreen()
  const panel = useGameStore((s) => s.panel)
  const setPanel = useGameStore((s) => s.setPanel)
  const size = usePhoneSheet((s) => s.size)
  const setSize = usePhoneSheet((s) => s.setSize)
  const remember = usePhoneSheet((s) => s.remember)
  const setTipSlot = usePhoneSheet((s) => s.setTipSlot)
  const lastPanel = useRef<Exclude<SidePanel, null>>(panel ?? 'build')
  if (panel) lastPanel.current = panel

  // A sheet the player folded stays folded when they come back.
  const restored = useRef(false)
  useEffect(() => {
    if (!narrow || restored.current) return
    restored.current = true
    if (rememberedSheetMode() === 'folded') setPanel(null)
  }, [narrow, setPanel])

  const apply = (mode: SheetMode) => {
    if (mode === 'folded') {
      setPanel(null)
      setSize('peek')
    } else {
      setSize(mode)
      if (useGameStore.getState().panel === null) setPanel(lastPanel.current)
    }
    remember(mode)
  }
  const drag = useSheetDrag(narrow, apply)

  const open = panel !== null
  const next = nextSheetMode(open, size)
  return {
    narrow,
    className: narrow ? ` sheet-${size}` : '',
    handleLabel: narrow ? sheetHandleLabel(open, size) : open ? 'Fold the panel away' : 'Open the panel',
    handleIcon: (narrow ? next === 'folded' : open) ? '▾' : '▴',
    onHandle: () => {
      if (narrow) apply(next)
      else setPanel(open ? null : 'build')
    },
    /** A tab press: the tab, or null when the open tab is pressed again (a fold). */
    onTab: (to: SidePanel) => {
      setPanel(to)
      if (narrow) remember(to === null ? 'folded' : size)
    },
    dragHandlers: narrow ? drag : {},
    tipSlotRef: setTipSlot,
  }
}
