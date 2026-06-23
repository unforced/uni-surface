// Domain helpers over the Parachute Vault REST API.
//
// Transport + auth (bearer, OAuth refresh-on-401, error classification) now come
// from `@openparachute/surface-client`'s `VaultClient`, reached via `surface.ts`.
// This module keeps the vault's domain shapes the app speaks (surfaces, weave,
// proposals, entities, attachments) — every export below is a thin, typed call
// onto that shared client. The hand-rolled `request`/`doFetch`/`tryRefresh`/
// `authedFetch` core is gone.

import { requireClient } from './surface'
import {
  VaultError,
  VaultConflictError,
  VaultNotFoundError,
  type Note as LibNote,
  type UpdateNotePayload,
} from '@openparachute/surface-client'
import type { EntityType, Note, NoteMetadata, TagRecord } from './types'

// Re-export the library error hierarchy so callers keep their existing
// `instanceof VaultError` / `VaultConflictError` (+ `.status` / `.currentUpdatedAt`)
// handling unchanged (e.g. the outbox's auth/conflict classification,
// UpdateEntityCard's re-apply-on-latest path).
export { VaultError, VaultConflictError }

// The library's `Note` (camelCase wire shape) is byte-compatible with the app's
// `Note`; its fields are merely typed as optional. The wire always populates
// them for real notes, so this cast is safe and contained to this transport
// boundary.
const asNote = (n: LibNote): Note => n as unknown as Note
const asNotes = (ns: LibNote[]): Note[] => ns as unknown as Note[]

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

export async function listNotes(q: NotesQuery = {}): Promise<Note[]> {
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
  return asNotes(await requireClient().queryNotes(p))
}

export async function getNote(
  idOrPath: string,
  opts: { includeLinks?: boolean; includeAttachments?: boolean } = {},
): Promise<Note> {
  const n = await requireClient().getNote(idOrPath, opts)
  if (!n) throw new VaultNotFoundError(`Note not found: ${idOrPath}`)
  return asNote(n)
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

export async function patchNote(id: string, patch: PatchNote): Promise<Note> {
  // `force` opts out of optimistic concurrency for unconditional writes.
  return asNote(await requireClient().updateNote(id, { ...patch, force: true } as UpdateNotePayload))
}

// Optimistic-concurrency PATCH: applies only if the note's live `updated_at`
// still equals `ifUpdatedAt`; otherwise the client throws a VaultConflictError
// carrying the live updated_at (so the caller can reconcile). MUST NOT send
// `force` — `if_updated_at` is the whole point here.
export async function patchNoteIf(
  id: string,
  patch: PatchNote,
  ifUpdatedAt: string,
): Promise<Note> {
  return asNote(
    await requireClient().updateNote(id, { ...patch, if_updated_at: ifUpdatedAt } as UpdateNotePayload),
  )
}

// Refresh an entity's summary (metadata) + markdown content. When `ifUpdatedAt`
// is given, the write is guarded (conflict-aware); otherwise it force-applies
// (used by "re-apply on latest" after the human has reconciled).
export function updateEntityContent(
  idOrPath: string,
  content: string,
  summary: string,
  ifUpdatedAt?: string,
): Promise<Note> {
  const patch: PatchNote = { content, metadata: { summary } }
  return ifUpdatedAt
    ? patchNoteIf(idOrPath, patch, ifUpdatedAt)
    : patchNote(idOrPath, patch)
}

export interface CreateNote {
  path: string
  content: string
  tags?: string[]
  metadata?: NoteMetadata
}

export async function createNote(note: CreateNote): Promise<Note> {
  return asNote(await requireClient().createNote(note))
}

export function deleteNote(id: string): Promise<void> {
  return requireClient().deleteNote(id)
}

// ---- Surfaces (the "For You" stream — prompts/reflections the AI poses) ----
//
// A surface is a note tagged `surface/*` with a `state` (open|resolved). Few in
// number, so we fetch all and split open/resolved client-side. No include_links:
// link hydration is vault-side expensive (~1s/note).
export async function listSurfaces(): Promise<Note[]> {
  const p = new URLSearchParams()
  p.set('tag', 'surface')
  p.set('include_content', 'true')
  p.set('include_metadata', 'true')
  p.set('limit', '100')
  p.set('sort', 'desc')
  return asNotes(await requireClient().queryNotes(p))
}

export function resolveSurface(id: string): Promise<Note> {
  return patchNote(id, { metadata: { state: 'resolved' } })
}

// ---- Weave triage ----
//
// "Unwoven" = fresh loose threads: recent + linkless + not a dream + not skipped.
export async function listUnwovenCaptures(sinceDays = 14, limit = 80): Promise<Note[]> {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10)
  const caps = await listNotes({
    tag: 'capture',
    hasLinks: false,
    dateFrom: since,
    sort: 'desc',
    limit,
    includeContent: true,
  })
  return caps.filter((c) => !(c.tags ?? []).some((t) => t === 'dream-log' || t === 'weave/skip'))
}

// Mark a capture as not needing weaving (additive tag — sacred content untouched).
export function skipWeave(id: string): Promise<Note> {
  return patchNote(id, { tags: { add: ['weave/skip'] } })
}

export function reopenSurface(id: string): Promise<Note> {
  return patchNote(id, { metadata: { state: 'open' } })
}

// ---- Proposals (deterministic review surface — NO AI) ----

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

// The Weaver metadata carried on a `proposal` note (see data model).
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
  // Curated captures the AI judge confirmed refer to this entity.
  capture_ids?: string[]
  target_path?: string
  [key: string]: unknown
}

// Build the target path for an entity of the given type + name.
export function entityPath(type: EntityType, name: string): string {
  return `${ENTITY_FOLDER[type]}/${name.trim()}`
}

// The pending-proposals query: tag=proposal, status==pending. Vault filters
// server-side on the indexed `status` field via `?metadata={...}` (vault#426).
export async function listPendingProposals(): Promise<Note[]> {
  const p = new URLSearchParams()
  p.set('tag', 'proposal')
  // include_content: the Weaver intent now lives in the note's JSON content.
  p.set('metadata', JSON.stringify({ status: { eq: 'pending' } }))
  p.set('include_metadata', 'true')
  p.set('include_content', 'true')
  p.set('limit', '200')
  return asNotes(await requireClient().queryNotes(p))
}

// Rename/move a note to a new path. The note id is STABLE across a rename, so
// every link pointing at it survives.
export async function renameNotePath(id: string, newPath: string): Promise<Note> {
  return asNote(await requireClient().updateNote(id, { path: newPath, force: true }))
}

// Full-text search across ALL notes (not just captures), with content.
export async function searchAllNotes(term: string): Promise<Note[]> {
  const p = new URLSearchParams()
  p.set('search', term)
  p.set('include_content', 'true')
  p.set('limit', '100')
  return asNotes(await requireClient().queryNotes(p))
}

// Add a value to an entity's `metadata.aliases` (string array), de-duped
// case-insensitively. Reads the live note first so we don't clobber existing
// aliases, then PATCHes the merged list.
export async function addAlias(idOrPath: string, alias: string): Promise<Note> {
  const value = alias.trim()
  const note = await getNote(idOrPath)
  const existing = Array.isArray(note.metadata?.aliases)
    ? (note.metadata!.aliases as unknown[]).map((a) => String(a))
    : []
  if (!value) return note
  if (existing.some((a) => a.toLowerCase() === value.toLowerCase())) return note
  const aliases = [...existing, value]
  return patchNote(note.id, { metadata: { aliases } })
}

// Captures whose text mentions `term` — the supporting evidence for a proposal.
export async function searchCaptures(term: string): Promise<Note[]> {
  const p = new URLSearchParams()
  p.set('tag', 'capture')
  p.set('search', term)
  p.set('include_content', 'false')
  p.set('limit', '50')
  return asNotes(await requireClient().queryNotes(p))
}

// Fetch specific captures by id — the curated set a proposal's
// `metadata.capture_ids` points at. Missing/failed ids are skipped so the card
// still loads with whatever resolves. Order follows the input id list.
export async function fetchCapturesByIds(ids: string[]): Promise<Note[]> {
  const settled = await Promise.allSettled(ids.map((id) => getNote(id)))
  const out: Note[] = []
  for (const r of settled) {
    if (r.status === 'fulfilled') out.push(r.value)
  }
  return out
}

// Create the entity note at `<Root>/<name>`; it inherits the `entity` parent
// automatically via its type tag. `aliases` are written to metadata.aliases;
// `fields` are type-specific metadata merged in (empty values dropped).
export function createEntity(
  type: EntityType,
  name: string,
  summary: string,
  aliases: string[] = [],
  fields: Record<string, unknown> = {},
): Promise<Note> {
  const path = entityPath(type, name)
  const cleanAliases = dedupeAliases(aliases)
  const metadata: NoteMetadata = {}
  if (summary.trim()) metadata.summary = summary.trim()
  if (cleanAliases.length) metadata.aliases = cleanAliases
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue
    if (typeof v === 'string' && v.trim() === '') continue
    ;(metadata as Record<string, unknown>)[k] = v
  }
  return createNote({
    path,
    content: `# ${name.trim()}\n${summary.trim() ? `\n${summary.trim()}\n` : ''}`,
    tags: [type],
    metadata,
  })
}

// Trim, drop empties, de-dupe (case-insensitive) an alias list.
export function dedupeAliases(input: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    const v = raw.trim()
    if (!v) continue
    const k = v.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out
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

// Resolve a proposal AND persist the (edited) intent into its content, so the
// note records exactly what was executed.
export function resolveProposalWithSpec(
  id: string,
  content: string,
  status: ProposalStatus,
): Promise<Note> {
  return patchNote(id, { content, metadata: { status } })
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

// Fetch a stored file (e.g. a voice memo) as a Blob, WITH the bearer header.
// A bare <audio src> can't carry the header, so callers turn this into an object
// URL. `path` is the attachment's storage path (the client accepts a bare path).
export function fetchStorageBlob(path: string): Promise<Blob> {
  return requireClient().fetchAttachmentBlob(path)
}

// Upload a file to vault storage. Result is { path, size, mimeType }.
export function uploadStorageFile(file: File): Promise<StorageUploadResult> {
  return requireClient().uploadStorageFile(file)
}

// Attach an uploaded file to a note (+ optionally kick off transcription).
export async function addAttachment(
  noteId: string,
  body: { path: string; mimeType: string; transcribe?: boolean },
): Promise<Attachment> {
  return (await requireClient().addAttachment(noteId, body)) as unknown as Attachment
}

// ---- Tags ----

export async function listTags(): Promise<TagRecord[]> {
  // includeSchema → description, fields, parent_names, relationships, timestamps.
  return (await requireClient().listTags({ includeSchema: true })) as unknown as TagRecord[]
}

export async function getTag(name: string): Promise<TagRecord> {
  const t = await requireClient().getTag(name)
  if (!t) throw new VaultNotFoundError(`Tag not found: ${name}`)
  return t as unknown as TagRecord
}

// Quick connectivity probe used by the connect screen's paste-token path.
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
