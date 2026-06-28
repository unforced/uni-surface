import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listSurfaces, listPendingProposals } from '../vault/api'
import type { Note } from '../vault/types'
import { useAsync } from '../vault/useAsync'
import { CAPTURE_CREATED_EVENT } from '../App'
import { getClient } from '../vault/surface'
import { SenderChip } from '../components/ChannelMessageCard'
import { Loading } from '../components/common'
import { formatRelative } from '../vault/util'
import {
  THREAD_TAG,
  tsOf,
  senderOf,
  isRead,
  noteAgentKey,
  listOutboundMessages,
  sendChannelMessage,
  agentHref,
} from '../vault/channels'

// Home — the calm Uni front door (Uni/Design/The Uni-native surface → "Calm Uni
// front door"). Not a triage stream and not a decision-counter tollbooth: a
// spacious place to THINK WITH Uni (the composer drops into the conversation),
// with a legible PULSE of what the system is doing on Aaron's behalf, and a
// quiet pointer to For You when something wants him. The daily ritual lives in
// Today; the actionable feed lives in For You. This is the membrane's threshold.

const reportAsks = (n: Note) => Number(n.metadata?.asks ?? 0)

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Still up'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 22) return 'Good evening'
  return 'Late night'
}

// A one-line glance of a message for the pulse (markdown flattened, trimmed).
function preview(n: Note): string {
  const t = (n.content ?? '').replace(/[#*_`>-]/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length > 110 ? `${t.slice(0, 110)}…` : t
}

export function Home() {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const navigate = useNavigate()

  const surfaces = useAsync(() => listSurfaces(), [])
  const proposals = useAsync(() => listPendingProposals(), [])
  const messages = useAsync(() => listOutboundMessages(), [])

  // Refresh the pulse + For-You pointer when a capture lands (answers may resolve
  // surfaces; new activity may arrive).
  useEffect(() => {
    const r = () => {
      surfaces.reload()
      messages.reload()
    }
    window.addEventListener(CAPTURE_CREATED_EVENT, r)
    window.addEventListener('pv:capture-synced', r)
    return () => {
      window.removeEventListener(CAPTURE_CREATED_EVENT, r)
      window.removeEventListener('pv:capture-synced', r)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── The live pulse: which agents are mid-turn right now. ──
  // Reads the existing agent/thread status over the shared live subscription
  // (no new writes, no new auth) — the "watch it work" transparency that makes
  // a continuously-working system feel calm rather than loud.
  const [working, setWorking] = useState<string[]>([])
  const threadsRef = useRef<Map<string, Note>>(new Map())
  useEffect(() => {
    const client = getClient()
    if (!client) return
    const recompute = () => {
      const names = new Set<string>()
      for (const n of threadsRef.current.values()) {
        if (String(n.metadata?.status ?? '') === 'working') names.add(noteAgentKey(n))
      }
      setWorking([...names].filter(Boolean))
    }
    const unsub = client.subscribe(
      { tag: THREAD_TAG },
      {
        onSnapshot: (notes) => {
          threadsRef.current = new Map((notes as unknown as Note[]).map((n) => [n.id, n]))
          recompute()
        },
        onUpsert: (note) => {
          threadsRef.current.set((note as unknown as Note).id, note as unknown as Note)
          recompute()
        },
        onRemove: (id) => {
          threadsRef.current.delete(id)
          recompute()
        },
      },
    )
    return unsub
  }, [])

  // Recent activity — the last several agent→Aaron messages, a read-only glance
  // (not a triage list). Unread ones carry a quiet dot.
  const activity = useMemo(() => (messages.data ?? []).slice(0, 6), [messages.data])

  // Is anything actually waiting in For You? (open surfaces, pending proposals,
  // unread report-asks.) Drives the calm pointer — named, never a hard counter.
  const hasForYou = useMemo(() => {
    const openSurfaces = (surfaces.data ?? []).some((s) => (s.metadata?.state ?? 'open') === 'open')
    const pending = (proposals.data ?? []).some(
      (p) => (p.metadata?.status ?? 'pending') === 'pending',
    )
    const asks = (messages.data ?? []).some(
      (m) => String(m.metadata?.kind ?? '') === 'report' && reportAsks(m) > 0 && !isRead(m),
    )
    return openSurfaces || pending || asks
  }, [surfaces.data, proposals.data, messages.data])

  async function send() {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try {
      // Drop into the conversation with Uni — the front door IS the composer.
      await sendChannelMessage('uni', body)
      setText('')
      navigate(agentHref('uni'))
    } finally {
      setSending(false)
    }
  }

  const workingLabel =
    working.length === 0
      ? null
      : working.includes('uni')
        ? working.length === 1
          ? 'Uni is thinking'
          : `Uni and ${working.length - 1} other${working.length > 2 ? 's' : ''} are working`
        : working.length === 1
          ? `${working[0]} is working`
          : `${working.length} agents are working`

  return (
    <div className="page fd" style={{ maxWidth: 680 }}>
      <div className="fd-head">
        <div className="kicker">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
        <h1>{greeting()}.</h1>
        <p className="sub">
          Think with Uni — kick off work, talk something through, or just watch the pulse. Your day
          lives in <Link to="/today">Today</Link>; what wants you is in <Link to="/inbox">For You</Link>.
        </p>
      </div>

      {/* ── The composer: talk to Uni ── */}
      <div className="fd-composer">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Talk to Uni…  (⌘↵ to send)"
          rows={3}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void send()
            }
          }}
        />
        <div className="fd-composer-row">
          <span className="fd-hint">Drops into your conversation with Uni</span>
          <button className="btn" onClick={send} disabled={!text.trim() || sending}>
            {sending ? '…' : 'Send to Uni ↩'}
          </button>
        </div>
      </div>

      {/* ── The pulse: who's working right now ── */}
      {workingLabel && (
        <div className="fd-working" aria-live="polite">
          <span className="ct-dots"><i /><i /><i /></span>
          <span className="fd-working-label">{workingLabel}…</span>
        </div>
      )}

      {/* ── Quiet pointer to For You ── */}
      <Link className={`fd-foryou${hasForYou ? ' on' : ''}`} to="/inbox">
        {hasForYou ? 'Something’s waiting for you in For You →' : 'For You is clear — nothing needs you'}
      </Link>

      {/* ── Recent activity glance ── */}
      <div className="fd-activity">
        <div className="fd-activity-head">Recent activity</div>
        {messages.loading && activity.length === 0 && <Loading label="Reading the pulse…" />}
        {!messages.loading && activity.length === 0 && (
          <p className="fd-activity-empty">Quiet so far. When the agents work, it shows here.</p>
        )}
        {activity.map((m) => {
          const agent = noteAgentKey(m) || 'uni'
          const kind = String(m.metadata?.kind ?? '')
          return (
            <Link key={m.id} to={agentHref(agent)} className="fd-act-row">
              <SenderChip sender={senderOf(m)} />
              {(kind === 'report' || kind === 'dispatch') && <span className="fd-act-kind">{kind}</span>}
              <span className="fd-act-text">{preview(m)}</span>
              <span className="fd-act-when">{tsOf(m) ? formatRelative(tsOf(m)) : ''}</span>
              {!isRead(m) && <span className="fd-act-dot" title="unread" />}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
