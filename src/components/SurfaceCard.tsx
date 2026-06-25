import { useState } from 'react'
import type { Note } from '../vault/types'
import { resolveSurface, reopenSurface } from '../vault/api'
import { openCapture } from '../App'
import { Markdown } from './Markdown'
import { OpenNote } from './common'

// The bold lead of a surface ("**The work.** …") → a short label for the reply
// chip. Falls back to the path leaf.
function leadLabel(s: Note): string {
  const m = (s.content ?? '').match(/\*\*(.+?)\*\*/)
  const lead = (m?.[1] ?? '').trim().replace(/[.:]$/, '')
  return lead || (s.path.split('/').pop() ?? 'this')
}

// Per-kind verbs — a reflection is acknowledged/riffed-on, not "answered".
const KIND_VERBS: Record<string, { respond: string; resolve: string }> = {
  inquiry: { respond: 'Respond', resolve: 'Resolve' },
  reflection: { respond: 'Riff on this', resolve: 'Acknowledge' },
  lesson: { respond: 'Respond', resolve: 'Got it' },
  digest: { respond: 'Respond', resolve: 'Done' },
  review: { respond: 'Respond', resolve: 'Done' },
}

// One surface as a card: the prompt/reflection, a Respond (threads responds-to
// AND auto-resolves), and a quiet Resolve. Resolved cards (in the inbox history)
// offer Reopen instead. Shared by the morning card and the For You inbox.
export function SurfaceCard({ surface, onChanged }: { surface: Note; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const kind = String(surface.metadata?.surface_kind ?? 'inquiry')
  const verbs = KIND_VERBS[kind] ?? KIND_VERBS.inquiry
  const label = leadLabel(surface)
  const domain = surface.metadata?.domain ? String(surface.metadata.domain) : null
  const resolved = (surface.metadata?.state ?? 'open') === 'resolved'

  async function setState(fn: (id: string) => Promise<unknown>) {
    setBusy(true)
    try {
      await fn(surface.id)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`mq mq-${kind}${resolved ? ' mq-resolved' : ''}`}>
      <div className="mq-tags">
        {kind !== 'inquiry' && <span className="mq-kind">{kind}</span>}
        {domain && <span className="mq-domain">{domain}</span>}
      </div>
      <div className="mq-body">
        <Markdown content={surface.content ?? ''} />
      </div>
      <div className="mq-actions">
        {resolved ? (
          <button className="mq-resolve" onClick={() => setState(reopenSurface)} disabled={busy}>
            {busy ? 'Reopening…' : 'Reopen'}
          </button>
        ) : (
          <>
            <button
              className="mq-respond"
              onClick={() => openCapture({ id: surface.id, label, resolveOnReply: true })}
            >
              {verbs.respond} <span className="mq-respond-arrow">↩</span>
            </button>
            <button className="mq-resolve" onClick={() => setState(resolveSurface)} disabled={busy}>
              {busy ? 'Resolving…' : verbs.resolve}
            </button>
          </>
        )}
        <span style={{ flex: 1 }} />
        <OpenNote note={surface} className="mq-open" />
      </div>
    </div>
  )
}
