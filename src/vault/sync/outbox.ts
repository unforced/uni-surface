// The offline write queue. Captures ALWAYS go here first (online or off); a
// drain pass flushes them to the vault in FIFO order, with backoff + conflict
// handling. This is what makes capture work with no network and sync later.
import { createNote, uploadStorageFile, addAttachment, VaultError } from '../api'
import { getConfig } from '../config'
import type { Note } from '../types'
import { getDB, newLocalId, type Mutation, type OutboxRow, type BlobRow } from './db'

// A mutation whose dependency (a create's server id, or an upload's path) isn't
// ready yet — try again on the next pass rather than failing the row.
class DeferError extends Error {}

function currentOrigin(): string | null {
  return getConfig()?.origin ?? null
}

// ── change notification (so the UI can reflect pending count live) ──
const listeners = new Set<() => void>()
export function onOutboxChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function notify() {
  for (const l of listeners) l()
  window.dispatchEvent(new CustomEvent('pv:outbox-change'))
}

// ── enqueue ──
export async function enqueue(mutation: Mutation): Promise<OutboxRow> {
  const db = await getDB()
  const row: OutboxRow = {
    id: crypto.randomUUID(),
    vaultOrigin: currentOrigin() ?? '',
    mutation,
    createdAt: Date.now(),
    attemptCount: 0,
    nextAttemptAt: 0,
    status: 'pending',
  }
  const seq = (await db.add('outbox', row)) as number
  notify()
  return { ...row, seq }
}

// Stash audio bytes for a voice capture so it survives offline + reloads.
export async function putBlob(data: ArrayBuffer, mimeType: string, filename: string): Promise<string> {
  const db = await getDB()
  const blobId = newLocalId()
  const row: BlobRow = { blobId, vaultOrigin: currentOrigin() ?? '', data, mimeType, filename }
  await db.put('blobs', row)
  return blobId
}

// ── optimistic rendering ──
// A synthetic Note for a not-yet-synced create-note, so Today can show it now.
export function optimisticNote(row: OutboxRow): Note | null {
  const m = row.mutation
  if (m.kind !== 'create-note') return null
  const iso = new Date(row.createdAt).toISOString()
  return {
    id: `local:${m.localId}`,
    path: m.path,
    content: m.content,
    tags: m.tags,
    metadata: { ...m.metadata },
    createdAt: iso,
    updatedAt: iso,
  }
}

// Pending create-note captures for the active vault, newest first.
export async function pendingCaptures(): Promise<Note[]> {
  const db = await getDB()
  const origin = currentOrigin()
  const rows = await db.getAll('outbox')
  return rows
    .filter((r) => r.vaultOrigin === origin && r.mutation.kind === 'create-note')
    .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))
    .map(optimisticNote)
    .filter((n): n is Note => n !== null)
}

export interface OutboxCounts {
  pending: number // rows still trying
  needsHuman: number // rows stuck on a conflict
}
export async function outboxCounts(): Promise<OutboxCounts> {
  const db = await getDB()
  const origin = currentOrigin()
  const rows = (await db.getAll('outbox')).filter((r) => r.vaultOrigin === origin)
  return {
    pending: rows.filter((r) => r.status === 'pending').length,
    needsHuman: rows.filter((r) => r.status === 'needs-human').length,
  }
}

// ── drain ──
const BASE_BACKOFF = 2000
const MAX_BACKOFF = 5 * 60 * 1000
function backoff(attempt: number): number {
  return Math.min(BASE_BACKOFF * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF)
}

// Outcome of a drain pass. `authHalt` means a write hit 401/403 — the engine
// should stop and the UI should prompt re-auth.
export interface DrainResult {
  done: number
  remaining: number
  authHalt: boolean
}

// Resolve a localId to its server note id (written by a prior create-note).
async function resolveServerId(localId: string): Promise<string> {
  const db = await getDB()
  const row = await db.get('idmap', localId)
  if (!row) throw new DeferError(`note ${localId} not created yet`)
  return row.serverId
}

// Apply one mutation against the live vault. Throws DeferError to retry later,
// VaultError to classify (auth/conflict/transient).
async function apply(mutation: Mutation): Promise<void> {
  const db = await getDB()
  switch (mutation.kind) {
    case 'create-note': {
      const note = await createNote({
        path: mutation.path,
        content: mutation.content,
        tags: mutation.tags,
        metadata: mutation.metadata,
      })
      await db.put('idmap', { localId: mutation.localId, serverId: note.id })
      // Let the UI swap the optimistic card for the real one.
      window.dispatchEvent(
        new CustomEvent('pv:capture-synced', { detail: { localId: mutation.localId, note } }),
      )
      return
    }
    case 'upload-attachment': {
      const blob = await db.get('blobs', mutation.blobId)
      if (!blob) return // blob gone (already uploaded/cleaned) — nothing to do
      if (blob.storagePath) return // already uploaded
      const file = new File([blob.data], blob.filename, { type: blob.mimeType })
      const uploaded = await uploadStorageFile(file)
      await db.put('blobs', { ...blob, storagePath: uploaded.path })
      return
    }
    case 'link-attachment': {
      const serverId = await resolveServerId(mutation.noteLocalId)
      const blob = await db.get('blobs', mutation.blobId)
      if (!blob?.storagePath) throw new DeferError('attachment not uploaded yet')
      await addAttachment(serverId, {
        path: blob.storagePath,
        mimeType: mutation.mimeType,
        transcribe: mutation.transcribe,
      })
      await db.delete('blobs', mutation.blobId) // bytes no longer needed
      return
    }
  }
}

// Drain the queue for the active vault, FIFO by seq. Stops early on a network
// failure (whole batch will likely fail) or an auth halt; continues past
// conflicts (parked as needs-human) and deferrals.
export async function drainOutbox(): Promise<DrainResult> {
  const db = await getDB()
  const origin = currentOrigin()
  if (!origin) return { done: 0, remaining: 0, authHalt: false }

  const all = (await db.getAll('outbox'))
    .filter((r) => r.vaultOrigin === origin)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))

  let done = 0
  let authHalt = false
  const now = Date.now()

  for (const row of all) {
    if (row.status === 'needs-human') continue
    if (row.nextAttemptAt > now) continue
    try {
      await apply(row.mutation)
      await db.delete('outbox', row.seq!)
      done++
      notify()
    } catch (e) {
      if (e instanceof DeferError) {
        await db.put('outbox', { ...row, nextAttemptAt: Date.now() + 5000 })
        continue
      }
      if (e instanceof VaultError && (e.status === 401 || e.status === 403)) {
        authHalt = true
        break // re-auth needed; leave the row to retry after sign-in
      }
      if (e instanceof VaultError && e.status === 409) {
        await db.put('outbox', { ...row, status: 'needs-human', lastError: e.message })
        notify()
        continue
      }
      // Network/offline (TypeError) or transient 5xx: backoff, then stop the
      // pass — the rest will share the same fate this round.
      const attemptCount = row.attemptCount + 1
      await db.put('outbox', {
        ...row,
        attemptCount,
        nextAttemptAt: Date.now() + backoff(attemptCount),
        lastError: e instanceof Error ? e.message : String(e),
      })
      notify()
      break
    }
  }

  const remaining = (await db.getAll('outbox')).filter(
    (r) => r.vaultOrigin === origin && r.status === 'pending',
  ).length
  if (done > 0) notify()
  return { done, remaining, authHalt }
}

// Wait (up to `timeoutMs`) for a specific create-note localId to get a server
// id — lets the capture UI hand back a real Note (to offer weaving) when online,
// while never blocking the offline path.
export async function awaitServerId(localId: string, timeoutMs = 8000): Promise<string | null> {
  const db = await getDB()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const row = await db.get('idmap', localId)
    if (row) return row.serverId
    await new Promise((r) => setTimeout(r, 250))
  }
  return null
}
