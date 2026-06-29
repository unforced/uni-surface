import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import type { Note } from '../vault/types'
import { getClient } from '../vault/surface'
import { useAsync } from '../vault/useAsync'
import { getNote, listNotes, uploadStorageFile, addAttachment } from '../vault/api'
import { Markdown } from '../components/Markdown'
import { SenderChip } from '../components/ChannelMessageCard'
import { noteHref, formatRelative } from '../vault/util'
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
  markRead,
  noteAgentKey,
  agentHref,
  stashAgentReturn,
} from '../vault/channels'

// Uni — the one place you talk to Uni, conversation-first. This is the merge of
// the old Agents window and Channels chat: the conversation IS the body. Sending
// writes an inbound agent/message note, Uni replies with an outbound one, and
// both arrive live over the SSE subscription (no polling). Aaron's messages
// right, Uni's left — reports and dispatches render as cards.
//
// The bare /uni route talks to the default 'uni' thread; /agent/:name selects a
// specific thread. We keep the language of *threads* here, not channels/agents —
// the machinery (definitions, schedules, prompts) lives on the Manage page.
export function Uni() {
  // `/agent/:name` addresses one thread; the bare `/uni` route falls back to the
  // last-selected one, defaulting to 'uni'. The route param is source of truth.
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
  // An optional file to attach to the next message (uploaded to vault storage +
  // attached to the message note).
  const [file, setFile] = useState<File | null>(null)
  const [live, setLive] = useState(false)
  const [picker, setPicker] = useState(false)
  const [thinking, setThinking] = useState(false)
  // The current thread note id — so the header can open the raw agent/thread
  // note (rolling summary + status + session id). Most-recent when there's >1.
  const [threadId, setThreadId] = useState<string | null>(null)
  const [turn, setTurn] = useState<TurnState>(emptyTurn())
  const [agentReady] = useState(() => hasAgentToken())
  // "What Uni's working on" strip + the foldable self-state — calm by default.
  const [working, setWorking] = useState<string[]>([])
  const [workOpen, setWorkOpen] = useState(false)
  const [nowOpen, setNowOpen] = useState(false)
  // The "what's loaded into context" panel + its per-layer folds (def, thread
  // content) — all calm and folded by default.
  const [ctxOpen, setCtxOpen] = useState(false)
  const [defOpen, setDefOpen] = useState(false)
  const [threadCtxOpen, setThreadCtxOpen] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const threadsRef = useRef<Map<string, Note>>(new Map())

  // Self-state + recent log for the working strip. Cheap queries; soft-fail so a
  // missing layer never blanks the conversation.
  const now = useAsync(() => getNote('Uni/Now').catch(() => null), [])
  const log = useAsync(
    () =>
      listNotes({ pathPrefix: 'Uni/Log/', sort: 'desc', limit: 5, includeMetadata: true }).catch(
        () => [] as Note[],
      ),
    [],
  )

  // Prefill the composer when arriving via a note's "Reference in Uni" action
  // (/agent/:name?ref=<path>): drop a wikilink so the message links back in the
  // graph. Strip the param after; never clobber an already-typed draft.
  useEffect(() => {
    const ref = searchParams.get('ref')
    if (!ref) return
    setText((t) => (t.trim() ? t : `Referencing [[${ref}]]\n\n`))
    const next = new URLSearchParams(searchParams)
    next.delete('ref')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // The thread roster for the menu. Failure is fine — choices fall back to the
  // current thread + 'uni' and the free-text "other…" path still works.
  const roster = useAsync(() => fetchAgentRoster().catch(() => [] as Agent[]), [])

  // The active thread note — its body is THIS thread's standing context and its
  // metadata.loadout the skills composed into the system prompt. Fetched fresh
  // (the live thread subscription carries metadata, not always content), keyed on
  // the resolved thread id. Soft-fail: no thread yet → the context panel stays
  // quiet.
  const activeThread = useAsync(
    () => (threadId ? getNote(threadId).catch(() => null) : Promise.resolve(null)),
    [threadId],
  )

  useEffect(() => {
    const client = getClient()
    if (!client) return
    const inChannel = (n: Note) => noteAgentKey(n) === channel
    // Scope the subscription to THIS conversation server-side. The old
    // `{ tag: MSG_TAG }` subscribed to EVERY agent message across all threads,
    // then filtered client-side — an unbounded snapshot (every channel's whole
    // history) that loaded slowly and held a needlessly wide live stream. The
    // read-side routing key is `noteAgentKey = agent || channel`, and the
    // channel→agent cutover backfilled `agent` on every message, so
    // `meta[agent]=channel` returns exactly this conversation, snapshot + live.
    // `inChannel` below stays as belt-and-suspenders.
    const unsub = client.subscribe(
      { tag: MSG_TAG, metadata: { agent: channel } },
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
            // Deletes broadcast vault-wide (the remove payload is a thin id ref,
            // un-scope-matchable) — so cross-thread deletes reach this scoped
            // stream too. Skip the Map rebuild + re-render when we don't hold it.
            if (!prev.has(id)) return prev
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

  // Live "thinking…" pill for THIS thread + the working set across all threads
  // (for the strip). Reads the existing agent/thread metadata.status ('working'
  // during a turn) over the same live-query — no new writes, no new auth.
  useEffect(() => {
    threadsRef.current = new Map()
    setThinking(false)
    setThreadId(null)
    setWorking([])
    const client = getClient()
    if (!client) return
    const forChannel = (n: Note) => noteAgentKey(n) === channel
    const isWorking = (n: Note) => String(n.metadata?.status ?? '') === 'working'
    const recompute = () => {
      const all = [...threadsRef.current.values()]
      const mine = all.filter(forChannel)
      setThinking(mine.some(isWorking))
      const latest = mine
        .slice()
        .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))[0]
      setThreadId(latest?.id ?? null)
      // Every thread currently working (any channel) — drives the strip's pills.
      const names = new Set<string>()
      for (const n of all) if (isWorking(n)) names.add(noteAgentKey(n))
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
  }, [channel])

  // The rich "watch it work" stream — layers onto the pill when an agent:read
  // token is present. Opens the daemon turn-events SSE for this thread and folds
  // events into the live turn. No token → no-op (the pill still works).
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

  // Clear the streamed turn once it settles — the final answer lands as a normal
  // bubble, so we don't want the streamed copy lingering.
  useEffect(() => {
    if (!thinking) setTurn(emptyTurn())
  }, [thinking])

  // What the threads menu shows: only *enabled* agents — retired/disabled
  // definitions (old sub-agents) drop out of the switcher, since Uni is one
  // unified agent now. 'uni' and the current thread are always present (even when
  // disabled or absent from the roster) so you can never get stranded in a thread
  // you can't see to leave. Presented as plain thread names — the agent machinery
  // stays on the Manage page (which still lists every definition).
  const threadChoices = useMemo(() => {
    const agents = (roster.data ?? []).filter((a) => a.status === 'enabled')
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

  // Opening the thread marks its messages read in the vault — keeps For You,
  // Home, and the Manage unread badges honest across devices.
  useEffect(() => {
    void markRead(ordered)
  }, [ordered])

  // The thread title: 'uni' reads as the proper name "Uni"; any other thread
  // shows its own name (no "#" prefix — these are threads, not channels).
  const title = channel === 'uni' ? 'Uni' : channel

  // The agent definition behind this thread — its body is the shared identity
  // layer of the context. Matched from the roster by channel (the routing key).
  const activeDef = useMemo(
    () => (roster.data ?? []).find((a) => a.channel === channel) ?? null,
    [roster.data, channel],
  )

  // The thread's loadout: an ordered list of skill-note paths whose content is
  // composed into the prompt. Empty for every thread today (the mechanism is
  // wired but unused) → the panel reads "no skills loaded".
  const loadout = useMemo(() => {
    const l = activeThread.data?.metadata?.loadout
    return Array.isArray(l) ? l.map(String).filter(Boolean) : []
  }, [activeThread.data])

  // The strip's live-working summary (excludes nothing — it's the system pulse).
  const workingLabel = useMemo(() => {
    if (working.length === 0) return null
    if (working.length === 1) return working[0] === 'uni' ? 'Uni is working' : `${working[0]} is working`
    return working.includes('uni')
      ? `Uni and ${working.length - 1} other${working.length > 2 ? 's' : ''} working`
      : `${working.length} threads working`
  }, [working])

  async function send() {
    const body = text.trim()
    if ((!body && !file) || sending) return
    setSending(true)
    try {
      if (file) {
        // Upload to vault storage, send the message, then attach the file to the
        // message note. The body names the file + its storage path so Uni (which
        // has vault access) can locate it even before the daemon passes
        // attachments into the turn directly.
        const uploaded = await uploadStorageFile(file)
        const ref = `📎 Attached **${file.name}** \`${uploaded.path}\``
        const msgBody = body ? `${body}\n\n${ref}` : ref
        const note = await sendChannelMessage(channel, msgBody)
        await addAttachment(note.id, {
          path: uploaded.path,
          mimeType: file.type || 'application/octet-stream',
        })
      } else {
        await sendChannelMessage(channel, body)
      }
      setText('')
      setFile(null)
    } finally {
      setSending(false)
    }
  }

  function pickThread(c: string) {
    setPicker(false)
    if (!c || c === channel) return
    // Navigate to the canonical per-thread URL; the routeName effect resets the
    // transcript and switches the live subscription.
    navigate(agentHref(c))
  }

  // Escape hatch for a thread that has no definition note (yet).
  function customThread() {
    setPicker(false)
    const c = window.prompt('Thread name', channel)
    if (c && c.trim()) pickThread(c.trim())
  }

  // One-time consent for the rich turn-stream: runs the isolated agent:read
  // OAuth flow (separate audience from the vault token). Redirects out and back
  // through /oauth/callback, which stores the agent token.
  async function enableAgentDetail() {
    const cfg = getConfig()
    if (!cfg) return
    try {
      // Remember which conversation we're in, so the shared OAuth callback
      // returns here (where the turn-stream lives) instead of dumping us on Home.
      stashAgentReturn(channel)
      const { authorizeUrl } = await beginAgentOAuth(cfg.origin)
      window.location.assign(authorizeUrl)
    } catch {
      /* best-effort — the thinking pill still works without the detail token */
    }
  }

  return (
    <div className="page" style={{ maxWidth: 740 }}>
      <div className="page-head">
        <h1>{title}</h1>
        <p className="sub">
          <span className={`chat-dot${live ? ' on' : ''}`} />
          {live ? 'Live — talk to Uni; replies arrive in realtime.' : 'Connecting…'}
          {!agentReady && (
            <button className="chat-enable" onClick={enableAgentDetail} title="Stream tool calls + partial replies as Uni works">
              watch it work ▸
            </button>
          )}
          {threadId && (
            <>
              {' · '}
              <Link to={`/note/${encodeURIComponent(threadId)}`} className="chan-thread-link" title="Open this thread (agent/thread) as a raw note">
                thread ↗
              </Link>
            </>
          )}
        </p>
      </div>

      {/* Pinned thread switcher — a slim bar that stays under the global nav as
          the transcript scrolls, so "which thread am I talking to" (and the
          switch) is always one glance away, never scrolled off with the head. */}
      <div className="uni-talkbar">
        <span className="uni-talkbar-label">talking to</span>
        <span className="chan-switch">
          <button className="uni-talkbar-pick" onClick={() => setPicker((v) => !v)}>
            {title} <span className="uni-talkbar-caret">▾</span>
          </button>
          {picker && (
            <>
              <div className="overflow-scrim" onClick={() => setPicker(false)} />
              <div className="chan-pop">
                {threadChoices.map((a) => (
                  <button
                    key={a.channel}
                    className={`chan-item${a.channel === channel ? ' on' : ''}`}
                    title={a.summary || undefined}
                    onClick={() => pickThread(a.channel)}
                  >
                    <span className={`status-dot ${statusDotClass(a.status)}`} />
                    {a.channel === 'uni' ? 'Uni' : a.channel}
                    {a.status && <span className="chan-status">{a.status}</span>}
                  </button>
                ))}
                <button className="chan-item other" onClick={customThread}>other…</button>
              </div>
            </>
          )}
        </span>
        <span
          className={`uni-talkbar-dot${live ? ' on' : ''}`}
          title={live ? 'Live' : 'Connecting…'}
        />
      </div>

      <div className="chat">
        {ordered.length === 0 && live && (
          <p className="chat-empty">Nothing here yet. Say something to begin.</p>
        )}
        {ordered.map((m) => {
          const sender = senderOf(m)
          // Self-vs-other by DIRECTION, not sender name: inbound = the human
          // (me), outbound = a session/thread. Robust to whatever handle stamped
          // the note (the channel chat uses "operator", this UI uses "aaron").
          const mine = !isOutbound(m)
          const kind = String(m.metadata?.kind ?? '')
          const isCard = kind === 'report' || kind === 'dispatch'
          const spark = kind === 'dispatch' ? sparkOf(m) : null
          const asks = kind === 'report' ? m.metadata?.asks : undefined
          // CSS rows keep their historical names: .in = Aaron (right), .out = thread (left).
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
            <span className="ct-label">{title} is thinking</span>
            <span className="ct-dots">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* ── What's loaded into context for THIS thread — the three layers the
          system prompt is composed from: the def (Uni's shared identity), this
          thread's standing content, and the loadout (skills pulled up). Calm and
          collapsible, folded by default. The "see what notes are loaded" view. ── */}
      <div className="uni-context">
        <button className="uni-context-head" onClick={() => setCtxOpen((o) => !o)}>
          <span className="uni-context-title">What's in {title}'s context</span>
          <span className="uni-context-caret">{ctxOpen ? 'fold' : 'unfold'}</span>
        </button>
        {ctxOpen && (
          <div className="uni-context-body">
            <p className="uni-context-lede">
              The layers composed into this thread's prompt — Uni's shared identity,
              this thread's standing context, and the skills it loads.
            </p>

            {/* Layer 1 — the def (shared identity, one per agent). */}
            <div className="uni-layer">
              <button className="uni-layer-head" onClick={() => setDefOpen((o) => !o)}>
                <span className="uni-layer-k">def</span>
                <span className="uni-layer-name">
                  {activeDef ? `${activeDef.name}'s identity` : 'no definition'}
                </span>
                <span className="uni-layer-meta">{defOpen ? 'fold' : 'unfold'}</span>
              </button>
              {defOpen && (
                <div className="uni-layer-body">
                  {activeDef?.prompt ? (
                    <>
                      <Markdown content={activeDef.prompt} />
                      {activeDef.defId && (
                        <Link className="uni-layer-open" to={`/note/${encodeURIComponent(activeDef.defId)}`}>
                          open definition ↗
                        </Link>
                      )}
                    </>
                  ) : (
                    <p className="uni-layer-empty">No definition note for this thread yet.</p>
                  )}
                </div>
              )}
            </div>

            {/* Layer 2 — this thread's standing content (preserved across turns). */}
            <div className="uni-layer">
              <button className="uni-layer-head" onClick={() => setThreadCtxOpen((o) => !o)}>
                <span className="uni-layer-k">thread</span>
                <span className="uni-layer-name">this thread's standing context</span>
                <span className="uni-layer-meta">{threadCtxOpen ? 'fold' : 'unfold'}</span>
              </button>
              {threadCtxOpen && (
                <div className="uni-layer-body">
                  {activeThread.data?.content?.trim() ? (
                    <>
                      <Markdown content={activeThread.data.content} />
                      {threadId && (
                        <Link className="uni-layer-open" to={`/note/${encodeURIComponent(threadId)}`}>
                          open thread note ↗
                        </Link>
                      )}
                    </>
                  ) : (
                    <p className="uni-layer-empty">
                      No standing context — this thread runs on Uni's identity alone.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Layer 3 — the loadout (reusable skills, shared). Empty today. */}
            <div className="uni-layer">
              <div className="uni-layer-head static">
                <span className="uni-layer-k">loadout</span>
                <span className="uni-layer-name">skills pulled up</span>
              </div>
              <div className="uni-layer-body">
                {loadout.length > 0 ? (
                  <div className="uni-loadout-list">
                    {loadout.map((p) => (
                      <Link key={p} className="uni-loadout-item" to={`/note/${encodeURIComponent(p)}`}>
                        {p}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="uni-layer-empty">No skills loaded.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── What Uni's working on — a calm, collapsible glance above the composer.
          Live working pills + recent log + the foldable self-state. Styled like
          Home's "Recent activity", not the old agent config cards. ── */}
      <div className="uni-work">
        <button className="uni-work-head" onClick={() => setWorkOpen((o) => !o)}>
          <span className="uni-work-title">
            {workingLabel ? (
              <>
                <span className="ct-dots"><i /><i /><i /></span>
                <span className="uni-work-live">{workingLabel}…</span>
              </>
            ) : (
              "What Uni's working on"
            )}
          </span>
          <span className="uni-work-caret">{workOpen ? 'fold' : 'unfold'}</span>
        </button>
        {workOpen && (
          <div className="uni-work-body">
            <p className="uni-work-frame">
              Across all of Uni's threads — it's one agent, working in many.
            </p>
            {working.length > 0 && (
              <div className="uni-work-pills">
                {working.map((w) => (
                  <Link key={w} to={agentHref(w)} className="uni-work-pill">
                    <span className="ct-dots"><i /><i /><i /></span>
                    {w === 'uni' ? 'Uni' : w}
                  </Link>
                ))}
              </div>
            )}

            {(log.data?.length ?? 0) > 0 && (
              <div className="uni-work-recent">
                <div className="uni-work-label">Recent</div>
                {(log.data ?? []).map((n) => (
                  <Link
                    key={n.id}
                    className="uni-work-row"
                    to={`/note/${encodeURIComponent(n.path ?? n.id)}`}
                  >
                    <span className="uni-work-row-title">{(n.path ?? '').replace(/^Uni\/Log\//, '')}</span>
                    {typeof n.metadata?.summary === 'string' && (
                      <span className="uni-work-row-sum">{n.metadata.summary}</span>
                    )}
                  </Link>
                ))}
              </div>
            )}

            {now.data && (
              <div className="uni-now">
                <button className="uni-now-head" onClick={() => setNowOpen((o) => !o)}>
                  <span className="uni-now-title">Uni / Now</span>
                  <span className="uni-now-meta">
                    tended {formatRelative(now.data.updatedAt ?? now.data.createdAt)} · {nowOpen ? 'fold' : 'unfold'}
                  </span>
                </button>
                {nowOpen && (
                  <div className="uni-now-body">
                    <Markdown content={now.data.content ?? ''} />
                    <Link className="uni-now-open" to={`/note/${encodeURIComponent(now.data.path ?? now.data.id)}`}>
                      open as note ↗
                    </Link>
                  </div>
                )}
              </div>
            )}

            <Link className="uni-work-manage" to="/manage">
              Manage agents &amp; schedules →
            </Link>
          </div>
        )}
      </div>

      {file && (
        <div className="chat-file" title={file.name}>
          <span className="chat-file-name">📎 {file.name}</span>
          <button className="chat-file-x" onClick={() => setFile(null)} aria-label="Remove file">×</button>
        </div>
      )}
      <div className="chat-input">
        <label className="chat-attach" title="Attach a file">
          📎
          <input
            type="file"
            style={{ display: 'none' }}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={channel === 'uni' ? 'Talk to Uni…  (⌘↵ to send)' : `Message ${title}…  (⌘↵ to send)`}
          rows={2}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button className="btn" onClick={send} disabled={(!text.trim() && !file) || sending}>
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
