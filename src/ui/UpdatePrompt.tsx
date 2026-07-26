import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Service-worker status strip. `autoUpdate` installs new versions in the
 * background, so this is purely to tell the player what happened — and to let
 * them reload at a safe moment rather than mid-storm.
 */
export function UpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!offlineReady && !needRefresh) return null

  return (
    <div className="sw-toast" role="status">
      {needRefresh ? (
        <>
          <span>A new version of Emberwatch is ready.</span>
          <button type="button" className="primary" onClick={() => updateServiceWorker(true)}>
            Reload
          </button>
          <button type="button" onClick={() => setNeedRefresh(false)}>
            Later
          </button>
        </>
      ) : (
        <>
          <span>Ready to play offline.</span>
          <button type="button" onClick={() => setOfflineReady(false)}>
            Dismiss
          </button>
        </>
      )}
    </div>
  )
}
