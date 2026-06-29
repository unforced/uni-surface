import { Link } from 'react-router-dom'
import { listNotes } from '../vault/api'
import type { Note } from '../vault/types'
import { entityTypeOf } from '../vault/types'
import { useAsync } from '../vault/useAsync'
import { entityHref, entityName, noteHref, formatRelative } from '../vault/util'
import { Loading, ErrorBanner } from '../components/common'
import { SectionLenses } from '../components/SectionLenses'

// The Dev section — the development domain's home. Builds (dev-tagged project
// entities) + the craft second-brain (dev/pattern, dev/learning) + the work log
// (dev/log). All live from the graph; the same section skeleton will serve Life
// and Writing.
export function Dev() {
  const builds = useAsync(() => listNotes({ tag: 'dev', includeMetadata: true, limit: 200, sort: 'asc' }), [])
  const patterns = useAsync(() => listNotes({ tag: 'dev/pattern', limit: 100, sort: 'asc' }), [])
  const learnings = useAsync(() => listNotes({ tag: 'dev/learning', limit: 100, sort: 'asc' }), [])
  const logs = useAsync(() => listNotes({ tag: 'dev/log', includeContent: false, limit: 50, sort: 'desc' }), [])

  const buildEntities = (builds.data ?? []).filter((n) => entityTypeOf(n) === 'project')

  return (
    <div className="page">
      <SectionLenses active="dev" />
      <div className="page-head">
        <div className="kicker">unforced.dev</div>
        <h1>Dev</h1>
        <p className="sub">The work through the dev lens — the builds, and the craft behind them.</p>
      </div>

      {Boolean(builds.error) && <ErrorBanner error={builds.error} onRetry={builds.reload} />}

      <section className="dev-section">
        <div className="section-title">What's building</div>
        {builds.loading && buildEntities.length === 0 && <Loading label="…" />}
        <div className="dev-builds">
          {buildEntities.map((b) => (
            <Link key={b.id} to={entityHref(b)} className="board-item">
              <div className="bi-name">
                <span className={`status-dot status-${b.metadata?.status ?? 'active'}`} />
                {entityName(b)}
              </div>
              {b.metadata?.summary && <div className="bi-sum">{String(b.metadata.summary)}</div>}
            </Link>
          ))}
        </div>
      </section>

      <div className="dev-cols">
        <section className="dev-section">
          <div className="section-title">Patterns</div>
          <p className="dev-hint">Reusable “how I build”.</p>
          <CraftList notes={patterns.data} loading={patterns.loading} empty="No patterns yet." />
        </section>
        <section className="dev-section">
          <div className="section-title">Learnings</div>
          <p className="dev-hint">Gotchas, banked.</p>
          <CraftList notes={learnings.data} loading={learnings.loading} empty="No learnings yet." />
        </section>
      </div>

      <section className="dev-section">
        <div className="section-title">Work log</div>
        {logs.loading && <Loading label="…" />}
        <div className="dev-craft-list">
          {(logs.data ?? []).map((n) => (
            <Link key={n.id} to={noteHref(n)} className="dev-craft-item dev-log-item">
              <span className="dev-craft-name">{n.path.split('/').pop()}</span>
              {n.createdAt && <span className="dev-craft-when">{formatRelative(n.createdAt)}</span>}
            </Link>
          ))}
          {(logs.data ?? []).length === 0 && !logs.loading && <p className="dev-hint">No log entries yet.</p>}
        </div>
      </section>
    </div>
  )
}

function CraftList({ notes, loading, empty }: { notes?: Note[] | null; loading: boolean; empty: string }) {
  if (loading && !notes) return <Loading label="…" />
  if (!notes || notes.length === 0) return <p className="dev-hint">{empty}</p>
  return (
    <div className="dev-craft-list">
      {notes.map((n) => (
        <Link key={n.id} to={noteHref(n)} className="dev-craft-item">
          <span className="dev-craft-name">{n.path.split('/').pop()}</span>
        </Link>
      ))}
    </div>
  )
}
