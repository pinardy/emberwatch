import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useGameStore } from '../game/store'
import { RecoveryOverlay } from './RecoveryOverlay'

/**
 * The app's last line of defence: a render error anywhere below stops play and
 * the autosave (through the store, as a game-loop crash does) and puts up the
 * recovery overlay in place of a white screen. A recovery bumps the store's
 * `recoveryEpoch`, which the caller uses as this boundary's key, so the app
 * mounts afresh behind it.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('A screen failed to render:', info.componentStack)
    useGameStore.getState().reportCrash(error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="screen recovery-backdrop">
        <RecoveryOverlay />
      </div>
    )
  }
}

/** The app inside a boundary that starts afresh after each recovery. */
export function GuardedApp({ children }: { children: ReactNode }) {
  const epoch = useGameStore((s) => s.recoveryEpoch)
  return <ErrorBoundary key={epoch}>{children}</ErrorBoundary>
}
