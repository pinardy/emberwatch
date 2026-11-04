import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/** How long "ready to play offline" stays up. It is good news, not a question. */
const OFFLINE_READY_MS = 4000

/**
 * Service-worker status. `autoUpdate` installs new versions in the background,
 * so this is purely to tell the player what happened — and to let them reload
 * at a safe moment rather than mid-storm.
 *
 * Neither form may sit on top of a primary action: "offline ready" is a small
 * pill that ignores the pointer and fades on its own, and "new version" is a
 * strip in the page flow that pushes the screen down instead of covering it.
 */
export function UpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  useEffect(() => {
    if (!offlineReady) return
    const timer = window.setTimeout(() => setOfflineReady(false), OFFLINE_READY_MS)
    return () => window.clearTimeout(timer)
  }, [offlineReady, setOfflineReady])

  if (needRefresh) {
    return (
      <div className="sw-toast is-strip" role="status">
        <span>A new version of Emberwatch is ready.</span>
        <button type="button" className="primary" onClick={() => updateServiceWorker(true)}>
          Reload
        </button>
        <button type="button" onClick={() => setNeedRefresh(false)}>
          Later
        </button>
      </div>
    )
  }

  if (!offlineReady) return null

  return (
    <div className="sw-toast is-pill" role="status">
      <span aria-hidden>✓ </span>Ready to play offline
    </div>
  )
}
