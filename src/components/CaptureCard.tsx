import { useNavigate } from 'react-router-dom'
import type { Note } from '../vault/types'
import { captureKindOf } from '../vault/types'
import { captureGlyph } from './icons'
import { EntityChip } from './common'
import { captureHref, formatTime, linkedEntities, previewText } from '../vault/util'

// One capture in the timeline spine.
export function CaptureCard({ note }: { note: Note }) {
  const nav = useNavigate()
  const kind = captureKindOf(note)
  const linked = linkedEntities(note)
  const preview = previewText(note, 280)
  // Optimistic, not-yet-synced captures carry a `local:` id (from the outbox).
  // They aren't navigable yet and wear a small sync chip.
  const pending = note.id.startsWith('local:')

  return (
    <article
      className={`capture kind-${kind ?? 'text'}${pending ? ' pending' : ''}`}
      onClick={pending ? undefined : () => nav(captureHref(note))}
      style={{ cursor: pending ? 'default' : 'pointer' }}
    >
      <span className="glyph">{captureGlyph(kind)}</span>
      <div className="capture-meta">
        <span className="kind">{kind === 'voice' ? 'voice' : kind === 'dream' ? 'dream' : 'note'}</span>
        <span>·</span>
        <span>{formatTime(note.createdAt)}</span>
        {pending && (
          <span className="sync-chip">{navigator.onLine ? 'saving…' : 'offline — queued'}</span>
        )}
      </div>
      <div className="capture-body">
        <span className="capture-preview">{preview || '(no text)'}</span>
      </div>
      {linked.length > 0 && (
        <div className="chips" onClick={(e) => e.stopPropagation()}>
          {linked.map((l) => (
            <EntityChip key={l.ref.id} entity={l.ref} relationship={l.relationship} showRel />
          ))}
        </div>
      )}
    </article>
  )
}
