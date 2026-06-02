// Thin client over the Parachute Vault REST API.
// base = <origin>/api ; Authorization: Bearer <token> on every request.

import { getConfig } from './config'
import type { Note, NoteMetadata, TagRecord } from './types'

export class VaultError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'VaultError'
  }
}

function requireConfig() {
  const cfg = getConfig()
  if (!cfg) throw new VaultError(0, 'Vault not configured')
  return cfg
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const { origin, token } = requireConfig()
  const url = `${origin}/api${path}`
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    throw new VaultError(
      0,
      `Could not reach the vault at ${origin}. Is it running and reachable? (${
        e instanceof Error ? e.message : String(e)
      })`,
    )
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const j = await res.json()
      detail = (j && (j.error || j.message)) || detail
    } catch {
      /* ignore */
    }
    if (res.status === 401 || res.status === 403) {
      throw new VaultError(res.status, `Auth failed (${res.status}). Your token may be expired — re-paste it.`)
    }
    throw new VaultError(res.status, `${res.status} ${detail}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// ---- Notes ----

export interface NotesQuery {
  tag?: string
  search?: string
  pathPrefix?: string
  hasLinks?: boolean
  includeMetadata?: boolean
  includeLinks?: boolean
  includeContent?: boolean
  limit?: number
  offset?: number
  sort?: 'asc' | 'desc'
  dateFrom?: string
  dateTo?: string
}

export function listNotes(q: NotesQuery = {}): Promise<Note[]> {
  const p = new URLSearchParams()
  if (q.tag) p.set('tag', q.tag)
  if (q.search) p.set('search', q.search)
  if (q.pathPrefix) p.set('path_prefix', q.pathPrefix)
  if (q.hasLinks !== undefined) p.set('has_links', String(q.hasLinks))
  if (q.includeMetadata) p.set('include_metadata', 'true')
  if (q.includeLinks) p.set('include_links', 'true')
  if (q.includeContent) p.set('include_content', 'true')
  if (q.limit !== undefined) p.set('limit', String(q.limit))
  if (q.offset !== undefined) p.set('offset', String(q.offset))
  if (q.sort) p.set('sort', q.sort)
  if (q.dateFrom) p.set('date_from', q.dateFrom)
  if (q.dateTo) p.set('date_to', q.dateTo)
  const qs = p.toString()
  return request<Note[]>('GET', `/notes${qs ? `?${qs}` : ''}`)
}

export function getNote(
  idOrPath: string,
  opts: { includeLinks?: boolean } = {},
): Promise<Note> {
  // Paths contain slashes — encode the whole segment.
  const enc = encodeURIComponent(idOrPath)
  const qs = opts.includeLinks ? '?include_links=true' : ''
  return request<Note>('GET', `/notes/${enc}${qs}`)
}

export interface LinkAdd {
  target: string // path or id
  relationship: string
}

export interface PatchNote {
  content?: string
  metadata?: NoteMetadata
  tags?: { add?: string[]; remove?: string[] }
  links?: { add?: LinkAdd[]; remove?: { target: string; relationship?: string }[] }
}

export function patchNote(id: string, patch: PatchNote): Promise<Note> {
  // `force` is TOP-LEVEL (nested → 428).
  return request<Note>('PATCH', `/notes/${encodeURIComponent(id)}`, {
    ...patch,
    force: true,
  })
}

export interface CreateNote {
  path: string
  content: string
  tags?: string[]
  metadata?: NoteMetadata
}

export function createNote(note: CreateNote): Promise<Note> {
  return request<Note>('POST', '/notes', note)
}

export function deleteNote(id: string): Promise<void> {
  return request<void>('DELETE', `/notes/${encodeURIComponent(id)}`)
}

// ---- Tags ----

export function listTags(): Promise<TagRecord[]> {
  return request<TagRecord[]>('GET', '/tags')
}

export function getTag(name: string): Promise<TagRecord> {
  return request<TagRecord>('GET', `/tags/${encodeURIComponent(name)}`)
}

// Quick connectivity probe used by the config screen.
export async function ping(origin: string, token: string): Promise<void> {
  const res = await fetch(`${origin.replace(/\/+$/, '')}/api/notes?limit=1`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Connected, but the token was rejected (${res.status}).`)
    }
    throw new Error(`Vault responded ${res.status}.`)
  }
}
