import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Note } from '../vault/types'
import { subscribeNotes } from '../vault/sse'
import { useAsync } from '../vault/useAsync'
import { Markdown } from '../components/Markdown'
import { SenderChip } from '../components/ChannelMessageCard'
import { noteHref } from '../vault/util'
import {
  CH_TAG,
  CHANNEL_KEY,
  type Arm,
  tsOf,
  senderOf,
  sparkOf,
  statusDotClass,
  fetchArmRoster,
  sendChannelMessage,
  selectChannel,
  isOutbound,
  markSeen,
} from '../vault/channels'

// The channels organ — talking to the Claude session through the vault, live.
// A message is a #channel-message note; sending writes an inbound note, the
// connected session replies with an outbound one, and both arrive in realtime
// over the SSE subscription (no polling). Aaron's messages right, arms' left —
// each arm with its own sender chip; reports and dispatches render as cards.
export function Channels() {
  const [channel, setChannel] = useState(() => localStorage.getItem(CHANNEL_KEY) || 'uni')
  const [msgs, setMsgs] = useState<Map<string, Note>>(new Map())
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [live, setLive] = useState(false)
  const [picker, setPicker] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  // The arm roster for the switcher. Failure is fine — the choices fall back to
  // the current channel + 'uni' and the free-text "other…" path still works.
  const roster = useAsync(() => fetchArmRoster().catch(() => [] as Arm[]), [])

  useEffect(() => {
    const inChannel = (n: Note) => String(n.metadata?.channel ?? '') === channel
    const unsub = subscribeNotes(
      { tag: CH_TAG },
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
  const armChoices = useMemo(() => {
    const arms = [...(roster.data ?? [])]
    for (const c of [channel, 'uni']) {
      if (!arms.some((a) => a.channel === c)) {
        arms.unshift({ name: c, channel: c, status: '', summary: '' })
      }
    }
    return arms
  }, [roster.data, channel])

  const ordered = useMemo(
    () => [...msgs.values()].sort((a, b) => tsOf(a).localeCompare(tsOf(b))),
    [msgs],
  )

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [ordered.length])

  // Reading the thread counts as seeing its arm messages — keeps Home's feed
  // and the Arms unread counts honest.
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
    selectChannel(c)
    setMsgs(new Map())
    setLive(false)
    setChannel(c)
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
                  {armChoices.map((a) => (
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
