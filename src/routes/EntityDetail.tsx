import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getNote, patchNote } from '../vault/api'
import type { Note, NoteRef } from '../vault/types'
import { entityTypeOf, isCapture } from '../vault/types'
import { useAsync } from '../vault/useAsync'
import { Markdown } from '../components/Markdown'
import { Loading, ErrorBanner, EmptyState, Toast } from '../components/common'
import { BackIcon } from '../components/icons'
import {
  entityName,
  entityHref,
  captureHref,
  groupByDay,
  formatDayHeading,
  formatTime,
  previewText,
  sourceCaptures,
} from '../vault/util'

// type-specific metadata fields to surface
const TYPE_FIELDS: Record<string, string[]> = {
  project: ['status', 'role'],
  person: ['relation'],
  place: ['kind'],
  thread: ['active'],
  reference: ['kind'],
}

export function EntityDetail() {
  const { path = '' } = useParams()
  const decoded = decodeURIComponent(path)
  const [toast, setToast] = useState<string | null>(null)

  const { data, loading, error, reload } = useAsync(
    () => getNote(decoded, { includeLinks: true }),
    [decoded],
  )

  // Fetch the actual capture notes (with content) that link here, for previews.
  const captureRefs = useMemo(() => (data ? sourceCaptures(data).filter(isCapture) : []), [data])
  const captureIds = captureRefs.map((r) => r.id).join(',')

  const captureNotes = useAsync(async () => {
    if (captureRefs.length === 0) return [] as Note[]
    const settled = await Promise.all(
      captureRefs.slice(0, 200).map((r) =>
        getNote(r.id, { includeLinks: true }).catch(() => null),
      ),
    )
    return settled.filter((n): n is Note => n !== null)
  }, [captureIds])

  return (
    <div className="page">
      <Link to="/browse" className="back-link">
        <BackIcon /> Browse
      </Link>

      {loading && <Loading />}
      {Boolean(error) && <ErrorBanner error={error} onRetry={reload} />}

      {data && (
        <>
          <EntityHeader entity={data} onSaved={() => { setToast('Summary saved'); setTimeout(() => setToast(null), 1800); reload() }} />

          <div className="detail-cols">
            {/* Linked captures timeline */}
            <div>
              <div className="section-title">Across time</div>
              {captureNotes.loading && <Loading label="Tracing the threads…" />}
              {captureNotes.data && captureNotes.data.length === 0 && (
                <EmptyState art="🕸" title="No captures woven here yet">
                  When captures link to {entityName(data)}, they'll gather here as a timeline.
                </EmptyState>
              )}
              {captureNotes.data && captureNotes.data.length > 0 && (
                <CaptureTimeline notes={captureNotes.data} />
              )}

              {data.content && previewText(data).length > 0 && (
                <div style={{ marginTop: 36 }}>
                  <div className="section-title">Note</div>
                  <Markdown content={data.content} />
                </div>
              )}
            </div>

            {/* Related entities (co-occurrence) */}
            <RelatedRail entity={data} captureNotes={captureNotes.data ?? []} />
          </div>
        </>
      )}
      {toast && <Toast message={toast} />}
    </div>
  )
}

function EntityHeader({ entity, onSaved }: { entity: Note; onSaved: () => void }) {
  const type = entityTypeOf(entity)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(entity.metadata?.summary ?? ''))
  const [saving, setSaving] = useState(false)
  const fields = TYPE_FIELDS[type ?? ''] ?? []

  async function save() {
    setSaving(true)
    try {
      await patchNote(entity.id, { metadata: { ...entity.metadata, summary: draft.trim() } })
      setEditing(false)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`t-${type ?? ''}`}>
      <div className="detail-head">
        <span className="type-badge">{type}</span>
      </div>
      <h1 className="detail-title">{entityName(entity)}</h1>

      {editing ? (
        <div style={{ marginTop: 8 }}>
          <textarea
            className="summary-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            autoFocus
          />
          <div className="btn-row">
            <button className="btn-ghost btn" onClick={() => { setEditing(false); setDraft(String(entity.metadata?.summary ?? '')) }}>
              Cancel
            </button>
            <button className="btn" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save summary'}
            </button>
          </div>
        </div>
      ) : (
        <p className="summary-edit" style={{ marginTop: 6 }}>
          {entity.metadata?.summary ? String(entity.metadata.summary) : <span style={{ color: 'var(--ink-faint)' }}>No summary yet.</span>}
          <button className="text-toggle edit-pencil" onClick={() => setEditing(true)}>
            edit
          </button>
        </p>
      )}

      {fields.length > 0 && (
        <div className="meta-fields">
          {fields.map((f) => {
            const v = entity.metadata?.[f]
            if (v === undefined || v === null || v === '') return null
            return (
              <div className="meta-field" key={f}>
                <span className="mf-k">{f}</span>{' '}
                <span className="mf-v">{String(v)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CaptureTimeline({ notes }: { notes: Note[] }) {
  const days = useMemo(() => groupByDay(notes), [notes])
  return (
    <>
      {days.map((d) => (
        <div className="day-group" key={d.key}>
          <h3 className="day-heading" style={{ fontSize: 14 }}>
            {formatDayHeading(d.key)}
          </h3>
          <div className="spine">
            {d.items.map((c) => (
              <Link key={c.id} to={captureHref(c)} className="capture kind-text" style={{ display: 'block' }}>
                <div className="capture-meta">
                  <span>{formatTime(c.createdAt)}</span>
                </div>
                <div className="capture-body">
                  <span className="capture-preview">{previewText(c, 220) || '(no text)'}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

// Entities that co-occur on the shared captures.
function RelatedRail({ entity, captureNotes }: { entity: Note; captureNotes: Note[] }) {
  const related = useMemo(() => {
    const counts = new Map<string, { ref: NoteRef; n: number }>()
    for (const c of captureNotes) {
      for (const l of c.links ?? []) {
        const ref = l.targetNote
        if (!ref || ref.id === entity.id) continue
        if (!entityTypeOf(ref)) continue
        const cur = counts.get(ref.id)
        if (cur) cur.n++
        else counts.set(ref.id, { ref, n: 1 })
      }
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 14)
  }, [captureNotes, entity.id])

  return (
    <aside className="related-card">
      <div className="section-title" style={{ marginBottom: 12 }}>Related</div>
      {related.length === 0 ? (
        <p style={{ color: 'var(--ink-faint)', fontSize: 13.5 }}>
          Nothing co-occurs yet.
        </p>
      ) : (
        <div className="related-list">
          {related.map((r) => (
            <Link key={r.ref.id} to={entityHref(r.ref)} className="board-item">
              <div className="bi-name" style={{ fontSize: 13.5 }}>
                <span className={`status-dot`} style={{ background: 'var(--tc, var(--ink-faint))' }} />
                <span className={`t-${entityTypeOf(r.ref) ?? ''}`} style={{ display: 'contents' }} />
                {entityName(r.ref)}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-faint)' }}>{r.n}×</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </aside>
  )
}
