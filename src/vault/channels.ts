// Channel-message + arm-roster helpers, shared by Channels (the live thread),
// Home (the unseen-message feed), and Arms (the roster). One source of truth
// for sender attribution, the Uni/Arms roster shape, and the local seen-state.

import { createNote, listNotes } from './api'
import type { Note, NoteRef } from './types'
import { SOURCED_FROM } from './util'

export const CH_TAG = '#channel-message'
export const CHANNEL_KEY = 'pv.channel'
// Arm mandate notes (tag uni-state) live here; their metadata names the channel.
export const ARMS_PREFIX = 'Uni/Arms/'

export const tsOf = (n: Note) => String(n.metadata?.ts ?? n.createdAt ?? '')

export function isOutbound(n: Note): boolean {
  const d = String(n.metadata?.direction ?? '')
  if (d) return d === 'outbound'
  return (n.tags ?? []).some((t) => t.endsWith('/outbound'))
}

// Who spoke. metadata.sender is the truth ('aaron', 'operator', or
// '<octopus>/<arm>'); legacy messages without one fall back to direction.
// NOTE: self-vs-other (which side a bubble sits on) is decided by DIRECTION, not
// by matching this string — see `mine` in Channels. So a human message stamped
// "operator" by the channel chat or "aaron" by this UI both render as mine, and
// the sender here only labels the chip on the other (outbound/arm) side.
export function senderOf(n: Note): string {
  const s = String(n.metadata?.sender ?? '').trim()
  if (s) return s
  return isOutbound(n) ? 'uni' : 'aaron'
}

// Chip label: drop the octopus prefix ("uni/weaver" → "weaver"); the full
// sender rides in the chip's title.
export const senderLabel = (s: string) => s.replace(/^[^/]+\//, '')

// Stable palette slot per sender: hash the full sender string onto one of the
// .sender-cN classes (colors defined in styles.css from the app palette).
const SENDER_PALETTE = 6
export function senderColorClass(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return `sender-c${h % SENDER_PALETTE}`
}

// The note a dispatch was sparked by — its outbound `sourced-from` link. Link
// data only rides along when the API included it (SSE payloads may be lean);
// we never fetch per-message, so the chip simply appears when data is there.
export function sparkOf(n: Note): NoteRef | null {
  for (const l of n.links ?? []) {
    if (l.sourceId === n.id && l.relationship === SOURCED_FROM && l.targetNote) {
      return l.targetNote
    }
  }
  return null
}

// ---- Arm roster ----

// One arm from the roster: its mandate note at Uni/Arms/<name>.
export interface Arm {
  name: string // path leaf — the display name
  channel: string
  status: string // active | birthing | dormant | '' (unknown)
  summary: string
}

export function armOf(n: Note): Arm {
  const leaf = n.path.split('/').pop() ?? n.path
  return {
    name: leaf,
    channel: String(n.metadata?.channel ?? '').trim() || leaf,
    status: String(n.metadata?.status ?? '').trim(),
    summary: String(n.metadata?.summary ?? '').trim(),
  }
}

// status → dot class (reuses the entity status-dot palette: green/amber/gray).
export function statusDotClass(status: string): string {
  if (status === 'active') return 'status-active'
  if (status === 'birthing') return 'status-incubating'
  return 'status-dormant'
}

// The full arm roster, deduped by channel and sorted. Callers decide how to
// handle failure (Channels falls back to the current channel + 'uni').
export async function fetchArmRoster(): Promise<Arm[]> {
  const notes = await listNotes({ pathPrefix: ARMS_PREFIX, includeMetadata: true, limit: 100 })
  const seen = new Set<string>()
  const arms: Arm[] = []
  for (const n of notes) {
    const a = armOf(n)
    if (!a.channel || seen.has(a.channel)) continue
    seen.add(a.channel)
    arms.push(a)
  }
  arms.sort((a, b) => a.channel.localeCompare(b.channel))
  return arms
}

// ---- Messages ----

// All recent arm→Aaron messages across every channel, newest first — ONE query
// for Home's feed and the Arms roster (never one query per arm). Queries the
// parent tag and filters client-side so legacy notes without the /outbound
// subtag still count.
export async function listOutboundMessages(limit = 300): Promise<Note[]> {
  const notes = await listNotes({
    tag: CH_TAG,
    includeMetadata: true,
    includeContent: true,
    sort: 'desc',
    limit,
  })
  return notes.filter(isOutbound)
}

// channel → latest outbound ts (ISO), from one already-fetched message list.
export function lastOutboundByChannel(notes: Note[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const n of notes) {
    const c = String(n.metadata?.channel ?? '')
    if (!c) continue
    const ts = tsOf(n)
    if (ts > (out.get(c) ?? '')) out.set(c, ts)
  }
  return out
}

// Write Aaron's message into a channel (the inbound half of the conversation).
export function sendChannelMessage(channel: string, body: string): Promise<Note> {
  const ts = new Date().toISOString()
  return createNote({
    path: `Channels/${channel}/${ts.replace(/[:.]/g, '-')}`,
    content: body,
    tags: [CH_TAG, `${CH_TAG}/inbound`],
    metadata: { channel, direction: 'inbound', sender: 'aaron', ts },
  })
}

// Persist the channel selection the Channels route reads on mount — lets any
// card/roster link land the user on the right thread.
export function selectChannel(channel: string) {
  localStorage.setItem(CHANNEL_KEY, channel)
}

// ---- Seen-state (local only — which arm messages Aaron's feed has shown) ----

const SEEN_KEY = 'pv.channelSeen'
const SEEN_MAX = 2000

// note id → ISO timestamp of when its card was first rendered.
export function seenMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function markSeen(ids: string[]) {
  if (ids.length === 0) return
  const map = seenMap()
  const now = new Date().toISOString()
  let changed = false
  for (const id of ids) {
    if (!map[id]) {
      map[id] = now
      changed = true
    }
  }
  if (!changed) return
  // Keep the map bounded: drop the oldest entries past the cap.
  const entries = Object.entries(map)
  const trimmed =
    entries.length > SEEN_MAX
      ? entries.sort((a, b) => b[1].localeCompare(a[1])).slice(0, SEEN_MAX)
      : entries
  localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(trimmed)))
}
