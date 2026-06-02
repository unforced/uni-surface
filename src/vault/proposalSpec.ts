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

// One linked capture in the spec. The on-disk JSON allows either a bare id
// string (uses the entity's default relationship) or an object carrying a
// per-capture relationship override. We normalize to this object form in memory
// and re-serialize compactly (bare string when no override) on write.
export interface SpecCapture {
  id: string
  // When set + different from the default, this capture is linked by this edge
  // instead of the spec's default `relationship`.
  relationship?: string
}

export interface SpecLinks {
  relationship: string
  captures: SpecCapture[]
}

// The `update_entity` kind: a proposal to REFRESH an existing entity's summary
// + content (no new entity, no capture links). It carries the target path, the
// entity's `updated_at` AT THE TIME THE PROPOSAL WAS MADE (for optimistic
// concurrency on accept), and the proposed new summary + markdown content.
export interface SpecUpdate {
  target: string
  baseUpdatedAt: string
  summary: string
  content: string
}

export interface ProposalSpec {
  v: number
  kind: string // "create_entity" | "update_entity" | …
  confidence: number
  evidence: string
  entity: SpecEntity
  links: SpecLinks
  // Present only when kind === 'update_entity'.
  update?: SpecUpdate
}

// Folder per entity type — the path derives as `<Folder>/<name>`. Mirrors
// ENTITY_FOLDER (api.ts) so a single source governs both create + path display.
export const TYPE_FOLDER = ENTITY_FOLDER

// Which relationship a given entity type usually wants its captures linked by.
// Default is `mentions` — most capture→entity links are just an honest mention,
// not a structural claim. Only the genuinely structural edges override that:
// place→at, thread→part-of, practice→practices. Person, project, organization,
// seed, reference, tool all default to `mentions`.
export function suggestRel(type: EntityType): string {
  switch (type) {
    case 'place': return 'at'
    case 'thread': return 'part-of'
    case 'practice': return 'practices'
    default: return 'mentions'
  }
}

// Build the canonical path for a type + name (folder by type).
export function specPath(type: EntityType, name: string): string {
  return `${TYPE_FOLDER[type]}/${name.trim()}`
}

// Reverse of TYPE_FOLDER: a path's leading folder → its entity type (e.g.
// "Projects/Parachute" → "project"). Used for update_entity, whose spec carries
// only a target path. Returns null when the folder isn't a known entity root.
const FOLDER_TYPE: Record<string, EntityType> = Object.fromEntries(
  Object.entries(TYPE_FOLDER).map(([type, folder]) => [folder, type as EntityType]),
) as Record<string, EntityType>

export function entityTypeFromPath(path: string): EntityType | null {
  const folder = path.split('/')[0] ?? ''
  return FOLDER_TYPE[folder] ?? null
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

// Parse links.captures, accepting BOTH the legacy bare-id form
//   ["id", ...]
// and the per-capture override form
//   [{ "id": "…", "relationship": "…" }, ...]
// (the two may be mixed). Returns normalized {id, relationship?} entries with
// empty ids dropped; a blank/whitespace relationship is treated as "no override".
export function parseCaptures(v: unknown): SpecCapture[] {
  if (!Array.isArray(v)) return []
  const out: SpecCapture[] = []
  for (const x of v) {
    if (typeof x === 'string') {
      const id = x.trim()
      if (id) out.push({ id })
    } else if (x && typeof x === 'object') {
      const id = String((x as { id?: unknown }).id ?? '').trim()
      if (!id) continue
      const rel = String((x as { relationship?: unknown }).relationship ?? '').trim()
      out.push(rel ? { id, relationship: rel } : { id })
    }
  }
  return out
}

// Re-serialize captures to the most compact on-disk form: a bare id string when
// there's no (or a no-op) override, else { id, relationship }. `defaultRel` is
// the spec's default edge — an override equal to it is dropped (it's not an
// override). De-duped by id (first entry with an override wins).
export function serializeCaptures(
  captures: SpecCapture[],
  defaultRel: string,
): (string | SpecCapture)[] {
  const seen = new Set<string>()
  const out: (string | SpecCapture)[] = []
  for (const c of captures) {
    const id = c.id.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const rel = c.relationship?.trim()
    out.push(rel && rel !== defaultRel ? { id, relationship: rel } : id)
  }
  return out
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
  const captures = parseCaptures(m.capture_ids ?? (m.capture_id ? [m.capture_id] : []))
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
      const parsed = JSON.parse(raw) as Partial<ProposalSpec> & {
        target?: unknown
        base_updated_at?: unknown
        update?: { summary?: unknown; content?: unknown }
      }
      // ── update_entity: a refresh of an existing entity's summary + content. ──
      if (parsed && typeof parsed === 'object' && parsed.kind === 'update_entity') {
        const target = String(parsed.target ?? '').trim()
        const type = (entityTypeFromPath(target) ?? 'reference') as EntityType
        const name = target.split('/').pop() ?? target
        return {
          v: typeof parsed.v === 'number' ? parsed.v : 1,
          kind: 'update_entity',
          confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0,
          evidence: String(parsed.evidence ?? ''),
          // A minimal entity stub so type-derived styling (the t-<type> class)
          // and grouping keep working; the real payload lives in `update`.
          entity: {
            type,
            name,
            path: target,
            summary: String(parsed.update?.summary ?? ''),
            aliases: [],
            fields: {},
          },
          links: { relationship: suggestRel(type), captures: [] },
          update: {
            target,
            baseUpdatedAt: String(parsed.base_updated_at ?? ''),
            summary: String(parsed.update?.summary ?? ''),
            content: String(parsed.update?.content ?? ''),
          },
        }
      }
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
            captures: parseCaptures(parsed.links?.captures),
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
