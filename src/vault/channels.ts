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

// The agent a message belongs to — the read-side routing key. Post-cutover the
// daemon stamps `metadata.agent` only; pre-cutover (and stale-tab straggler)
// notes carry `metadata.channel`, and an empty agent ('') must fall through to
// channel. So truthiness (`||`), NOT `??` — mirrors the daemon's noteAgentKey.
export function noteAgentKey(n: Note): string {
  return String(n.metadata?.agent || n.metadata?.channel || '')
}

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

// ---- Schedules (#agent/job) ----

// A scheduled job: the runner injects this note's content as an inbound message
// to `agent` on its cron. Body = the message; metadata = the schedule + health.
// Full contract: Uni/Reference/Agent Jobs (#agent-job scheduling).
export const JOB_TAG = '#agent/job'

export interface AgentJob {
  jobId: string
  agent: string // target agent (the routing key — agent || channel)
  cron: string
  tz: string
  enabled: boolean
  lastRunAt: string
  lastStatus: string // 'ok' | 'error: …' | '' (never run)
  message: string // note body — what the runner delivers each fire
  path: string
  id: string
  updatedAt: string
}

export function agentJobOf(n: Note): AgentJob {
  const m = n.metadata ?? {}
  return {
    jobId: String(m.jobId ?? '').trim() || (n.path.split('/').pop() ?? ''),
    agent: noteAgentKey(n),
    cron: String(m.cron ?? '').trim(),
    tz: String(m.tz ?? '').trim(),
    enabled: String(m.enabled ?? '') === 'true',
    lastRunAt: String(m.lastRunAt ?? '').trim(),
    lastStatus: String(m.lastStatus ?? '').trim(),
    message: n.content ?? '',
    path: n.path,
    id: n.id,
    updatedAt: n.updatedAt ?? n.createdAt ?? '',
  }
}

// Every scheduled job, across all agents. Group with jobsByAgent.
export async function fetchAgentJobs(): Promise<AgentJob[]> {
  const notes = await listNotes({
    tag: JOB_TAG,
    includeMetadata: true,
    includeContent: true,
    limit: 100,
  })
  return notes.map(agentJobOf).filter((j) => j.agent)
}

export function jobsByAgent(jobs: AgentJob[]): Map<string, AgentJob[]> {
  const m = new Map<string, AgentJob[]>()
  for (const j of jobs) {
    const arr = m.get(j.agent) ?? []
    arr.push(j)
    m.set(j.agent, arr)
  }
  return m
}

// Best-effort human gloss of a 5-field numeric cron (min hour dom month dow).
// Falls back to the raw expression for anything it doesn't confidently match —
// honest over clever. Mirrors the runner's v1 cron (numeric, Sunday=0).
export function describeCron(cron: string): string {
  const f = cron.trim().split(/\s+/)
  if (f.length !== 5) return cron
  const [min, hour, dom, mon, dow] = f
  const clock = (() => {
    const hh = Number(hour)
    const mm = Number(min)
    if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh > 23 || mm > 59) return null
    const ap = hh < 12 ? 'am' : 'pm'
    const h12 = hh % 12 === 0 ? 12 : hh % 12
    return `${h12}:${String(mm).padStart(2, '0')}${ap}`
  })()
  if (dom === '*' && mon === '*' && clock) {
    if (dow === '*') return `daily at ${clock}`
    if (dow === '1-5') return `weekdays at ${clock}`
  }
  if (/^\*\/\d+$/.test(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `every ${min.slice(2)} min`
  }
  return cron
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
    const c = noteAgentKey(n)
    if (!c) continue
    const ts = tsOf(n)
    if (ts > (out.get(c) ?? '')) out.set(c, ts)
  }
  return out
}

// Write Aaron's message into a channel (the inbound half of the conversation).
// New-model path + tags: `channel/<agent>/<uuid>`, `#agent/message[/inbound]`.
//
// Routing key migration (expand→contract): the note routing key is moving
// `channel` → `agent`. We dual-carry both keys — `agent` is the destination,
// `channel` stays until the daemon flips its inbound trigger to
// `has_metadata:["agent"]` and drops the `channel` write. The `channel` param
// IS the agent name, so `agent: channel`. An EMPTY `agent` would make the agent
// deaf after the trigger flip — always populate it.
export function sendChannelMessage(channel: string, body: string): Promise<Note> {
  const ts = new Date().toISOString()
  const uuid = crypto.randomUUID()
  return createNote({
    path: `channel/${channel}/${uuid}`,
    content: body,
    tags: [MSG_TAG, `${MSG_TAG}/inbound`],
    metadata: { agent: channel, channel, direction: 'inbound', sender: 'aaron', ts },
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
