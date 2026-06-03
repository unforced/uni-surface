import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

// The PWA update nudge. With registerType:'prompt', a freshly-deployed service
// worker installs but WAITS — `needRefresh` flips true and we surface a calm
// banner. Tapping "Refresh" activates the new SW and reloads onto it. This is
// also our cure for the stale-bundle problem: no more manual hard-refresh.
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
    offlineReady: [offlineReady, setOfflineReady],
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      // Poll for a new deploy hourly (and the browser checks on navigation too).
      if (registration) {
        setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000)
      }
    },
  })

  // The "installed & ready offline" note is a one-time reassurance; auto-dismiss.
  useEffect(() => {
    if (!offlineReady) return
    const t = setTimeout(() => setOfflineReady(false), 4000)
    return () => clearTimeout(t)
  }, [offlineReady, setOfflineReady])

  if (!needRefresh && !offlineReady) return null

  if (needRefresh) {
    return (
      <div className="update-banner" role="status">
        <span className="update-spark">🌱</span>
        <span className="update-text">A new version is ready.</span>
        <button className="update-btn" onClick={() => updateServiceWorker(true)}>
          Refresh
        </button>
        <button className="update-dismiss" aria-label="Dismiss" onClick={() => setNeedRefresh(false)}>
          ×
        </button>
      </div>
    )
  }

  return (
    <div className="update-banner subtle" role="status">
      <span className="update-spark">🌿</span>
      <span className="update-text">Ready to work offline.</span>
    </div>
  )
}
