// The sync engine: drives drainOutbox on a tick, on reconnect, and on tab
// focus. Idempotent start (safe under React StrictMode double-mount).
import { useEffect, useState } from 'react'
import { hasConfig } from '../config'
import { drainOutbox, onOutboxChange, outboxCounts } from './outbox'

const TICK_MS = 30_000

let started = false
let timer: ReturnType<typeof setInterval> | null = null
let running = false
let authHalted = false

// Run a single drain pass, guarded against re-entry and pointless attempts.
export async function runOnce(): Promise<void> {
  if (running) return
  if (!navigator.onLine) return
  if (!hasConfig()) return
  running = true
  try {
    const res = await drainOutbox()
    authHalted = res.authHalt
  } catch {
    /* swallow — next tick retries */
  } finally {
    running = false
  }
}

export function isAuthHalted(): boolean {
  return authHalted
}

export function startSyncEngine(): void {
  if (started) return
  started = true
  window.addEventListener('online', () => void runOnce())
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void runOnce()
  })
  timer = setInterval(() => void runOnce(), TICK_MS)
  void runOnce()
}

export function stopSyncEngine(): void {
  if (timer) clearInterval(timer)
  timer = null
  started = false
}

// ── React hook: live sync status for the topbar badge ──
export interface SyncStatus {
  online: boolean
  pending: number
  needsHuman: number
}

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({
    online: navigator.onLine,
    pending: 0,
    needsHuman: 0,
  })

  useEffect(() => {
    let live = true
    const refresh = async () => {
      const counts = await outboxCounts()
      if (live) setStatus({ online: navigator.onLine, pending: counts.pending, needsHuman: counts.needsHuman })
    }
    refresh()
    const off = onOutboxChange(refresh)
    const onNet = () => refresh()
    window.addEventListener('online', onNet)
    window.addEventListener('offline', onNet)
    return () => {
      live = false
      off()
      window.removeEventListener('online', onNet)
      window.removeEventListener('offline', onNet)
    }
  }, [])

  return status
}
