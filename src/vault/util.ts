import type { Note, NoteRef } from './types'
import { entityTypeOf } from './types'

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

export function previewText(note: Note, max = 220): string {
  const raw = note.content ?? note.preview ?? ''
  const clean = stripEmbeds(raw)
    .replace(WIKILINK_RE, (_m, p1) => String(p1).split('|').pop()!.split('/').pop()!)
    .replace(/^#+\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > max ? clean.slice(0, max).trimEnd() + '…' : clean
}

// ---- Entities ----

export function entityName(ref: NoteRef | Note): string {
  // Path is like "People/Adam Elfers" → "Adam Elfers"
  return ref.path.split('/').pop() ?? ref.path
}

export function entitySummary(ref: NoteRef | Note): string {
  return (ref.metadata?.summary as string) ?? ''
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

// Pick the right route for any note ref (entity vs capture vs other).
export function noteHref(ref: NoteRef | Note): string {
  if (entityTypeOf(ref)) return entityHref(ref)
  return captureHref(ref)
}
