import { useMemo, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { getNote, patchNote } from '../vault/api'
import type { Note, NoteRef } from '../vault/types'
import { entityTypeOf, entitySubtypeOf, isCapture } from '../vault/types'
import { useAsync } from '../vault/useAsync'
import { Markdown } from '../components/Markdown'
import { Loading, ErrorBanner, EmptyState, Toast } from '../components/common'
import { UnlinkedMentions } from '../components/UnlinkedMentions'
import { NoteControls } from '../components/NoteControls'
import { RenameEntity } from '../components/RenameEntity'
import { MergeEntity } from '../components/MergeEntity'
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
  structuralConnections,
  groundedIn,
  developsRefs,
  threadsAbout,
  threadAgentKey,
  formatRelative,
} from '../vault/util'
import { agentHref } from '../vault/channels'
import { RELATIONSHIP_LABELS } from '../vault/types'

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
  const nav = useNavigate()
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

  // The contribution flow: captures that DEVELOP this endeavor (working notes).
  const developRefs = useMemo(() => (data ? developsRefs(data) : []), [data])
  const developIds = developRefs.map((r) => r.id).join(',')
  const developNotes = useAsync(async () => {
    if (developRefs.length === 0) return [] as Note[]
    const settled = await Promise.all(
      developRefs.slice(0, 100).map((r) => getNote(r.id).catch(() => null)),
    )
    return settled.filter((n): n is Note => n !== null)
  }, [developIds])

  // The marquee strand: agent threads ABOUT this entity (inbound `about` edges).
  const threadRefs = useMemo(() => (data ? threadsAbout(data) : []), [data])

  const isEndeavor = data ? entityTypeOf(data) === 'project' : false

  return (
    <div className="page">
      {/* Context-sensitive back: return wherever the user came from. A deep
          link (no in-app history) has nothing to go back to → fall to Browse. */}
      <button
        type="button"
        className="back-link"
        onClick={() => (window.history.length > 1 ? nav(-1) : nav('/browse'))}
      >
        <BackIcon /> Back
      </button>

      {loading && <Loading />}
      {Boolean(error) && <ErrorBanner error={error} onRetry={reload} />}

      {data && (
        <>
          <EntityHeader entity={data} onSaved={() => { setToast('Summary saved'); setTimeout(() => setToast(null), 1800); reload() }} />

          <div className="detail-cols">
            <div>
              <Threads threads={threadRefs} />
              {isEndeavor && (
                <WorkingNotes notes={developNotes.data ?? []} loading={developNotes.loading} />
              )}
              {/* A piece (essay/book) is a standalone work — its content is the
                  main event. Skip the capture-timeline scaffolding and lead with
                  the writing + its publish meta. Other entities keep "Across time". */}
              {entitySubtypeOf(data) === 'piece' ? (
                <>
                  {data.content && previewText(data).length > 0 && (
                    <>
                      <PieceMeta entity={data} />
                      <Markdown content={data.content} />
                    </>
                  )}
                </>
              ) : (
                <>
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

                  <UnlinkedMentions entity={data} onLinked={reload} />

                  {data.content && previewText(data).length > 0 && (
                    <div style={{ marginTop: 36 }}>
                      <div className="section-title">Note</div>
                      <Markdown content={data.content} />
                      <GroundedIn entity={data} captureNotes={captureNotes.data ?? []} />
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Right rail: structural connections (entity↔entity) + co-occurrence */}
            <div className="detail-rail">
              <ConnectionsRail entity={data} />
              <RelatedRail entity={data} captureNotes={captureNotes.data ?? []} />
            </div>
          </div>

          <NoteControls
            note={data}
            onChanged={reload}
            onDeleted={() => nav('/browse')}
            allowPathEdit={false}
          />
        </>
      )}
      {toast && <Toast message={toast} />}
    </div>
  )
}

// Downward citations: the captures the current synthesis is grounded in. The
// provenance layer — every woven claim is one click from the words you spoke.
function GroundedIn({ entity, captureNotes }: { entity: Note; captureNotes: Note[] }) {
  const cites = groundedIn(entity)
  if (cites.length === 0) return null
  const byId = new Map(captureNotes.map((n) => [n.id, n]))
  return (
    <div className="grounded-in">
      <div className="grounded-head">Grounded in</div>
      <p className="grounded-hint">The captures this draws from — your own words, one click away.</p>
      <div className="grounded-list">
        {cites.map((c) => {
          const full = byId.get(c.id)
          const when = full?.createdAt ?? c.createdAt
          const preview = full ? previewText(full, 90) : (c.path.split('/').pop() ?? c.id)
          return (
            <Link key={c.id} to={captureHref(c)} className="grounded-cite">
              {when && <span className="gc-when">{formatRelative(when)}</span>}
              <span className="gc-text">{preview}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// The marquee strand: the agent threads ABOUT this entity. Each thread is a row
// linking to its agent's channel view (/agent/<agent>) — the conversation
// actively tending this. Hidden when nothing links here.
function Threads({ threads }: { threads: NoteRef[] }) {
  if (threads.length === 0) return null
  return (
    <div className="threads-strand">
      <div className="section-title">Threads</div>
      <p className="threads-hint">Agent threads tending this.</p>
      <div className="related-list">
        {threads.map((t) => {
          const agent = threadAgentKey(t)
          const turns = String(t.metadata?.turn_count ?? '').trim()
          return (
            <Link key={t.id} to={agentHref(agent)} className="board-item">
              <div className="bi-name" style={{ fontSize: 13.5 }}>
                <span className="status-dot" style={{ background: 'var(--tc, var(--ink-faint))' }} />
                {agent || 'thread'}
                {turns && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-faint)' }}>
                    {turns} turn{turns === '1' ? '' : 's'}
                  </span>
                )}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// The "working notes" strand on an endeavor — captures that DEVELOP it (the
// contribution flow). The raw thinking accreting toward its next state; what the
// Weaver reads to pick up the work.
function WorkingNotes({ notes, loading }: { notes: Note[]; loading: boolean }) {
  if (!loading && notes.length === 0) return null
  return (
    <div className="working-notes">
      <div className="section-title">Working notes</div>
      <p className="wn-hint">The raw thinking moving this forward — captures developing it.</p>
      {loading && notes.length === 0 && <Loading label="…" />}
      {notes.length > 0 && <CaptureTimeline notes={notes} />}
    </div>
  )
}

// A piece's publish line — stage, date, and a link out to the live post.
function PieceMeta({ entity }: { entity: Note }) {
  const m = entity.metadata ?? {}
  const stage = m.stage ? String(m.stage) : null
  const date = m.published_at ? String(m.published_at) : null
  const url = m.url ? String(m.url) : null
  if (!stage && !date && !url) return null
  return (
    <div className="piece-meta">
      {stage && <span className="piece-stage">{stage}</span>}
      {date && <span className="piece-meta-date">{date}</span>}
      {url && (
        <a className="piece-meta-link" href={url} target="_blank" rel="noreferrer">
          View on unforced.org →
        </a>
      )}
    </div>
  )
}

function EntityHeader({ entity, onSaved }: { entity: Note; onSaved: () => void }) {
  const type = entityTypeOf(entity)
  const nav = useNavigate()
  const [editing, setEditing] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [merging, setMerging] = useState(false)
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
        <span className="type-badge">{entitySubtypeOf(entity) ?? type}</span>
      </div>
      <h1 className="detail-title">
        {entityName(entity)}
        <button className="rename-trigger" onClick={() => setRenaming(true)} title="Rename / fix spelling">
          rename
        </button>
        <button className="rename-trigger" onClick={() => setMerging(true)} title="Merge into another entity">
          merge
        </button>
      </h1>

      {renaming && (
        <RenameEntity
          entity={entity}
          onClose={() => setRenaming(false)}
          onRenamed={(newPath) => {
            setRenaming(false)
            nav(`/entity/${encodeURIComponent(newPath)}`)
          }}
        />
      )}

      {merging && (
        <MergeEntity
          entity={entity}
          onClose={() => setMerging(false)}
          onMerged={(targetPath) => {
            setMerging(false)
            nav(`/entity/${encodeURIComponent(targetPath)}`)
          }}
        />
      )}

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

// Direct entity↔entity links (structural connections) — distinct from the
// capture co-occurrence "Related" rail. Shows the far-end entity + the labeled
// relationship, with direction (outgoing "works-on → X", incoming "X works-on").
function ConnectionsRail({ entity }: { entity: Note }) {
  const connections = useMemo(() => structuralConnections(entity), [entity])
  if (connections.length === 0) return null
  const relLabel = (rel: string) => RELATIONSHIP_LABELS[rel] ?? rel
  return (
    <aside className="related-card connections-card">
      <div className="section-title" style={{ marginBottom: 12 }}>Connections</div>
      <div className="related-list">
        {connections.map((c) => (
          <Link
            key={`${c.other.id}|${c.relationship}|${c.outgoing ? 'o' : 'i'}`}
            to={entityHref(c.other)}
            className={`board-item t-${c.type ?? ''}`}
          >
            <div className="bi-name" style={{ fontSize: 13.5 }}>
              <span className="status-dot" style={{ background: 'var(--tc, var(--ink-faint))' }} />
              {entityName(c.other)}
            </div>
            <div className="conn-rel">
              {c.outgoing ? (
                <>
                  <span className="conn-rel-edge">{relLabel(c.relationship)}</span>
                  <span className="conn-rel-arrow"> → </span>
                  {entityName(c.other)}
                </>
              ) : (
                <>
                  {entityName(c.other)}{' '}
                  <span className="conn-rel-edge">{relLabel(c.relationship)}</span>
                </>
              )}
            </div>
          </Link>
        ))}
      </div>
    </aside>
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

  if (related.length === 0) return null

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
