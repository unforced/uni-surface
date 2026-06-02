// Thin client over the Parachute Vault REST API.
// base = <origin>/api ; Authorization: Bearer <token> on every request.

import { getAuth, getConfig, isOAuth, updateAccessToken } from './config'
import { refreshAccessToken } from './oauth'
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

// When signed in via OAuth, swap an expiring/rejected access token for a fresh
// one using the stored refresh token. Returns the new access token, or null if
// there's nothing to refresh (pasted token, or no refresh_token). The hub
// rotates the refresh token, so we persist whatever comes back.
let refreshInflight: Promise<string | null> | null = null

async function tryRefresh(): Promise<string | null> {
  if (refreshInflight) return refreshInflight
  refreshInflight = (async () => {
    const auth = getAuth()
    if (!auth || !auth.refreshToken) return null
    try {
      const token = await refreshAccessToken({
        tokenEndpoint: auth.tokenEndpoint,
        clientId: auth.clientId,
        refreshToken: auth.refreshToken,
      })
      updateAccessToken(token.access_token, {
        refreshToken: token.refresh_token ?? auth.refreshToken,
        expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
        scope: token.scope ?? auth.scope,
      })
      return token.access_token
    } catch {
      return null
    }
  })()
  try {
    return await refreshInflight
  } finally {
    refreshInflight = null
  }
}

function doFetch(
  origin: string,
  path: string,
  method: string,
  token: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${origin}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const { origin, token } = requireConfig()
  let res: Response
  try {
    res = await doFetch(origin, path, method, token, body)
  } catch (e) {
    throw new VaultError(
      0,
      `Could not reach the vault at ${origin}. Is it running and reachable? (${
        e instanceof Error ? e.message : String(e)
      })`,
    )
  }
  // OAuth: an expired access token surfaces as 401. Refresh once and retry.
  if (res.status === 401 && isOAuth()) {
    const fresh = await tryRefresh()
    if (fresh) {
      try {
        res = await doFetch(origin, path, method, fresh, body)
      } catch (e) {
        throw new VaultError(
          0,
          `Could not reach the vault at ${origin}. (${e instanceof Error ? e.message : String(e)})`,
        )
      }
    }
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
      const hint = isOAuth()
        ? 'Your session expired — sign in again.'
        : 'Your token may be expired — re-paste it.'
      throw new VaultError(res.status, `Auth failed (${res.status}). ${hint}`)
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
  opts: { includeLinks?: boolean; includeAttachments?: boolean } = {},
): Promise<Note> {
  // Paths contain slashes — encode the whole segment.
  const enc = encodeURIComponent(idOrPath)
  const p = new URLSearchParams()
  if (opts.includeLinks) p.set('include_links', 'true')
  if (opts.includeAttachments) p.set('include_attachments', 'true')
  const qs = p.toString()
  return request<Note>('GET', `/notes/${enc}${qs ? `?${qs}` : ''}`)
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

// ---- Proposals (deterministic review surface — NO AI) ----
//
// Proposals are notes tagged `proposal` carrying a Weaver suggestion in their
// metadata. Approving one runs plain vault calls: create the entity, link the
// chosen captures, resolve the proposal. These helpers are small + typed and
// are reused directly by the Proposals UI.

import type { EntityType } from './types'

// entity_type → path root folder (matches the vault's layout + WeaveEditor).
export const ENTITY_FOLDER: Record<EntityType, string> = {
  project: 'Projects',
  person: 'People',
  place: 'Places',
  thread: 'Threads',
  practice: 'Practices',
  tool: 'Tools',
  reference: 'References',
  organization: 'Organizations',
  seed: 'Seeds',
}

export type ProposalStatus = 'pending' | 'approved' | 'rejected'

// The Weaver metadata carried on a `proposal` note (see data model). Kept as a
// standalone shape (not extending NoteMetadata, whose `status` is narrower).
export interface ProposalMeta {
  kind?: 'entity' | 'link'
  status?: ProposalStatus
  entity_type?: EntityType
  entity_name?: string
  entity_summary?: string
  relationship?: string
  confidence?: number
  evidence?: string
  run?: string
  capture_id?: string
  target_path?: string
  [key: string]: unknown
}

// Build the target path for an entity of the given type + name.
export function entityPath(type: EntityType, name: string): string {
  return `${ENTITY_FOLDER[type]}/${name.trim()}`
}

// The pending-proposals query (spec-exact): tag=proposal, status==pending.
export function listPendingProposals(): Promise<Note[]> {
  const meta = encodeURIComponent(JSON.stringify({ status: { eq: 'pending' } }))
  return request<Note[]>(
    'GET',
    `/notes?tag=proposal&metadata=${meta}&include_metadata=true&limit=200`,
  )
}

// Captures whose text mentions `term` — the supporting evidence for a proposal.
export function searchCaptures(term: string): Promise<Note[]> {
  const p = new URLSearchParams()
  p.set('tag', 'capture')
  p.set('search', term)
  p.set('include_content', 'false')
  p.set('limit', '50')
  return request<Note[]>('GET', `/notes?${p.toString()}`)
}

// Create the entity note at `<Root>/<name>`; it inherits the `entity` parent
// automatically via its type tag.
export function createEntity(
  type: EntityType,
  name: string,
  summary: string,
): Promise<Note> {
  const path = entityPath(type, name)
  return createNote({
    path,
    content: `# ${name.trim()}\n${summary.trim() ? `\n${summary.trim()}\n` : ''}`,
    tags: [type],
    metadata: summary.trim() ? { summary: summary.trim() } : {},
  })
}

// Link one capture to an entity path with the given relationship.
export function linkCapture(
  captureId: string,
  targetPath: string,
  relationship: string,
): Promise<Note> {
  return patchNote(captureId, { links: { add: [{ target: targetPath, relationship }] } })
}

// Resolve a proposal — keep it as an audit record (don't delete).
export function resolveProposal(id: string, status: ProposalStatus): Promise<Note> {
  return patchNote(id, { metadata: { status } })
}

// ---- Attachments & storage ----

// An attachment row as returned by GET /api/notes/{id}?include_attachments=true
// and POST /api/notes/{id}/attachments.
export interface Attachment {
  id: string
  noteId?: string
  path: string
  mimeType?: string
  url?: string
  size?: number
  createdAt?: string
  metadata?: Record<string, unknown>
}

// Result of POST /api/storage/upload (confirmed live: {path,size,mimeType}).
export interface StorageUploadResult {
  path: string
  size: number
  mimeType: string
}

// Run a non-JSON request (blob GET / multipart POST) with the same
// auth + OAuth-refresh-on-401 contract as `request`. `build` is given a
// token and returns the fetch args so we can re-run it with a fresh token.
async function authedFetch(
  build: (origin: string, token: string) => [string, RequestInit],
): Promise<Response> {
  const { origin, token } = requireConfig()
  const run = async (tok: string) => {
    const [url, init] = build(origin, tok)
    return fetch(url, init)
  }
  let res: Response
  try {
    res = await run(token)
  } catch (e) {
    throw new VaultError(
      0,
      `Could not reach the vault at ${origin}. (${e instanceof Error ? e.message : String(e)})`,
    )
  }
  if (res.status === 401 && isOAuth()) {
    const fresh = await tryRefresh()
    if (fresh) res = await run(fresh)
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      const hint = isOAuth()
        ? 'Your session expired — sign in again.'
        : 'Your token may be expired — re-paste it.'
      throw new VaultError(res.status, `Auth failed (${res.status}). ${hint}`)
    }
    throw new VaultError(res.status, `${res.status} ${res.statusText}`)
  }
  return res
}

// Fetch a stored file (e.g. a voice memo) as a Blob, WITH the bearer header.
// A bare <audio src> can't carry the header, so callers turn this into an
// object URL. `path` is the attachment's storage path (no leading slash).
export async function fetchStorageBlob(path: string): Promise<Blob> {
  const clean = path.replace(/^\/+/, '')
  const res = await authedFetch((origin, token) => [
    `${origin}/api/storage/${clean}`,
    { headers: { Authorization: `Bearer ${token}` } },
  ])
  return res.blob()
}

// Upload a file to vault storage. Confirmed live: multipart field name is
// `file`; the result is { path, size, mimeType }.
export async function uploadStorageFile(file: File): Promise<StorageUploadResult> {
  const res = await authedFetch((origin, token) => {
    const form = new FormData()
    form.append('file', file)
    return [
      `${origin}/api/storage/upload`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
    ]
  })
  return (await res.json()) as StorageUploadResult
}

// Attach an uploaded file to a note (+ optionally kick off transcription).
export function addAttachment(
  noteId: string,
  body: { path: string; mimeType: string; transcribe?: boolean },
): Promise<Attachment> {
  return request<Attachment>(
    'POST',
    `/notes/${encodeURIComponent(noteId)}/attachments`,
    body,
  )
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
