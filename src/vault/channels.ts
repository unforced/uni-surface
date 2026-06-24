// Agent-message + agent-roster helpers, shared by Channels (the live thread),
// Home (the unseen-message feed), and Agents (the roster). One source of truth
// for sender attribution, the agent roster shape, and the local seen-state.
//
// Tag note: agent tags are stored WITH a literal `#` (`#agent/message`,
// `#agent/definition`) — a filter built as `agent/message` returns nothing.
// All the constants below carry the `#`; never hand-build these strings.

import { createNote, listNotes, patchNote } from './api'
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
// A thread record (definition → thread → messages). Carries metadata.status:
// 'working' while a turn runs, 'ok'/'error' when it settles — written by the
// daemon. We subscribe to it to show a live "thinking…" pill.
export const THREAD_TAG = '#agent/thread'

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

// Edit an agent's system prompt — the body of its `#agent/definition` note.
// High blast radius: it changes how the agent behaves on its next run, so
// callers should confirm first.
export function updateAgentPrompt(defId: string, prompt: string): Promise<Note> {
  return patchNote(defId, { content: prompt })
}

// Set an agent's status (enabled | disabled) via its definition metadata.
export function setAgentStatus(defId: string, status: 'enabled' | 'disabled'): Promise<Note> {
  return patchNote(defId, { metadata: { status } })
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

// Pause/resume a job. The runner reads `enabled` each tick, so this takes
// effect on the next tick — no restart. (metadata merges; other keys untouched.)
export function setJobEnabled(id: string, enabled: boolean): Promise<Note> {
  return patchNote(id, { metadata: { enabled: enabled ? 'true' : 'false' } })
}

// Reschedule a job. The runner re-reads cron/tz on its next tick.
export function updateJobSchedule(id: string, cron: string, tz: string): Promise<Note> {
  return patchNote(id, { metadata: { cron: cron.trim(), tz: tz.trim() } })
}

// Validate a 5-field numeric cron against the runner's v1 grammar (min hour dom
// month dow; numeric only — no @macros or MON/JAN names; *, */n, a-b, a-b/n,
// a,b,c; dow 0-6, Sunday=0). The surface writes job notes DIRECTLY to the vault,
// which bypasses the daemon's validateJob — so we must gate here, or the runner
// silently skips a malformed cron.
export function isValidCron(cron: string): boolean {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return false
  const bounds: Array<[number, number]> = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ]
  const fieldOk = (spec: string, lo: number, hi: number): boolean =>
    spec.split(',').every((part) => {
      let body = part
      let step: number | null = null
      const slash = part.indexOf('/')
      if (slash !== -1) {
        step = Number(part.slice(slash + 1))
        if (!Number.isInteger(step) || step < 1) return false
        body = part.slice(0, slash)
      }
      if (body === '*') return true
      const dash = body.indexOf('-')
      if (dash !== -1) {
        const a = Number(body.slice(0, dash))
        const b = Number(body.slice(dash + 1))
        return Number.isInteger(a) && Number.isInteger(b) && a >= lo && b <= hi && a <= b
      }
      if (step !== null) return false // a step is only valid on '*' or a range
      const n = Number(body)
      return Number.isInteger(n) && n >= lo && n <= hi
    })
  return fields.every((spec, i) => fieldOk(spec, bounds[i][0], bounds[i][1]))
}

// Validate an IANA timezone (empty = daemon-local default, allowed). Mirrors the
// runner's Intl-based check.
export function isValidTz(tz: string): boolean {
  const t = tz.trim()
  if (!t) return true
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: t })
    return true
  } catch {
    return false
  }
}

// A job id slug — the runner's rule (alphanumeric, dash, underscore).
export const isValidJobId = (s: string) => /^[a-zA-Z0-9_-]+$/.test(s.trim())

// Create a scheduled job for an agent: writes an #agent/job note at the
// convention path. The runner picks it up on its next tick. Caller validates
// (slug, cron, tz) first — a direct write bypasses the daemon's validateJob.
export async function createAgentJob(params: {
  agent: string
  jobId: string
  cron: string
  tz: string
  message: string
}): Promise<Note> {
  const { agent, jobId, cron, tz, message } = params
  return createNote({
    path: `Channels/${agent}/jobs/${jobId.trim()}`,
    content: message.trim(),
    tags: [JOB_TAG],
    metadata: {
      jobId: jobId.trim(),
      channel: agent, // dual-carry the legacy routing key alongside `agent`
      agent,
      cron: cron.trim(),
      tz: tz.trim(),
      enabled: 'true',
      createdAt: new Date().toISOString(),
    },
  })
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

// The canonical URL for an agent's conversation. One agent ↔ one channel, so the
// agent name is the whole key (single-threaded agents have one thread, addressed
// by name; the thread note back-links its definition via metadata.definition).
export const agentHref = (name: string) => `/agent/${encodeURIComponent(name)}`

// The agent:read OAuth flow redirects out to the hub and back through the shared
// /oauth/callback — which would otherwise dump you on Home. Stash which agent's
// conversation you were on before the redirect, so the callback returns you
// there (where the turn-event stream actually lives).
const AGENT_RETURN_KEY = 'pv.agentReturn'
export function stashAgentReturn(channel: string): void {
  try {
    sessionStorage.setItem(AGENT_RETURN_KEY, channel)
  } catch {
    /* best-effort */
  }
}
export function takeAgentReturn(): string | null {
  try {
    const v = sessionStorage.getItem(AGENT_RETURN_KEY)
    if (v) sessionStorage.removeItem(AGENT_RETURN_KEY)
    return v && v.trim() ? v : null
  } catch {
    return null
  }
}

// ---- Read-state (vault-backed — cross-device) ----
//
// "Read" lives on the message note itself (`metadata.read: true`), set when
// Aaron sees a message, so unread is real across every device — replacing the
// old per-browser localStorage seen-map. Absent `read` = unread. Only outbound
// (agent→Aaron) messages are tracked; inbound are Aaron's own.

export function isRead(n: Note): boolean {
  return n.metadata?.read === true
}

// Mark messages read in the vault. Patches ONLY outbound messages not already
// read (bounded + idempotent — no redundant writes, no mark-read loop with the
// live subscription's echo). Best-effort: a failed mark is non-fatal (the
// message simply stays unread until the next view).
export async function markRead(notes: Note[]): Promise<void> {
  const toMark = notes.filter((n) => isOutbound(n) && !isRead(n))
  if (toMark.length === 0) return
  await Promise.allSettled(toMark.map((n) => patchNote(n.id, { metadata: { read: true } })))
}
