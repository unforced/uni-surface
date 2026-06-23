import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import type { Note } from '../vault/types'
import { getClient } from '../vault/surface'
import { useAsync } from '../vault/useAsync'
import { Markdown } from '../components/Markdown'
import { SenderChip } from '../components/ChannelMessageCard'
import { noteHref } from '../vault/util'
import { TurnStream } from '../components/TurnStream'
import { subscribeTurnEvents, foldTurn, emptyTurn, type TurnState } from '../vault/turnEvents'
import { ensureAgentToken, getAgentHubOrigin, hasAgentToken, beginAgentOAuth } from '../vault/agentAuth'
import { getConfig } from '../vault/config'
import {
  MSG_TAG,
  THREAD_TAG,
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
  const [thinking, setThinking] = useState(false)
  const [turn, setTurn] = useState<TurnState>(emptyTurn())
  const [agentReady] = useState(() => hasAgentToken())
  const endRef = useRef<HTMLDivElement>(null)
  const threadsRef = useRef<Map<string, Note>>(new Map())

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
    const client = getClient()
    if (!client) return
    const inChannel = (n: Note) => noteAgentKey(n) === channel
    // VaultClient.subscribe carries the bearer in the Authorization header (no
    // token in the query string) and self-corrects on reconnect with a fresh
    // snapshot + refresh-on-401. onStatus drives the live indicator.
    const unsub = client.subscribe(
      { tag: MSG_TAG },
      {
        onSnapshot: (notes) => {
          const m = new Map<string, Note>()
          for (const n of notes as unknown as Note[]) if (inChannel(n)) m.set(n.id, n)
          setMsgs(m)
          setLive(true)
        },
        onUpsert: (note) => {
          const n = note as unknown as Note
          setMsgs((prev) => {
            if (!inChannel(n)) return prev
            const next = new Map(prev)
            next.set(n.id, n)
            return next
          })
        },
        onRemove: (id) =>
          setMsgs((prev) => {
            const next = new Map(prev)
            next.delete(id)
            return next
          }),
        onStatus: (s) => setLive(s === 'open'),
        onError: () => setLive(false),
      },
    )
    return unsub
  }, [channel])

  // Live "thinking…" pill: the agent's #agent/thread note carries
  // metadata.status ('working' during a turn, 'ok'/'error' after) — written by
  // the daemon today. We read that existing state over the same live-query (no
  // new writes, no new auth) and light the pill while any of this agent's
  // threads is working.
  useEffect(() => {
    threadsRef.current = new Map()
    setThinking(false)
    const client = getClient()
    if (!client) return
    const forAgent = (n: Note) => noteAgentKey(n) === channel
    const isWorking = (n: Note) => String(n.metadata?.status ?? '') === 'working'
    const recompute = () => setThinking([...threadsRef.current.values()].some(isWorking))
    const unsub = client.subscribe(
      { tag: THREAD_TAG },
      {
        onSnapshot: (notes) => {
          threadsRef.current = new Map(
            (notes as unknown as Note[]).filter(forAgent).map((n) => [n.id, n]),
          )
          recompute()
        },
        onUpsert: (note) => {
          const n = note as unknown as Note
          if (!forAgent(n)) return
          threadsRef.current.set(n.id, n)
          recompute()
        },
        onRemove: (id) => {
          threadsRef.current.delete(id)
          recompute()
        },
      },
    )
    return unsub
  }, [channel])

  // (d) The rich "watch it work" stream — layers onto the pill when an
  // agent:read token is present. Opens the daemon turn-events SSE for this
  // channel and folds events into the live turn. No token → no-op (the pill
  // still works on the thread status alone).
  useEffect(() => {
    let unsub = () => {}
    let cancelled = false
    ;(async () => {
      const token = await ensureAgentToken()
      const origin = getAgentHubOrigin()
      if (cancelled || !token || !origin) return
      unsub = subscribeTurnEvents(origin, channel, token, {
        onEvent: (e) => setTurn((prev) => foldTurn(prev, e)),
      })
    })()
    return () => {
      cancelled = true
      unsub()
      setTurn(emptyTurn())
    }
  }, [channel])

  // Clear the streamed turn once it settles — the final answer lands as a
  // normal message bubble, so we don't want the streamed copy lingering.
  useEffect(() => {
    if (!thinking) setTurn(emptyTurn())
  }, [thinking])

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

  // One-time consent for the rich turn-stream: runs the isolated agent:read
  // OAuth flow (separate audience from the vault token). Redirects out and back
  // through /oauth/callback, which stores the agent token.
  async function enableAgentDetail() {
    const cfg = getConfig()
    if (!cfg) return
    try {
      const { authorizeUrl } = await beginAgentOAuth(cfg.origin)
      window.location.assign(authorizeUrl)
    } catch {
      /* best-effort — the thinking pill still works without the detail token */
    }
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
          {!agentReady && (
            <button className="chat-enable" onClick={enableAgentDetail} title="Stream tool calls + partial replies as the agent works">
              watch it work ▸
            </button>
          )}
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
        <TurnStream turn={turn} />
        {thinking && (
          <div className="chat-thinking" aria-live="polite">
            <span className="ct-label">{channel} is thinking</span>
            <span className="ct-dots">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
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
