import type { Note, NoteRef, EntityType } from './types'
import type { Attachment } from './api'
import { entityTypeOf, isCapture } from './types'

// ---- Dates ----

export function dayKey(iso: string): string {
  // Local day bucket, e.g. "2026-06-01"
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayKey(): string {
  return dayKey(new Date().toISOString())
}

export function formatDayHeading(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = new Date()
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const diff = Math.round((t.getTime() - date.getTime()) / 86400000)
  const weekday = date.toLocaleDateString(undefined, { weekday: 'long' })
  const full = date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  })
  if (diff === 0) return `Today · ${weekday}, ${full}`
  if (diff === 1) return `Yesterday · ${weekday}, ${full}`
  return `${weekday}, ${full}`
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const s = Math.round((now - then) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.round(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.round(mo / 12)}y ago`
}

export function groupByDay<T extends { createdAt: string }>(
  items: T[],
): { key: string; items: T[] }[] {
  const map = new Map<string, T[]>()
  for (const it of items) {
    const k = dayKey(it.createdAt)
    const arr = map.get(k) ?? []
    arr.push(it)
    map.set(k, arr)
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, its]) => ({ key, items: its }))
}

// ---- Capture paths ----

// Path roots for NEW captures, matching the Parachute Notes app convention
// (packages/notes-ui recorder.ts): text → Notes/, voice → Memos/. Kept as
// one-line constants so the scheme is trivial to adjust.
export const NOTES_PREFIX = 'Notes'
export const MEMOS_PREFIX = 'Memos'

// Build `${prefix}/YYYY/MM-DD/HH-MM-SS` from a moment in time.
export function capturePath(
  kind: 'text' | 'voice',
  at: Date = new Date(),
): string {
  const prefix = kind === 'voice' ? MEMOS_PREFIX : NOTES_PREFIX
  const yyyy = at.getFullYear()
  const mm = String(at.getMonth() + 1).padStart(2, '0')
  const dd = String(at.getDate()).padStart(2, '0')
  const hh = String(at.getHours()).padStart(2, '0')
  const mi = String(at.getMinutes()).padStart(2, '0')
  const ss = String(at.getSeconds()).padStart(2, '0')
  return `${prefix}/${yyyy}/${mm}-${dd}/${hh}-${mi}-${ss}`
}

// Filename for a voice memo blob (used in the ![[...]] embed + as the File name).
export function memoFilename(mimeType: string, at: Date = new Date()): string {
  const ext = mimeType.startsWith('audio/webm')
    ? 'webm'
    : mimeType.startsWith('audio/mp4')
      ? 'm4a'
      : mimeType.startsWith('audio/ogg')
        ? 'ogg'
        : 'bin'
  const stamp = at.toISOString().replace(/[:.]/g, '-').replace(/Z$/, '')
  return `memo-${stamp}.${ext}`
}

// ---- Content / preview ----

const EMBED_RE = /!\[\[([^\]]+?)\]\]/g
const WIKILINK_RE = /\[\[([^\]]+?)\]\]/g

export function stripEmbeds(content: string): string {
  return content.replace(EMBED_RE, '').trim()
}

export function findAudioEmbed(content: string): string | null {
  const matches = content.matchAll(EMBED_RE)
  for (const m of matches) {
    const name = m[1].trim()
    if (/\.(webm|ogg|m4a|mp3|wav)$/i.test(name)) return name
  }
  return null
}

// The voice attachment on a note (audio mimeType, or audio file extension).
// A voice note typically has exactly one; we return the first audio match.
export function audioAttachmentOf(
  attachments: Attachment[] | undefined | null,
): Attachment | null {
  if (!attachments) return null
  for (const a of attachments) {
    if (a.mimeType?.startsWith('audio/')) return a
    if (a.path && /\.(webm|ogg|m4a|mp3|wav)$/i.test(a.path)) return a
  }
  return null
}

// Pull a transcript out of an attachment's metadata, if present.
export function transcriptOf(att: Attachment | null | undefined): string | null {
  const t = att?.metadata?.transcript
  return typeof t === 'string' && t.trim() ? t : null
}

export function previewText(note: Note, max = 220): string {
  const raw = note.content ?? note.preview ?? ''
  const clean = stripEmbeds(raw)
    .replace(WIKILINK_RE, (_m, p1) => String(p1).split('|').pop()!.split('/').pop()!)
    .replace(/^#+\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > max ? clean.slice(0, max).trimEnd() + '…' : clean
}

// Normalize raw note content into a single readable line (drop embeds, flatten
// wikilinks to their label, strip heading markers, collapse whitespace) — the
// same shape previewText produces, but without truncation, so we can search it.
function flattenContent(content: string): string {
  return stripEmbeds(content)
    .replace(WIKILINK_RE, (_m, p1) => String(p1).split('|').pop()!.split('/').pop()!)
    .replace(/^#+\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// A mention snippet: the slice of a capture's text around the first place one of
// `terms` appears, split so the matched run can be highlighted. `before`/`after`
// carry leading/trailing "…" when the text was trimmed; `match` is the exact
// substring as it appears in the text (original casing preserved).
export interface MentionSnippet {
  before: string
  match: string
  after: string
}

// Escape a string for safe use as a literal inside a RegExp.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Find the first occurrence in `content` of any of `terms` (case-insensitive,
// whole-word where the term is word-like) and return ~`pad` chars of context on
// each side, trimmed to word boundaries with leading/trailing ellipses. Terms
// are tried in order, but we pick the EARLIEST match across all of them so the
// snippet lands on the first time the entity is named. Returns null if none
// match (caller falls back to a plain preview).
export function mentionSnippet(
  content: string,
  terms: string[],
  pad = 80,
): MentionSnippet | null {
  const text = flattenContent(content)
  if (!text) return null

  // De-dupe + drop empties; keep longer terms first so a multi-word name wins
  // over its first word when both start at the same index.
  const cleaned = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  )
  if (cleaned.length === 0) return null

  let bestIdx = -1
  let bestLen = 0
  for (const term of cleaned) {
    // Word-boundary match when the term is alphanumeric-bounded, so "Rachel"
    // doesn't match inside "Rachelle"; fall back to a plain search otherwise.
    const wordish = /^\w.*\w$|^\w$/.test(term)
    const pat = wordish ? `\\b${escapeRegExp(term)}\\b` : escapeRegExp(term)
    const re = new RegExp(pat, 'i')
    const m = re.exec(text)
    if (!m) continue
    if (bestIdx === -1 || m.index < bestIdx) {
      bestIdx = m.index
      bestLen = m[0].length
    }
  }
  if (bestIdx === -1) return null

  const matchStr = text.slice(bestIdx, bestIdx + bestLen)

  // Expand the window, then nudge each edge out to the nearest whitespace so we
  // don't cut a word in half.
  let start = Math.max(0, bestIdx - pad)
  let end = Math.min(text.length, bestIdx + bestLen + pad)
  if (start > 0) {
    const sp = text.indexOf(' ', start)
    if (sp !== -1 && sp < bestIdx) start = sp + 1
  }
  if (end < text.length) {
    const sp = text.lastIndexOf(' ', end)
    if (sp !== -1 && sp > bestIdx + bestLen) end = sp
  }

  const before = (start > 0 ? '…' : '') + text.slice(start, bestIdx)
  const after = text.slice(bestIdx + bestLen, end) + (end < text.length ? '…' : '')
  return { before, match: matchStr, after }
}

// ---- Entities ----

export function entityName(ref: NoteRef | Note): string {
  // Path is like "People/Adam Elfers" → "Adam Elfers"
  return ref.path.split('/').pop() ?? ref.path
}

export function entitySummary(ref: NoteRef | Note): string {
  return (ref.metadata?.summary as string) ?? ''
}

// An entity's `metadata.aliases` as a clean string array (or []).
export function entityAliases(ref: NoteRef | Note): string[] {
  const a = ref.metadata?.aliases
  if (!Array.isArray(a)) return []
  return a.map((x) => String(x).trim()).filter(Boolean)
}

// Common words that double as first-names — too generic to first-word match
// (an "I will go" capture shouldn't suggest "Will Thomas").
const FIRST_WORD_STOP = new Set([
  'will', 'grace', 'may', 'art', 'hope', 'joy', 'faith', 'sky', 'star', 'rose',
  'the', 'new', 'good', 'one', 'love', 'light', 'open', 'first',
])

// The terms that should match an entity in free text: its name, every alias, and
// — for PEOPLE only — the FIRST word of the name (covers bare mentions like
// "Rachel" for "Rachel Isaacson"). First-word matching is restricted to people
// because for other types the first word is usually a common word ("Write of
// Passage", "Search Inside Yourself", "Spirit of the Front Range") and would just
// be noise. Common-word first-names (Will, Grace…) are skipped too. Deduped
// case-insensitively. Used by both Unlinked mentions (entity→captures) and
// Detected entities (capture→entities) so the two directions stay symmetric.
export function entityMatchTerms(ref: NoteRef | Note): string[] {
  const name = entityName(ref).trim()
  const raw = [name, ...entityAliases(ref)]
  if (entityTypeOf(ref) === 'person') {
    const firstWord = name.split(/\s+/)[0] ?? ''
    if (firstWord.length >= 3 && !FIRST_WORD_STOP.has(firstWord.toLowerCase())) {
      raw.push(firstWord)
    }
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of raw) {
    const v = t.trim()
    if (!v) continue
    const k = v.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out
}

// Find the most likely EXISTING entity a proposal name already refers to.
// A match when, case-insensitively, the name:
//   • equals the entity's name or one of its aliases, OR
//   • is a word-subset of the entity's name (every word of `name` appears in it).
// Same-type matches are preferred (and scored higher). Returns the best match or
// null. Used for duplicate-detection on proposal cards (capability A).
export function findExistingEntity(
  name: string,
  entities: (NoteRef | Note)[],
  preferType?: EntityType | null,
): (NoteRef | Note) | null {
  const q = name.trim().toLowerCase()
  if (!q) return null
  const qWords = q.split(/\s+/).filter(Boolean)
  let best: { e: NoteRef | Note; score: number } | null = null
  for (const e of entities) {
    const eName = entityName(e).toLowerCase()
    const aliases = entityAliases(e).map((a) => a.toLowerCase())
    const sameType = preferType ? entityTypeOf(e) === preferType : false
    let score = 0
    if (eName === q || aliases.includes(q)) {
      score = 100 // exact name / alias match
    } else {
      // word-subset: every query word present somewhere in the entity name
      const eWords = new Set(eName.split(/\s+/).filter(Boolean))
      const subset = qWords.length > 0 && qWords.every((w) => eWords.has(w))
      // or query name is a word-subset of an alias
      const aliasSubset = aliases.some((al) => {
        const aw = new Set(al.split(/\s+/).filter(Boolean))
        return qWords.length > 0 && qWords.every((w) => aw.has(w))
      })
      if (subset || aliasSubset) score = 60
    }
    if (score === 0) continue
    if (sameType) score += 20
    if (!best || score > best.score) best = { e, score }
  }
  return best?.e ?? null
}

// Collapse a note's links to unique target entities (dedupe + keep one rel).
export interface LinkedEntity {
  ref: NoteRef
  relationship: string
  type: ReturnType<typeof entityTypeOf>
}

export function linkedEntities(note: Note): LinkedEntity[] {
  const out: LinkedEntity[] = []
  const seen = new Set<string>()
  for (const l of note.links ?? []) {
    const ref = l.targetNote
    if (!ref) continue
    // skip links pointing back at captures; keep entity targets
    const type = entityTypeOf(ref)
    if (!type) continue
    if (seen.has(ref.id)) continue
    seen.add(ref.id)
    out.push({ ref, relationship: l.relationship, type })
  }
  return out
}

// The relationship a woven page uses to cite a source capture (downward link).
export const SOURCED_FROM = 'sourced-from'

// The keystone of the conversational loop: a capture that answers a surface the
// AI put in front of Aaron links `responds-to → surface`. Additive to the
// sacred capture (only ever a link), and the thread the next Weaver pass reads.
export const RESPONDS_TO = 'responds-to'

// The contribution flow: a capture that DEVELOPS an endeavor (build/piece/
// project) — a feature idea, a decision, a paragraph, raw thinking that moves it
// forward. Distinct from a passing `mentions`: this is the working material the
// endeavor is accreting toward its next state (and what the Weaver reads to pick
// up the work). Additive to the sacred capture (only a link).
export const DEVELOPS = 'develops'

// Captures that develop this endeavor — its "working notes" strand (inbound
// `develops` edges), newest first by the ref's createdAt when available.
export function developsRefs(entity: Note): NoteRef[] {
  const out: NoteRef[] = []
  const seen = new Set<string>()
  for (const l of entity.links ?? []) {
    if (l.targetId !== entity.id || l.relationship !== DEVELOPS) continue
    const ref = l.sourceNote
    if (!ref || seen.has(ref.id)) continue
    seen.add(ref.id)
    out.push(ref)
  }
  return out
}

// Replies threaded under a surface: captures with an inbound `responds-to` edge.
export function repliesTo(surface: Note): NoteRef[] {
  const out: NoteRef[] = []
  const seen = new Set<string>()
  for (const l of surface.links ?? []) {
    if (l.targetId !== surface.id || l.relationship !== RESPONDS_TO) continue
    const ref = l.sourceNote
    if (!ref || seen.has(ref.id)) continue
    seen.add(ref.id)
    out.push(ref)
  }
  return out
}

// Downward citations: the captures a woven page's CURRENT synthesis is grounded
// in — outgoing `sourced-from` links from the entity to captures. Curated and
// mutable (they change as the synthesis matures), distinct from the permanent
// upward `mentions` shown in "Across time". This is the provenance layer:
// every claim traceable to the words you actually spoke.
export function groundedIn(entity: Note): NoteRef[] {
  const out: NoteRef[] = []
  const seen = new Set<string>()
  for (const l of entity.links ?? []) {
    if (l.sourceId !== entity.id || l.relationship !== SOURCED_FROM) continue
    const ref = l.targetNote
    if (!ref || seen.has(ref.id)) continue
    seen.add(ref.id)
    out.push(ref)
  }
  return out
}

// A direct entity↔entity link (structural), from one entity's `links` array.
// `other` is the entity on the far end; `relationship` is the edge; `outgoing`
// is true when THIS entity is the link's source (so the UI can phrase direction:
//   outgoing → "works-on → Games.Coop"
//   incoming → "Lucian Hymer works-on").
export interface StructuralConnection {
  other: NoteRef
  relationship: string
  outgoing: boolean
  type: ReturnType<typeof entityTypeOf>
}

// The entity's DIRECT links to OTHER ENTITIES (not captures) — its structural
// connections. We look at each link, pick the end that ISN'T this entity, and
// keep it only when that end carries an entity type tag. Deduped by (other id +
// relationship + direction) so the same edge isn't listed twice.
export function structuralConnections(entity: Note): StructuralConnection[] {
  const out: StructuralConnection[] = []
  const seen = new Set<string>()
  for (const l of entity.links ?? []) {
    const outgoing = l.sourceId === entity.id
    const ref = outgoing ? l.targetNote : l.sourceNote
    if (!ref || ref.id === entity.id) continue
    const type = entityTypeOf(ref)
    if (!type) continue // far end isn't an entity (likely a capture) — skip
    const key = `${ref.id}|${l.relationship}|${outgoing ? 'o' : 'i'}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ other: ref, relationship: l.relationship, outgoing, type })
  }
  return out
}

// The capture sources that link TO an entity (from an entity's links array).
export function sourceCaptures(entity: Note): NoteRef[] {
  const out: NoteRef[] = []
  const seen = new Set<string>()
  for (const l of entity.links ?? []) {
    // entity is the target; the source is the capture
    const ref =
      l.targetId === entity.id ? l.sourceNote : l.sourceNote ?? l.targetNote
    if (!ref || ref.id === entity.id) continue
    if (seen.has(ref.id)) continue
    seen.add(ref.id)
    out.push(ref)
  }
  return out
}

// ---- Routing helpers ----

// Entity detail uses the path (e.g. "Projects/Parachute"); encode for the URL.
export function entityHref(ref: NoteRef | Note): string {
  return `/entity/${encodeURIComponent(ref.path)}`
}

export function captureHref(ref: NoteRef | Note): string {
  return `/capture/${encodeURIComponent(ref.id)}`
}

// Pick the right route for any note ref: entity → /entity, capture → /capture,
// everything else (Now, Open Inquiry, Jobs/*, Feedback/*, …) → the generic
// /note view. The fallback keys off `path` (so getNote can resolve it by path).
export function noteHref(ref: NoteRef | Note): string {
  if (entityTypeOf(ref)) return entityHref(ref)
  if (isCapture(ref)) return captureHref(ref)
  return `/note/${encodeURIComponent(ref.path ?? ref.id)}`
}

// A wikilink target ("Now", "Projects/scenius.social") → the generic note view.
// Used when the entity index can't resolve it but it may still be a real note.
export function genericNoteHref(target: string): string {
  return `/note/${encodeURIComponent(target.trim())}`
}
