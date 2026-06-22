// Shapes returned by the Parachute Vault HTTP API.
// Lean by default; enriched when include_* flags are passed.

export interface NoteRef {
  id: string
  path: string
  tags?: string[]
  metadata?: NoteMetadata
  createdAt?: string
  updatedAt?: string
}

export interface VaultLink {
  sourceId: string
  targetId: string
  relationship: string
  createdAt?: string
  sourceNote?: NoteRef
  targetNote?: NoteRef
}

export interface NoteMetadata {
  summary?: string
  // Entity lifecycle, proposal lifecycle (pending/approved/rejected), and
  // agent-definition status (enabled/disabled).
  status?:
    | 'active'
    | 'incubating'
    | 'dormant'
    | 'archived'
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'enabled'
    | 'disabled'
  role?: string
  relation?: 'friend' | 'family' | 'collaborator' | 'influence'
  kind?: string
  active?: boolean
  // freeform — anything else the vault stores
  [key: string]: unknown
}

export interface Note {
  id: string
  path: string
  extension?: string
  content?: string
  preview?: string
  tags: string[]
  metadata: NoteMetadata
  createdAt: string
  updatedAt: string
  links?: VaultLink[]
  attachments?: import('./api').Attachment[]
  byteSize?: number
}

export interface TagField {
  type?: string
  description?: string
  enum?: string[]
  indexed?: boolean
}

export interface TagRecord {
  name: string
  count: number
  description?: string
  fields?: Record<string, TagField> | null
  relationships?: unknown
  parent_names?: string[]
  metadata?: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

// ---- Entity typing (derived from tags) ----

export type EntityType =
  | 'project'
  | 'person'
  | 'place'
  | 'thread'
  | 'practice'
  | 'tool'
  | 'reference'
  | 'organization'
  | 'seed'

export const ENTITY_TYPES: EntityType[] = [
  'project',
  'person',
  'thread',
  'place',
  'practice',
  'tool',
  'reference',
  'organization',
  'seed',
]

export const ENTITY_PARENT_TAG = 'entity'

// Relationship → which entity type it usually points at (for chip glyphs).
export const RELATIONSHIP_LABELS: Record<string, string> = {
  'relates-to': 'relates to',
  mentions: 'mentions',
  develops: 'develops',
  at: 'at',
  'part-of': 'part of',
  practices: 'practices',
  uses: 'uses',
  references: 'references',
}

// Specializations of `project`, housed in a domain (dev → build, writing →
// piece). They inherit project's schema in the vault; in the UI they resolve to
// `project` for typing/behavior, while `entitySubtypeOf` exposes the finer name.
export const PROJECT_SUBTYPES = ['build', 'piece'] as const
export type ProjectSubtype = (typeof PROJECT_SUBTYPES)[number]

// First entity type found on a note's tag list (build/piece resolve to project).
export function entityTypeOf(note: NoteRef | Note): EntityType | null {
  const tags = note.tags ?? []
  for (const t of ENTITY_TYPES) {
    if (tags.includes(t)) return t
  }
  if (PROJECT_SUBTYPES.some((s) => tags.includes(s))) return 'project'
  return null
}

// The finer endeavor label for display: 'build' | 'piece', else the entity type.
export function entitySubtypeOf(note: NoteRef | Note): string | null {
  const tags = note.tags ?? []
  for (const s of PROJECT_SUBTYPES) {
    if (tags.includes(s)) return s
  }
  return entityTypeOf(note)
}

export type CaptureKind = 'text' | 'voice' | 'dream'

export function captureKindOf(note: NoteRef | Note): CaptureKind | null {
  const tags = note.tags ?? []
  if (tags.includes('dream-log')) return 'dream'
  if (tags.includes('capture/voice')) return 'voice'
  if (tags.includes('capture/text') || tags.includes('capture')) return 'text'
  return null
}

export function isCapture(note: NoteRef | Note): boolean {
  return (note.tags ?? []).some((t) => t === 'capture' || t.startsWith('capture/'))
}

export function isEntity(note: NoteRef | Note): boolean {
  return entityTypeOf(note) !== null
}
