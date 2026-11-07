import { useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGameStore } from '../../game/store'
import { perfStats } from '../perfStats'

/**
 * Reports the renderer's draw calls to the performance readout. Mounted only
 * while the readout is on. The renderer resets its counters at the start of
 * every render, so read before this frame's render they hold the last
 * frame's totals (shadow passes included).
 */
function Probe() {
  const gl = useThree((s) => s.gl)
  useFrame(() => {
    perfStats.drawCalls = gl.info.render.calls
  })
  useEffect(
    () => () => {
      perfStats.drawCalls = null
    },
    [],
  )
  return null
}

/** The probe, when Settings → Show performance is on. */
export function PerfProbe() {
  const on = useGameStore((s) => s.settings.showPerf)
  return on ? <Probe /> : null
}
