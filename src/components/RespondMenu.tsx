import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAsync } from '../vault/useAsync'
import { agentHref, fetchAgentRoster, statusDotClass, type Agent } from '../vault/channels'

// "Respond" — drop a note into a conversation, routed to Uni by default or to a
// chosen agent. The generalized form of the old "Reference in Uni" button: a
// split control whose primary action goes to Uni and whose caret opens an agent
// picker. Navigating to `/agent/:name?ref=<path>` lands in that agent's thread
// with the composer prefilled `Referencing [[path]]` (the feed item becomes the
// context of the reply — the feed is the outbox, the reply is a conversation).
//
// The roster is fetched lazily (only when the picker opens), so a feed of many
// cards doesn't fan out a roster query per card.
export function RespondMenu({
  notePath,
  label = 'Respond',
  className = '',
}: {
  notePath: string
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const roster = useAsync(
    () => (open ? fetchAgentRoster().catch(() => [] as Agent[]) : Promise.resolve([] as Agent[])),
    [open],
  )

  function go(agent: string) {
    setOpen(false)
    nav(`${agentHref(agent)}?ref=${encodeURIComponent(notePath)}`)
  }

  // 'uni' is always offered first; the rest of the roster follows (deduped).
  const choices: Agent[] = [
    ...(roster.data ?? []).filter((a) => a.channel === 'uni'),
    ...(roster.data ?? []).filter((a) => a.channel !== 'uni'),
  ]

  return (
    <span className={`respond ${className}`}>
      <button
        className="respond-main"
        onClick={() => go('uni')}
        title="Bring this into a conversation with Uni"
      >
        {label} <span className="respond-arrow">↩</span>
      </button>
      <button
        className="respond-caret"
        onClick={() => setOpen((v) => !v)}
        aria-label="Respond to a specific agent"
        title="Send to a specific agent"
      >
        ▾
      </button>
      {open && (
        <>
          <div className="overflow-scrim" onClick={() => setOpen(false)} />
          <div className="respond-pop">
            <div className="respond-pop-head">Send to…</div>
            {roster.loading && <div className="respond-pop-empty">Loading agents…</div>}
            {!roster.loading && choices.length === 0 && (
              <button className="respond-item" onClick={() => go('uni')}>
                <span className="status-dot status-active" />
                uni
              </button>
            )}
            {choices.map((a) => (
              <button key={a.channel} className="respond-item" onClick={() => go(a.channel)}>
                <span className={`status-dot ${statusDotClass(a.status)}`} />
                {a.channel}
                {a.summary && <span className="respond-item-sum">{a.summary}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  )
}
