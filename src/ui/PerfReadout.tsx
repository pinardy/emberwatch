import { useEffect, useRef } from 'react'
import { useGameStore } from '../game/store'
import { perfStats } from './perfStats'

/** How often the readout refreshes, and the window its numbers cover. */
export const PERF_WINDOW_MS = 500

export interface PerfWindow {
  fps: number
  /** Mean time between frames, ms. */
  frameMs: number
  /** Longest frame in the window, ms. */
  worstMs: number
}

/** Frames-per-second and frame times from the gaps between frames, in ms. */
export function summarise(gaps: readonly number[]): PerfWindow | null {
  if (gaps.length === 0) return null
  let total = 0
  let worst = 0
  for (const gap of gaps) {
    total += gap
    if (gap > worst) worst = gap
  }
  const frameMs = total / gaps.length
  return { fps: frameMs > 0 ? 1000 / frameMs : 0, frameMs, worstMs: worst }
}

/** "60 fps · 16.7 ms (max 22)" and, on the 3D map, "53 draw calls". */
export function perfText(w: PerfWindow, drawCalls: number | null): [string, string] {
  const line =
    `${Math.round(w.fps)} fps · ${w.frameMs.toFixed(1)} ms` + ` (max ${Math.round(w.worstMs)})`
  return [line, drawCalls === null ? '2D map: no draw calls' : `${drawCalls} draw calls`]
}

/**
 * An opt-in performance readout over the map (Settings → Show performance),
 * so the game can be checked on real hardware: frames per second and frame
 * time from the browser's own frame clock, and the 3D renderer's draw calls.
 * Off, it is not mounted at all, and the 3D map mounts no probe: no cost.
 * On, it writes its text twice a second straight to the DOM, without a React
 * render per frame.
 */
export function PerfReadout() {
  const on = useGameStore((s) => s.settings.showPerf)
  return on ? <PerfPanel /> : null
}

function PerfPanel() {
  const first = useRef<HTMLSpanElement>(null)
  const second = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let frame = 0
    let last = performance.now()
    let windowStart = last
    const gaps: number[] = []
    const step = (now: number) => {
      gaps.push(now - last)
      last = now
      if (now - windowStart >= PERF_WINDOW_MS) {
        const summary = summarise(gaps)
        if (summary && first.current && second.current) {
          const [a, b] = perfText(summary, perfStats.drawCalls)
          first.current.textContent = a
          second.current.textContent = b
        }
        gaps.length = 0
        windowStart = now
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div className="perf-readout" role="group" aria-label="Performance">
      <span ref={first}>Measuring…</span>
      <span ref={second} />
    </div>
  )
}
