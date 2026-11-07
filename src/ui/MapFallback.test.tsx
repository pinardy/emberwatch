import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '../game/persistence'
import { useGameStore } from '../game/store'
import { createRun } from '../game/engine/createRun'
import { CONTEXT_RESTORE_GRACE_MS, MAP_FALLBACK_NOTICE, MapView } from './MapView'
import { forgetWebGLCheckForTests, preloadMapView3D } from './map3dLoader'

/*
 * The 3D map's safety nets, with a stand-in for the three.js scene: a scene
 * that throws falls back to the 2D map (and switches the setting), a lost
 * WebGL context that does not come back does the same, and the 3D chunk is
 * preloaded only when it is the renderer the game will show.
 */

const fake = vi.hoisted(() => ({ mode: 'ok' as 'ok' | 'throw', imported: 0 }))

vi.mock('./map3d/MapView3D', () => {
  fake.imported++
  return {
    MapView3D: () => {
      if (fake.mode === 'throw') throw new Error('Shader failed to compile')
      return <canvas data-testid="gl-canvas" />
    },
  }
})

beforeEach(() => {
  // A canvas that says it can do WebGL, as a real browser's would.
  vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {})
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({}) as unknown as RenderingContext,
  )
  forgetWebGLCheckForTests()
  fake.mode = 'ok'
  const run = createRun({ seed: 11, species: ['human', 'beaver', 'lizard'], modifiers: [] })
  useGameStore.setState({
    screen: 'game',
    run,
    notice: null,
    settings: { ...defaultSettings(), renderer: '3d', sound: false },
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  forgetWebGLCheckForTests()
})

describe('preloading the 3D map', () => {
  it('does not fetch it while the 2D map is the renderer', async () => {
    useGameStore.setState({ settings: { ...defaultSettings(), renderer: '2d' } })
    await preloadMapView3D()
    expect(fake.imported).toBe(0)
  })

  it('fetches it in advance when the 3D map is the renderer', async () => {
    await preloadMapView3D()
    expect(fake.imported).toBe(1)
  })
})

describe('when the 3D map fails', () => {
  it('shows the 2D map and switches the renderer setting', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    fake.mode = 'throw'
    render(<MapView />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(await screen.findByRole('img', { name: /Settlement map/i })).toBeTruthy()
    expect(screen.queryByTestId('gl-canvas')).toBeNull()
    expect(useGameStore.getState().settings.renderer).toBe('2d')
    expect(useGameStore.getState().notice).toBe(MAP_FALLBACK_NOTICE)
    error.mockRestore()
  })

  it('falls back when the WebGL context is lost and not restored', async () => {
    render(<MapView />)
    const canvas = await screen.findByTestId('gl-canvas')
    vi.useFakeTimers()
    // Context events do not bubble.
    act(() => {
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    })
    act(() => {
      vi.advanceTimersByTime(CONTEXT_RESTORE_GRACE_MS - 100)
    })
    expect(useGameStore.getState().settings.renderer).toBe('3d')
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(useGameStore.getState().settings.renderer).toBe('2d')
    expect(screen.queryByTestId('gl-canvas')).toBeNull()
  })

  it('stays on the 3D map when the context comes back in time', async () => {
    render(<MapView />)
    const canvas = await screen.findByTestId('gl-canvas')
    vi.useFakeTimers()
    act(() => {
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
      canvas.dispatchEvent(new Event('webglcontextrestored'))
    })
    act(() => {
      vi.advanceTimersByTime(CONTEXT_RESTORE_GRACE_MS * 2)
    })
    expect(useGameStore.getState().settings.renderer).toBe('3d')
    expect(screen.getByTestId('gl-canvas')).toBeTruthy()
  })
})
