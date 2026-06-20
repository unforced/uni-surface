// Agent-message + agent-roster helpers, shared by Channels (the live thread),
// Home (the unseen-message feed), and Agents (the roster). One source of truth
// for sender attribution, the agent roster shape, and the local seen-state.
//
// Tag note: agent tags are stored WITH a literal `#` (`#agent/message`,
// `#agent/definition`) — a filter built as `agent/message` returns nothing.
// All the constants below carry the `#`; never hand-build these strings.

import { createNote, listNotes } from './api'
import type { Note, NoteRef } from './types'
import { SOURCED_FROM } from './util'

// The conversation stream. Querying the parent `#agent/message` returns its
// /inbound + /outbound descendants by tag inheritance. `#channel-message` is the
// pre-rename tag — kept read-only so historical threads still render.
export const MSG_TAG = '#agent/message'
export const LEGACY_MSG_TAG = '#channel-message'
export const CHANNEL_KEY = 'pv.channel'
// The agent roster: each agent is an `#agent/definition` note at Agents/<name>,
// its body the system prompt and its metadata the config.
export const AGENT_DEF_TAG = '#agent/definition'

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

// ---- Agent roster ----

// One agent from the roster: its `#agent/definition` note at Agents/<name>. The
// body is the system prompt; the metadata is the runtime config. An agent's
// channel IS its name (messages stamp metadata.channel = the agent name).
export interface Agent {
  name: string // = path leaf = channel
  channel: string
  status: string // enabled | disabled | '' (unknown)
  backend: string // programmatic | channel
  mode: string // single-threaded | multi-threaded
  model: string // e.g. claude-opus-4-8
  summary: string
  prompt: string // the system prompt (note body)
  defId: string // the definition note id — links to its threads
}

export function agentOf(n: Note): Agent {
  const leaf = n.path.split('/').pop() ?? n.path
  const name = String(n.metadata?.name ?? '').trim() || leaf
  return {
    name,
    channel: name,
    status: String(n.metadata?.status ?? '').trim(),
    backend: String(n.metadata?.backend ?? '').trim(),
    mode: String(n.metadata?.mode ?? '').trim(),
    model: String(n.metadata?.model ?? '').trim(),
    summary: String(n.metadata?.summary ?? '').trim(),
    prompt: n.content ?? '',
    defId: n.id,
  }
}

// status → dot class (reuses the entity status-dot palette: green/amber/gray).
export function statusDotClass(status: string): string {
  if (status === 'enabled' || status === 'active') return 'status-active'
  if (status === 'birthing') return 'status-incubating'
  return 'status-dormant' // disabled | dormant | unknown
}

// The full agent roster, sorted by name. Reads `#agent/definition` notes —
// body (system prompt) included so the roster can expand each agent inline.
// Callers decide how to handle failure (Channels falls back to a bare 'uni').
export async function fetchAgentRoster(): Promise<Agent[]> {
  const notes = await listNotes({
    tag: AGENT_DEF_TAG,
    includeMetadata: true,
    includeContent: true,
    limit: 100,
  })
  const agents = notes.map(agentOf).filter((a) => a.name)
  agents.sort((a, b) => a.name.localeCompare(b.name))
  return agents
}

// ---- Messages ----

// All recent agent→Aaron messages across every channel, newest first — for
// Home's feed and the Agents roster (never one query per agent). Queries the
// parent tag and filters client-side so notes without the /outbound subtag
// still count. Reads the new `#agent/message` tag and the legacy
// `#channel-message` tag, merging both so historical threads still appear.
export async function listOutboundMessages(limit = 300): Promise<Note[]> {
  const opts = { includeMetadata: true, includeContent: true, sort: 'desc' as const, limit }
  const [fresh, legacy] = await Promise.all([
    listNotes({ tag: MSG_TAG, ...opts }),
    listNotes({ tag: LEGACY_MSG_TAG, ...opts }).catch(() => [] as Note[]),
  ])
  const byId = new Map<string, Note>()
  for (const n of [...fresh, ...legacy]) byId.set(n.id, n)
  return [...byId.values()]
    .filter(isOutbound)
    .sort((a, b) => tsOf(b).localeCompare(tsOf(a)))
    .slice(0, limit)
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
// New-model path + tags: `channel/<agent>/<uuid>`, `#agent/message[/inbound]`.
export function sendChannelMessage(channel: string, body: string): Promise<Note> {
  const ts = new Date().toISOString()
  const uuid = crypto.randomUUID()
  return createNote({
    path: `channel/${channel}/${uuid}`,
    content: body,
    tags: [MSG_TAG, `${MSG_TAG}/inbound`],
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
