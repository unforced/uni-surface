// The Weaver "intent" — a structured spec describing the entity to create and
// the captures to link. It lives in a pending proposal note's CONTENT as JSON
// (extension `json`). The review UI parses it into an editable form; Accept
// executes the (edited) spec deterministically. For transition safety, older
// proposals that carry the suggestion in metadata.* (no/invalid JSON content)
// are reconstructed into the same shape via `specFromMetadata`.

import type { EntityType, Note } from './types'
import { ENTITY_FOLDER } from './api'

// Type-specific metadata, rendered as dedicated form controls (never raw JSON).
export interface ProjectFields {
  status?: 'active' | 'incubating' | 'dormant' | 'archived'
  role?: string
}
export interface PersonFields {
  relation?: 'friend' | 'family' | 'collaborator' | 'influence'
}
export interface PlaceFields {
  kind?: 'venue' | 'city' | 'town' | 'region'
}
export interface ReferenceFields {
  kind?: 'book' | 'essay' | 'framework' | 'talk'
}
// All other types carry no extra fields.
export type EntityFields =
  | ProjectFields
  | PersonFields
  | PlaceFields
  | ReferenceFields
  | Record<string, never>

export interface SpecEntity {
  type: EntityType
  name: string
  path: string
  summary: string
  aliases: string[]
  fields: Record<string, unknown>
}

export interface SpecLinks {
  relationship: string
  captures: string[]
}

export interface ProposalSpec {
  v: number
  kind: string // e.g. "create_entity"
  confidence: number
  evidence: string
  entity: SpecEntity
  links: SpecLinks
}

// Folder per entity type — the path derives as `<Folder>/<name>`. Mirrors
// ENTITY_FOLDER (api.ts) so a single source governs both create + path display.
export const TYPE_FOLDER = ENTITY_FOLDER

// Which relationship a given entity type usually wants its captures linked by.
export function suggestRel(type: EntityType): string {
  switch (type) {
    case 'person': return 'mentions'
    case 'place': return 'at'
    case 'thread': return 'part-of'
    case 'practice': return 'practices'
    case 'tool': return 'uses'
    case 'reference': return 'references'
    case 'project': return 'relates-to'
    default: return 'relates-to'
  }
}

// Build the canonical path for a type + name (folder by type).
export function specPath(type: EntityType, name: string): string {
  return `${TYPE_FOLDER[type]}/${name.trim()}`
}

// The type-specific fields that should render for a given type, with their
// option lists. Used by the form to know which controls to show; also the
// source of truth for default values when a type is first selected.
export const PROJECT_STATUSES = ['active', 'incubating', 'dormant', 'archived'] as const
export const PERSON_RELATIONS = ['friend', 'family', 'collaborator', 'influence'] as const
export const PLACE_KINDS = ['venue', 'city', 'town', 'region'] as const
export const REFERENCE_KINDS = ['book', 'essay', 'framework', 'talk'] as const

// Sensible defaults for a type's fields when the type is (re)selected and the
// spec carries nothing usable for it.
export function defaultFields(type: EntityType): Record<string, unknown> {
  switch (type) {
    case 'project': return { status: 'active', role: '' }
    case 'person': return { relation: 'friend' }
    case 'place': return { kind: 'venue' }
    case 'reference': return { kind: 'book' }
    default: return {}
  }
}

// Keep only the fields that belong to a type (drops stale keys after a type
// switch) and fill any gaps from defaults — so a project always has a status,
// a person always has a relation, etc., and a thread never carries `status`.
export function normalizeFields(
  type: EntityType,
  fields: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const f = fields ?? {}
  const out = defaultFields(type)
  for (const k of Object.keys(out)) {
    if (f[k] !== undefined && f[k] !== null && f[k] !== '') out[k] = f[k]
    else if (k === 'role' && typeof f[k] === 'string') out[k] = f[k] // allow empty role
  }
  return out
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x).trim()).filter(Boolean)
}

// Reconstruct a spec from a legacy proposal's metadata.* (transition safety).
export function specFromMetadata(note: Note): ProposalSpec {
  const m = note.metadata ?? {}
  const type = ((m.entity_type as EntityType) ?? 'reference') as EntityType
  // Name falls back to the proposal's own path leaf (e.g. "Proposals/Hakomi").
  const name = String(m.entity_name ?? note.path.split('/').pop() ?? '').trim()
  const summary = String(m.entity_summary ?? m.summary ?? '')
  const confidence = Number.isFinite(Number(m.confidence)) ? Number(m.confidence) : 0
  const evidence = String(m.evidence ?? '')
  const relationship = String(m.relationship ?? suggestRel(type))
  const captures = asStringArray(m.capture_ids ?? (m.capture_id ? [m.capture_id] : []))
  return {
    v: 1,
    kind: 'create_entity',
    confidence,
    evidence,
    entity: {
      type,
      name,
      path: specPath(type, name),
      summary,
      aliases: asStringArray(m.aliases),
      fields: normalizeFields(type, {}),
    },
    links: { relationship, captures },
  }
}

// Parse a proposal note's content as the JSON intent. Falls back to building a
// spec from metadata.* when the content isn't valid JSON (older proposals or
// any partial write). Always returns a fully-populated, normalized spec.
export function parseProposalSpec(note: Note): ProposalSpec {
  const raw = (note.content ?? '').trim()
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<ProposalSpec>
      if (parsed && typeof parsed === 'object' && parsed.entity) {
        const e = parsed.entity
        const type = ((e.type as EntityType) ?? 'reference') as EntityType
        const name = String(e.name ?? '').trim()
        return {
          v: typeof parsed.v === 'number' ? parsed.v : 1,
          kind: String(parsed.kind ?? 'create_entity'),
          confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0,
          evidence: String(parsed.evidence ?? ''),
          entity: {
            type,
            name,
            // Trust an explicit path; else derive from type+name.
            path: String(e.path ?? specPath(type, name)),
            summary: String(e.summary ?? ''),
            aliases: asStringArray(e.aliases),
            fields: normalizeFields(type, e.fields as Record<string, unknown>),
          },
          links: {
            relationship: String(parsed.links?.relationship ?? suggestRel(type)),
            captures: asStringArray(parsed.links?.captures),
          },
        }
      }
    } catch {
      /* not JSON → fall through to metadata reconstruction */
    }
  }
  return specFromMetadata(note)
}

// Apply a type change to a spec: re-derive the path's folder and reset the
// type-specific fields to that type's shape (keeping any still-relevant value).
export function withType(spec: ProposalSpec, type: EntityType): ProposalSpec {
  return {
    ...spec,
    entity: {
      ...spec.entity,
      type,
      path: specPath(type, spec.entity.name),
      fields: normalizeFields(type, spec.entity.fields),
    },
    links: { ...spec.links, relationship: suggestRel(type) },
  }
}

// Apply a name change: re-derive the path.
export function withName(spec: ProposalSpec, name: string): ProposalSpec {
  return {
    ...spec,
    entity: { ...spec.entity, name, path: specPath(spec.entity.type, name) },
  }
}
