import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import type { Note } from '../vault/types'
import { subscribeNotes } from '../vault/sse'
import { useAsync } from '../vault/useAsync'
import { Markdown } from '../components/Markdown'
import { SenderChip } from '../components/ChannelMessageCard'
import { noteHref } from '../vault/util'
import {
  MSG_TAG,
  CHANNEL_KEY,
  type Agent,
  tsOf,
  senderOf,
  sparkOf,
  statusDotClass,
  fetchAgentRoster,
  sendChannelMessage,
  selectChannel,
  isOutbound,
  markSeen,
  noteAgentKey,
  agentHref,
} from '../vault/channels'

// The channels organ — talking to the agent through the vault, live.
// A message is an #agent/message note; sending writes an inbound note, the
// agent replies with an outbound one, and both arrive in realtime over the SSE
// subscription (no polling). Aaron's messages right, the agent's left — each
// with its own sender chip; reports and dispatches render as cards.
export function Channels() {
  // `/agent/:name` addresses one agent's conversation; the bare `/channels`
  // route falls back to the last-selected channel. The route param is the source
  // of truth when present.
  const { name: routeName } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [channel, setChannel] = useState(() => routeName || localStorage.getItem(CHANNEL_KEY) || 'uni')
  useEffect(() => {
    if (routeName && routeName !== channel) {
      setMsgs(new Map())
      setLive(false)
      setChannel(routeName)
      selectChannel(routeName)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeName])
  const [msgs, setMsgs] = useState<Map<string, Note>>(new Map())
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [live, setLive] = useState(false)
  const [picker, setPicker] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  // Prefill the composer when arriving via a note's "Reference in Uni" action
  // (/agent/:name?ref=<path>): drop a wikilink to the note so the message links
  // back to it in the graph. Strip the param after, so resend/refresh is clean
  // and an already-typed draft is never clobbered.
  useEffect(() => {
    const ref = searchParams.get('ref')
    if (!ref) return
    setText((t) => (t.trim() ? t : `Referencing [[${ref}]]\n\n`))
    const next = new URLSearchParams(searchParams)
    next.delete('ref')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // The agent roster for the switcher. Failure is fine — the choices fall back
  // to the current channel + 'uni' and the free-text "other…" path still works.
  const roster = useAsync(() => fetchAgentRoster().catch(() => [] as Agent[]), [])

  useEffect(() => {
    const inChannel = (n: Note) => noteAgentKey(n) === channel
    const unsub = subscribeNotes(
      { tag: MSG_TAG },
      {
        onSnapshot: (notes) => {
          const m = new Map<string, Note>()
          for (const n of notes) if (inChannel(n)) m.set(n.id, n)
          setMsgs(m)
          setLive(true)
        },
        onUpsert: (n) =>
          setMsgs((prev) => {
            if (!inChannel(n)) return prev
            const next = new Map(prev)
            next.set(n.id, n)
            return next
          }),
        onRemove: (id) =>
          setMsgs((prev) => {
            const next = new Map(prev)
            next.delete(id)
            return next
          }),
        onError: () => setLive(false),
      },
    )
    return unsub
  }, [channel])

  // What the switcher shows: the roster, with 'uni' (and whatever channel is
  // currently selected) always present even when the query came back empty.
  const agentChoices = useMemo(() => {
    const agents = [...(roster.data ?? [])]
    for (const c of [channel, 'uni']) {
      if (!agents.some((a) => a.channel === c)) {
        agents.unshift({
          name: c, channel: c, status: '',
          backend: '', mode: '', model: '', summary: '', prompt: '', defId: '',
        })
      }
    }
    return agents
  }, [roster.data, channel])

  const ordered = useMemo(
    () => [...msgs.values()].sort((a, b) => tsOf(a).localeCompare(tsOf(b))),
    [msgs],
  )

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [ordered.length])

  // Reading the thread counts as seeing its arm messages — keeps Home's feed
  // and the Agents unread counts honest.
  useEffect(() => {
    markSeen(ordered.filter(isOutbound).map((n) => n.id))
  }, [ordered])

  async function send() {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try {
      await sendChannelMessage(channel, body)
      setText('')
    } finally {
      setSending(false)
    }
  }

  function pickChannel(c: string) {
    setPicker(false)
    if (!c || c === channel) return
    // Navigate to the canonical per-agent URL; the routeName effect resets the
    // transcript and switches the live subscription.
    navigate(agentHref(c))
  }

  // Escape hatch for a channel that has no arm note (yet).
  function customChannel() {
    setPicker(false)
    const c = window.prompt('Channel name', channel)
    if (c && c.trim()) pickChannel(c.trim())
  }

  return (
    <div className="page" style={{ maxWidth: 740 }}>
      <div className="page-head">
        <div className="kicker">channels · how we talk</div>
        <h1>
          #{channel}
          <span className="chan-switch">
            <button className="rename-trigger" onClick={() => setPicker((v) => !v)}>switch</button>
            {picker && (
              <>
                <div className="overflow-scrim" onClick={() => setPicker(false)} />
                <div className="chan-pop">
                  {agentChoices.map((a) => (
                    <button
                      key={a.channel}
                      className={`chan-item${a.channel === channel ? ' on' : ''}`}
                      title={a.summary || undefined}
                      onClick={() => pickChannel(a.channel)}
                    >
                      <span className={`status-dot ${statusDotClass(a.status)}`} />
                      #{a.channel}
                      {a.status && <span className="chan-status">{a.status}</span>}
                    </button>
                  ))}
                  <button className="chan-item other" onClick={customChannel}>other…</button>
                </div>
              </>
            )}
          </span>
        </h1>
        <p className="sub">
          <span className={`chat-dot${live ? ' on' : ''}`} />
          {live ? 'Live — talk to Uni; replies arrive in realtime.' : 'Connecting…'}
        </p>
      </div>

      <div className="chat">
        {ordered.length === 0 && live && (
          <p className="chat-empty">No messages yet on #{channel}. Say something to begin.</p>
        )}
        {ordered.map((m) => {
          const sender = senderOf(m)
          // Self-vs-other by DIRECTION, not by sender name: inbound = the human
          // (me), outbound = a session/arm. Robust to whatever handle stamped the
          // note (the channel chat uses "operator", this UI uses "aaron").
          const mine = !isOutbound(m)
          const kind = String(m.metadata?.kind ?? '')
          const isCard = kind === 'report' || kind === 'dispatch'
          const spark = kind === 'dispatch' ? sparkOf(m) : null
          const asks = kind === 'report' ? m.metadata?.asks : undefined
          // CSS rows keep their historical names: .in = Aaron (right), .out = arm (left).
          return (
            <div key={m.id} className={`chat-row ${mine ? 'in' : 'out'}`}>
              <div className={`chat-bubble${isCard ? ` k-${kind}` : ''}`}>
                {(!mine || isCard) && (
                  <div className="chat-bubble-head">
                    {!mine && <SenderChip sender={sender} />}
                    {isCard && <span className="chat-kind">{kind}</span>}
                    {asks !== undefined && asks !== null && (
                      <span className={`chat-asks${Number(asks) === 0 ? ' none' : ''}`}>
                        {Number(asks) === 0 ? 'no asks' : `${asks} ask${Number(asks) === 1 ? '' : 's'}`}
                      </span>
                    )}
                    {spark && (
                      <Link className="chat-spark" to={noteHref(spark)} title={spark.path}>
                        sparked by →
                      </Link>
                    )}
                  </div>
                )}
                <Markdown content={m.content ?? ''} />
                <span className="chat-ts">
                  {tsOf(m) ? new Date(tsOf(m)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  <Link className="chat-open" to={noteHref(m)} title="Open as note">↗</Link>
                </span>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      <div className="chat-input">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Message #${channel}…  (⌘↵ to send)`}
          rows={2}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button className="btn" onClick={send} disabled={!text.trim() || sending}>
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
