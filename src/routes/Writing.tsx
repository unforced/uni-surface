import { Link } from 'react-router-dom'
import { listNotes } from '../vault/api'
import { entityTypeOf } from '../vault/types'
import { useAsync } from '../vault/useAsync'
import { entityHref, entityName, noteHref } from '../vault/util'
import { Loading, ErrorBanner } from '../components/common'

// The Writing section — the writing domain's home. Pieces (writing-tagged
// project-family entities) + the themes that thread them. Toward: the vault as
// the source of truth, unforced.org statically generated from these notes.
export function Writing() {
  const pieces = useAsync(() => listNotes({ tag: 'writing', includeMetadata: true, limit: 300, sort: 'desc' }), [])
  const themes = useAsync(() => listNotes({ tag: 'writing/theme', limit: 100, sort: 'asc' }), [])

  const pieceEntities = (pieces.data ?? []).filter((n) => entityTypeOf(n) === 'project')

  return (
    <div className="page">
      <div className="page-head">
        <div className="kicker">unforced.org</div>
        <h1>Writing</h1>
        <p className="sub">Your pieces and the themes that thread them — the vault as the source, the site a projection.</p>
      </div>

      {Boolean(pieces.error) && <ErrorBanner error={pieces.error} onRetry={pieces.reload} />}

      <section className="dev-section">
        <div className="section-title">Pieces</div>
        {pieces.loading && pieceEntities.length === 0 && <Loading label="…" />}
        <div className="dev-builds">
          {pieceEntities.map((p) => (
            <Link key={p.id} to={entityHref(p)} className="board-item">
              <div className="bi-name">
                <span className={`status-dot status-${p.metadata?.status ?? 'active'}`} />
                {entityName(p)}
                {p.metadata?.stage ? <span className="piece-stage">{String(p.metadata.stage)}</span> : null}
              </div>
              {p.metadata?.summary && <div className="bi-sum">{String(p.metadata.summary)}</div>}
            </Link>
          ))}
          {!pieces.loading && pieceEntities.length === 0 && (
            <p className="dev-hint">No pieces yet — the essay import will populate this.</p>
          )}
        </div>
      </section>

      <section className="dev-section">
        <div className="section-title">Themes</div>
        <p className="dev-hint">The through-lines of the body of work.</p>
        <div className="dev-craft-list">
          {(themes.data ?? []).map((t) => (
            <Link key={t.id} to={noteHref(t)} className="dev-craft-item">
              <span className="dev-craft-name">{t.path.split('/').pop()}</span>
            </Link>
          ))}
          {!themes.loading && (themes.data ?? []).length === 0 && <p className="dev-hint">No themes yet.</p>}
        </div>
      </section>
    </div>
  )
}
