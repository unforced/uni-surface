import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Note } from '../vault/types'
import { Markdown } from './Markdown'
import { OpenNote } from './common'
import { formatRelative } from '../vault/util'
import {
  senderOf,
  senderLabel,
  senderColorClass,
  tsOf,
  markRead,
  agentHref,
  sendChannelMessage,
  noteAgentKey,
} from '../vault/channels'

// An agent's name as a small colored chip — same palette slot everywhere it
// speaks (Channels bubbles, Home feed cards). Full sender rides in the title.
export function SenderChip({ sender }: { sender: string }) {
  return (
    <span className={`chat-sender ${senderColorClass(sender)}`} title={sender}>
      {senderLabel(sender)}
    </span>
  )
}

// Quiet inline reply: a toggle that opens a one-shot textarea writing Aaron's
// inbound note into the channel, plus the jump into the full thread.
function ReplyRow({ channel }: { channel: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  async function send() {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try {
      await sendChannelMessage(channel, body)
      setText('')
      setOpen(false)
      setSent(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="cm-foot">
      {open ? (
        <div className="cm-reply">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Reply on #${channel}…  (⌘↵ to send)`}
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
      ) : (
        <button className="cm-reply-toggle" onClick={() => setOpen(true)}>
          {sent ? 'Sent ↩ Reply again' : 'Reply ↩'}
        </button>
      )}
      <Link className="cm-thread" to={agentHref(channel)}>
        open thread →
      </Link>
    </div>
  )
}

// Shared shell for a channel message in the Home feed: sender chip + channel +
// when, the message body, and the inline reply affordance. Rendering the card
// marks the note seen (it then lives on in the thread view, not the feed).
function CardBase({ note, report }: { note: Note; report: boolean }) {
  const sender = senderOf(note)
  const channel = noteAgentKey(note)
  const asks = report ? note.metadata?.asks : undefined
  const ts = tsOf(note)

  useEffect(() => {
    void markRead([note])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id])

  return (
    <div className={`cm-card${report ? ' cm-report' : ''}`}>
      <div className="cm-head">
        <SenderChip sender={sender} />
        {report && <span className="chat-kind">report</span>}
        {asks !== undefined && asks !== null && (
          <span className={`chat-asks${Number(asks) === 0 ? ' none' : ''}`}>
            {Number(asks) === 0 ? 'no asks' : `${asks} ask${Number(asks) === 1 ? '' : 's'}`}
          </span>
        )}
        {channel && (
          <Link className="cm-chan" to={agentHref(channel)}>
            #{channel}
          </Link>
        )}
        {ts && <span className="cm-when">{formatRelative(ts)}</span>}
        <span style={{ flex: 1 }} />
        <OpenNote note={note} className="cm-open" />
      </div>
      <div className="cm-body">
        <Markdown content={note.content ?? ''} />
      </div>
      <ReplyRow channel={channel || 'uni'} />
    </div>
  )
}

// A plain arm→Aaron message surfaced on Home.
export function ChannelMessageCard({ note }: { note: Note }) {
  return <CardBase note={note} report={false} />
}

// A standup/run report on Home — distinct framing + the asks badge.
export function ReportCard({ note }: { note: Note }) {
  return <CardBase note={note} report />
}
