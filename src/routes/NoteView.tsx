import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getNote, fetchCapturesByIds } from '../vault/api'
import type { VaultLink } from '../vault/types'
import { useAsync } from '../vault/useAsync'
import { Markdown } from '../components/Markdown'
import { Loading, ErrorBanner, EmptyState } from '../components/common'
import { BackIcon } from '../components/icons'
import { entityName, noteHref, captureHref, previewText, formatRelative, repliesTo, RESPONDS_TO } from '../vault/util'

// The generic note view — the humble fallback for any note that isn't an
// entity or a capture (Now, Open Inquiry, Jobs/*, Feedback/*, anything else).
// Renders content, tags, and its graph links. Reached via /note/<path-or-id>.
export function NoteView() {
  const { id = '' } = useParams()
  const decoded = decodeURIComponent(id)

  const { data, loading, error, reload } = useAsync(
    () => getNote(decoded, { includeLinks: true }),
    [decoded],
  )

  const title = useMemo(() => {
    if (!data) return decoded.split('/').pop() ?? decoded
    const h1 = (data.content ?? '').match(/^#\s+(.+)$/m)
    return h1 ? h1[1].trim() : data.path.split('/').pop() ?? data.path
  }, [data, decoded])

  // Split graph links into outgoing / incoming, with the "other" note ref.
  // Inbound `responds-to` edges are pulled out into a dedicated Replies thread.
  const { outgoing, incoming } = useMemo(() => {
    const out: VaultLink[] = []
    const inc: VaultLink[] = []
    for (const l of data?.links ?? []) {
      if (l.sourceId === data?.id) out.push(l)
      else if (l.targetId === data?.id && l.relationship !== RESPONDS_TO) inc.push(l)
    }
    return { outgoing: out, incoming: inc }
  }, [data])

  // The conversational loop made visible: captures that answered this surface.
  const replyRefs = useMemo(() => (data ? repliesTo(data) : []), [data])
  const replyIds = replyRefs.map((r) => r.id).join(',')
  const replies = useAsync(async () => {
    if (replyRefs.length === 0) return []
    return fetchCapturesByIds(replyRefs.map((r) => r.id))
  }, [replyIds])

  return (
    <div className="note-wrap">
      <Link to="/browse" className="back-link">
        <BackIcon /> Notes
      </Link>

      {loading && <Loading label="Opening the note…" />}
      {Boolean(error) && <ErrorBanner error={error} onRetry={reload} />}
      {data === null && !loading && (
        <EmptyState art="🍃" title="No note here">
          Nothing lives at <code>{decoded}</code> yet.
        </EmptyState>
      )}

      {data && (
        <>
          <header className="note-head">
            <h1>{title}</h1>
            <div className="note-meta">
              <span className="note-path">{data.path}</span>
              {data.tags?.length > 0 && (
                <span className="note-tags">
                  {data.tags.map((t) => (
                    <span className="note-tag" key={t}>
                      {t}
                    </span>
                  ))}
                </span>
              )}
              {data.updatedAt && (
                <span className="note-when">updated {formatRelative(data.updatedAt)}</span>
              )}
            </div>
          </header>

          <article className="note-body">
            <Markdown content={data.content ?? ''} />
          </article>

          {replyRefs.length > 0 && (
            <section className="note-replies">
              <h3>Replies <span className="nr-count">{replyRefs.length}</span></h3>
              <p className="nr-hint">Your answers, threaded back to what they responded to.</p>
              <div className="nr-list">
                {(replies.data ?? []).map((c) => (
                  <Link key={c.id} to={captureHref(c)} className="nr-item">
                    <span className="nr-when">{formatRelative(c.createdAt)}</span>
                    <span className="nr-text">{previewText(c, 200) || '(no text)'}</span>
                  </Link>
                ))}
                {replies.loading && <span className="nr-loading">Gathering replies…</span>}
              </div>
            </section>
          )}

          {(outgoing.length > 0 || incoming.length > 0) && (
            <section className="note-links">
              {outgoing.length > 0 && (
                <div className="note-links-group">
                  <h3>Links out</h3>
                  <div className="chips">
                    {outgoing.map((l, i) =>
                      l.targetNote ? (
                        <Link key={i} className="link-chip" to={noteHref(l.targetNote)}>
                          <span className="lc-rel">{l.relationship}</span>
                          {entityName(l.targetNote)}
                        </Link>
                      ) : null,
                    )}
                  </div>
                </div>
              )}
              {incoming.length > 0 && (
                <div className="note-links-group">
                  <h3>Linked from</h3>
                  <div className="chips">
                    {incoming.map((l, i) =>
                      l.sourceNote ? (
                        <Link key={i} className="link-chip" to={noteHref(l.sourceNote)}>
                          <span className="lc-rel">{l.relationship}</span>
                          {entityName(l.sourceNote)}
                        </Link>
                      ) : null,
                    )}
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
