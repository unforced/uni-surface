import { useSyncStatus, runOnce } from '../vault/sync/engine'

// A quiet topbar indicator: only shows when there's something to say — offline,
// captures waiting to sync, or a row stuck on a conflict. Silent when all clear.
export function SyncBadge() {
  const { online, pending, needsHuman } = useSyncStatus()

  if (online && pending === 0 && needsHuman === 0) return null

  const label = !online
    ? pending > 0
      ? `offline · ${pending} queued`
      : 'offline'
    : needsHuman > 0
      ? `${needsHuman} need${needsHuman === 1 ? 's' : ''} attention`
      : `syncing ${pending}…`

  const tone = !online ? 'offline' : needsHuman > 0 ? 'stuck' : 'syncing'

  return (
    <button
      className={`sync-badge ${tone}`}
      title={online ? 'Tap to sync now' : 'You are offline — captures are queued and will sync when you reconnect'}
      onClick={() => online && void runOnce()}
    >
      <span className="sync-dot" aria-hidden />
      <span>{label}</span>
    </button>
  )
}
