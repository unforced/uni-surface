// IndexedDB schema for offline capture. Three stores:
//  - outbox: queued mutations (FIFO by autoincrement `seq`), survives reloads.
//  - idmap:  localId → server note id, written once a create-note succeeds so
//            later mutations (attachments) can resolve their target.
//  - blobs:  audio bytes for a voice capture made offline, plus the storage
//            path once uploaded (so link-attachment can resolve it).
//
// Mirrors the proven Parachute Notes sync model, trimmed to this app's needs.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

// A queued write. `kind` discriminates the payload.
export type Mutation =
  | {
      kind: 'create-note'
      localId: string
      path: string
      content: string
      tags: string[]
      metadata: Record<string, unknown>
    }
  | { kind: 'upload-attachment'; blobId: string }
  | {
      kind: 'link-attachment'
      noteLocalId: string
      blobId: string
      mimeType: string
      transcribe: boolean
    }

export type OutboxStatus = 'pending' | 'needs-human'

export interface OutboxRow {
  seq?: number // autoincrement primary key (assigned on add)
  id: string // stable uuid (for dedupe / references)
  vaultOrigin: string // which vault this belongs to — safe across vault switches
  mutation: Mutation
  createdAt: number
  attemptCount: number
  nextAttemptAt: number // epoch ms; row is skipped until now >= this
  status: OutboxStatus
  lastError?: string
}

export interface BlobRow {
  blobId: string
  vaultOrigin: string
  data: ArrayBuffer
  mimeType: string
  filename: string
  storagePath?: string // set after upload-attachment succeeds
}

interface PVDB extends DBSchema {
  outbox: { key: number; value: OutboxRow; indexes: { 'by-status': OutboxStatus } }
  idmap: { key: string; value: { localId: string; serverId: string } }
  blobs: { key: string; value: BlobRow }
}

let dbp: Promise<IDBPDatabase<PVDB>> | null = null

export function getDB(): Promise<IDBPDatabase<PVDB>> {
  if (!dbp) {
    dbp = openDB<PVDB>('pv-sync', 1, {
      upgrade(db) {
        const outbox = db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true })
        outbox.createIndex('by-status', 'status')
        db.createObjectStore('idmap', { keyPath: 'localId' })
        db.createObjectStore('blobs', { keyPath: 'blobId' })
      },
    })
  }
  return dbp
}

export function newLocalId(): string {
  return crypto.randomUUID()
}
